import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BIG_ISLAND_BOUNDS,
  confirmFreshStills,
  fetchBigIslandCameras,
  isFreshStill,
  mapHvoInventory,
  mapHvoWebcam,
  summitCamera,
  type AshCamRecord,
  fanOutStacked,
  STACK_RING_METRES,
} from './bigisland';
import { HVO_SITES, SUMMIT_CAMERAS, dmsToDecimal } from './bigisland-cameras';
import type { CctvCamera } from './types';
import { stealthFetch } from '@/lib/stealthFetch';
import { clearSourceCache } from '@/lib/sourceCache';

vi.mock('@/lib/stealthFetch', () => ({ stealthFetch: vi.fn(), stealthHeaders: vi.fn(() => ({})) }));

/** 2026-09-30 23:42:01 UTC, when the rows below were read from the AshCam index. */
const NOW_S = 1790811721;
const NOW_MS = NOW_S * 1000;

/** HVO's KWcam as the AshCam index listed it on 2026-09-30, at its pre-2025 point. */
const kwcam: AshCamRecord = {
  webcamCode: 'kilauea-kw-cam',
  webcamName: 'Kilauea - KW Cam',
  latitude: 19.421,
  longitude: -155.287,
  externalUrl: 'https://volcanoes.usgs.gov/observatories/hvo/cams/panorama.php?cam=KWcam',
  vName: 'Kilauea',
  hasImages: 'Y',
  lastImageTimestamp: NOW_S,
  currentImageUrl: 'https://volcview.wr.usgs.gov/ashcam-api/images/webcams/kilauea-kw-cam/current.jpg',
  currentMediumImageUrl: 'https://volcview.wr.usgs.gov/ashcam-api/images/webcams/kilauea-kw-cam/current-medium.jpg',
};

/** HVO's B1cam-style row: listed at 0,0 with no name, page or volcano. */
const v2cam: AshCamRecord = {
  webcamCode: 'kilauea-v2-cam',
  webcamName: 'kilauea-v2-cam',
  latitude: 0,
  longitude: 0,
  externalUrl: null,
  vName: null,
  hasImages: 'Y',
  lastImageTimestamp: NOW_S - 120,
  currentImageUrl: 'https://volcview.wr.usgs.gov/ashcam-api/images/webcams/kilauea-v2-cam/current.jpg',
  currentMediumImageUrl: 'https://volcview.wr.usgs.gov/ashcam-api/images/webcams/kilauea-v2-cam/current-medium.jpg',
};

const V1_POINT = { lat: 19.41249, lng: -155.29003 };

function onBigIsland(lat: number, lng: number): boolean {
  return lat >= BIG_ISLAND_BOUNDS.minLat && lat <= BIG_ISLAND_BOUNDS.maxLat
    && lng >= BIG_ISLAND_BOUNDS.minLng && lng <= BIG_ISLAND_BOUNDS.maxLng;
}

describe('curated places', () => {
  it('converts the IfA survey coordinates to decimal degrees', () => {
    // Gemini North, NAD 83: 19 49 25.68521 N, 155 28 08.56831 W.
    expect(dmsToDecimal(19, 49, 25.68521)).toBeCloseTo(19.8238015, 6);
    expect(dmsToDecimal(155, 28, 8.56831)).toBeCloseTo(155.4690468, 6);
  });

  it('puts every HVO camera on Hawaii Island with its USGS page', () => {
    for (const [code, site] of Object.entries(HVO_SITES)) {
      expect(onBigIsland(site.lat, site.lng), code).toBe(true);
      expect(site.page, code).toMatch(/^https:\/\/www\.usgs\.gov\//);
    }
  });

  it('puts every observatory camera on Hawaii Island with a unique id and an https still', () => {
    const ids = SUMMIT_CAMERAS.map(cam => cam.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const cam of SUMMIT_CAMERAS) {
      expect(onBigIsland(cam.lat, cam.lng), cam.id).toBe(true);
      expect(new URL(cam.feed).protocol, cam.id).toBe('https:');
    }
  });

  it('keeps KWcam and F1cam as two cameras on the mast they share with V1cam', () => {
    const kw = HVO_SITES['kilauea-kw-cam'];
    const f1 = HVO_SITES['kilauea-f1-cam'];
    expect(kw.name).not.toBe(f1.name);
    expect({ lat: kw.lat, lng: kw.lng }).toEqual(V1_POINT);
    expect({ lat: f1.lat, lng: f1.lng }).toEqual(V1_POINT);
    // Not the point the AshCam index still gives them.
    expect(kw.lat).not.toBe(19.421);
  });
});

describe('mapHvoWebcam', () => {
  it('places KWcam where USGS now says it is, not at the index\'s old point', () => {
    expect(mapHvoWebcam(kwcam, NOW_MS)).toEqual({
      id: 'usgs-hvo-kilauea-kw-cam',
      ...V1_POINT,
      name: 'Kilauea - KW Cam (Halemaumau from the west rim)',
      city: 'Kilauea',
      country: 'US',
      feed_url: 'https://volcview.wr.usgs.gov/ashcam-api/images/webcams/kilauea-kw-cam/current-medium.jpg',
      external_url: 'https://www.usgs.gov/volcanoes/kilauea/kwcam-live-panorama-halemaumau-west-rim-kilauea-summit-caldera-looking-southeast',
      source: 'USGS HVO',
    });
  });

  it('places a camera the index lists at 0,0 from the curated table', () => {
    const cam = mapHvoWebcam(v2cam, NOW_MS);
    expect(cam?.lat).toBe(19.428554);
    expect(cam?.lng).toBe(-155.25851);
    expect(cam?.city).toBe('Kilauea');
    expect(cam?.name).toBe('Kilauea - V2 Cam (east Halemaumau crater)');
    expect(cam?.external_url).toBe('https://www.usgs.gov/volcanoes/kilauea/v2cam-kilauea-volcano-hawaii-east-halemaumau-crater');
  });

  it('places an uncurated camera where the index puts it, when that is on the island', () => {
    const cam = mapHvoWebcam({
      ...kwcam, webcamCode: 'kilauea-new-cam', webcamName: 'Kilauea - New Cam', latitude: 19.39, longitude: -155.1,
    }, NOW_MS);
    expect(cam).toMatchObject({ id: 'usgs-hvo-kilauea-new-cam', lat: 19.39, lng: -155.1, name: 'Kilauea - New Cam', city: 'Kilauea' });
    expect(cam?.external_url).toBe('https://volcanoes.usgs.gov/observatories/hvo/cams/panorama.php?cam=KWcam');
  });

  it('skips an uncurated camera that is unplaced, or placed off the island', () => {
    expect(mapHvoWebcam({ ...v2cam, webcamCode: 'kilauea-b1-cam' }, NOW_MS)).toBeNull(); // 0,0
    expect(mapHvoWebcam({ ...kwcam, webcamCode: 'akunIsland-N', latitude: 54.146948, longitude: -165.60517 }, NOW_MS)).toBeNull();
    expect(mapHvoWebcam({ ...kwcam, webcamCode: 'haleakala', latitude: 20.71, longitude: -156.25 }, NOW_MS)).toBeNull(); // Maui
  });

  it('skips imageless, quiet and off-usgs.gov cameras', () => {
    expect(mapHvoWebcam({ ...kwcam, hasImages: 'N' }, NOW_MS)).toBeNull();
    // S1cam: last frame 219 hours before the read.
    expect(mapHvoWebcam({ ...kwcam, lastImageTimestamp: NOW_S - 219 * 3600 }, NOW_MS)).toBeNull();
    expect(mapHvoWebcam({ ...kwcam, lastImageTimestamp: null }, NOW_MS)).toBeNull();
    expect(mapHvoWebcam({
      ...kwcam,
      currentImageUrl: 'https://example.com/current.jpg',
      currentMediumImageUrl: 'http://volcview.wr.usgs.gov/current-medium.jpg',
    }, NOW_MS)).toBeNull();
    expect(mapHvoWebcam({ ...kwcam, currentMediumImageUrl: 'https://evil.example/usgs.gov/x.jpg', currentImageUrl: null }, NOW_MS)).toBeNull();
    expect(mapHvoWebcam({ ...kwcam, webcamCode: '' }, NOW_MS)).toBeNull();
    expect(mapHvoWebcam(null, NOW_MS)).toBeNull();
    expect(mapHvoWebcam('kilauea-kw-cam', NOW_MS)).toBeNull();
  });

  it('does not treat inherited object keys as camera codes', () => {
    expect(mapHvoWebcam({ ...v2cam, webcamCode: 'constructor' }, NOW_MS)).toBeNull();
  });

  it('falls back to the full frame when there is no medium one', () => {
    expect(mapHvoWebcam({ ...kwcam, currentMediumImageUrl: null }, NOW_MS)?.feed_url)
      .toBe('https://volcview.wr.usgs.gov/ashcam-api/images/webcams/kilauea-kw-cam/current.jpg');
  });
});

describe('mapHvoInventory', () => {
  it('keeps only Hawaii Island\'s cameras from the nationwide index, once each', () => {
    const alaska = { ...kwcam, webcamCode: 'akunIsland-N', latitude: 54.146948, longitude: -165.60517 };
    const cams = mapHvoInventory({ webcams: [alaska, kwcam, v2cam, kwcam], meta: { webcamTotal: 4 } }, NOW_MS);
    expect(cams.map(c => c.id)).toEqual(['usgs-hvo-kilauea-kw-cam', 'usgs-hvo-kilauea-v2-cam']);
  });

  it('throws when the index has no webcams list, so the last good list is kept', () => {
    expect(() => mapHvoInventory([], NOW_MS)).toThrow('missing webcams');
    expect(() => mapHvoInventory({ webcams: null }, NOW_MS)).toThrow('missing webcams');
  });
});

/** A HEAD answer with the headers the observatories send. */
function stillHead(headers: Record<string, string>, status = 200): Response {
  return new Response(null, { status, headers });
}

const FRESH_HEADERS = (nowMs: number) => ({
  'content-type': 'image/png',
  'content-length': '332882',
  'last-modified': new Date(nowMs - 4 * 60 * 1000).toUTCString(),
});

describe('isFreshStill', () => {
  it('accepts an image of real size written minutes ago', () => {
    expect(isFreshStill(stillHead(FRESH_HEADERS(NOW_MS)), NOW_MS)).toBe(true);
  });

  it('judges a still with no Last-Modified on the rest, as the VLBA\'s', () => {
    expect(isFreshStill(stillHead({ 'content-type': 'image/jpeg', 'content-length': '47754' }), NOW_MS)).toBe(true);
  });

  it('rejects empty files, old frames, error pages and failures', () => {
    // NOAA MLO's gate camera: an empty file last written in 2023.
    expect(isFreshStill(stillHead({ 'content-type': 'image/jpeg', 'content-length': '0', 'last-modified': 'Fri, 17 Feb 2023 18:46:18 GMT' }), NOW_MS)).toBe(false);
    // CFHT's Nana ao: two days old.
    expect(isFreshStill(stillHead({ ...FRESH_HEADERS(NOW_MS), 'last-modified': new Date(NOW_MS - 48 * 3600 * 1000).toUTCString() }), NOW_MS)).toBe(false);
    expect(isFreshStill(stillHead({ ...FRESH_HEADERS(NOW_MS), 'content-type': 'text/html; charset=UTF-8' }), NOW_MS)).toBe(false);
    expect(isFreshStill(stillHead({ ...FRESH_HEADERS(NOW_MS), 'last-modified': 'yesterday-ish' }), NOW_MS)).toBe(false);
    expect(isFreshStill(stillHead({ ...FRESH_HEADERS(NOW_MS), 'content-length': 'many' }), NOW_MS)).toBe(false);
    expect(isFreshStill(stillHead(FRESH_HEADERS(NOW_MS), 404), NOW_MS)).toBe(false);
  });
});

const GEMINI_HILO = SUMMIT_CAMERAS.find(cam => cam.id === 'gemini-north-hilo')!;
const MLO_NORTH = SUMMIT_CAMERAS.find(cam => cam.id === 'noaa-mlo-north')!;

/** Answer each upstream by URL; anything not named is a 503. */
function upstreams(routes: { ashcam?: Response; stills?: Record<string, Response> }) {
  vi.mocked(stealthFetch).mockImplementation(async (input) => {
    const url = String(input);
    if (url.startsWith('https://volcview.wr.usgs.gov/') && routes.ashcam) return routes.ashcam.clone();
    const still = routes.stills?.[url];
    if (still) return still.clone();
    return new Response('', { status: 503 });
  });
}

describe('confirmFreshStills', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('asks each still once, by HEAD, and keeps only current frames', async () => {
    const stale = 'https://www.cfht.hawaii.edu/images/webcam/nanaao.jpg';
    upstreams({
      stills: {
        [GEMINI_HILO.feed]: stillHead(FRESH_HEADERS(Date.now())),
        [stale]: stillHead({ ...FRESH_HEADERS(Date.now()), 'last-modified': 'Mon, 28 Sep 2026 23:16:28 GMT' }),
      },
    });
    const fresh = await confirmFreshStills([GEMINI_HILO.feed, stale, GEMINI_HILO.feed, MLO_NORTH.feed]);
    expect([...fresh]).toEqual([GEMINI_HILO.feed]);
    expect(vi.mocked(stealthFetch)).toHaveBeenCalledTimes(3);
    for (const [, init] of vi.mocked(stealthFetch).mock.calls) {
      expect(init?.method).toBe('HEAD');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('treats a still that cannot be reached as unconfirmed', async () => {
    vi.mocked(stealthFetch).mockRejectedValue(new TypeError('fetch failed'));
    expect((await confirmFreshStills([GEMINI_HILO.feed])).size).toBe(0);
    expect((await confirmFreshStills([])).size).toBe(0);
  });
});

describe('summitCamera', () => {
  it('maps a curated observatory camera to a still with its page', () => {
    expect(summitCamera(GEMINI_HILO)).toEqual({
      id: 'gemini-north-hilo',
      lat: dmsToDecimal(19, 49, 25.68521),
      lng: -dmsToDecimal(155, 28, 8.56831),
      name: 'Gemini North - view toward Hilo',
      city: 'Mauna Kea',
      country: 'US',
      feed_url: 'https://www.gemini.edu/sciops/schedules/obsStatus/currentstill_Hilo.png',
      external_url: 'http://mkwc.ifa.hawaii.edu/current/cams/',
      source: 'Gemini Observatory',
    });
  });
});

describe('fetchBigIslandCameras', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clearSourceCache();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); clearSourceCache(); });

  const nowS = () => Math.floor(Date.now() / 1000);

  it('merges the HVO webcams with the observatory cameras that are current', async () => {
    upstreams({
      // Served as text/html although the body is JSON, as the real index is.
      ashcam: new Response(JSON.stringify({ webcams: [{ ...kwcam, lastImageTimestamp: nowS() }, { ...v2cam, lastImageTimestamp: nowS() }] }), {
        headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      }),
      stills: {
        [GEMINI_HILO.feed]: stillHead(FRESH_HEADERS(Date.now())),
        [MLO_NORTH.feed]: stillHead({ 'content-type': 'image/jpeg', 'content-length': '0' }),
      },
    });
    const cams = await fetchBigIslandCameras();
    expect(cams.map(c => c.id).sort()).toEqual(['gemini-north-hilo', 'usgs-hvo-kilauea-kw-cam', 'usgs-hvo-kilauea-v2-cam']);
    expect(cams.every(c => onBigIsland(c.lat, c.lng))).toBe(true);
  });

  it('keeps the observatory cameras when the AshCam index is down', async () => {
    upstreams({ stills: { [GEMINI_HILO.feed]: stillHead(FRESH_HEADERS(Date.now())) } });
    expect((await fetchBigIslandCameras()).map(c => c.id)).toEqual(['gemini-north-hilo']);
  });

  it('returns nothing, rather than throwing, when everything is down', async () => {
    vi.mocked(stealthFetch).mockResolvedValue(new Response('Internal Server Error', { status: 500 }));
    expect(await fetchBigIslandCameras()).toEqual([]);
  });
});

it.skipIf(!process.env.RUN_LIVE_TESTS)('loads live Hawaii Island cameras from USGS and the observatories', async () => {
  const { stealthFetch: real } = await vi.importActual<typeof import('@/lib/stealthFetch')>('@/lib/stealthFetch');
  vi.mocked(stealthFetch).mockImplementation(real);
  clearSourceCache();
  const cameras = await fetchBigIslandCameras();
  const hvo = cameras.filter(c => c.source === 'USGS HVO');
  const observatories = cameras.filter(c => c.source !== 'USGS HVO');
  // 16 HVO and 22 observatory cameras were current on 2026-09-30; leave room for outages.
  expect(hvo.length).toBeGreaterThanOrEqual(8);
  expect(observatories.length).toBeGreaterThanOrEqual(10);
  expect(cameras.every(c => onBigIsland(c.lat, c.lng))).toBe(true);
  expect(cameras.every(c => c.feed_url?.startsWith('https://'))).toBe(true);
  expect(new Set(cameras.map(c => c.id)).size).toBe(cameras.length);
}, 60_000);

describe('fanOutStacked', () => {
  const at = (id: string, lat: number, lng: number): CctvCamera => ({
    id, lat, lng, name: id, city: 'Mauna Kea', country: 'US', source: 'test', feed_url: `https://example.org/${id}.jpg`,
  });
  const metres = (a: CctvCamera, b: CctvCamera) =>
    Math.hypot((a.lat - b.lat) * 111_320, (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180));

  it('spreads cameras that share a point onto a ring, leaving lone cameras alone', () => {
    const lone = at('lone', 19.4, -155.2);
    const stack = ['g1', 'g2', 'g3', 'g4', 'g5'].map(id => at(id, 19.823802, -155.469047));
    const out = fanOutStacked([lone, ...stack]);
    expect(out[0]).toEqual(lone);
    const spread = out.slice(1);
    expect(new Set(spread.map(c => `${c.lat},${c.lng}`)).size).toBe(5);
    for (const cam of spread) expect(metres(cam, stack[0])).toBeCloseTo(STACK_RING_METRES / 2, 1);
  });

  it('places a camera the same way every refresh, whatever order the sources answer in', () => {
    const stack = ['b', 'a', 'c'].map(id => at(id, 19.41249, -155.29003));
    const first = fanOutStacked(stack);
    const second = fanOutStacked([...stack].reverse());
    for (const cam of first) expect(second.find(c => c.id === cam.id)).toEqual(cam);
  });
});

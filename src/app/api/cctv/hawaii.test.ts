import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  confirmLiveStreams,
  fetchHawaiiCameras,
  goAkamaiHeaders,
  judgeStills,
  keepLiveStreams,
  keepRealStills,
  probeUrlFor,
  STILL_BLANK_MAX_BYTES,
  islandFor,
  mapGoAkamaiCamera,
  mapGoAkamaiInventory,
  type GoAkamaiCameraRecord,
} from './hawaii';
import type { CctvCamera } from './types';
import type { AshCamRecord } from './bigisland';
import { stealthFetch } from '@/lib/stealthFetch';
import { clearSourceCache } from '@/lib/sourceCache';

vi.mock('@/lib/stealthFetch', () => ({ stealthFetch: vi.fn(), stealthHeaders: vi.fn(() => ({})) }));

/** HDOT's H-1 camera as /cameras returned it on 2026-09-30 (unused fields dropped). */
const oahu: GoAkamaiCameraRecord = {
  id: 'TL-0322',
  status: 'OK',
  description: 'H-1 - East of Honouliuli Stream 1',
  location: { coordinates: { latitude: 21.3786449, longitude: -158.040771 }, facility: { roadName: 'H-1' } },
  images: [
    { status: 'OK', type: 'SnapShot', width: 320, URL: 'http://cctv.cdn.goakamai.org/SnapShot/320x240/TL-0322.jpg' },
    { status: 'OK', type: 'SnapShot', width: 800, URL: 'http://cctv.cdn.goakamai.org/SnapShot/800x600/TL-0322.jpg' },
    { status: 'OK', type: 'SnapShot', width: 1280, URL: 'http://cctv.cdn.goakamai.org/SnapShot/1280x720/TL-0322.jpg' },
    {
      status: 'OK', type: 'Stream', width: 320,
      URL: 'https://cdn3.wowza.com/5/eGNPNml0UHc3RFFI/HDOT/TL-0322_H1_East_of_Honouliuli_Stream_1.stream/playlist.m3u8',
    },
  ],
};

/** A Maui County camera: stills only, no stream. */
const maui: GoAkamaiCameraRecord = {
  id: 'TL-0801',
  status: 'OK',
  description: 'Haleakala Hwy at Kula Hwy and Old Haleakala Rd',
  location: { coordinates: { latitude: 20.8293133, longitude: -156.330246 }, facility: { roadName: 'Haleakala Hwy' } },
  images: [
    { status: 'OK', type: 'SnapShot', width: 1920, URL: 'http://cctv.cdn.goakamai.org/SnapShot/1920x1080/TL-0801.jpg' },
    { status: 'OK', type: 'SnapShot', width: 320, URL: 'http://cctv.cdn.goakamai.org/SnapShot/320x240/TL-0801.jpg' },
    { status: 'OK', type: 'SnapShot', width: 800, URL: 'http://cctv.cdn.goakamai.org/SnapShot/800x600/TL-0801.jpg' },
  ],
};

/** HVO's KWcam as the AshCam index listed it on 2026-09-30; bigisland.ts reads this index now. */
const kwcam: AshCamRecord = {
  webcamCode: 'kilauea-kw-cam',
  webcamName: 'Kilauea - KW Cam',
  latitude: 19.421,
  longitude: -155.287,
  externalUrl: 'https://volcanoes.usgs.gov/observatories/hvo/cams/panorama.php?cam=KWcam',
  vName: 'Kilauea',
  hasImages: 'Y',
  lastImageTimestamp: 1790803442,
  currentImageUrl: 'https://volcview.wr.usgs.gov/ashcam-api/images/webcams/kilauea-kw-cam/current.jpg',
  currentMediumImageUrl: 'https://volcview.wr.usgs.gov/ashcam-api/images/webcams/kilauea-kw-cam/current-medium.jpg',
};

describe('mapGoAkamaiCamera', () => {
  it('maps an Oahu row to an https still near 800 wide plus its HLS stream', () => {
    expect(mapGoAkamaiCamera(oahu)).toEqual({
      id: 'goakamai-TL-0322',
      lat: 21.3786449,
      lng: -158.040771,
      name: 'H-1 - East of Honouliuli Stream 1',
      city: 'Oahu',
      country: 'US',
      feed_url: 'https://cctv.cdn.goakamai.org/SnapShot/800x600/TL-0322.jpg',
      stream_url: 'https://cdn3.wowza.com/5/eGNPNml0UHc3RFFI/HDOT/TL-0322_H1_East_of_Honouliuli_Stream_1.stream/playlist.m3u8',
      stream_type: 'hls',
      source: 'GoAkamai',
    });
  });

  it('keeps a stills-only Maui camera, choosing 800 wide whatever the list order', () => {
    const cam = mapGoAkamaiCamera(maui);
    expect(cam?.city).toBe('Maui');
    expect(cam?.feed_url).toBe('https://cctv.cdn.goakamai.org/SnapShot/800x600/TL-0801.jpg');
    expect(cam?.stream_url).toBeUndefined();
    expect(cam?.stream_type).toBeUndefined();
  });

  it('only takes stills from the GoAkamai CDN and streams from Wowza over https', () => {
    const foreign = mapGoAkamaiCamera({
      ...oahu,
      images: [
        { status: 'OK', type: 'SnapShot', width: 800, URL: 'https://example.com/TL-0322.jpg' },
        { status: 'OK', type: 'SnapShot', width: 800, URL: 'ftp://cctv.cdn.goakamai.org/TL-0322.jpg' },
        { status: 'OK', type: 'Stream', URL: 'http://cdn3.wowza.com/5/x/TL-0322.stream/playlist.m3u8' },
        { status: 'OK', type: 'Stream', URL: 'https://evil.example/wowza.com/playlist.m3u8' },
        { status: 'OK', type: 'Stream', URL: 'https://cdn3.wowza.com/5/x/TL-0322.stream/manifest.mpd' },
      ],
    });
    expect(foreign).toBeNull();
  });

  it('skips images the service has flagged, and breaks a size tie toward the sharper still', () => {
    const cam = mapGoAkamaiCamera({
      ...oahu,
      images: oahu.images!.map(img => img.width === 800 ? { ...img, status: 'Offline' } : img),
    });
    expect(cam?.feed_url).toBe('https://cctv.cdn.goakamai.org/SnapShot/1280x720/TL-0322.jpg');
    expect(mapGoAkamaiCamera({ ...oahu, images: oahu.images!.map(img => ({ ...img, status: 'Offline' })) })).toBeNull();
  });

  it('drops flagged, idless, unplaced and imageless rows', () => {
    expect(mapGoAkamaiCamera({ ...oahu, status: 'Offline' })).toBeNull();
    expect(mapGoAkamaiCamera({ ...oahu, id: '' })).toBeNull();
    expect(mapGoAkamaiCamera({ ...oahu, id: null })).toBeNull();
    expect(mapGoAkamaiCamera({ ...oahu, images: [] })).toBeNull();
    expect(mapGoAkamaiCamera({ ...oahu, images: null })).toBeNull();
    expect(mapGoAkamaiCamera({ ...oahu, location: null })).toBeNull();
    expect(mapGoAkamaiCamera({ ...oahu, location: { coordinates: { latitude: 0, longitude: 0 } } })).toBeNull();
    // The same camera moved to Los Angeles.
    expect(mapGoAkamaiCamera({ ...oahu, location: { coordinates: { latitude: 34.05, longitude: -118.24 } } })).toBeNull();
    expect(mapGoAkamaiCamera(null)).toBeNull();
    expect(mapGoAkamaiCamera('TL-0322')).toBeNull();
  });

  it('names a camera by its road, then its id, when the description is blank', () => {
    expect(mapGoAkamaiCamera({ ...oahu, description: '  ' })?.name).toBe('H-1');
    expect(mapGoAkamaiCamera({ ...oahu, description: null, location: { ...oahu.location, facility: null } })?.name)
      .toBe('GoAkamai Camera TL-0322');
  });
});

describe('mapGoAkamaiInventory', () => {
  it('deduplicates on id and keeps every usable row', () => {
    const cams = mapGoAkamaiInventory([oahu, maui, oahu, null, { id: 'TL-9999' }]);
    expect(cams.map(c => c.id)).toEqual(['goakamai-TL-0322', 'goakamai-TL-0801']);
  });

  it('throws on a payload that is not a list, so the last good list is kept', () => {
    expect(() => mapGoAkamaiInventory({ error: 'Internal Server Error' })).toThrow('did not return a list');
    expect(() => mapGoAkamaiInventory(null)).toThrow();
  });
});

describe('islandFor', () => {
  it('labels each island, and falls back to Hawaii in the channels', () => {
    expect(islandFor(19.7241, -155.0868)).toBe('Hawaii Island'); // Hilo
    expect(islandFor(20.0785, -155.4686)).toBe('Hawaii Island'); // Honokaa
    expect(islandFor(19.64, -155.99)).toBe('Hawaii Island'); // Kailua-Kona
    expect(islandFor(21.9789, -159.3711)).toBe('Kauai'); // Lihue
    expect(islandFor(21.3069, -157.8583)).toBe('Oahu'); // Honolulu
    expect(islandFor(20.8893, -156.4729)).toBe('Maui'); // Kahului
    expect(islandFor(21.0906, -157.0226)).toBe('Molokai'); // Kaunakakai
    expect(islandFor(20.8275, -156.9205)).toBe('Lanai'); // Lanai City
    expect(islandFor(21.5, -158.8)).toBe('Hawaii'); // Kaieiewaho Channel
  });
});

const OAHU_STREAM = oahu.images!.find(img => img.type === 'Stream')!.URL!;
const PLAYLIST = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=3237595,RESOLUTION=720x480\nchunklist.m3u8\n';

/** Answer each upstream by URL; anything not named is a 503. */
function upstreams(routes: { goakamai?: Response; ashcam?: Response; playlists?: Record<string, Response> }) {
  vi.mocked(stealthFetch).mockImplementation(async (input) => {
    const url = String(input);
    if (url.startsWith('https://a.cameraservice.goakamai.org/') && routes.goakamai) return routes.goakamai.clone();
    if (url.startsWith('https://volcview.wr.usgs.gov/') && routes.ashcam) return routes.ashcam.clone();
    const playlist = routes.playlists?.[url];
    if (playlist) return playlist.clone();
    return new Response('', { status: 503 });
  });
}

describe('confirmLiveStreams / keepLiveStreams', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('confirms only playlists that answer with an HLS playlist', async () => {
    const dead = 'https://cdn3.wowza.com/5/x/TL-0001.stream/playlist.m3u8';
    const errorPage = 'https://cdn3.wowza.com/5/x/TL-0002.stream/playlist.m3u8';
    upstreams({
      playlists: {
        [OAHU_STREAM]: new Response(PLAYLIST),
        [dead]: new Response('Not Found', { status: 404 }),
        [errorPage]: new Response('<html>maintenance</html>'),
      },
    });
    const live = await confirmLiveStreams([OAHU_STREAM, dead, errorPage, OAHU_STREAM]);
    expect([...live]).toEqual([OAHU_STREAM]);
    // Asked once each, duplicates included only once.
    expect(vi.mocked(stealthFetch)).toHaveBeenCalledTimes(3);
  });

  it('treats a playlist that cannot be reached as unconfirmed', async () => {
    vi.mocked(stealthFetch).mockRejectedValue(new TypeError('fetch failed'));
    expect((await confirmLiveStreams([OAHU_STREAM])).size).toBe(0);
    expect((await confirmLiveStreams([])).size).toBe(0);
  });

  it('keeps a dead stream\'s camera on its still, and drops a camera left with nothing', () => {
    const withStream = mapGoAkamaiCamera(oahu)!;
    const streamOnly = { ...withStream, id: 'goakamai-TL-9', feed_url: undefined };
    const [still, ...rest] = keepLiveStreams([withStream, streamOnly], new Set());
    expect(rest).toEqual([]);
    expect(still.feed_url).toBe('https://cctv.cdn.goakamai.org/SnapShot/800x600/TL-0322.jpg');
    expect(still).not.toHaveProperty('stream_url');
    expect(still).not.toHaveProperty('stream_type');
    expect(keepLiveStreams([withStream], new Set([OAHU_STREAM]))).toEqual([withStream]);
  });
});

describe('fetchHawaiiCameras', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clearSourceCache();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); clearSourceCache(); });

  it('asks GoAkamai the way its own site does, and merges both sources', async () => {
    upstreams({
      goakamai: Response.json([oahu, maui]),
      // Served as text/html although the body is JSON, as the real index is.
      ashcam: new Response(JSON.stringify({ webcams: [{ ...kwcam, lastImageTimestamp: Math.floor(Date.now() / 1000) }] }), {
        headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      }),
      playlists: { [OAHU_STREAM]: new Response(PLAYLIST) },
    });

    const cams = await fetchHawaiiCameras();
    expect(cams.map(c => c.city).sort()).toEqual(['Kilauea', 'Maui', 'Oahu']);
    expect(cams.find(c => c.city === 'Oahu')?.stream_url).toBe(OAHU_STREAM);

    const goAkamaiCall = vi.mocked(stealthFetch).mock.calls.find(([url]) => String(url).includes('goakamai'));
    const headers = goAkamaiCall?.[1]?.headers as Record<string, string>;
    expect(headers.Origin).toBe('https://goakamai.org');
    expect(headers['x-icx-copyright']).toBe('ICxTransportationGroup');
    expect(Math.abs(Number(headers['x-icx-ts']) - Date.now())).toBeLessThan(60_000);
    expect(goAkamaiCall?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('serves a camera whose playlist is dead as a still', async () => {
    upstreams({ goakamai: Response.json([oahu]) }); // the playlist answers 503
    const [cam] = await fetchHawaiiCameras();
    expect(cam.feed_url).toBe('https://cctv.cdn.goakamai.org/SnapShot/800x600/TL-0322.jpg');
    expect(cam.stream_url).toBeUndefined();
    expect(cam.stream_type).toBeUndefined();
  });

  it('keeps one source on the map when the other fails', async () => {
    upstreams({ goakamai: Response.json([oahu]), playlists: { [OAHU_STREAM]: new Response(PLAYLIST) } });
    expect((await fetchHawaiiCameras()).map(c => c.id)).toEqual(['goakamai-TL-0322']);
  });

  it('returns nothing, rather than throwing, when both sources are down', async () => {
    vi.mocked(stealthFetch).mockResolvedValue(new Response('Internal Server Error', { status: 500 }));
    expect(await fetchHawaiiCameras()).toEqual([]);
  });

  it('builds the timestamp header from the clock it is given', () => {
    expect(goAkamaiHeaders(1790803409524)['x-icx-ts']).toBe('1790803409524');
  });
});

describe('judging GoAkamai stills', () => {
  const cam = (id: string, lat: number, lng: number, extra: Partial<CctvCamera> = {}): CctvCamera => ({
    id, lat, lng, name: id, city: 'Oahu', country: 'US', source: 'GoAkamai',
    feed_url: `https://cctv.cdn.goakamai.org/SnapShot/800x600/${id}.jpg`, ...extra,
  });
  const probe = (digest: string, bytes = 17_325) => ({ digest, bytes });

  it('judges the small variant of a still', () => {
    expect(probeUrlFor('https://cctv.cdn.goakamai.org/SnapShot/800x600/TL-0822.jpg'))
      .toBe('https://cctv.cdn.goakamai.org/SnapShot/320x240/TL-0822.jpg');
  });

  it('calls a frame shared by cameras kilometres apart the placeholder', () => {
    const a = cam('TL-0217', 21.2787, -157.8155);
    const b = cam('TL-0200', 21.2862, -157.8255); // ~1.3 km away
    const c = cam('TL-0322', 21.3786, -158.0408);
    const probes = new Map([[a.feed_url!, probe('logo', 11_841)], [b.feed_url!, probe('logo', 11_841)], [c.feed_url!, probe('street')]]);
    expect(judgeStills([a, b, c], probes)).toEqual({ deadStills: new Set(['TL-0217', 'TL-0200']), duplicates: new Set() });
  });

  it('calls a frame under the blank threshold dead, however unique', () => {
    const a = cam('TL-0119', 21.33, -157.86);
    expect(judgeStills([a], new Map([[a.feed_url!, probe('black', STILL_BLANK_MAX_BYTES - 1)]])).deadStills).toEqual(new Set(['TL-0119']));
  });

  it('treats an identical frame at the same spot as one camera listed twice, keeping the listing with video', () => {
    const a = cam('TL-0137', 21.3080, -157.8662);
    const b = cam('TL-0370', 21.30805, -157.86615, { stream_url: 'https://cdn3.wowza.com/5/x/TL-0370.stream/playlist.m3u8', stream_type: 'hls' });
    const probes = new Map([[a.feed_url!, probe('nimitz')], [b.feed_url!, probe('nimitz')]]);
    expect(judgeStills([a, b], probes)).toEqual({ deadStills: new Set(), duplicates: new Set(['TL-0137']) });
  });

  it('leaves unjudged cameras alone', () => {
    expect(judgeStills([cam('TL-0001', 21.3, -157.8)], new Map())).toEqual({ deadStills: new Set(), duplicates: new Set() });
  });

  it('keeps working video without its dead still, and drops a camera left with nothing', () => {
    const video = cam('TL-0001', 21.3, -157.8, { stream_url: 'https://cdn3.wowza.com/5/x/TL-0001.stream/playlist.m3u8', stream_type: 'hls' });
    const stillOnly = cam('TL-0822', 20.8369, -156.3297, { city: 'Maui' });
    const dup = cam('TL-0370', 21.3, -157.8);
    const fine = cam('TL-0322', 21.3786, -158.0408);
    const kept = keepRealStills([video, stillOnly, dup, fine], {
      deadStills: new Set(['TL-0001', 'TL-0822']),
      duplicates: new Set(['TL-0370']),
    });
    expect(kept.map(c => c.id)).toEqual(['TL-0001', 'TL-0322']);
    expect(kept[0].feed_url).toBeUndefined();
    expect(kept[0].stream_url).toBe(video.stream_url);
    expect(kept[1]).toEqual(fine);
  });
});

describe('fetchHawaiiCameras with dead stills', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clearSourceCache();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); clearSourceCache(); });

  it('drops still-only cameras that serve the shared placeholder and keeps the real one', async () => {
    const logo = new Uint8Array(11_841).fill(7);
    const street = new Uint8Array(17_325).fill(9);
    const mauiTwo: GoAkamaiCameraRecord = {
      ...maui,
      id: 'TL-0822',
      description: 'Haleakala Hwy at Makawao Ave',
      location: { coordinates: { latitude: 20.836895, longitude: -156.329727 }, facility: { roadName: 'Haleakala Hwy' } },
      images: maui.images!.map(img => ({ ...img, URL: img.URL?.replace('TL-0801', 'TL-0822') })),
    };
    const small = (id: string) => `https://cctv.cdn.goakamai.org/SnapShot/320x240/${id}.jpg`;
    upstreams({
      goakamai: Response.json([oahu, maui, mauiTwo]),
      playlists: {
        [OAHU_STREAM]: new Response(PLAYLIST),
        [small('TL-0322')]: new Response(street),
        [small('TL-0801')]: new Response(logo),
        [small('TL-0822')]: new Response(logo),
      },
    });
    const cams = await fetchHawaiiCameras();
    expect(cams.map(c => c.id)).toEqual(['goakamai-TL-0322']);
  });
});

it.skipIf(!process.env.RUN_LIVE_TESTS)('loads live Hawaii cameras from GoAkamai', async () => {
  const { stealthFetch: real } = await vi.importActual<typeof import('@/lib/stealthFetch')>('@/lib/stealthFetch');
  vi.mocked(stealthFetch).mockImplementation(real);
  clearSourceCache();
  const cameras = await fetchHawaiiCameras();
  expect(cameras.filter(c => c.city === 'Oahu').length).toBeGreaterThan(100);
  // Not asserting Maui: on 2026-09-30 26 of its 27 cameras served the placeholder
  // and are dropped, so its count rides on one camera's health.
}, 30_000);

import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';
import { createPool } from '@/lib/fetch-pool';
import type { CctvCamera } from './types';
import { HVO_SITES, SUMMIT_CAMERAS, type SummitCamera } from './bigisland-cameras';

/**
 * OSIRIS — Hawaii Island (Big Island) cameras.
 *
 * HDOT publishes no traffic camera on Hawaii Island, so the island's public
 * cameras are the scientific ones, all official and keyless:
 *
 * USGS Hawaiian Volcano Observatory — Kilauea and Mauna Loa webcams, read
 * from the USGS AshCam index (https://volcview.wr.usgs.gov/ashcam-api/webcamApi/),
 * which says when each camera last sent a frame and serves an 800-wide copy.
 * The index does not say where most of them are, so their places come from
 * bigisland-cameras.ts. A camera the index places itself and that file does
 * not know is placed where the index says.
 *
 * Mauna Kea and Mauna Loa observatories — Gemini, Subaru, Keck, UKIRT, IRTF,
 * the VLBA antenna, Hale Pohaku and NOAA's Mauna Loa Observatory. Each
 * publishes a still at a fixed URL; there is no listing, so the list is
 * curated and each still is checked on every refresh (confirmFreshStills).
 *
 * Neither source needs the proxy: every still here is served over https.
 */

/** Hawaii Island, padded. A point outside it belongs to another island or is wrong. */
export const BIG_ISLAND_BOUNDS = { minLat: 18.8, maxLat: 20.4, minLng: -156.2, maxLng: -154.7 };

/**
 * HVO's cameras send a frame every few minutes, night included, and the
 * observatory cameras every few minutes too. One that has sent nothing for a
 * day is down, and its last frame would pass for live.
 */
export const MAX_FRAME_AGE_MS = 24 * 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, maxLength = 200): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : undefined;
}

/** A finite coordinate pair on Hawaii Island, or null. */
function bigIslandPoint(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < BIG_ISLAND_BOUNDS.minLat || lat > BIG_ISLAND_BOUNDS.maxLat) return null;
  if (lng < BIG_ISLAND_BOUNDS.minLng || lng > BIG_ISLAND_BOUNDS.maxLng) return null;
  return { lat, lng };
}

// ═══ USGS Hawaiian Volcano Observatory (AshCam index) ═══

const ASHCAM_WEBCAMS = 'https://volcview.wr.usgs.gov/ashcam-api/webcamApi/webcams';
const USGS_HOST = 'usgs.gov';

/** One AshCam webcam (only the fields we consume). */
export interface AshCamRecord {
  webcamCode?: string | null;
  webcamName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  externalUrl?: string | null;
  vName?: string | null;
  hasImages?: string | null;
  lastImageTimestamp?: number | null;
  currentImageUrl?: string | null;
  currentMediumImageUrl?: string | null;
}

/** An https URL on usgs.gov or one of its subdomains, or undefined. */
function usgsUrl(value: unknown): string | undefined {
  const raw = text(value, 2048);
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  const host = url.hostname.toLowerCase();
  const onUsgs = host === USGS_HOST || host.endsWith(`.${USGS_HOST}`);
  return onUsgs && url.protocol === 'https:' ? url.href : undefined;
}

/**
 * Map one AshCam webcam to a Hawaii Island camera, or null when it is
 * elsewhere, unplaced, imageless or gone quiet. `nowMs` is injectable for
 * tests. Exported for tests.
 */
export function mapHvoWebcam(row: unknown, nowMs: number = Date.now()): CctvCamera | null {
  if (!isRecord(row)) return null;
  const code = text(row.webcamCode, 64);
  if (!code || row.hasImages !== 'Y') return null;

  // The curated place wins: the index's own coordinates for KWcam and F1cam
  // are from before they moved.
  const site = Object.hasOwn(HVO_SITES, code) ? HVO_SITES[code] : undefined;
  const point = site ? { lat: site.lat, lng: site.lng } : bigIslandPoint(row.latitude, row.longitude);
  if (!point) return null;

  const last = row.lastImageTimestamp;
  if (typeof last !== 'number' || !Number.isFinite(last)) return null;
  if (nowMs - last * 1000 > MAX_FRAME_AGE_MS) return null;

  // The medium frame is 800 wide and tens of KB; the full one is over a megabyte.
  const image = usgsUrl(row.currentMediumImageUrl) ?? usgsUrl(row.currentImageUrl);
  if (!image) return null;

  const page = site?.page ?? usgsUrl(row.externalUrl);
  return {
    id: `usgs-hvo-${code}`,
    lat: point.lat,
    lng: point.lng,
    name: site?.name ?? text(row.webcamName) ?? code,
    city: site?.area ?? text(row.vName, 64) ?? 'Hawaii Island',
    country: 'US',
    feed_url: image,
    ...(page ? { external_url: page } : {}),
    source: 'USGS HVO',
  };
}

/** Map the nationwide AshCam index to Hawaii Island's cameras. Throws on an unexpected shape. Exported for tests. */
export function mapHvoInventory(data: unknown, nowMs: number = Date.now()): CctvCamera[] {
  const webcams = isRecord(data) ? data.webcams : undefined;
  if (!Array.isArray(webcams)) throw new Error('USGS AshCam index is missing webcams');
  const cams = new Map<string, CctvCamera>();
  for (const row of webcams) {
    const cam = mapHvoWebcam(row, nowMs);
    if (cam && !cams.has(cam.id)) cams.set(cam.id, cam);
  }
  return [...cams.values()];
}

async function loadHvoCameras(): Promise<CctvCamera[]> {
  const res = await stealthFetch(ASHCAM_WEBCAMS, {
    signal: AbortSignal.timeout(15000),
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`USGS AshCam HTTP ${res.status}`);
  // Served as text/html although the body is JSON.
  const cams = mapHvoInventory(JSON.parse(await res.text()));
  console.log(`[OSIRIS] Hawaii Island cameras — USGS HVO: ${cams.length}`);
  return cams;
}

// ═══ Mauna Kea and Mauna Loa observatories ═══

/*
 * Each still is asked for its headers once per refresh. All of them answered
 * HEAD on 2026-09-30. A still is kept when it comes back as an image of real
 * size, last written within a day. Last-Modified is the only freshness signal
 * these servers give; the VLBA's sends none, so its still is judged on the
 * rest. The budget bounds the whole pass, so one hung host costs only its own
 * cameras for one refresh.
 */
const STILL_PROBE_CONCURRENCY = 8;
const STILL_PROBE_BUDGET_MS = 8000;
/** NOAA's dead cameras are left as empty files; real frames are tens of KB. */
const MIN_STILL_BYTES = 1024;

/** Whether a still's response headers describe a current frame. Exported for tests. */
export function isFreshStill(res: Response, nowMs: number = Date.now()): boolean {
  if (!res.ok) return false;
  const type = res.headers.get('content-type') ?? '';
  if (!/^image\//i.test(type.trim())) return false;

  const length = res.headers.get('content-length');
  if (length !== null) {
    const bytes = Number(length);
    if (!Number.isFinite(bytes) || bytes < MIN_STILL_BYTES) return false;
  }

  const modified = res.headers.get('last-modified');
  if (modified !== null) {
    const writtenMs = Date.parse(modified);
    if (!Number.isFinite(writtenMs)) return false;
    if (nowMs - writtenMs > MAX_FRAME_AGE_MS) return false;
  }
  return true;
}

/** The stills among `urls` that are current frames. Exported for tests. */
export async function confirmFreshStills(urls: string[], nowMs: number = Date.now()): Promise<Set<string>> {
  const fresh = new Set<string>();
  if (!urls.length) return fresh;

  const pool = createPool(STILL_PROBE_CONCURRENCY);
  const deadline = Date.now() + STILL_PROBE_BUDGET_MS;
  await Promise.all([...new Set(urls)].map(url => pool.run(async () => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return; // out of time: left unconfirmed
    try {
      const res = await stealthFetch(url, { method: 'HEAD', signal: AbortSignal.timeout(remaining) });
      if (isFreshStill(res, nowMs)) fresh.add(url);
    } catch {
      // Unreachable, or cut off by the budget: not confirmed.
    }
  })));
  return fresh;
}

/** A curated observatory camera as a map camera. Exported for tests. */
export function summitCamera(cam: SummitCamera): CctvCamera {
  return {
    id: cam.id,
    lat: cam.lat,
    lng: cam.lng,
    name: cam.name,
    city: cam.area,
    country: 'US',
    feed_url: cam.feed,
    external_url: cam.page,
    source: cam.source,
  };
}

async function loadSummitCameras(): Promise<CctvCamera[]> {
  const fresh = await confirmFreshStills(SUMMIT_CAMERAS.map(cam => cam.feed));
  const cams = SUMMIT_CAMERAS.filter(cam => fresh.has(cam.feed)).map(summitCamera);
  console.log(`[OSIRIS] Hawaii Island cameras — observatories: ${cams.length}/${SUMMIT_CAMERAS.length} current`);
  return cams;
}

// ═══ Region ═══

/* Cached apart, so an AshCam outage cannot take the observatory cameras with
   it, nor the other way round. */
const sourceFetchers = [
  cachedSource('bigisland:usgs-hvo', loadHvoCameras),
  cachedSource('bigisland:observatories', loadSummitCameras),
];

export async function fetchBigIslandCameras(): Promise<CctvCamera[]> {
  const results = await Promise.allSettled(sourceFetchers.map(fetcher => fetcher()));
  return results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
}

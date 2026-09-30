import { createHash } from 'node:crypto';
import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';
import { createPool } from '@/lib/fetch-pool';
import type { CctvCamera } from './types';

/**
 * OSIRIS — Hawaii CCTV Cameras
 * Two official sources, both keyless:
 *
 * GoAkamai (https://goakamai.org) — the traveler site HDOT runs with the City
 * and County of Honolulu. Its camera page reads its list from
 * https://a.cameraservice.goakamai.org/cameras: 336 cameras on 2026-09-30,
 * 309 on Oahu and 27 on Maui. HDOT publishes no camera on Hawaii Island,
 * Kauai, Molokai or Lanai there (Kauai's four Route 560 cameras were a
 * construction-season install and are gone from the list).
 *
 * The service only answers requests shaped like the site's own client: an
 * Origin of goakamai.org, `x-icx-copyright` (a constant the site ships in its
 * public config) and `x-icx-ts` (Date.now() at request time). Without them it
 * returns 500, and 403 with a stale timestamp. Neither is a credential; the
 * site sends both for every anonymous visitor.
 *
 * Snapshots are listed as http:// on cctv.cdn.goakamai.org, which serves the
 * same files over https, so they are upgraded rather than proxied. 302 of the
 * 336 also list a Wowza HLS playlist, served with
 * Access-Control-Allow-Origin: *, so it plays in a tile as it is — but only
 * about 250 of those answer, so each playlist is checked before it is used
 * (see confirmLiveStreams).
 *
 * USGS AshCam (https://volcview.wr.usgs.gov/ashcam-api/webcamApi/) — the
 * Volcano Science Center's webcam index, which carries the Hawaiian Volcano
 * Observatory's cameras. Only the ones USGS has given coordinates are placed
 * (KWcam and F1cam at Kilauea's summit on 2026-09-30); the rest are listed at
 * 0,0 and are skipped rather than guessed. The index's own geojson query
 * rounds coordinates to whole degrees, so the full list is read and filtered.
 */

/** All eight main islands, padded — anything outside is a bad coordinate. */
export const HI_BOUNDS = { minLat: 18.8, maxLat: 22.3, minLng: -160.3, maxLng: -154.7 };

/**
 * Coarse per-island boxes, used only to label a camera. None overlap; a point
 * in the channels between them falls back to plain "Hawaii".
 */
const ISLANDS: ReadonlyArray<{ name: string; minLat: number; maxLat: number; minLng: number; maxLng: number }> = [
  { name: 'Kauai', minLat: 21.7, maxLat: 22.3, minLng: -160.3, maxLng: -159.2 },
  { name: 'Oahu', minLat: 21.2, maxLat: 21.75, minLng: -158.35, maxLng: -157.6 },
  { name: 'Molokai', minLat: 21.0, maxLat: 21.25, minLng: -157.35, maxLng: -156.7 },
  { name: 'Lanai', minLat: 20.7, maxLat: 20.95, minLng: -157.1, maxLng: -156.8 },
  { name: 'Maui', minLat: 20.5, maxLat: 21.05, minLng: -156.7, maxLng: -155.95 },
  { name: 'Hawaii Island', minLat: 18.8, maxLat: 20.3, minLng: -156.1, maxLng: -154.7 },
];

/** The island a point sits on, or "Hawaii" when it is not clearly on one. */
export function islandFor(lat: number, lng: number): string {
  const island = ISLANDS.find(b => lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng);
  return island?.name ?? 'Hawaii';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, maxLength = 200): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : undefined;
}

/** A finite coordinate pair inside Hawaii, or null. */
function hawaiiPoint(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < HI_BOUNDS.minLat || lat > HI_BOUNDS.maxLat) return null;
  if (lng < HI_BOUNDS.minLng || lng > HI_BOUNDS.maxLng) return null;
  return { lat, lng };
}

/** Parse a URL and keep it only if it is on `host` or one of its subdomains. */
function urlOnHost(value: unknown, host: string): URL | null {
  const raw = text(value, 2048);
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const hostname = url.hostname.toLowerCase();
  return hostname === host || hostname.endsWith(`.${host}`) ? url : null;
}

// ═══ GoAkamai (HDOT / City and County of Honolulu) ═══

const GOAKAMAI_CAMERAS = 'https://a.cameraservice.goakamai.org/cameras';
const GOAKAMAI_ORIGIN = 'https://goakamai.org';
/** `icxCopyright` from the site's public config (window.__NUXT__.config). */
const GOAKAMAI_CLIENT = 'ICxTransportationGroup';
/** Every snapshot the service lists lives here. */
const GOAKAMAI_SNAPSHOT_HOST = 'cctv.cdn.goakamai.org';
/** Every stream the service lists is a Wowza CDN playlist. */
const GOAKAMAI_STREAM_HOST = 'wowza.com';
/**
 * Each camera lists its still at several sizes (320x240 and 800x600 always,
 * some up to 1920x1088). 320 is a postage stamp in a tile; 1920 is ~230 KB a
 * refresh against ~100 KB at 800. The one nearest 800 wide is used.
 */
const SNAPSHOT_TARGET_WIDTH = 800;

/** One image entry of a /cameras row (only the fields we consume). */
export interface GoAkamaiImage {
  status?: string | null;
  type?: string | null;
  width?: number | null;
  URL?: string | null;
}

/** One row of /cameras (only the fields we consume). */
export interface GoAkamaiCameraRecord {
  id?: string | null;
  status?: string | null;
  description?: string | null;
  location?: {
    coordinates?: { latitude?: number | null; longitude?: number | null } | null;
    facility?: { roadName?: string | null } | null;
  } | null;
  images?: GoAkamaiImage[] | null;
}

/** The images of one type that the service has not flagged. */
function usableImages(images: unknown, type: 'SnapShot' | 'Stream'): Record<string, unknown>[] {
  if (!Array.isArray(images)) return [];
  return images.filter((img): img is Record<string, unknown> =>
    isRecord(img) && img.type === type && (img.status == null || img.status === 'OK'));
}

/** The https still nearest the target width, or undefined. */
function pickSnapshot(images: unknown): string | undefined {
  let best: { url: string; width: number } | undefined;
  for (const img of usableImages(images, 'SnapShot')) {
    const url = urlOnHost(img.URL, GOAKAMAI_SNAPSHOT_HOST);
    if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) continue;
    url.protocol = 'https:'; // listed as http; the CDN serves the same file over https
    const width = typeof img.width === 'number' && Number.isFinite(img.width) ? img.width : 0;
    const gap = Math.abs(width - SNAPSHOT_TARGET_WIDTH);
    const bestGap = best ? Math.abs(best.width - SNAPSHOT_TARGET_WIDTH) : Infinity;
    // On a tie the sharper frame wins.
    if (!best || gap < bestGap || (gap === bestGap && width > best.width)) best = { url: url.href, width };
  }
  return best?.url;
}

/** The camera's HLS playlist, or undefined. */
function pickStream(images: unknown): string | undefined {
  for (const img of usableImages(images, 'Stream')) {
    const url = urlOnHost(img.URL, GOAKAMAI_STREAM_HOST);
    if (url && url.protocol === 'https:' && /\.m3u8$/i.test(url.pathname)) return url.href;
  }
  return undefined;
}

/** Map one /cameras row to a camera, or null if it should be skipped. Exported for tests. */
export function mapGoAkamaiCamera(row: unknown): CctvCamera | null {
  if (!isRecord(row)) return null;
  const id = text(row.id, 64);
  if (!id) return null;
  // The service's own health flag. Every row read "OK" on 2026-09-30.
  if (row.status != null && row.status !== 'OK') return null;

  const location = isRecord(row.location) ? row.location : undefined;
  const coordinates = location && isRecord(location.coordinates) ? location.coordinates : undefined;
  const point = hawaiiPoint(coordinates?.latitude, coordinates?.longitude);
  if (!point) return null;

  const snapshot = pickSnapshot(row.images);
  const stream = pickStream(row.images);
  if (!snapshot && !stream) return null;

  const facility = location && isRecord(location.facility) ? location.facility : undefined;
  const name = text(row.description) ?? text(facility?.roadName) ?? `GoAkamai Camera ${id}`;

  return {
    id: `goakamai-${id}`,
    lat: point.lat,
    lng: point.lng,
    name,
    city: islandFor(point.lat, point.lng),
    country: 'US',
    ...(snapshot ? { feed_url: snapshot } : {}),
    ...(stream ? { stream_url: stream, stream_type: 'hls' as const } : {}),
    source: 'GoAkamai',
  };
}

/** Map the whole /cameras payload. Throws on a payload that is not a list. Exported for tests. */
export function mapGoAkamaiInventory(data: unknown): CctvCamera[] {
  if (!Array.isArray(data)) throw new Error('GoAkamai /cameras did not return a list');
  const cams = new Map<string, CctvCamera>();
  for (const row of data) {
    const cam = mapGoAkamaiCamera(row);
    if (cam && !cams.has(cam.id)) cams.set(cam.id, cam);
  }
  return [...cams.values()];
}

/** The headers the GoAkamai site's own client sends. Exported for tests. */
export function goAkamaiHeaders(now: number): Record<string, string> {
  return {
    Accept: 'application/json',
    Origin: GOAKAMAI_ORIGIN,
    Referer: `${GOAKAMAI_ORIGIN}/`,
    'x-icx-copyright': GOAKAMAI_CLIENT,
    'x-icx-ts': String(now),
  };
}

/*
 * The viewer plays a camera's stream instead of its still, not as a fallback
 * to it, so a dead playlist turns a working camera into "FEED UNAVAILABLE".
 * On 2026-09-30, 51 of GoAkamai's 302 playlists answered 404 or 403. Each is
 * asked for once per refresh; only those that come back as a playlist keep
 * their stream, and the rest keep their still.
 *
 * Measured from Node on 2026-09-30: list plus all 302 probes, 16 wide, took
 * 5.3s cold, inside the route's 12s region budget; a warm pass is under 2s.
 * They all go to one CDN host. The probe budget bounds the whole pass, so a
 * CDN that hangs costs the region its video for one refresh, never its
 * cameras.
 */
const STREAM_PROBE_CONCURRENCY = 16;
const STREAM_PROBE_BUDGET_MS = 8000;

/** The playlists among `urls` that answer with an HLS playlist. Exported for tests. */
export async function confirmLiveStreams(urls: string[]): Promise<Set<string>> {
  const live = new Set<string>();
  if (!urls.length) return live;

  const pool = createPool(STREAM_PROBE_CONCURRENCY);
  const deadline = Date.now() + STREAM_PROBE_BUDGET_MS;
  await Promise.all([...new Set(urls)].map(url => pool.run(async () => {
    // Each probe gets whatever is left of the budget, on its own signal.
    const remaining = deadline - Date.now();
    if (remaining <= 0) return; // out of time: left unconfirmed
    try {
      const res = await stealthFetch(url, { signal: AbortSignal.timeout(remaining) });
      if (res.ok && (await res.text()).trimStart().startsWith('#EXTM3U')) live.add(url);
    } catch {
      // Unreachable, or cut off by the budget: not confirmed.
    }
  })));
  return live;
}

/** Drop the stream from any camera whose playlist is not in `live`. Exported for tests. */
export function keepLiveStreams(cams: CctvCamera[], live: ReadonlySet<string>): CctvCamera[] {
  return cams.flatMap(cam => {
    if (!cam.stream_url || live.has(cam.stream_url)) return [cam];
    const still: CctvCamera = { ...cam };
    delete still.stream_url;
    delete still.stream_type;
    return still.feed_url ? [still] : [];
  });
}

/*
 * Stills. A GoAkamai camera that has stopped sending frames still answers
 * 200 image/jpeg, so a status check proves nothing: the picture has to be
 * judged. Measured across all 336 cameras at 320x240 on 2026-09-30, 13:40 HST:
 *   • 66 returned one byte-identical "GoAkamai — Image Temporarily
 *     Unavailable" logo, including 26 of Maui's 27 cameras;
 *   • 4 returned black "No video" frames of 1,940–4,798 bytes;
 *   • the dimmest real frame was 6,013 bytes, the median 17,325;
 *   • two cameras are each listed twice, 6 m and 23 m apart, and return
 *     byte-identical real frames (Nimitz & Pacific, Makakilo & Farrington).
 * So a frame that other cameras return byte for byte is the placeholder,
 * unless every copy sits at the same spot, in which case it is one camera
 * listed twice; and a frame under STILL_BLANK_MAX_BYTES has nothing in it.
 * The small 320x240 variant is enough to judge and costs ~4 MB a refresh
 * for all of them, against ~27 MB for the 800-wide one the viewer shows.
 */
const STILL_PROBE_CONCURRENCY = 16;
const STILL_PROBE_BUDGET_MS = 8000;
export const STILL_BLANK_MAX_BYTES = 5000;
const SAME_SPOT_METRES = 250;

/** What one still looked like: its size and a digest of its bytes. */
export interface StillProbe {
  bytes: number;
  digest: string;
}

/** The 320x240 variant of a GoAkamai still, used only to judge it. Exported for tests. */
export function probeUrlFor(feedUrl: string): string {
  return feedUrl.replace(/\/SnapShot\/\d+x\d+\//, '/SnapShot/320x240/');
}

/** Download each camera's small still once; keyed by the camera's feed_url. */
async function probeStills(feedUrls: string[]): Promise<Map<string, StillProbe>> {
  const probes = new Map<string, StillProbe>();
  if (!feedUrls.length) return probes;

  const pool = createPool(STILL_PROBE_CONCURRENCY);
  const deadline = Date.now() + STILL_PROBE_BUDGET_MS;
  await Promise.all([...new Set(feedUrls)].map(feedUrl => pool.run(async () => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return; // out of time: left unjudged, so kept
    try {
      const res = await stealthFetch(probeUrlFor(feedUrl), { signal: AbortSignal.timeout(remaining) });
      if (!res.ok) return;
      const body = Buffer.from(await res.arrayBuffer());
      probes.set(feedUrl, { bytes: body.length, digest: createHash('sha1').update(body).digest('hex') });
    } catch {
      // Unreachable, or cut off by the budget: unjudged, so kept.
    }
  })));
  return probes;
}

function metresApart(a: CctvCamera, b: CctvCamera): number {
  const dy = (a.lat - b.lat) * 111_320;
  const dx = (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

/**
 * Which stills are dead and which cameras are a second listing of another.
 * Cameras without a probe are unjudged and appear in neither set. Exported for tests.
 */
export function judgeStills(
  cams: CctvCamera[],
  probes: ReadonlyMap<string, StillProbe>,
): { deadStills: Set<string>; duplicates: Set<string> } {
  const deadStills = new Set<string>();
  const duplicates = new Set<string>();
  const byDigest = new Map<string, CctvCamera[]>();

  for (const cam of cams) {
    const probe = cam.feed_url ? probes.get(cam.feed_url) : undefined;
    if (!probe) continue;
    if (probe.bytes < STILL_BLANK_MAX_BYTES) {
      deadStills.add(cam.id);
      continue;
    }
    byDigest.set(probe.digest, [...(byDigest.get(probe.digest) ?? []), cam]);
  }

  for (const group of byDigest.values()) {
    if (group.length < 2) continue;
    const sameSpot = group.every(cam => metresApart(cam, group[0]) <= SAME_SPOT_METRES);
    if (!sameSpot) {
      for (const cam of group) deadStills.add(cam.id);
      continue;
    }
    // One camera listed more than once: keep a listing with video, if any.
    const keep = group.find(cam => cam.stream_url) ?? group[0];
    for (const cam of group) if (cam !== keep) duplicates.add(cam.id);
  }
  return { deadStills, duplicates };
}

/**
 * Drop second listings; take the dead still off a camera whose video works,
 * and drop a camera left with neither. Exported for tests.
 */
export function keepRealStills(
  cams: CctvCamera[],
  verdict: { deadStills: ReadonlySet<string>; duplicates: ReadonlySet<string> },
): CctvCamera[] {
  return cams.flatMap(cam => {
    if (verdict.duplicates.has(cam.id)) return [];
    if (!verdict.deadStills.has(cam.id)) return [cam];
    const video: CctvCamera = { ...cam };
    delete video.feed_url;
    return video.stream_url ? [video] : [];
  });
}

async function loadGoAkamaiCameras(): Promise<CctvCamera[]> {
  const res = await stealthFetch(GOAKAMAI_CAMERAS, {
    signal: AbortSignal.timeout(15000),
    headers: goAkamaiHeaders(Date.now()),
  });
  if (!res.ok) throw new Error(`GoAkamai HTTP ${res.status}`);
  const listed = mapGoAkamaiInventory(await res.json());
  const streams = listed.flatMap(cam => cam.stream_url ? [cam.stream_url] : []);
  const stills = listed.flatMap(cam => cam.feed_url ? [cam.feed_url] : []);
  // Both checks go to GoAkamai's CDN and each is bounded on its own, so they run side by side.
  const [live, probes] = await Promise.all([confirmLiveStreams(streams), probeStills(stills)]);
  const withVideo = keepLiveStreams(listed, live);
  const verdict = judgeStills(withVideo, probes);
  const cams = keepRealStills(withVideo, verdict);
  console.log(
    `[OSIRIS] Hawaii cameras — GoAkamai: ${cams.length} of ${listed.length} ` +
    `(${live.size}/${streams.length} streams live, ${verdict.deadStills.size} dead stills, ` +
    `${verdict.duplicates.size} duplicate listings, ${probes.size}/${stills.length} stills judged)`,
  );
  return cams;
}

// ═══ USGS AshCam (Hawaiian Volcano Observatory) ═══

const ASHCAM_WEBCAMS = 'https://volcview.wr.usgs.gov/ashcam-api/webcamApi/webcams';
const ASHCAM_IMAGE_HOST = 'usgs.gov';
/**
 * HVO's cameras send a frame every few minutes, night included. One that has
 * sent nothing for a day is down, and its last frame would pass for live.
 */
const ASHCAM_MAX_AGE_S = 24 * 60 * 60;

/** One AshCam webcam (only the fields we consume). */
export interface AshCamWebcam {
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

/** An https URL on a usgs.gov host, or undefined. */
function usgsUrl(value: unknown): string | undefined {
  const url = urlOnHost(value, ASHCAM_IMAGE_HOST);
  return url && url.protocol === 'https:' ? url.href : undefined;
}

/**
 * Map one AshCam webcam to a camera, or null if it is outside Hawaii, unplaced,
 * imageless or gone quiet. `nowMs` is injectable for tests. Exported for tests.
 */
export function mapAshCamWebcam(row: unknown, nowMs: number = Date.now()): CctvCamera | null {
  if (!isRecord(row)) return null;
  const code = text(row.webcamCode, 64);
  if (!code || row.hasImages !== 'Y') return null;

  const point = hawaiiPoint(row.latitude, row.longitude);
  if (!point) return null;

  const last = row.lastImageTimestamp;
  if (typeof last !== 'number' || !Number.isFinite(last)) return null;
  if (nowMs / 1000 - last > ASHCAM_MAX_AGE_S) return null;

  // The medium frame is ~70 KB; the full one is over a megabyte.
  const image = usgsUrl(row.currentMediumImageUrl) ?? usgsUrl(row.currentImageUrl);
  if (!image) return null;

  const external = usgsUrl(row.externalUrl);
  return {
    id: `usgs-hvo-${code}`,
    lat: point.lat,
    lng: point.lng,
    name: text(row.webcamName) ?? code,
    city: text(row.vName, 64) ?? islandFor(point.lat, point.lng),
    country: 'US',
    feed_url: image,
    ...(external ? { external_url: external } : {}),
    source: 'USGS HVO',
  };
}

/** Map the AshCam index to Hawaii's cameras. Throws on an unexpected shape. Exported for tests. */
export function mapAshCamInventory(data: unknown, nowMs: number = Date.now()): CctvCamera[] {
  const webcams = isRecord(data) ? data.webcams : undefined;
  if (!Array.isArray(webcams)) throw new Error('USGS AshCam index is missing webcams');
  const cams = new Map<string, CctvCamera>();
  for (const row of webcams) {
    const cam = mapAshCamWebcam(row, nowMs);
    if (cam && !cams.has(cam.id)) cams.set(cam.id, cam);
  }
  return [...cams.values()];
}

async function loadAshCamCameras(): Promise<CctvCamera[]> {
  const res = await stealthFetch(ASHCAM_WEBCAMS, {
    signal: AbortSignal.timeout(15000),
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`USGS AshCam HTTP ${res.status}`);
  // Served as text/html although the body is JSON.
  const cams = mapAshCamInventory(JSON.parse(await res.text()));
  console.log(`[OSIRIS] Hawaii cameras — USGS HVO: ${cams.length}`);
  return cams;
}

// ═══ Region ═══

/* Each source is cached on its own, so an outage at one cannot replace the
   other's last good list with nothing — a region-level cache stores any
   non-empty result as a success. */
const sourceFetchers = [
  cachedSource('hawaii:goakamai', loadGoAkamaiCameras),
  cachedSource('hawaii:usgs-hvo', loadAshCamCameras),
];

export async function fetchHawaiiCameras(): Promise<CctvCamera[]> {
  const results = await Promise.allSettled(sourceFetchers.map(fetcher => fetcher()));
  return results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
}

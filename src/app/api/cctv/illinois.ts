import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';
import type { CctvCamera } from './types';

/**
 * OSIRIS — Illinois CCTV Cameras (IDOT Gateway / TravelMidwest)
 * Source: IDOT open data, "Illinois Gateway Traffic Cameras"
 *   https://gis-idot.opendata.arcgis.com/datasets/illinois-gateway-traffic-cameras
 * ~3,700 cameras from IDOT, the Illinois Tollway, and the Lake, DuPage and
 * Kane County systems. Public feature layer, CC BY-SA 2.0 — NO API KEY NEEDED.
 *
 * This replaces travelmidwest.com/lmiga/cameraReport.json, which now
 * 301-redirects to a per-user report that answers `reportTables: []` unless
 * the caller has saved locations. It never returned a camera, and waiting on
 * it held the whole us-central region open on every cold start.
 *
 * The layer caps a response at 1,000 rows, so it is read in pages.
 */

const LAYER =
  'https://services2.arcgis.com/aIrBD8yn1TDTEXoz/arcgis/rest/services/TrafficCamerasTM_Public/FeatureServer/0/query';
const PAGE_SIZE = 1000; // the layer's maxRecordCount
const MAX_PAGES = 10; // safety bound (~10,000 cameras) so a bad count can't fan out forever
const FIELDS = 'OBJECTID,CameraLocation,CameraDirection,SnapShot,ImgPath,TooOld,x,y';

/** Illinois bounding box — drops any mis-geocoded rows. */
const IL_BOUNDS = { minLat: 36.9, maxLat: 42.6, minLng: -91.6, maxLng: -87.0 };

/** One row's attributes (only the fields we consume). */
export interface IllinoisCameraRecord {
  OBJECTID?: number | null;
  CameraLocation?: string | null;
  CameraDirection?: string | null;
  SnapShot?: string | null;
  ImgPath?: string | null;
  /** "true" when the latest frame is more than 30 minutes old. */
  TooOld?: string | null;
  x?: number | null;
  y?: number | null;
}

/** Map a raw record to a CctvCamera, or null if it should be skipped. */
export function mapRecord(rec: IllinoisCameraRecord): CctvCamera | null {
  if (!rec || typeof rec.OBJECTID !== 'number') return null;
  // A camera whose frame is half an hour stale is down; a marker would show a still that lies.
  if (rec.TooOld === 'true') return null;

  const snapshot = rec.SnapShot?.trim();
  if (!snapshot || !/^https:\/\//i.test(snapshot)) return null;

  const lat = rec.y;
  const lng = rec.x;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (lat < IL_BOUNDS.minLat || lat > IL_BOUNDS.maxLat) return null;
  if (lng < IL_BOUNDS.minLng || lng > IL_BOUNDS.maxLng) return null;

  /* The camera id lives in the viewer link (`showCamera?id=IL-IDOTD1-IK14B`)
     and is stable across refreshes, unlike OBJECTID, which the layer
     renumbers whenever it is republished. Fall back to OBJECTID only when
     the link is missing. */
  const viewer = rec.ImgPath?.trim();
  const cameraId = viewer?.match(/[?&]id=([^&]+)/)?.[1];
  const direction = rec.CameraDirection?.trim();
  const place = rec.CameraLocation?.trim();
  const name = place
    ? direction && direction !== 'NONE' ? `${place} (${direction})` : place
    : `IDOT Camera ${rec.OBJECTID}`;

  return {
    id: `ildot-${cameraId ? `${cameraId}-${direction || 'NONE'}` : rec.OBJECTID}`,
    lat,
    lng,
    name,
    city: 'Illinois',
    country: 'US',
    feed_url: snapshot,
    ...(viewer && /^https:\/\//i.test(viewer) ? { external_url: viewer } : {}),
    source: 'IDOT',
  };
}

/** The parts of an ArcGIS query response this reads; everything is optional until checked. */
interface ArcgisQueryResponse {
  count?: unknown;
  features?: unknown;
  error?: { code?: number; message?: string } | null;
}

async function fetchJson(params: string): Promise<ArcgisQueryResponse> {
  const res = await stealthFetch(`${LAYER}?${params}&f=json`, {
    signal: AbortSignal.timeout(15000),
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`IDOT HTTP ${res.status}`);
  const data = (await res.json()) as ArcgisQueryResponse | null;
  if (!data || typeof data !== 'object') throw new Error('IDOT returned a non-object body');
  // ArcGIS reports failures as HTTP 200 with an `error` object.
  if (data?.error) throw new Error(`IDOT ArcGIS error ${data.error.code ?? ''}: ${data.error.message ?? ''}`);
  return data;
}

async function fetchPage(offset: number): Promise<IllinoisCameraRecord[]> {
  const data = await fetchJson(
    `where=1%3D1&outFields=${FIELDS}&orderByFields=OBJECTID&resultOffset=${offset}&resultRecordCount=${PAGE_SIZE}`,
  );
  const features: unknown[] = Array.isArray(data.features) ? data.features : [];
  return features
    .map(f => (f && typeof f === 'object' ? (f as { attributes?: IllinoisCameraRecord }).attributes : undefined))
    .filter((a): a is IllinoisCameraRecord => !!a && typeof a === 'object');
}

async function loadIllinoisCameras(): Promise<CctvCamera[]> {
  const count = Number((await fetchJson('where=1%3D1&returnCountOnly=true')).count) || 0;
  const offsets: number[] = [];
  for (let o = 0; o < count && o < PAGE_SIZE * MAX_PAGES; o += PAGE_SIZE) offsets.push(o);

  const seen = new Map<string, CctvCamera>();
  const results = await Promise.allSettled(offsets.map(o => fetchPage(o)));
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const rec of r.value) {
      const cam = mapRecord(rec);
      if (cam) seen.set(cam.id, cam);
    }
  }
  const cams = [...seen.values()];
  console.log(`[OSIRIS] Illinois cameras — IDOT Gateway: ${cams.length} of ${count}`);
  return cams;
}

export const fetchIllinoisCameras = cachedSource('illinois', loadIllinoisCameras);

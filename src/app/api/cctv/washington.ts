import { stealthFetch } from '@/lib/stealthFetch';
import { cachedSource } from '@/lib/sourceCache';
import type { CctvCamera } from './types';

/**
 * OSIRIS — Washington State CCTV Cameras (WSDOT)
 * Source: https://data.wsdot.wa.gov/travelcenter/Cameras.json
 * ~1,700 statewide highway and pass cameras — NO API KEY NEEDED.
 *
 * The old address, /log/public/cameras.json, now answers 404, which is why
 * Washington had gone dark on the map. The documented Traveler Information
 * API wants an access code. The Travel Center map on wsdot.com reads this
 * Esri JSON layer instead, and that is what this reads.
 *
 * Two quirks of the layer:
 *   • geometry is Web Mercator (EPSG:3857), not lat/lng, so it is converted;
 *   • the body is latin-1, so decoding it as UTF-8 would mangle the handful
 *     of titles with accented characters.
 */

const URL = 'https://data.wsdot.wa.gov/travelcenter/Cameras.json';

/** Washington, with a little slack for the Columbia River border cameras. */
const WA_BOUNDS = { minLat: 45.4, maxLat: 49.1, minLng: -125, maxLng: -116.8 };

/* WSDOT republishes a few dozen Oregon TripCheck frames along the border.
   The Oregon source already carries those cameras, so keeping them here would
   stack two markers on one spot. */
const SKIP_IMAGE_HOSTS = ['tripcheck.com'];

const EARTH_RADIUS = 6378137;

/** One feature of the Esri JSON layer (only the fields we consume). */
export interface WsdotFeature {
  attributes?: {
    CameraID?: number | null;
    CameraTitle?: string | null;
    CompassDirection?: string | null;
    ImageURL?: string | null;
  } | null;
  geometry?: { x?: number | null; y?: number | null } | null;
}

/** EPSG:3857 metres to WGS84 degrees. */
export function mercatorToLatLng(x: number, y: number): { lat: number; lng: number } {
  const lng = (x / EARTH_RADIUS) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) * (180 / Math.PI);
  return { lat, lng };
}

/** Map a raw feature to a CctvCamera, or null if it should be skipped. */
export function mapFeature(f: WsdotFeature): CctvCamera | null {
  const a = f?.attributes;
  if (!a || typeof a.CameraID !== 'number') return null;

  const image = a.ImageURL?.trim();
  if (!image || !/^https:\/\//i.test(image)) return null;
  let host: string;
  try {
    host = new globalThis.URL(image).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (SKIP_IMAGE_HOSTS.some(h => host === h || host.endsWith('.' + h))) return null;

  const { x, y } = f.geometry ?? {};
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const { lat, lng } = mercatorToLatLng(x, y);
  if (lat < WA_BOUNDS.minLat || lat > WA_BOUNDS.maxLat) return null;
  if (lng < WA_BOUNDS.minLng || lng > WA_BOUNDS.maxLng) return null;

  return {
    id: `wsdot-${a.CameraID}`,
    lat,
    lng,
    name: a.CameraTitle?.trim() || `WSDOT Camera ${a.CameraID}`,
    city: 'Washington',
    country: 'US',
    feed_url: image,
    source: 'WSDOT',
  };
}

async function loadWashingtonCameras(): Promise<CctvCamera[]> {
  const res = await stealthFetch(URL, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`WSDOT HTTP ${res.status}`);
  const body = new TextDecoder('latin1').decode(await res.arrayBuffer());
  const data = JSON.parse(body);
  const features: WsdotFeature[] = Array.isArray(data?.features) ? data.features : [];

  const seen = new Map<string, CctvCamera>();
  for (const f of features) {
    const cam = mapFeature(f);
    if (cam) seen.set(cam.id, cam);
  }
  const cams = [...seen.values()];
  console.log(`[OSIRIS] Washington cameras — WSDOT: ${cams.length}`);
  return cams;
}

export const fetchWashingtonCameras = cachedSource('washington', loadWashingtonCameras);

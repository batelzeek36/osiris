import { describe, it, expect } from 'vitest';
import { fetchWashingtonCameras, mapFeature, mercatorToLatLng, type WsdotFeature } from './washington';

/** A representative feature from data.wsdot.wa.gov/travelcenter/Cameras.json. */
const sample: WsdotFeature = {
  attributes: {
    CameraID: 8040,
    CompassDirection: 'N',
    CameraTitle: 'US 195 at MP 81.6: Spangle (1)',
    ImageURL: 'https://images.wsdot.wa.gov/rweather/Medium_Spangle.jpg',
  },
  geometry: { x: -13068830.29548676, y: 6021385.077819482 },
};

describe('mercatorToLatLng', () => {
  it('turns Web Mercator metres into degrees', () => {
    const { lat, lng } = mercatorToLatLng(-13068830.29548676, 6021385.077819482);
    expect(lat).toBeCloseTo(47.4837, 3);
    expect(lng).toBeCloseTo(-117.3993, 3);
  });
});

describe('mapFeature', () => {
  it('maps a WSDOT feature to a still-image camera', () => {
    const cam = mapFeature(sample);
    expect(cam).toMatchObject({
      id: 'wsdot-8040',
      name: 'US 195 at MP 81.6: Spangle (1)',
      city: 'Washington',
      country: 'US',
      feed_url: 'https://images.wsdot.wa.gov/rweather/Medium_Spangle.jpg',
      source: 'WSDOT',
    });
    expect(cam?.lat).toBeCloseTo(47.4837, 3);
    expect(cam?.lng).toBeCloseTo(-117.3993, 3);
  });

  it('leaves the Oregon TripCheck frames to the Oregon source', () => {
    expect(mapFeature({
      ...sample,
      attributes: { ...sample.attributes, ImageURL: 'https://www.tripcheck.com/RoadCams/cams/I-5%20Bridge%20SB%20North_pid4676.jpg' },
    })).toBeNull();
  });

  it('drops features without an id, an https image or a usable point', () => {
    expect(mapFeature({ ...sample, attributes: { ...sample.attributes, CameraID: null } })).toBeNull();
    expect(mapFeature({ ...sample, attributes: { ...sample.attributes, ImageURL: 'http://images.wsdot.wa.gov/x.jpg' } })).toBeNull();
    expect(mapFeature({ ...sample, attributes: { ...sample.attributes, ImageURL: '' } })).toBeNull();
    expect(mapFeature({ ...sample, geometry: null })).toBeNull();
    // Web Mercator for somewhere in Texas: outside Washington.
    expect(mapFeature({ ...sample, geometry: { x: -10880000, y: 3540000 } })).toBeNull();
  });

  it('falls back to a numbered label when the title is blank', () => {
    expect(mapFeature({ ...sample, attributes: { ...sample.attributes, CameraTitle: '  ' } })?.name).toBe('WSDOT Camera 8040');
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits the real WSDOT endpoint).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchWashingtonCameras (live)', () => {
  liveIt('returns well over a thousand Washington cameras', async () => {
    const cams = await fetchWashingtonCameras();
    expect(cams.length).toBeGreaterThan(1000);
    expect(cams.every(c => c.source === 'WSDOT' && c.feed_url?.startsWith('https://'))).toBe(true);
  }, 30000);
});

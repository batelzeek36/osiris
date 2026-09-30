import { describe, it, expect } from 'vitest';
import { fetchIllinoisCameras, mapRecord, type IllinoisCameraRecord } from './illinois';

/** A representative row from IDOT's TrafficCamerasTM_Public layer. */
const sample: IllinoisCameraRecord = {
  OBJECTID: 2,
  ImgPath: 'https://travelmidwest.com/showCamera?id=IL-IDOTD1-IK23&direction=NONE',
  CameraLocation: 'Nordic',
  CameraDirection: 'NONE',
  y: 41.95833,
  x: -88.02554,
  SnapShot: 'https://cctv.travelmidwest.com/snapshots/IL-IDOTD1_1_DuPage_WB_I-290_4195833_-8802554_1_NONE.jpg',
  TooOld: 'false',
};

describe('mapRecord', () => {
  it('maps a Gateway row to a still-image camera keyed by its stable camera id', () => {
    expect(mapRecord(sample)).toEqual({
      id: 'ildot-IL-IDOTD1-IK23-NONE',
      lat: 41.95833,
      lng: -88.02554,
      name: 'Nordic',
      city: 'Illinois',
      country: 'US',
      feed_url: 'https://cctv.travelmidwest.com/snapshots/IL-IDOTD1_1_DuPage_WB_I-290_4195833_-8802554_1_NONE.jpg',
      external_url: 'https://travelmidwest.com/showCamera?id=IL-IDOTD1-IK23&direction=NONE',
      source: 'IDOT',
    });
  });

  it('adds the view direction to the label when there is one', () => {
    expect(mapRecord({ ...sample, CameraDirection: 'NW' })?.name).toBe('Nordic (NW)');
    expect(mapRecord({ ...sample, CameraDirection: 'NW' })?.id).toBe('ildot-IL-IDOTD1-IK23-NW');
  });

  it('falls back to OBJECTID when the viewer link is missing', () => {
    const cam = mapRecord({ ...sample, ImgPath: null, CameraLocation: null });
    expect(cam?.id).toBe('ildot-2');
    expect(cam?.name).toBe('IDOT Camera 2');
    expect(cam).not.toHaveProperty('external_url');
  });

  it('drops cameras whose latest frame is more than 30 minutes old', () => {
    expect(mapRecord({ ...sample, TooOld: 'true' })).toBeNull();
  });

  it('drops rows without an https snapshot or usable coordinates, and any outside Illinois', () => {
    expect(mapRecord({ ...sample, SnapShot: null })).toBeNull();
    expect(mapRecord({ ...sample, SnapShot: 'http://cctv.travelmidwest.com/x.jpg' })).toBeNull();
    expect(mapRecord({ ...sample, x: null })).toBeNull();
    expect(mapRecord({ ...sample, y: 30.1, x: -95.4 })).toBeNull(); // Houston
    expect(mapRecord({ ...sample, OBJECTID: null })).toBeNull();
  });
});

// Live integration test — opt in with RUN_LIVE_TESTS=1 (hits the real IDOT layer).
const liveIt = process.env.RUN_LIVE_TESTS === '1' ? it : it.skip;

describe('fetchIllinoisCameras (live)', () => {
  liveIt('returns thousands of Illinois cameras across every page of the layer', async () => {
    const cams = await fetchIllinoisCameras();
    expect(cams.length).toBeGreaterThan(3000);
    expect(new Set(cams.map(c => c.id)).size).toBe(cams.length);
  }, 60000);
});

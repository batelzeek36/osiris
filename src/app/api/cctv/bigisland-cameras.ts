/**
 * OSIRIS — Hawaii Island cameras: where each one actually is.
 *
 * Curated, because the listings that carry these cameras do not place them.
 * The USGS AshCam index lists most of the Hawaiian Volcano Observatory's
 * webcams at 0,0, and the two it does place (KWcam and F1cam) it puts on one
 * point that predates their 2025 move. The Mauna Kea and Mauna Loa observatory
 * cameras have no listing at all.
 *
 * Every coordinate below is copied from an official source, cited beside it.
 * A camera with no published location is left out rather than guessed:
 * B1cam, K2cam, KPcam and S2cam at Kilauea and HLcam on Hualalai are described
 * by USGS only in words ("east rim of the caldera", "a tower near Uekahuna
 * bluff", "Mauna Loa Strip Road", "south rim", "Hualalai repeater site").
 *
 * Several cameras share a mast and so share a point: KWcam and F1cam sit with
 * V1cam, and each observatory's cameras share that observatory's survey point.
 *
 * Every camera here was opened and looked at on 2026-09-30 and showed a frame
 * stamped that day. Ones that did not were left out: HVO's S1cam (frame from
 * 2026-01-16), MITDcam (2026-08-16), R3cam (2026-09-09), PGcam, MKcam, MOcam,
 * SPcam, MTcam, MSTcam and B2cam (all months old); JCMT (an "unavailable"
 * card); CFHT's Nana ao (two days old) and dome camera (2023); Keck II's mast
 * camera (lens blocked by the mast's own grating); NOAA MLO's south-west, deck
 * and gate cameras (empty files). Subaru's all-sky camera works but is a 1.2 MB
 * PNG on every 15-second refresh, and its four catwalk cameras already cover
 * the site.
 */

/** Degrees, minutes, seconds to decimal degrees (unsigned). Exported for tests. */
export function dmsToDecimal(degrees: number, minutes: number, seconds: number): number {
  return degrees + minutes / 60 + seconds / 3600;
}

// ═══ USGS Hawaiian Volcano Observatory ═══

/** Where an HVO webcam sits, keyed by its AshCam `webcamCode`. */
export interface HvoSite {
  name: string;
  /** The area the camera is in, shown as the camera's city. */
  area: string;
  lat: number;
  lng: number;
  /** The camera's page on usgs.gov. */
  page: string;
}

/*
 * Points come from the "Geospatial Information" map on each camera's USGS
 * media page (https://www.usgs.gov/media/webcams/<slug>), which USGS serves as
 * https://d9-wret.s3.us-west-2.amazonaws.com/assets/palladium/production/s3fs-public/geodata/media-<id>.geojson.
 * F1cam, KWcam, B1cam, K2cam and KPcam pages carry only a generic
 * "Kilauea Volcano, Hawaii" point instead, which is why they are not used.
 */
export const HVO_SITES: Readonly<Record<string, HvoSite>> = {
  // media-102044, titled "V1 Cam".
  'kilauea-v1-cam': {
    name: 'Kilauea - V1 Cam (west Halemaumau crater)',
    area: 'Kilauea',
    lat: 19.41249,
    lng: -155.29003,
    page: 'https://www.usgs.gov/volcanoes/kilauea/v1cam-kilauea-volcano-hawaii-west-halemaumau-crater',
  },
  // USGS photo caption, 2025-06-24 (/media/images/june-24-2025-reinstalling-kwcam-and-f1cam-kilauea-summit):
  // "The KWcam, F1cam, and laser rangefinder have been co-located with the
  // V1cam on the western rim of Kaluapele". So V1cam's point, media-102044.
  'kilauea-kw-cam': {
    name: 'Kilauea - KW Cam (Halemaumau from the west rim)',
    area: 'Kilauea',
    lat: 19.41249,
    lng: -155.29003,
    page: 'https://www.usgs.gov/volcanoes/kilauea/kwcam-live-panorama-halemaumau-west-rim-kilauea-summit-caldera-looking-southeast',
  },
  // Same caption and point as KWcam.
  'kilauea-f1-cam': {
    name: 'Kilauea - F1 Cam (thermal, Halemaumau from the west rim)',
    area: 'Kilauea',
    lat: 19.41249,
    lng: -155.29003,
    page: 'https://www.usgs.gov/volcanoes/kilauea/f1cam-halemaumau-thermal-image-west-rim-summit-caldera-looking-southeast',
  },
  // media-132508. Its title says "[V1]" but names the east crater, and the
  // point is on the north-east caldera rim, where the V2cam page puts it.
  'kilauea-v2-cam': {
    name: 'Kilauea - V2 Cam (east Halemaumau crater)',
    area: 'Kilauea',
    lat: 19.428554,
    lng: -155.25851,
    page: 'https://www.usgs.gov/volcanoes/kilauea/v2cam-kilauea-volcano-hawaii-east-halemaumau-crater',
  },
  // media-133912, titled "[V3cam]".
  'kilauea-v3-cam': {
    name: 'Kilauea - V3 Cam (south Halemaumau crater)',
    area: 'Kilauea',
    lat: 19.400146,
    lng: -155.288183,
    page: 'https://www.usgs.gov/observatories/hvo/v3cam-kilauea-volcano-hawaii-south-halemaumau-crater',
  },
  // media-124040, titled "[KOcam] Live Image of upper East Rift Zone from Maunaulu".
  'kilauea-ko-cam': {
    name: 'Kilauea - KO Cam (upper East Rift Zone from Maunaulu)',
    area: 'Kilauea',
    lat: 19.3675,
    lng: -155.202774,
    page: 'https://www.usgs.gov/observatories/hvo/kocam-live-image-upper-east-rift-zone-maunaulu',
  },
  // media-96021, titled "MUcam".
  'kilauea-mu-cam': {
    name: 'Kilauea - MU Cam (Maunaulu)',
    area: 'Kilauea',
    lat: 19.36986,
    lng: -155.200771,
    page: 'https://www.usgs.gov/volcanoes/kilauea/live-panorama-maunaulu-cam-mucam',
  },
  // media-95909, titled "PEcam".
  'kilauea-pe-cam': {
    name: 'Kilauea - PE Cam (Puu Oo east flank)',
    area: 'Kilauea',
    lat: 19.38994,
    lng: -155.090911,
    page: 'https://www.usgs.gov/volcanoes/kilauea/pu-u-east-flank-pecam',
  },
  // media-95910, titled "PWcam".
  'kilauea-pw-cam': {
    name: 'Kilauea - PW Cam (Puu Oo west flank)',
    area: 'Kilauea',
    lat: 19.388569,
    lng: -155.110058,
    page: 'https://www.usgs.gov/volcanoes/kilauea/live-panorama-pu-u-west-flank-pu-u-pwcam',
  },
  // media-95913, titled "HPcam".
  'kilauea-hp-cam': {
    name: 'Kilauea - HP Cam (Holei Pali)',
    area: 'Kilauea',
    lat: 19.319134,
    lng: -155.100448,
    page: 'https://www.usgs.gov/volcanoes/kilauea/hpcam-holei-pali-holei-pali',
  },
  // media-95916, titled "MLcam".
  'mauna-loa-ml-cam': {
    name: 'Mauna Loa - ML Cam (Mokuaweoweo caldera from the northwest rim)',
    area: 'Mauna Loa',
    lat: 19.480203,
    lng: -155.600564,
    page: 'https://www.usgs.gov/volcanoes/mauna-loa/mlcam-mokuaweoweo-caldera-northwest-rim',
  },
  // media-111156, titled "Mauna Kea, HI": the camera is on Mauna Kea looking
  // at Mauna Loa, and the point is in the Mauna Kea summit area.
  'mauna-loa-mk2-cam': {
    name: 'Mauna Loa - MK2 Cam (summit and Northeast Rift Zone from Mauna Kea)',
    area: 'Mauna Kea',
    lat: 19.82283,
    lng: -155.469421,
    page: 'https://www.usgs.gov/observatories/hvo/mauna-loas-summit-and-northeast-rift-zone-mk2cam',
  },
  // media-122951, titled "[MSPcam] Live Image of Mauna Loa's Southwest Rift Zone from the South Point area".
  'mauna-loa-msp-cam': {
    name: 'Mauna Loa - MSP Cam (Southwest Rift Zone from the South Point area)',
    area: 'South Point',
    lat: 18.978461,
    lng: -155.668316,
    page: 'https://www.usgs.gov/observatories/hvo/mspcam-mauna-loas-southwest-rift-zone-south-point-area',
  },
  // media-95919, titled "M2cam".
  'mauna-loa-m2-cam': {
    name: 'Mauna Loa - M2 Cam (middle Southwest Rift Zone)',
    area: 'Mauna Loa',
    lat: 19.224192,
    lng: -155.74145,
    page: 'https://www.usgs.gov/volcanoes/mauna-loa/m2cam-middle-part-mauna-loas-southwest-rift-zone',
  },
  // media-95920, titled "M3cam".
  'mauna-loa-m3-cam': {
    name: 'Mauna Loa - M3 Cam (upper Southwest Rift Zone)',
    area: 'Mauna Loa',
    lat: 19.345433,
    lng: -155.671998,
    page: 'https://www.usgs.gov/volcanoes/mauna-loa/m3cam-upper-part-mauna-loas-southwest-rift-zone',
  },
  // media-123825. USGS publishes this one to two decimals (about 1 km), and
  // its title was copied from MSPcam's; the page says the camera is on
  // Dandelion Cone in the middle of the rift zone.
  'mauna-loa-mdl-cam': {
    name: 'Mauna Loa - MDL Cam (Southwest Rift Zone from Dandelion Cone)',
    area: 'Mauna Loa',
    lat: 19.35,
    lng: -155.67,
    page: 'https://www.usgs.gov/observatories/hvo/mdlcam-upper-and-middle-parts-mauna-loas-southwest-rift-zone',
  },
};

// ═══ Mauna Kea and Mauna Loa observatories ═══

/** A still published at one fixed URL that the operator overwrites. */
export interface SummitCamera {
  /** Stable OSIRIS id. */
  id: string;
  name: string;
  area: string;
  lat: number;
  lng: number;
  /** The still, over https. */
  feed: string;
  /** The operator's page for the camera. */
  page: string;
  source: string;
}

/*
 * Observatory points: "Coordinates of Mauna Kea Telescopes", NAD 83, from an
 * aerial survey of 1996-09-25 (R. Wainscoat, UH Institute for Astronomy),
 * https://irtfweb.ifa.hawaii.edu/observing/telescopeCoordinates.php.
 * A camera on an observatory's building or catwalk is placed on that
 * observatory's survey point.
 */
const GEMINI = { lat: dmsToDecimal(19, 49, 25.68521), lng: -dmsToDecimal(155, 28, 8.56831) };
const SUBARU = { lat: dmsToDecimal(19, 49, 31.81425), lng: -dmsToDecimal(155, 28, 33.66719) };
const KECK_1 = { lat: dmsToDecimal(19, 49, 33.40757), lng: -dmsToDecimal(155, 28, 28.98665) };
const KECK_2 = { lat: dmsToDecimal(19, 49, 35.61788), lng: -dmsToDecimal(155, 28, 27.24268) };
const UKIRT = { lat: dmsToDecimal(19, 49, 20.75334), lng: -dmsToDecimal(155, 28, 13.1763) };
const IRTF = { lat: dmsToDecimal(19, 49, 34.38594), lng: -dmsToDecimal(155, 28, 19.19564) };
/** NRAO, VLBA Observational Status Summary, station table: "Mauna Kea, HI 19:48:04.97 155:27:19.81 3763 MK". */
const VLBA_MK = { lat: dmsToDecimal(19, 48, 4.97), lng: -dmsToDecimal(155, 27, 19.81) };
/** UH IfA, https://about.ifa.hawaii.edu/facility/hale-pohaku/: "19°45'33″N Latitude and 155°27′22″W Longitude". */
const HALE_POHAKU = { lat: dmsToDecimal(19, 45, 33), lng: -dmsToDecimal(155, 27, 22) };
/** NOAA GML, https://gml.noaa.gov/obop/mlo/: "Latitude: 19.5362° North Longitude: 155.5763° West". */
const NOAA_MLO = { lat: 19.5362, lng: -155.5763 };

/** UH Hilo's Maunakea Weather Center indexes the summit cameras on one page. */
const MKWC_CAMS = 'http://mkwc.ifa.hawaii.edu/current/cams/';
const IRTF_CAMS = 'https://irtfweb.ifa.hawaii.edu/~irtfcameras/';

/* Names follow the direction each camera faces as MKWC and the operators
   label it. */
export const SUMMIT_CAMERAS: readonly SummitCamera[] = [
  ...([
    ['hilo', 'view toward Hilo', 'Hilo'],
    ['south', 'looking south', 'South'],
    ['west', 'looking west', 'West'],
    ['north', 'looking north', 'North'],
    ['up', 'sky camera', 'Up'],
  ] as const).map(([slug, label, file]) => ({
    id: `gemini-north-${slug}`,
    name: `Gemini North - ${label}`,
    area: 'Mauna Kea',
    ...GEMINI,
    feed: `https://www.gemini.edu/sciops/schedules/obsStatus/currentstill_${file}.png`,
    page: MKWC_CAMS,
    source: 'Gemini Observatory',
  })),
  ...([
    ['nw', 'northwest', 'cw66'],
    ['se', 'southeast', 'cw68'],
    ['sw', 'southwest', 'cw70'],
    ['ne', 'northeast', 'cw72'],
  ] as const).map(([slug, label, file]) => ({
    id: `subaru-catwalk-${slug}`,
    name: `Subaru Telescope - catwalk, looking ${label}`,
    area: 'Mauna Kea',
    ...SUBARU,
    feed: `https://www.naoj.hawaii.edu/Weather/CATWALK/${file}.png`,
    page: MKWC_CAMS,
    source: 'Subaru Telescope (NAOJ)',
  })),
  {
    id: 'keck-1-east',
    name: 'Keck Observatory - Keck I, looking east',
    area: 'Mauna Kea',
    ...KECK_1,
    feed: 'https://www2.keck.hawaii.edu/realtime/webcam/kcam_1.jpg',
    page: MKWC_CAMS,
    source: 'W. M. Keck Observatory',
  },
  {
    id: 'keck-2-weather-mast',
    name: 'Keck Observatory - Keck II weather mast',
    area: 'Mauna Kea',
    ...KECK_2,
    feed: 'https://www2.keck.hawaii.edu/realtime/webcam/weatherMast.jpg',
    page: MKWC_CAMS,
    source: 'W. M. Keck Observatory',
  },
  {
    id: 'ukirt-southwest',
    name: 'UKIRT - looking southwest',
    area: 'Mauna Kea',
    ...UKIRT,
    feed: 'https://ukirt.ifa.hawaii.edu/webcam',
    page: MKWC_CAMS,
    source: 'UKIRT (UH IfA)',
  },
  {
    id: 'ukirt-dome',
    name: 'UKIRT - dome',
    area: 'Mauna Kea',
    ...UKIRT,
    feed: 'https://ukirt.ifa.hawaii.edu/domecam',
    page: MKWC_CAMS,
    source: 'UKIRT (UH IfA)',
  },
  ...([
    ['c159', 'bunker, looking east'],
    ['c160', 'front door, looking west'],
    ['c161', 'looking north toward Waimea'],
    ['c166', 'looking south toward Mauna Loa'],
    ['c168', 'bunker door, looking east'],
  ] as const).map(([cam, label]) => ({
    id: `irtf-${cam}`,
    name: `NASA IRTF - ${label}`,
    area: 'Mauna Kea',
    ...IRTF,
    feed: `https://irtfweb.ifa.hawaii.edu/~irtfcameras/${cam}/latest.jpg`,
    page: IRTF_CAMS,
    source: 'NASA IRTF (UH IfA)',
  })),
  {
    id: 'vlba-mauna-kea',
    name: 'VLBA Mauna Kea antenna',
    area: 'Mauna Kea',
    ...VLBA_MK,
    feed: 'https://www.vlba.nrao.edu/sites/SITECAM/MKSNAP.JPG',
    page: 'https://www.vlba.nrao.edu/sites/SITECAM/MKcam.shtml',
    source: 'NRAO VLBA',
  },
  {
    id: 'ifa-hale-pohaku',
    name: 'Hale Pohaku - mid-level facility, looking west',
    area: 'Mauna Kea',
    ...HALE_POHAKU,
    feed: 'https://hp.ifa.hawaii.edu/cams/dormb-ptz.jpg',
    page: MKWC_CAMS,
    source: 'UH Institute for Astronomy',
  },
  {
    id: 'noaa-mlo-north',
    name: 'Mauna Loa Observatory - north sky and Mauna Kea',
    area: 'Mauna Loa',
    ...NOAA_MLO,
    feed: 'https://gml.noaa.gov/webdata/mlo/webcam/northcam.jpg',
    page: 'https://gml.noaa.gov/obop/mlo/livecam/livecam.html',
    source: 'NOAA GML',
  },
];

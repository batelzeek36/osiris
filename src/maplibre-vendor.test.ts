import { describe, expect, it } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { version as maplibreVersion } from 'maplibre-gl/package.json';

const vendorDir = fileURLToPath(new URL('../public/vendor/maplibre/', import.meta.url));

/* PR #330 moved the MapLibre worker out of the bundle and onto a self-hosted
   public/ path. When that file is not retrievable the canvas and the
   main-thread entity layers still draw, but no vector tile can be parsed, so
   the basemap never arrives and startup times out into "The map couldn't
   finish loading" — the production failure that forced the revert to fac8d1b.
   (Upstream also asserted its analytics middleware skipped these paths; this
   fork removed that middleware, so only the shipping half remains.) */
describe('map runtime assets', () => {
  it('ships the worker the bundle actually asks for', () => {
    expect(existsSync(`${vendorDir}${maplibreVersion}/maplibre-gl-worker.mjs`)).toBe(true);
    // The worker is a module that imports this sibling by relative path.
    expect(existsSync(`${vendorDir}${maplibreVersion}/maplibre-gl-shared.mjs`)).toBe(true);
  });

  it('keeps exactly one vendored version, so local cannot pass while a clean deploy fails', () => {
    expect(readdirSync(vendorDir, { withFileTypes: true })
      .filter(e => e.isDirectory()).map(e => e.name)).toEqual([maplibreVersion]);
  });
});

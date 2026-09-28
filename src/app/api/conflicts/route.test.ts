import { afterEach, expect, it, vi } from 'vitest';
import { GET } from './route';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const rss = '<rss><channel><item><title>Fighting reported in Ukraine near Kharkiv</title>'
  + '<link>https://example.org/a</link><description>Ukraine front</description></item></channel></rss>';

/* Each page load used to re-download and re-parse every feed: ~85 times a
   minute in production. */
it('refreshes the feeds once for many visitors, then again after five minutes', async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn(() => Promise.resolve(new Response(rss)));
  vi.stubGlobal('fetch', fetchMock);

  const first = await (await GET()).json();
  expect(first.totalLiveEvents).toBeGreaterThan(0);
  const perRefresh = fetchMock.mock.calls.length;
  expect(perRefresh).toBeGreaterThan(0);

  for (let i = 0; i < 10; i++) await GET();
  expect(fetchMock.mock.calls.length).toBe(perRefresh);

  vi.advanceTimersByTime(5 * 60 * 1000 + 1);
  await GET(); // served from the last answer while the refresh runs behind it
  await vi.waitFor(() => expect(fetchMock.mock.calls.length).toBe(perRefresh * 2));
});

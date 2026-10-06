import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { koreaDay, parseFeed, refreshHeadlines } from '../dist/server/index.js';

const country = {code:'FR',lang:'fr'};
const rss = (date,title='A &amp; B - News',url='https://news.google.com/rss/articles/example') =>
  `<rss><channel><item><title>${title}</title><source url="https://example.com">News</source><link>${url}</link><pubDate>${date}</pubDate></item></channel></rss>`;
const bucket = initial => {
  let value = initial ? JSON.stringify(initial) : null;
  return {get:async () => value ? {json:async () => JSON.parse(value)} : null,
    put:async (_,body) => {value = body;},read:() => value};
};

test('Korean midnight removes yesterday and preserves original titles', async () => {
  assert.equal(koreaDay(new Date('2026-10-05T15:00:00Z')),'2026-10-06');
  assert.equal((await parseFeed(rss('Mon, 05 Oct 2026 14:59:59 GMT'),country,'2026-10-06')).length,0);
  const items = await parseFeed(rss('Mon, 05 Oct 2026 15:00:00 GMT'),country,'2026-10-06');
  assert.equal(items.length,1); assert.equal(items[0].title,'A & B');
  assert.equal((await parseFeed(rss('Tue, 06 Oct 2026 15:00:00 GMT'),country,'2026-10-06')).length,0);
});

test('malformed upstream content is a failure; an empty RSS is a valid empty day', async () => {
  await assert.rejects(parseFeed('<html>Blocked</html>',country,'2026-10-06'));
  assert.deepEqual(await parseFeed('<rss><channel></channel></rss>',country,'2026-10-06'),[]);
});

test('unattended writer saves today and readers return the saved snapshot', async () => {
  const original = globalThis.fetch, storage = bucket();
  globalThis.fetch = async url => new Response(rss(new Date().toUTCString(),'Today - News','https://news.google.com/rss/articles/' + new URL(url).searchParams.get('gl')));
  try {
    const data = await refreshHeadlines({BUCKET:storage});
    assert.equal(data.articles.length,24);
    assert.ok(data.articles.every(a => koreaDay(new Date(a.date)) === koreaDay()));
    assert.equal(JSON.parse(storage.read()).collectedAt,data.collectedAt);
    const response = await worker.fetch(new Request('https://example.com/api/headlines'),{BUCKET:storage},{waitUntil:()=>{}});
    assert.equal(response.status,200); assert.equal((await response.json()).articles.length,24);
    assert.equal((await worker.fetch(new Request('https://example.com/api/refresh'),{BUCKET:storage},{})).status,405);
  } finally {globalThis.fetch = original;}
});

test('total RSS outage preserves the last successful snapshot', async () => {
  const initial = {collectedAt:new Date().toISOString(), articles:[]}, storage = bucket(initial);
  const original = globalThis.fetch;
  globalThis.fetch = async () => {throw new Error('upstream unavailable');};
  try {
    await assert.rejects(refreshHeadlines({BUCKET:storage}));
    assert.equal(storage.read(),JSON.stringify(initial));
  } finally {globalThis.fetch = original;}
});

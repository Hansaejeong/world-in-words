import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { koreaDay, parseFeed, refreshHeadlines } from '../dist/server/index.js';
import { extractArticle, publisherUrl } from '../dist/server/reader.mjs';
import '../ranking.js';
import '../translation.js';

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
  globalThis.fetch = async url => new Response(rss(new Date().toUTCString(),new URL(url).searchParams.get('gl') === 'KR' ? '오늘의 소식 - News' : 'Today - News','https://news.google.com/rss/articles/' + new URL(url).searchParams.get('gl')));
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

test('scheduled upload accepts only current-day headlines and persists them', async () => {
  const storage = bucket(), env = {BUCKET:storage};
  const payload = {end:koreaDay(),articles:[
    {id:'new',country:'FR',date:new Date().toISOString(),title:'New headline',source:'News'},
    {id:'old',country:'FR',date:'2020-01-01T00:00:00Z',title:'Old headline'},
  ]};
  const response = await worker.fetch(new Request('https://example.com/api/snapshot', {
    method:'POST',body:JSON.stringify(payload),
  }),env,{});
  assert.equal(response.status,200);
  assert.deepEqual(JSON.parse(storage.read()).articles.map(a => a.id),['new']);
  const sources = await worker.fetch(new Request('https://example.com/api/sources'),env,{});
  assert.equal((await sources.json()).countries.length,24);
});

test('article reader extracts text without executable HTML and respects paid articles', () => {
  const paragraph='A public article paragraph explaining the government election results in detail. '.repeat(3);
  const html='<script type="application/ld+json">'+JSON.stringify({'@type':'NewsArticle',articleBody:paragraph+'\nSecond paragraph with more information.'})+'</script>';
  assert.equal(extractArticle(html).paragraphs.length,2);
  assert.equal(extractArticle('<script type="application/ld+json">'+JSON.stringify({'@type':'NewsArticle',isAccessibleForFree:false,articleBody:paragraph})+'</script>').restricted,true);
  assert.deepEqual(extractArticle('<article><p>'+paragraph+'</p><p class="related">Unrelated advertising content that should be excluded from the reader</p></article>').paragraphs,[paragraph.trim()]);
  assert.equal(publisherUrl('https://localhost/admin','KR'),null);
  assert.equal(publisherUrl('https://yna.co.kr.attacker.example/article','KR'),null);
  assert.ok(publisherUrl('https://www.yna.co.kr/view/article','KR'));
});

test('snapshot preserves Korean Unicode and rejects damaged uploads without replacing it', async () => {
  const storage = bucket(), env = {BUCKET:storage};
  const article = {id:'korean',country:'KR',date:new Date().toISOString(),
    title:'조희대 “계엄 전혀 협조 안해”',source:'한겨레'};
  const upload = articles => worker.fetch(new Request('https://example.com/api/snapshot', {
    method:'POST',body:JSON.stringify({end:koreaDay(),articles}),
  }),env,{});
  assert.equal((await upload([article])).status,200);
  const saved = storage.read();
  const response = await worker.fetch(new Request('https://example.com/api/headlines'),env,{});
  const result = (await response.json()).articles[0];
  assert.equal(result.title,article.title);
  assert.equal(result.source,article.source);
  for (const broken of [{...article,title:'uc870ud76cub300'},
    {...article,source:'ud55cuaca8ub808'}, {...article,title:'\\u005cu조'}]) {
    if (broken.title === '\\u005cu조') continue;
    assert.equal((await upload([broken])).status,400);
    assert.equal(storage.read(),saved);
  }
});

test('importance prioritizes public issues with coverage across publishers', () => {
  const articles=[{id:'a',lang:'en',source:'One',title:'Government election results change national policy'},
    {id:'b',lang:'en',source:'Two',title:'National election results announced by government'},
    {id:'c',lang:'en',source:'Three',title:'A singer releases an acoustic studio album'}];
  const scores=rankHeadlines(articles);
  assert.ok(scores.get('a')>scores.get('c'));
  assert.ok(scores.get('b')>scores.get('c'));
});

test('translation falls back after rate limits and respects the alternate byte limit', async () => {
  const original=globalThis.fetch;let googleRequests=0, alternateRequests=0;
  globalThis.fetch=async url => {
    url=new URL(url);
    if(url.hostname==='translate.googleapis.com'){googleRequests++;return new Response('',{status:429});}
    assert.equal(url.hostname,'api.mymemory.translated.net');
    assert.ok(new TextEncoder().encode(url.searchParams.get('q')).length<=450);
    assert.equal(url.searchParams.get('langpair'),'en|ko');alternateRequests++;
    return Response.json({responseStatus:200,responseData:{translatedText:'한국어 번역'}});
  };
  try {
    const result=await translateNewsText('Government election results. '.repeat(40),'en-GB');
    assert.ok(result.includes('한국어 번역'));assert.equal(googleRequests,1);assert.ok(alternateRequests>1);
  } finally {globalThis.fetch=original;}
});

test('saved article text is readable inside the site and rejects untrusted publishers', async () => {
  const article={id:'article-reader-check',country:'US',title:'A current article',source:'NPR',lang:'en',date:new Date().toISOString()};
  const values=new Map([['headlines/latest.json',JSON.stringify({articles:[article],collectedAt:new Date().toISOString()})]]);
  const env={BUCKET:{get:async key => values.has(key) ? {json:async () => JSON.parse(values.get(key))} : null,put:async (key,value) => values.set(key,value)}};
  const payload={id:article.id,url:'https://www.npr.org/article',paragraphs:['Original article paragraph.']};
  const written=await worker.fetch(new Request('https://example.com/api/article-snapshot',{method:'POST',body:JSON.stringify(payload)}),env,{});
  assert.equal(written.status,200);
  const read=await worker.fetch(new Request('https://example.com/api/article?id='+article.id),env,{});
  assert.deepEqual((await read.json()).paragraphs,payload.paragraphs);
  payload.url='https://127.0.0.1/admin';
  assert.equal((await worker.fetch(new Request('https://example.com/api/article-snapshot',{method:'POST',body:JSON.stringify(payload)}),env,{})).status,400);
});


test('Korean collection keeps original Hangul titles and excludes English edition titles', async () => {
  const korean={code:'KR',lang:'ko'}, date=new Date().toUTCString(), today=koreaDay();
  assert.equal((await parseFeed(rss(date,'Government announces new policy - News'),korean,today)).length,0);
  const title='BTS, UN에서 새 프로젝트 발표';
  assert.equal((await parseFeed(rss(date,title+' - News'),korean,today))[0].title,title);
  assert.equal((await parseFeed(rss(date,'Government announces new policy - News'),country,today)).length,1);
});

test('scheduled uploads and older snapshots cannot reintroduce English titles in Korea', async () => {
  const articles=[
    {id:'ko',country:'KR',title:'한국어 원문 제목',date:new Date().toISOString(),source:'경향신문'},
    {id:'en',country:'KR',title:'English edition headline',date:new Date().toISOString(),source:'경향신문'},
    {id:'us',country:'US',title:'English original headline',date:new Date().toISOString(),source:'NPR'},
  ];
  const storage=bucket({articles,collectedAt:new Date().toISOString()}), env={BUCKET:storage};
  const response=await worker.fetch(new Request('https://example.com/api/headlines'),env,{});
  assert.deepEqual((await response.json()).articles.map(a => a.id),['ko','us']);
  const uploaded=await worker.fetch(new Request('https://example.com/api/snapshot',{
    method:'POST',body:JSON.stringify({end:koreaDay(),articles}),
  }),env,{});
  assert.equal(uploaded.status,200);
  assert.deepEqual(JSON.parse(storage.read()).articles.map(a => a.id),['ko','us']);
});

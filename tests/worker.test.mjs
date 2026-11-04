import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { koreaDay, parseFeed, refreshHeadlines } from '../dist/server/index.js';
import '../ranking.js';
import '../translation.js';

const country = {code:'FR',lang:'fr'};
const rss = (date,title='A &amp; B - News',url='https://news.google.com/rss/articles/example') =>
  `<rss><channel><item><title>${title}</title><source url="https://example.com">News</source><link>${url}</link><pubDate>${date}</pubDate></item></channel></rss>`;
const bucket = initial => {
  const values=new Map(initial ? [['headlines/latest.json',JSON.stringify(initial)]] : []);
  return {get:async key => values.has(key) ? {json:async () => JSON.parse(values.get(key))} : null,
    put:async (key,body) => {values.set(key,body);},read:(key='headlines/latest.json') => values.get(key),values};
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
    assert.equal(JSON.parse(storage.read('headlines/daily/'+koreaDay()+'.json')).collectedAt,data.collectedAt);
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
  assert.deepEqual(JSON.parse(storage.read('headlines/daily/'+koreaDay()+'.json')).articles.map(a => a.id),['new']);
  const sources = await worker.fetch(new Request('https://example.com/api/sources'),env,{});
  assert.equal((await sources.json()).countries.length,24);
});

test('headline search validates a one-year range and filters title, country, and publisher',async()=>{
 const today=koreaDay(),yesterday=new Date(today+'T00:00:00Z');yesterday.setUTCDate(yesterday.getUTCDate()-1);
 const before=yesterday.toISOString().slice(0,10), storage=bucket();
 const make=(id,country,title,source,date)=>({id,country,title,source,date:date+'T03:00:00Z',lang:'en'});
 storage.values.set('headlines/daily/'+before+'.json',JSON.stringify({end:before,articles:[make('old-us','US','Election result','NPR',before)]}));
 storage.values.set('headlines/daily/'+today+'.json',JSON.stringify({end:today,articles:[make('new-us','US','Election update','NPR',today),make('fr','FR','Économie','Le Monde',today)]}));
 const response=await worker.fetch(new Request(`https://example.com/api/headlines?from=${before}&to=${today}&title=Election&country=US&publisher=NPR`),{BUCKET:storage},{waitUntil:()=>{}});
 const result=await response.json();assert.equal(response.status,200);assert.deepEqual(result.articles.map(a=>a.id),['new-us','old-us']);
 assert.deepEqual(result.publishers,['NPR']);
 const invalid=await worker.fetch(new Request('https://example.com/api/headlines?from=2020-01-01&to='+today),{BUCKET:storage},{waitUntil:()=>{}});
 assert.equal(invalid.status,400);
});

test('title-only site does not expose article body endpoints',async()=>{
 const storage=bucket({collectedAt:new Date().toISOString(),articles:[]}),env={BUCKET:storage};
 assert.equal((await worker.fetch(new Request('https://example.com/api/article?id=example'),env,{waitUntil:()=>{}})).status,404);
 assert.equal((await worker.fetch(new Request('https://example.com/api/article-snapshot',{method:'POST',body:'{}'}),env,{waitUntil:()=>{}})).status,405);
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

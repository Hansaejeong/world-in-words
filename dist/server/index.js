import { COUNTRIES, SOURCES, ASSETS, INITIAL_NEWS } from './generated.mjs';
import { accountRoutes, sealHeadlines } from './accounts.mjs';

export const koreaDay = (date = new Date()) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);

const decode = text => text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => String.fromCodePoint(n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n)))
  .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name) => ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '})[name]);
const field = (xml, name) => decode(xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] || '').trim();

// A Korean publisher domain can also serve English editions. RSS locale alone
// does not guarantee a Korean title; retain original titles containing Hangul.
const nativeTitle = (country, title) => country !== 'KR' || /[가-힣]/u.test(title);

export async function parseFeed(xml, country, today) {
  if (!/<rss[\s>]/i.test(xml) || !/<channel[\s>]/i.test(xml)) throw new Error('Invalid RSS response');
  const items = [];
  for (const item of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const date = new Date(field(item[1], 'pubDate'));
    if (!Number.isFinite(date.getTime()) || koreaDay(date) !== today) continue;
    const source = field(item[1], 'source'), url = field(item[1], 'link');
    let title = field(item[1], 'title');
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -source.length - 3);
    if (!title || !url.startsWith('https://') || !nativeTitle(country.code,title)) continue;
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(country.code + url));
    const id = [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('').slice(0,12);
    const sourceUrl=decode(item[1].match(/<source\b[^>]*url="([^"]+)"/i)?.[1] || '');
    items.push({id, country:country.code, title, date:date.toISOString(), source, url, sourceUrl, feedRank:items.length,
      lang:country.lang, direction:country.lang === 'ar' ? 'rtl' : 'ltr'});
  }
  const seen = new Set();
  return items.sort((a,b) => b.date.localeCompare(a.date)).filter(a => {
    const key = a.title.normalize('NFKC').toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0,50);
}

function feedUrl(country, today) {
  const yesterday = new Date(today + 'T00:00:00Z'); yesterday.setUTCDate(yesterday.getUTCDate()-1);
  const tomorrow = new Date(today + 'T00:00:00Z'); tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
  const sites = SOURCES[country.code].map(site => 'site:' + site).join(' OR ');
  const lang = country.lang.startsWith('en-') ? 'en' : country.lang;
  const url = new URL('https://news.google.com/rss/search');
  url.search = new URLSearchParams({q:`(${sites}) after:${yesterday.toISOString().slice(0,10)} before:${tomorrow.toISOString().slice(0,10)}`, hl:country.lang, gl:country.code, ceid:`${country.code}:${lang}`});
  return url;
}
async function collectCountry(country, today) {
  const response = await fetch(feedUrl(country,today), {signal:AbortSignal.timeout(6000)});
  const body = await response.text();
  if (!response.ok) throw new Error('RSS status ' + response.status);
  return parseFeed(body, country, today);
}

const empty = today => ({start:today,end:today,window:'day',articleLimitPerCountry:50,
  collectedAt:null,countries:COUNTRIES,articles:[],failures:[]});
// A JSON body passed through curl's config parser can lose Unicode backslashes.
// Reject the whole upload so a damaged snapshot never replaces readable news.
const damagedText = value => typeof value === 'string' && /(?:\\?u[0-9a-f]{4}){2,}/i.test(value);
function forToday(data, today) {
  return {...(data || empty(today)), start:today, end:today, window:'day', countries:COUNTRIES,
    articles:(data?.articles || []).filter(a => koreaDay(new Date(a.date)) === today && nativeTitle(a.country,a.title))};
}
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},
});
async function readSaved(env, today) {
  const object = await env.BUCKET.get('headlines/latest.json');
  const data=forToday(object ? await object.json() : INITIAL_NEWS, today);
  const initial=new Map(INITIAL_NEWS.articles.map(a => [a.id,a]));
  data.articles=data.articles.map(a => ({...initial.get(a.id),...a}));
  return data;
}
const archiveKey = date => `headlines/daily/${date}.json`;
async function saveSnapshot(env,data) {
  const body=JSON.stringify(data), date=data.end || koreaDay(new Date(data.collectedAt));
  await Promise.all([
    env.BUCKET.put('headlines/latest.json',body,{httpMetadata:{contentType:'application/json'}}),
    env.BUCKET.put(archiveKey(date),body,{httpMetadata:{contentType:'application/json'}}),
  ]);
}
const rangeDates = (from,to) => {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))return null;
  const start=new Date(from+'T00:00:00Z'),end=new Date(to+'T00:00:00Z');
  if(!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start>end || to>koreaDay())return null;
  const anniversary=new Date(start);anniversary.setUTCFullYear(anniversary.getUTCFullYear()+1);
  if(end>anniversary)return null;
  const dates=[];for(let value=new Date(end);value>=start;value.setUTCDate(value.getUTCDate()-1))dates.push(value.toISOString().slice(0,10));
  return dates;
};
async function readRange(env,from,to,{title='',country='all',publisher=''}={}) {
  const dates=rangeDates(from,to);if(!dates)throw new RangeError('Invalid date range');
  const needle=title.normalize('NFKC').toLocaleLowerCase(),articles=[],publishers=new Set();let truncated=false;
  for(const date of dates) {
    const saved=await env.BUCKET.get(archiveKey(date)) || (date===koreaDay() ? await env.BUCKET.get('headlines/latest.json') : null);
    if(!saved)continue;
    const data=forToday(await saved.json(),date);
    for(const article of data.articles) {
      if(country!=='all' && article.country!==country)continue;
      if(needle && !article.title.normalize('NFKC').toLocaleLowerCase().includes(needle))continue;
      if(article.source)publishers.add(article.source);
      if(publisher && article.source!==publisher)continue;
      if(articles.length<2000)articles.push(article);else truncated=true;
    }
  }
  return {start:from,end:to,window:from===to?'day':'range',articleLimitPerCountry:50,collectedAt:new Date().toISOString(),
    countries:COUNTRIES,articles,publishers:[...publishers].sort((a,b)=>a.localeCompare(b)),failures:[],truncated};
}
let pending;
export async function refreshHeadlines(env) {
  if (pending) return pending;
  pending = (async () => {
    const today = koreaDay(), previous = await readSaved(env, today);
    const results = [];
    // Workers allow only a few simultaneous HTTP connections. Always drain bodies.
    for (let i=0;i<COUNTRIES.length;i+=4) {
      results.push(...await Promise.allSettled(COUNTRIES.slice(i,i+4).map(c => collectCountry(c,today))));
    }
    const articles = [], failures = [];
    results.forEach((result,i) => {
      const country = COUNTRIES[i];
      if (result.status === 'fulfilled') articles.push(...result.value);
      else {
        failures.push({country:country.code,error:String(result.reason?.message || result.reason)});
        articles.push(...previous.articles.filter(a => a.country === country.code));
      }
    });
    // Never replace a good same-day snapshot with a total network failure.
    if (failures.length === COUNTRIES.length) throw new Error('All RSS sources unavailable: ' + failures.slice(0,3).map(f => f.error).join(', '));
    const data = {...empty(today), collectedAt:new Date().toISOString(), failures,
      articles:articles.sort((a,b) => b.date.localeCompare(a.date))};
    await saveSnapshot(env,data);
    return forToday(data, koreaDay());
  })();
  try {return await pending;} finally {pending = null;}
}

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    const findCurrent = async id => (await readSaved(env,koreaDay())).articles.find(a => a.id===id);
    const accountResponse = await accountRoutes(request,env,findCurrent);
    if(accountResponse)return accountResponse;
    if (path === '/api/sources' && request.method === 'GET') {
      return json({date:koreaDay(),articleFields:['id','country','title','source','date','url','sourceUrl'],countries:COUNTRIES.map(c => ({...c,feeds:[String(feedUrl(c,koreaDay()))]}))});
    }
    if (path === '/api/snapshot') {
      if (request.method !== 'POST') return json({error:'POST required'},405);
      try {
        const body = await request.text();
        if (body.length > 4000000) return json({error:'Snapshot too large'},413);
        const incoming = JSON.parse(body), today = koreaDay();
        if (incoming.end !== today || !Array.isArray(incoming.articles)) return json({error:'Current-day snapshot required'},400);
        if (incoming.articles.some(a => damagedText(a.title) || damagedText(a.source))) {
          return json({error:'Corrupted Unicode text; send UTF-8 JSON as the raw request body'},400);
        }
        const previous=await readSaved(env,today), byId=new Map(previous.articles.map(a => [a.id,a]));
        const articles = [], seen = new Set();
        for (const article of incoming.articles) {
          const country = COUNTRIES.find(c => c.code === article.country);
          const date = new Date(article.date);
          if (!country || !Number.isFinite(date.getTime()) || koreaDay(date) !== today ||
              typeof article.title !== 'string' || !article.title.trim() || !nativeTitle(country.code,article.title)) continue;
          const key = country.code + article.title;
          if (seen.has(key) || articles.filter(a => a.country === country.code).length >= 50) continue;
          seen.add(key);
          const old=byId.get(String(article.id));
          const safeLink=value => {try{return new URL(value).protocol==='https:'?value:undefined;}catch{return undefined;}};
          articles.push({id:String(article.id || key),country:country.code,title:article.title,
            date:date.toISOString(),source:String(article.source || ''),lang:country.lang,
            direction:country.lang === 'ar' ? 'rtl' : 'ltr',
            url:safeLink(article.url || old?.url),publisherUrl:safeLink(article.publisherUrl || old?.publisherUrl),
            sourceUrl:safeLink(article.sourceUrl || old?.sourceUrl),
            feedRank:Number.isFinite(article.feedRank)?article.feedRank:old?.feedRank,topNews:article.topNews === true});
        }
        if (!articles.length) return json({error:'No verified current-day headlines'},400);
        const data = {...empty(today),collectedAt:new Date().toISOString(),articles,
          failures:Array.isArray(incoming.failures) ? incoming.failures : []};
        await saveSnapshot(env,data);
        return json({collectedAt:data.collectedAt,end:today,articles:articles.length,failures:data.failures.length});
      } catch (error) {
        console.error('Snapshot update failed',error.message);
        return json({error:'Snapshot update unavailable'},503);
      }
    }
    if (path === '/api/refresh' || path === '/api/headlines') {
      if (path === '/api/refresh' && request.method !== 'POST') return json({error:'POST required'},405);
      if (path === '/api/headlines' && request.method !== 'GET') return json({error:'GET required'},405);
      // This shared writer is behind the existing owner-private Sites access boundary.
      // Do not make this Site public without adding separate writer authorization.
      try {
        if (!env.BUCKET) throw new Error('Headline storage unavailable');
        if (path === '/api/refresh') return json(await refreshHeadlines(env));
        const url=new URL(request.url), today=koreaDay();
        let data = await readSaved(env,today);
        const age = Date.now() - Date.parse(data.collectedAt || '');
        if (!Number.isFinite(age) || age >= 900000 || koreaDay(new Date(data.collectedAt)) !== koreaDay()) {
          if (!data.articles.length) {
            try {data = await refreshHeadlines(env);} catch (error) {
              console.error('Headlines refresh failed',error.message);
              return json({...data,refreshError:true},503);
            }
          } else ctx.waitUntil(refreshHeadlines(env).catch(error => console.error('Headlines refresh failed',error.message)));
        }
        const from=url.searchParams.get('from') || today,to=url.searchParams.get('to') || from;
        if(!rangeDates(from,to))return json({error:'날짜는 하루 이상, 최대 1년 범위로 선택해주세요.'},400);
        const ranged=await readRange(env,from,to,{title:(url.searchParams.get('title') || '').slice(0,200),
          country:url.searchParams.get('country') || 'all',publisher:(url.searchParams.get('publisher') || '').slice(0,300)});
        return json(await sealHeadlines(ranged,env));
      } catch (error) {
        console.error('Headlines storage failed',error.message);
        return json({...forToday(INITIAL_NEWS,koreaDay()),refreshError:true},503);
      }
    }
    if (!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed',{status:405});
    const asset = ASSETS[path === '/' ? '/index.html' : path];
    if (!asset) return new Response('Not found',{status:404});
    return new Response(request.method === 'HEAD' ? null : asset.body, {
      headers:{'Content-Type':asset.type,'Cache-Control':'no-cache'},
    });
  },
};

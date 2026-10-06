import { COUNTRIES, SOURCES, ASSETS, INITIAL_NEWS } from './generated.mjs';

export const koreaDay = (date = new Date()) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);

const decode = text => text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => String.fromCodePoint(n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n)))
  .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name) => ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '})[name]);
const field = (xml, name) => decode(xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] || '').trim();

export async function parseFeed(xml, country, today) {
  if (!/<rss[\s>]/i.test(xml) || !/<channel[\s>]/i.test(xml)) throw new Error('Invalid RSS response');
  const items = [];
  for (const item of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const date = new Date(field(item[1], 'pubDate'));
    if (!Number.isFinite(date.getTime()) || koreaDay(date) !== today) continue;
    const source = field(item[1], 'source'), url = field(item[1], 'link');
    let title = field(item[1], 'title');
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -source.length - 3);
    if (!title || !url.startsWith('https://')) continue;
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(country.code + url));
    const id = [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('').slice(0,12);
    items.push({id, country:country.code, title, date:date.toISOString(), source,
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
function forToday(data, today) {
  return {...(data || empty(today)), start:today, end:today, window:'day', countries:COUNTRIES,
    articles:(data?.articles || []).filter(a => koreaDay(new Date(a.date)) === today)};
}
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},
});
async function readSaved(env, today) {
  const object = await env.BUCKET.get('headlines/latest.json');
  return forToday(object ? await object.json() : INITIAL_NEWS, today);
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
    await env.BUCKET.put('headlines/latest.json', JSON.stringify(data), {httpMetadata:{contentType:'application/json'}});
    return forToday(data, koreaDay());
  })();
  try {return await pending;} finally {pending = null;}
}

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (path === '/api/sources' && request.method === 'GET') {
      return json({date:koreaDay(),countries:COUNTRIES.map(c => ({...c,feeds:[String(feedUrl(c,koreaDay()))]}))});
    }
    if (path === '/api/snapshot') {
      if (request.method !== 'POST') return json({error:'POST required'},405);
      try {
        const body = await request.text();
        if (body.length > 4000000) return json({error:'Snapshot too large'},413);
        const incoming = JSON.parse(body), today = koreaDay();
        if (incoming.end !== today || !Array.isArray(incoming.articles)) return json({error:'Current-day snapshot required'},400);
        const articles = [], seen = new Set();
        for (const article of incoming.articles) {
          const country = COUNTRIES.find(c => c.code === article.country);
          const date = new Date(article.date);
          if (!country || !Number.isFinite(date.getTime()) || koreaDay(date) !== today ||
              typeof article.title !== 'string' || !article.title.trim()) continue;
          const key = country.code + article.title;
          if (seen.has(key) || articles.filter(a => a.country === country.code).length >= 50) continue;
          seen.add(key);
          articles.push({id:String(article.id || key),country:country.code,title:article.title,
            date:date.toISOString(),source:String(article.source || ''),lang:country.lang,
            direction:country.lang === 'ar' ? 'rtl' : 'ltr'});
        }
        if (!articles.length) return json({error:'No verified current-day headlines'},400);
        const data = {...empty(today),collectedAt:new Date().toISOString(),articles,
          failures:Array.isArray(incoming.failures) ? incoming.failures : []};
        await env.BUCKET.put('headlines/latest.json',JSON.stringify(data));
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
        let data = await readSaved(env, koreaDay());
        const age = Date.now() - Date.parse(data.collectedAt || '');
        if (!Number.isFinite(age) || age >= 900000 || koreaDay(new Date(data.collectedAt)) !== koreaDay()) {
          if (!data.articles.length) {
            try {data = await refreshHeadlines(env);} catch (error) {
              console.error('Headlines refresh failed',error.message);
              return json({...data,refreshError:true},503);
            }
          } else ctx.waitUntil(refreshHeadlines(env).catch(error => console.error('Headlines refresh failed',error.message)));
        }
        return json(data);
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

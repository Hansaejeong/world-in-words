import { SOURCES } from './generated.mjs';

const decode = value => value.replace(/&#(x[\da-f]+|\d+);/gi,(_,n) => String.fromCodePoint(n[0].toLowerCase()==='x' ? parseInt(n.slice(1),16) : Number(n)))
 .replace(/&(amp|lt|gt|quot|apos|nbsp);/g,(_,n) => ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '})[n]);
const plain = value => decode(value.replace(/<(script|style|nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]+>/g,' ')).replace(/[ \t]+/g,' ').trim();

export function extractArticle(html) {
 const walk = value => {
  if (!value || typeof value !== 'object') return null;
  if (value.isAccessibleForFree === false || value.isAccessibleForFree === 'False' || value.isAccessibleForFree === 'false') return {restricted:true};
  if (typeof value.articleBody === 'string' && value.articleBody.trim().length > 100) return {paragraphs:value.articleBody.split(/\n+/).map(plain).filter(Boolean)};
  for (const child of Object.values(value)) {const found=walk(child);if(found)return found;}
  return null;
 };
 for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
  try {const result=walk(JSON.parse(match[1]));if(result)return result;} catch {}
 }
 const area = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] || html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
 if (!area) return {paragraphs:[]};
 const paragraphs = [...area.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)]
  .filter(m => !/class=["'][^"']*(?:caption|byline|related|advert|copyright|share|subscription|footer)/i.test(m[1]))
  .map(m => plain(m[2])).filter(text => text.length >= 35);
 return {paragraphs:[...new Set(paragraphs)]};
}

export function publisherUrl(value, country) {
 try {
  const url = new URL(value);
  if(url.protocol!=='https:' || url.username || url.password || (url.port && url.port!=='443')) return null;
  const domains = (SOURCES[country] || []).map(s => s.split('/')[0]);
  return domains.some(d => url.hostname === d || url.hostname.endsWith('.'+d)) ? url : null;
 } catch {return null;}
}
async function page(url,country) {
 for(let i=0;i<5;i++) {
  const allowed = publisherUrl(String(url),country);
  if(!allowed)throw new Error('Publisher address unavailable');
  const response = await fetch(allowed,{redirect:'manual',signal:AbortSignal.timeout(10000),headers:{'User-Agent':'WorldInWords personal reader','Accept':'text/html'}});
  if(response.status>=300 && response.status<400) {
   const next=response.headers.get('location');await response.body?.cancel();
   if(!next)throw new Error('Publisher redirect unavailable');url=new URL(next,allowed);continue;
  }
  const html=await response.text();
  if(!response.ok)throw new Error('Publisher access unavailable');
  if(html.length>3000000)throw new Error('Publisher page too large');
  return {html,url:String(allowed)};
 }
 throw new Error('Publisher redirect unavailable');
}
async function resolveGoogle(value,country) {
 const url=new URL(value);
 if(url.hostname!=='news.google.com' || !url.pathname.includes('/articles/'))throw new Error('Original address unavailable');
 const token=url.pathname.split('/').pop();
 const response=await fetch(url,{signal:AbortSignal.timeout(10000)});
 const html=await response.text();
 if(publisherUrl(response.url,country))return response.url;
 const signature=html.match(/data-n-a-sg="([^"]+)"/)?.[1], timestamp=html.match(/data-n-a-ts="(\d+)"/)?.[1];
 if(!signature || !timestamp)throw new Error('Original address unavailable');
 const args=['garturlreq',[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],token,Number(timestamp),signature];
 const rpc=await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute',{
  method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},
  body:new URLSearchParams({'f.req':JSON.stringify([[['Fbv4je',JSON.stringify(args)]]])}),signal:AbortSignal.timeout(10000),
 });
 const result=(await rpc.text()).split('\n\n').slice(1).join('\n\n').trim();
 const outer=JSON.parse(result), original=JSON.parse(outer[0][2])[1];
 if(!publisherUrl(original,country))throw new Error('Original address unavailable');
 return original;
}

export async function readArticle(article, env) {
 const cached = await env.BUCKET.get('articles/'+article.id+'.json');
 if(cached)return cached.json();
 let original = publisherUrl(article.publisherUrl || article.url,article.country);
 if(!original && article.url) original = new URL(await resolveGoogle(article.url,article.country));
 if(!original)throw new Error('Original address unavailable');
 const {html,url} = await page(original,article.country), extracted=extractArticle(html);
 if(extracted.restricted) return {restricted:true,paragraphs:[],url};
 if(!extracted.paragraphs?.length)return {unavailable:true,paragraphs:[],url};
 const data={paragraphs:extracted.paragraphs,url,lang:article.lang,source:article.source};
 await env.BUCKET.put('articles/'+article.id+'.json',JSON.stringify(data));
 return data;
}

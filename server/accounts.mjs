const encoder = new TextEncoder();
const accountLanguages = new Set(['ko','ja','zh-TW','hi','id','th','vi','fr','de','es','it','en','pt','ar']);
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
export const hashToken = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const articleMetadata = article => Object.fromEntries(['id','title','country','date','source','lang','direction','url','publisherUrl','sourceUrl'].filter(key=>article[key]!==undefined).map(key=>[key,article[key]]));
const url64 = bytes => b64(bytes).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const from64 = value => Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
async function receiptKey(env) {
 return crypto.subtle.importKey('raw',encoder.encode(JSON.parse(env.WIW_RPC_SIGNING_KEY).d),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
// A signed copy lets a displayed headline remain usable after an RSS refresh.
export async function sealHeadlines(data,env) {
 if(!configured(env))return data;
 const key=await receiptKey(env), expires=Date.now()+172800000;
 const articles=await Promise.all(data.articles.map(async article=>{
  const bytes=encoder.encode(JSON.stringify({article:articleMetadata(article),expires}));
  return {...article,articleToken:url64(bytes)+'.'+url64(await crypto.subtle.sign('HMAC',key,bytes))};
 }));
 return {...data,articles};
}
async function verifiedArticle(env,value,id) {
 try {
  if(typeof value!=='string' || value.length>12000)return null;
  const [payload,signature]=value.split('.'),bytes=from64(payload);
  if(!await crypto.subtle.verify('HMAC',await receiptKey(env),from64(signature),bytes))return null;
  const result=JSON.parse(new TextDecoder().decode(bytes));
  return result.expires>Date.now() && result.article.id===id ? result.article : null;
 }catch{return null;}
}
const cookie = (name,value,maxAge=2592000) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
const readCookie = (request,name) => request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1) || '';
const sessionHash = async request => {
 const value=readCookie(request,'__Host-wiw_session');
 return /^[a-f0-9]{64}$/.test(value) ? hashToken(value) : null;
};
export const configured = env => Boolean(env.SUPABASE_RPC_URL && env.WIW_RPC_SIGNING_KEY);
export async function rpc(env,action,session=null,input={}) {
 if(!configured(env))throw new Error('계정 보관함 연결을 준비 중입니다.');
 const body=JSON.stringify({p_action:action,p_session:session,p_input:input});
 const timestamp=String(Date.now());
 const key=await crypto.subtle.importKey('jwk',JSON.parse(env.WIW_RPC_SIGNING_KEY),{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
 const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,encoder.encode(timestamp+'\n'+body));
 const response=await fetch(env.SUPABASE_RPC_URL,{method:'POST',headers:{'Content-Type':'application/json','X-WIW-Time':timestamp,'X-WIW-Signature':b64(signature)},body,signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error('보관함 연결이 지연되고 있습니다. 잠시 후 다시 시도해주세요.');
 return response.json();
}
const reply=(data,status=200,headers={}) => Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}});
const errorStatus=result => result.error==='unauthorized' ? 401 : result.error==='rate_limited' ? 429 : 400;
const errors={unauthorized:'로그인이 필요합니다.',rate_limited:'시도 횟수가 많습니다. 15분 후 다시 시도해주세요.',invalid_credentials:'아이디 또는 비밀번호를 확인해주세요.',username_taken:'이미 사용 중인 아이디입니다.'};
const validDateRange=(from,to)=>{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))return false;
 const start=new Date(from+'T00:00:00Z'),end=new Date(to+'T00:00:00Z'),anniversary=new Date(start);
 anniversary.setUTCFullYear(anniversary.getUTCFullYear()+1);
 return Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && start<=end && end<=anniversary;
};
async function inputJSON(request) {
 const text=await request.text();
 if(text.length>24000)throw new Error('요청이 너무 큽니다.');
 return JSON.parse(text);
}
export async function accountArticle(request,env,id) {
 if(!configured(env))return null;
 const session=await sessionHash(request);if(!session)return null;
 return (await rpc(env,'article',session,{id})).article || null;
}
export async function accountRoutes(request,env,findCurrent) {
 const url=new URL(request.url), path=url.pathname;
 if(!path.startsWith('/api/account') && path!='/api/library' && path!='/api/scrap' && path!='/api/counts' && !path.startsWith('/go/'))return null;
 try {
  if(!['GET','POST'].includes(request.method))return reply({error:'지원하지 않는 요청입니다.'},405);
  if(request.method==='POST') {
   if(request.headers.get('origin')!==url.origin)return reply({error:'요청 출처를 확인할 수 없습니다.'},403);
   if(!request.headers.get('content-type')?.includes('application/json'))return reply({error:'JSON 요청이 필요합니다.'},415);
  }
  if(path==='/api/account' && request.method==='GET') {
   if(!configured(env))return reply({configured:false,user:null});
   return reply({configured:true,...await rpc(env,'session',await sessionHash(request))});
  }
  if(!configured(env))return reply({error:'계정 보관함 연결을 준비 중입니다.'},503);
  if(path==='/api/account/signup' || path==='/api/account/login') {
   if(request.method!=='POST')return reply({error:'POST 요청이 필요합니다.'},405);
   const input=await inputJSON(request), username=String(input.username || '').normalize('NFKC').toLowerCase().trim(), password=input.password;
   if(!/^[a-z0-9_]{3,24}$/.test(username) || typeof password!=='string' || password.length<8 || encoder.encode(password).length>64)
    return reply({error:'아이디는 영문·숫자·밑줄 3–24자, 비밀번호는 8자 이상·64바이트 이내로 입력해주세요.'},400);
   const language=accountLanguages.has(input.language)?input.language:'ko';
   const value=token(), result=await rpc(env,path.endsWith('/signup')?'signup':'login',await hashToken(value),{username,password,language});
   if(result.error)return reply({error:errors[result.error] || '가입할 수 없습니다.'},errorStatus(result));
   return reply(result,200,{'Set-Cookie':cookie('__Host-wiw_session',value)});
  }
  const session=await sessionHash(request);
  if(path==='/api/account/language' && request.method==='POST') {
   const language=(await inputJSON(request)).language;
   if(!accountLanguages.has(language))return reply({error:'지원하지 않는 언어입니다.'},400);
   const result=await rpc(env,'language',session,{language});
   return result.error ? reply({error:errors[result.error]},errorStatus(result)) : reply(result);
  }
  if(path==='/api/account/logout' && request.method==='POST') {
   await rpc(env,'logout',session);
   return reply({ok:true},200,{'Set-Cookie':cookie('__Host-wiw_session','',0)});
  }
  if(path==='/api/counts') {
   const supplied=request.method==='POST' ? (await inputJSON(request)).ids : (url.searchParams.get('ids') || '').split(',');
   const ids=(Array.isArray(supplied)?supplied:[]).filter(id=>typeof id==='string' && /^[\w-]{1,128}$/.test(id)).slice(0,1200);
   return reply(await rpc(env,'counts',session,{ids}));
  }
  if(path==='/api/library' && request.method==='GET') {
   const kind=url.searchParams.get('kind') || 'history',from=url.searchParams.get('from') || '',to=url.searchParams.get('to') || '';
   if(!['history','scraps'].includes(kind) || !validDateRange(from,to))return reply({error:'날짜는 하루 이상, 최대 1년 범위로 선택해주세요.'},400);
   const result=await rpc(env,'library',session,{kind,from,to,title:(url.searchParams.get('title') || '').slice(0,200),country:url.searchParams.get('country') || 'all',publisher:(url.searchParams.get('publisher') || '').slice(0,300),sort:url.searchParams.get('sort'),page:Math.floor(Math.max(0,Math.min(10000,Number(url.searchParams.get('page')) || 0)))});
   return result.error ? reply({error:errors[result.error]},errorStatus(result)) : reply(result);
  }
  if(path==='/api/scrap' && request.method==='POST') {
   const input=await inputJSON(request), id=String(input.id || '');
   // Metadata always comes from a verified snapshot or this user's own library.
   const article=input.saved===false ? null : await findCurrent(id) || await verifiedArticle(env,input.articleToken,id) || await accountArticle(request,env,id);
   if(input.saved!==false && !article)return reply({error:'기사를 찾을 수 없습니다.'},404);
   const result=await rpc(env,'scrap',session,{id,saved:input.saved!==false,article:article ? articleMetadata(article) : null});
   return result.error ? reply({error:errors[result.error]},errorStatus(result)) : reply(result);
  }
  if(path.startsWith('/go/') && request.method==='GET') {
   // Only actual document navigation counts, never link prefetch or API fetches.
   if(request.headers.get('purpose')==='prefetch' || request.headers.get('sec-purpose')?.includes('prefetch'))return new Response(null,{status:204});
   const id=decodeURIComponent(path.slice(4));
   const article=await findCurrent(id) || await verifiedArticle(env,url.searchParams.get('article'),id) || await accountArticle(request,env,id);
   if(!article)return reply({error:'기사를 찾을 수 없습니다. 로그인 후 보관함을 확인해주세요.'},404);
   let target;
   for(const candidate of [article.publisherUrl,article.url]) {
    try {const parsed=new URL(candidate);if(parsed.protocol==='https:' && !parsed.username && !parsed.password){target=parsed.href;break;}}catch{}
   }
   if(!target)return reply({error:'기사 원문 주소가 없습니다.'},404);
   const viewer=readCookie(request,'__Host-wiw_reader');
   const visitor=/^[a-f0-9]{64}$/.test(viewer)?viewer:token();
   const me=await rpc(env,'session',session);
   const viewerHash=await hashToken(me.user ? 'user:'+me.user.username : 'visitor:'+visitor);
   await rpc(env,'view',session,{article:articleMetadata(article),viewer:viewerHash});
   return new Response(null,{status:303,headers:{Location:target,'Cache-Control':'no-store','Referrer-Policy':'no-referrer','Set-Cookie':cookie('__Host-wiw_reader',visitor)}});
  }
  return reply({error:'경로를 찾을 수 없습니다.'},404);
 } catch(error) {
  return reply({error:error instanceof SyntaxError?'요청 내용을 확인해주세요.':error.message || '보관함을 불러올 수 없습니다.'},503);
 }
}

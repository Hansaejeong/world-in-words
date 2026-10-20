import {test} from 'node:test';
import assert from 'node:assert/strict';
import {accountRoutes,hashToken} from '../server/accounts.mjs';
const origin='https://reader.example';
const article={id:'verified',title:'한국어 원문 기사',country:'KR',lang:'ko',source:'출처',url:'https://publisher.example/article',date:'2026-10-06T00:00:00Z'};
const request=(path,body,cookie='')=>new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:body===undefined?undefined:JSON.stringify(body)});
async function fixture(callback){
 const keys=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const env={SUPABASE_RPC_URL:'https://bridge.example',WIW_RPC_SIGNING_KEY:JSON.stringify(await crypto.subtle.exportKey('jwk',keys.privateKey))};
 const native=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{
  assert.equal(String(url),env.SUPABASE_RPC_URL);
  const signature=Uint8Array.from(atob(options.headers['X-WIW-Signature']),c=>c.charCodeAt(0));
  assert.ok(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},keys.publicKey,signature,new TextEncoder().encode(options.headers['X-WIW-Time']+'\n'+options.body)));
  const payload=JSON.parse(options.body);calls.push(payload);
  const result=await callback(payload,calls);
  return Response.json(result);
 };
 return {env,calls,restore:()=>{globalThis.fetch=native;}};
}
test('username signup sets a secure HttpOnly cookie and sends only its hash to Supabase',async()=>{
 const f=await fixture(()=>({user:{username:'reader_qa'}}));
 try{
  const response=await accountRoutes(request('/api/account/signup',{username:'Reader_QA',password:'testing_password'}),f.env,async()=>null);
  assert.equal(response.status,200);
  const cookie=response.headers.get('set-cookie');assert.match(cookie,/__Host-wiw_session=[a-f0-9]{64}; Path=\/; HttpOnly; Secure; SameSite=Lax/);
  const raw=cookie.split(';')[0].split('=')[1];
  assert.equal(f.calls[0].p_session,await hashToken(raw));
  assert.equal(f.calls[0].p_input.username,'reader_qa');
  assert.notEqual(f.calls[0].p_session,raw);
 }finally{f.restore();}
});
test('cross-origin writes are rejected before any database call',async()=>{
 const response=await accountRoutes(new Request(origin+'/api/account/signup',{method:'POST',headers:{Origin:'https://attacker.example','Content-Type':'application/json'},body:'{}'}),{},async()=>null);
 assert.equal(response.status,403);
});
test('scraps ignore client-supplied metadata and private operations require a session',async()=>{
 const f=await fixture(()=>({error:'unauthorized'}));
 try{
  const response=await accountRoutes(request('/api/scrap',{id:article.id,saved:true,article:{url:'https://attacker.example'}}),f.env,async()=>article);
  assert.equal(response.status,401);assert.deepEqual(f.calls[0].p_input.article,article);
 }finally{f.restore();}
});
test('only original-link navigation records a view and redirects to the verified publisher',async()=>{
 const f=await fixture(p=>p.p_action==='session'?{user:{username:'reader_qa'}}:{recorded:true});
 try{
  const response=await accountRoutes(request('/go/'+article.id),f.env,async()=>article);
  assert.equal(response.status,303);assert.equal(response.headers.get('location'),article.url);
  assert.deepEqual(f.calls.map(p=>p.p_action),['session','view']);
  assert.equal(f.calls[1].p_input.article.title,article.title);
  assert.match(f.calls[1].p_input.viewer,/^[a-f0-9]{64}$/);
  const before=f.calls.length;
  const prefetch=await accountRoutes(new Request(origin+'/go/'+article.id,{headers:{Purpose:'prefetch'}}),f.env,async()=>article);
  assert.equal(prefetch.status,204);assert.equal(f.calls.length,before);
 }finally{f.restore();}
});
test('logout revokes the server session before clearing the cookie',async()=>{
 const f=await fixture(()=>({ok:true})),value='a'.repeat(64);
 try{
  const response=await accountRoutes(request('/api/account/logout',{},'__Host-wiw_session='+value),f.env,async()=>null);
  assert.equal(f.calls[0].p_action,'logout');assert.equal(f.calls[0].p_session,await hashToken(value));
  assert.match(response.headers.get('set-cookie'),/Max-Age=0/);
 }finally{f.restore();}
});
test('missing configuration is explicit and unknown links never redirect',async()=>{
 assert.equal((await accountRoutes(request('/api/scrap',{id:'missing'}),{},async()=>null)).status,503);
 const f=await fixture(()=>({}));
 try{assert.equal((await accountRoutes(request('/go/missing'),f.env,async()=>null)).status,404);}finally{f.restore();}
});

test('signed headline metadata survives refresh but tampering cannot create an article',async()=>{
 const {sealHeadlines}=await import('../server/accounts.mjs');
 const f=await fixture(()=>({saved:true}));
 try{
  const sealed=await sealHeadlines({articles:[article]},f.env), value=sealed.articles[0].articleToken;
  const saved=await accountRoutes(request('/api/scrap',{id:article.id,saved:true,articleToken:value}),f.env,async()=>null);
  assert.equal(saved.status,200);assert.deepEqual(f.calls[0].p_input.article,article);
  const bytes=JSON.parse(atob(value.split('.')[0].replaceAll('-','+').replaceAll('_','/')));
  bytes.article.url='https://attacker.example';
  const tampered=btoa(JSON.stringify(bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')+'.'+value.split('.')[1];
  const rejected=await accountRoutes(request('/api/scrap',{id:article.id,saved:true,articleToken:tampered}),f.env,async()=>null);
  assert.equal(rejected.status,404);
 }finally{f.restore();}
});

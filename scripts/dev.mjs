// Portable local Worker preview. Environment arrives on hidden stdin, never disk.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import worker from '../dist/server/index.js';
const port=Number(process.argv[2] || 8765);
process.stdout.write('Ready for preview environment JSON (input hidden).\n');
if(process.stdin.isTTY)process.stdin.setRawMode(true);
process.stdin.resume();
let input='';
const env=await new Promise(resolve=>{
 const read=chunk=>{
  input+=chunk.toString();
  if(!input.includes('\n'))return;
  process.stdin.off('data',read);if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.pause();
  resolve(JSON.parse(input.trim()));input='';
 };
 process.stdin.on('data',read);
});
const values=new Map();
if(process.argv[3])values.set('headlines/latest.json',await readFile(process.argv[3],'utf8'));
env.BUCKET={get:async key=>values.has(key)?{json:async()=>JSON.parse(values.get(key))}:null,put:async(key,value)=>{values.set(key,value);}};
// curl uses the OS certificate store, also for existing RSS and reader routes.
globalThis.fetch=async(resource,options={})=>{
 const req=new Request(resource,options);
 const config='url = '+JSON.stringify(req.url)+'\nrequest = '+JSON.stringify(req.method)+'\n'+[...req.headers].map(([k,v])=>'header = '+JSON.stringify(k+': '+v)+'\n').join('');
 const body=['GET','HEAD'].includes(req.method)?undefined:Buffer.from(await req.arrayBuffer());
 return new Promise((resolve,reject)=>{
  const child=spawn('curl',['--silent','--show-error','--max-time','45','--config','/dev/fd/3','--write-out','\n%{http_code}',...(body?['--data-binary','@-']:[])],{stdio:['pipe','pipe','pipe','pipe']});
  let output=[],error='';child.stdout.on('data',c=>output.push(c));child.stderr.on('data',c=>error+=c);
  child.on('error',reject);child.on('close',code=>{if(code)return reject(new Error(error));const raw=Buffer.concat(output),index=raw.lastIndexOf(10);resolve(new Response(raw.subarray(0,index),{status:Number(raw.subarray(index+1)),headers:{'Content-Type':'application/json'}}));});
  child.stdio[3].end(config);child.stdin.end(body);
 });
};
http.createServer(async(req,res)=>{
 try {
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  // Loopback-only development cookie names: production keeps Secure __Host cookies.
  const headers={...req.headers,cookie:(req.headers.cookie || '').replaceAll('wiw_preview_','__Host-wiw_')};
  const request=new Request('http://'+req.headers.host+req.url,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
  const response=await worker.fetch(request,env,{waitUntil:promise=>promise.catch(()=>{})});
  const out=Object.fromEntries(response.headers);
  if(out['set-cookie'])out['set-cookie']=out['set-cookie'].replaceAll('__Host-wiw_','wiw_preview_').replace('; Secure','');
  res.writeHead(response.status,out);res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(500);res.end('Local preview error');}
}).listen(port,'127.0.0.1',()=>console.log('World In Words preview: http://localhost:'+port));

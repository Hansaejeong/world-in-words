// Only WIW's server can authorize this bridge. The private key lives in Sites secrets.
const publicKey = {"key_ops":["verify"],"ext":true,"kty":"EC","x":"Aj34FM8UsX5kE4cV9cHwFpIGdnFFlX--svvwSi4CBqg","y":"NDYgxN2nLntPDF7lIpRhUatD0cwRlGZJfXTad118Tlg","crv":"P-256"};
const verificationKey = crypto.subtle.importKey('jwk',publicKey,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
export async function handle(request: Request): Promise<Response> {
 if(request.method!=='POST')return new Response('Method not allowed',{status:405});
 try {
  const timestamp=request.headers.get('X-WIW-Time') || '';
  if(!/^\d{13}$/.test(timestamp) || Math.abs(Date.now()-Number(timestamp))>60000)return new Response('Unauthorized',{status:401});
  const text=await request.text();if(text.length>200000)return new Response('Too large',{status:413});
  const bytes=Uint8Array.from(atob(request.headers.get('X-WIW-Signature') || ''),c=>c.charCodeAt(0));
  const valid=await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},await verificationKey,bytes,new TextEncoder().encode(timestamp+'\n'+text));
  if(!valid)return new Response('Unauthorized',{status:401});
  const payload=JSON.parse(text);
  if(!['signup','login','logout','session','language','counts','view','scrap','article','library'].includes(payload.p_action))return new Response('Bad request',{status:400});
  const secrets=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
  const secret=secrets.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!secret)return new Response('Database unavailable',{status:503});
  const headers:Record<string,string>={'Content-Type':'application/json',apikey:secret};
  if(!secret.startsWith('sb_secret_'))headers.Authorization='Bearer '+secret;
  const rpcName=payload.p_action==='library'?'wiw_library_search':'wiw_api';
  const response=await fetch(Deno.env.get('SUPABASE_URL')+'/rest/v1/rpc/'+rpcName,{method:'POST',headers,body:text,signal:AbortSignal.timeout(15000)});
  if(!response.ok)return Response.json({error:'Database request failed'},{status:503});
  return new Response(await response.text(),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 } catch {return new Response('Request unavailable',{status:503});}
}
Deno.serve(handle);


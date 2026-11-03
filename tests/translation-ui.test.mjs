import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../translation.js';

test('headline translation uses the selected country language',async()=>{
 const native=globalThis.fetch,calls=[];
 globalThis.fetch=async url=>{calls.push(new URL(url));return Response.json([[['bonjour']]]);};
 try{
  assert.equal(await globalThis.translateNewsText('hello','en-US','fr'),'bonjour');
  assert.equal(calls[0].searchParams.get('tl'),'fr');
  assert.equal(await globalThis.translateNewsText('déjà traduit','fr','fr'),'déjà traduit');
  assert.equal(calls.length,1);
 }finally{globalThis.fetch=native;}
});

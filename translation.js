(() => {
 let googleUnavailableUntil=0;
 const encoder=new TextEncoder();
 const chunks=(text,limit) => {
  const result=[];let buffer='';
  for(const word of text.match(/\S+\s*/gu) || []) {
   if(encoder.encode(buffer+word).length<=limit){buffer+=word;continue;}
   if(buffer){result.push(buffer.trim());buffer='';}
   for(const character of word) {
    if(encoder.encode(buffer+character).length>limit){result.push(buffer.trim());buffer='';}
    buffer+=character;
   }
  }
  if(buffer.trim())result.push(buffer.trim());return result;
 };
 const code=lang => lang==='zh-TW' ? lang : String(lang || 'en').split('-')[0];
 globalThis.translateNewsText=async (text,lang,target='ko') => {
  const source=code(lang), destination=code(target);
  if(source===destination)return text;
  if(Date.now()>googleUnavailableUntil) {
   try {
    const pieces=[];
    for(const chunk of chunks(text,1200)) {
     const url=new URL('https://translate.googleapis.com/translate_a/single');
     Object.entries({client:'gtx',sl:'auto',tl:destination,dt:'t',q:chunk}).forEach(([k,v]) => url.searchParams.set(k,v));
     const response=await fetch(url,{signal:AbortSignal.timeout(15000)});
     if(!response.ok)throw new Error('translation unavailable');
     const payload=await response.json(), translated=payload?.[0]?.map(p => p?.[0] || '').join('').trim();
     if(!translated)throw new Error('empty translation');pieces.push(translated);
    }
    return pieces.join(' ');
   } catch {googleUnavailableUntil=Date.now()+300000;}
  }
  const pieces=[];
  for(const chunk of chunks(text,450)) {
   const url=new URL('https://api.mymemory.translated.net/get');
   url.search=new URLSearchParams({q:chunk,langpair:source+'|'+destination});
   const response=await fetch(url,{signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw new Error('translation unavailable');
   const payload=await response.json(), translated=payload.responseData?.translatedText;
   if(payload.responseStatus!==200 || !translated || /^MYMEMORY WARNING/i.test(translated))throw new Error('translation unavailable');
   pieces.push(translated);
  }
  return pieces.join(' ');
 };
})();

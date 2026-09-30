(() => {
 'use strict';
 const $ = s => document.querySelector(s);
 if (!window.NEWS) { $('#article-list').textContent='뉴스 데이터를 불러오지 못했습니다. 페이지를 새로고침해주세요.'; return; }
 const data=window.NEWS, countries=new Map(data.countries.map(c=>[c.code,c]));
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const shortDate=d=>d.slice(0,10).replaceAll('-','.');
 const safeUrl=u=>{try {return new URL(u).protocol==='https:'?u:'#';}catch{return '#';}};
 const labels={Asia:'아시아',Europe:'유럽',Americas:'아메리카',Africa:'아프리카','Middle East':'중동',Oceania:'오세아니아'};
 let saved=new Set();try{const v=JSON.parse(localStorage.getItem('wiw-saved')||'[]');if(Array.isArray(v)) saved=new Set(v.filter(x=>data.articles.some(a=>a.id===x)));}catch{}
 const state={country:'all',mode:'archive',query:'',days:'all',sort:'new',limit:24,selected:null,translationId:null};
 const titleTranslations=new Map();
 let results=[];
 const period=`${shortDate(data.start)} — ${shortDate(data.end)}`;
 $('#period').textContent=period;$('#about-period').textContent=period+' (발행일 UTC 기준)';
 $('#about-update').textContent=`${shortDate(data.collectedAt)} 수집본입니다. 자동 갱신되지 않는 고정 아카이브이며, 수집 프로그램을 실행해 새 기간으로 갱신할 수 있습니다.`;
 const covered=data.countries.filter(c=>data.articles.some(a=>a.country===c.code));
 $('#country-count').textContent=covered.length;$('#all-count').textContent=data.articles.length;
 $('#statistics').innerHTML=[[covered.length,'국가·지역'],[new Set(covered.map(c=>c.language)).size,'언어'],[data.articles.length,'기사']].map(([n,l])=>`<div class="stat"><strong>${n}</strong><span>${l}</span></div>`).join('');
 $('#countries').innerHTML=Object.entries(labels).map(([region,ko])=>`<div class="region-label">${region}<small>${ko}</small></div>${covered.filter(c=>c.region===region).map(c=>`<button class="country" data-country="${c.code}" title="${esc(c.ko)} · ${esc(c.language)}"><span class="country-name"><span class="code">${c.code}</span><bdi lang="${c.lang}">${esc(c.name)}</bdi></span><span>${data.articles.filter(a=>a.country===c.code).length}</span></button>`).join('')}`).join('');
 function toast(text){$('#toast').textContent=text;$('#toast').classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('visible'),2200);}
 function persist(){try{localStorage.setItem('wiw-saved',JSON.stringify([...saved]));}catch{toast('브라우저 저장이 제한되어 이번 화면에서만 보관됩니다.');}}
 function toggleSave(id){saved.has(id)?saved.delete(id):saved.add(id);persist();render();toast(saved.has(id)?'기사를 저장했습니다.':'저장 목록에서 제외했습니다.');}
 function filtered(){const end=new Date(data.end+'T23:59:59Z');return data.articles.filter(a=>{
  const c=countries.get(a.country), q=state.query.normalize('NFKC').toLocaleLowerCase();
  return (state.country==='all'||a.country===state.country)&&(state.mode!=='saved'||saved.has(a.id))&&(state.days==='all'||((end-new Date(a.date))/86400000<Number(state.days)))&&(!q||[a.title,a.source,c.name,c.ko,c.code,c.language].join(' ').normalize('NFKC').toLocaleLowerCase().includes(q));
 }).sort((a,b)=>state.sort==='old'?a.date.localeCompare(b.date):state.sort==='country'?a.country.localeCompare(b.country)||b.date.localeCompare(a.date):b.date.localeCompare(a.date));}
 function reset(){state.country='all';state.query='';state.days='all';state.limit=24;$('#search').value='';$('#date-filter').value='all';render();}
 function render(){results=filtered();$('#saved-count').textContent=saved.size;
  $('#archive-tab').classList.toggle('active',state.mode==='archive');$('#saved-tab').classList.toggle('active',state.mode==='saved');
  document.querySelectorAll('[data-country]').forEach(b=>{b.classList.toggle('selected',b.dataset.country===state.country);b.setAttribute('aria-pressed',String(b.dataset.country===state.country));});
  const c=countries.get(state.country);$('#section-title').innerHTML=state.mode==='saved'?'저장한 기사':c?`${esc(c.ko)}의 소식 <span>${esc(c.name)}</span>`:'전체 기사';
  $('#result-count').textContent=`${String(results.length).padStart(3,'0')} ARTICLES`;
  if(!results.some(a=>a.id===state.selected))state.selected=results[0]?.id||null;
  $('#article-list').innerHTML=results.length?results.slice(0,state.limit).map(a=>{const c=countries.get(a.country);return `<article class="news-item ${a.id===state.selected?'chosen':''}"><button class="article-select" data-id="${a.id}" aria-label="${esc(a.title)} — 기사 정보" aria-pressed="${a.id===state.selected}"><span class="item-meta"><span class="locale"><bdi lang="${c.lang}">${esc(c.name)}</bdi></span><span>${esc(c.language)}</span><time datetime="${a.date}">${shortDate(a.date)}</time></span><span class="item-title" lang="${a.lang}" dir="${a.direction}">${esc(a.title)}</span><span class="item-source">${esc(a.source)}<span class="read-arrow" aria-hidden="true">↗</span></span></button><button class="save-small" data-save="${a.id}" aria-label="${saved.has(a.id)?'저장 해제':'기사 저장'}: ${esc(a.title)}" aria-pressed="${saved.has(a.id)}">${saved.has(a.id)?'◆':'◇'}</button></article>`;}).join(''):`<div class="empty"><strong>${state.mode==='saved'&&!saved.size?'아직 저장한 기사가 없습니다.':'일치하는 기사가 없습니다.'}</strong><p>${state.mode==='saved'&&!saved.size?'기사 옆의 ◇를 눌러 저장하세요.':'다른 검색어를 입력하거나 필터를 초기화해보세요.'}</p><button id="empty-reset">${state.mode==='saved'&&!saved.size?'모든 기사 둘러보기 ↗':'필터 초기화 ↺'}</button></div>`;
  $('#more').hidden=results.length<=state.limit;
  if(!$('#more').hidden)$('#more').innerHTML=`기사 더 보기 <span>${Math.min(state.limit,results.length)} / ${results.length} ↓</span>`;
  $('#empty-reset')?.addEventListener('click',()=>{if(state.mode==='saved'&&!saved.size)state.mode='archive';reset();});renderReader();
 }
 async function translateTitle(a){
  if(titleTranslations.has(a.id)){state.translationId=a.id;renderReader();return;}
  const button=$('#translate-title'), status=$('#translation-status');
  button.disabled=true;button.textContent='번역하는 중…';status.textContent='기사 제목을 한국어로 번역하고 있습니다.';
  const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),12000);
  try{
   const url=new URL('https://translate.googleapis.com/translate_a/single');
   Object.entries({client:'gtx',sl:'auto',tl:'ko',dt:'t',q:a.title}).forEach(([key,value])=>url.searchParams.set(key,value));
   const response=await fetch(url,{signal:controller.signal});
   if(!response.ok)throw Error('번역 서비스 응답 오류');
   const payload=await response.json();
   const translated=payload?.[0]?.map(part=>part?.[0]||'').join('').trim();
   if(!translated)throw Error('번역 결과 없음');
   titleTranslations.set(a.id,translated);
   if(state.selected===a.id){state.translationId=a.id;renderReader();}
  }catch{
   if(state.selected===a.id){button.disabled=false;button.textContent='한국어 제목 다시 시도';status.innerHTML='<span>지금은 제목 번역을 불러오지 못했습니다.</span> <a href="'+esc('https://translate.google.com/?sl=auto&tl=ko&text='+encodeURIComponent(a.title)+'&op=translate')+'" target="_blank" rel="noopener noreferrer">Google 번역에서 보기 ↗</a>';}
  }finally{clearTimeout(timeout);}
 }
 function renderReader(){const a=data.articles.find(a=>a.id===state.selected);if(!a){$('#reader').innerHTML='<p class="reader-empty">목록에서 기사를 선택해주세요.</p>';return;}
  const c=countries.get(a.country),i=results.findIndex(x=>x.id===a.id);
  let nativeDate;try{nativeDate=new Intl.DateTimeFormat(a.lang,{dateStyle:'long',timeZone:'UTC'}).format(new Date(a.date));}catch{nativeDate=shortDate(a.date);}
  const translated=state.translationId===a.id&&titleTranslations.has(a.id);
  const publisherUrl=safeUrl(a.publisherUrl||a.url);
  $('#reader').innerHTML=`
   <div class="reader-top"><span class="eyebrow">DISPATCH / ${c.code}</span><span class="reader-tag">ORIGINAL LANGUAGE</span><button class="close-reader">닫기 ×</button></div>
   <p class="reader-country">${esc(c.ko)} · <bdi lang="${c.lang}">${esc(c.name)}</bdi></p>
   <h2 id="reader-title" lang="${translated?'ko':a.lang}" dir="${translated?'ltr':a.direction}">${esc(translated?titleTranslations.get(a.id):a.title)}</h2>
   ${translated?`<p class="original-heading">원어 제목 · <span lang="${a.lang}" dir="${a.direction}">${esc(a.title)}</span></p>`:''}
   <div class="translation-controls">
    ${a.lang==='ko'?'<span class="already-korean">한국어 기사</span>':`<button id="translate-title" type="button" aria-pressed="${translated}">${translated?'원어 제목 보기':'제목 한국어로 보기'}</button>`}
   </div>
   ${a.lang==='ko'?'':`<details class="free-translation"><summary>전문 무료 번역</summary><ol><li><a href="${esc(publisherUrl)}" target="_blank" rel="noopener noreferrer">기사 원문 열기</a></li><li>Chrome: 주소창의 번역 아이콘 또는 페이지 우클릭 → 한국어로 번역.<br>Edge: 주소창의 번역 아이콘 → 한국어 → 번역.</li></ol><p>별도 결제 없이 이용할 수 있습니다. 언론사의 유료 기사·로그인 제한은 그대로 적용됩니다.</p><p>본문을 복사해 <a href="https://translate.google.com/?sl=auto&tl=ko&op=translate" target="_blank" rel="noopener noreferrer">Google 번역</a> 또는 <a href="https://papago.naver.com/" target="_blank" rel="noopener noreferrer">파파고 텍스트 번역</a>에 붙여넣을 수도 있습니다.</p></details>`}
   <p id="translation-status" class="translation-status" role="status">${translated?'자동 번역된 제목입니다.':''}</p>
   <dl class="reader-details"><div><dt>발행</dt><dd lang="${a.lang}" dir="auto">${esc(nativeDate)}</dd></div><div><dt>언론사</dt><dd><a href="${esc(safeUrl(a.sourceUrl))}" target="_blank" rel="noopener noreferrer">${esc(a.source)} ↗</a></dd></div><div><dt>언어</dt><dd>${esc(c.language)} · ${esc(a.lang)}</dd></div><div><dt>수집</dt><dd>${shortDate(data.collectedAt)}</dd></div></dl>
   <a class="original-link" href="${esc(publisherUrl)}" target="_blank" rel="noopener noreferrer">원문에서 전문 읽기 <span>↗</span></a>
   <div class="reader-actions"><button data-save="${a.id}">${saved.has(a.id)?'◆ 저장됨':'◇ 기사 저장'}</button><button id="copy-link">링크 복사 ↗</button></div>
   <p class="reader-note">${esc(c.language)} 원어 제목입니다. 한국어 번역은 자동 번역이며 오류가 있을 수 있습니다.<br>전문 번역 방법은 위의 ‘전문 무료 번역’을 펼쳐 확인하세요.</p>
   <div class="reader-bottom"><span>${String(i+1).padStart(3,'0')} / ${String(results.length).padStart(3,'0')} 기사</span><div><button id="previous" aria-label="이전 기사" ${i<=0?'disabled':''}>←</button> <button id="next" aria-label="다음 기사" ${i>=results.length-1?'disabled':''}>→</button></div></div><div class="reader-mark" aria-hidden="true">${c.code} ↗</div>`;
  $('#translate-title')?.addEventListener('click',()=>{if(state.translationId===a.id){state.translationId=null;renderReader();}else translateTitle(a);});
  $('.close-reader').addEventListener('click',()=>$('#reader').classList.remove('mobile-open'));
  $('#copy-link').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(publisherUrl);toast('원문 링크를 복사했습니다.');}catch{const t=document.createElement('textarea');t.value=publisherUrl;document.body.appendChild(t);t.select();const ok=document.execCommand('copy');t.remove();toast(ok?'원문 링크를 복사했습니다.':'복사할 수 없습니다. 원문 링크를 길게 눌러 복사해주세요.');}});
  $('#previous').addEventListener('click',()=>select(results[i-1]?.id));$('#next').addEventListener('click',()=>select(results[i+1]?.id));
 }
 function select(id){if(!id)return;if(state.selected!==id)state.translationId=null;state.selected=id;state.limit=Math.max(state.limit,results.findIndex(a=>a.id===id)+1);render();if(matchMedia('(max-width:800px)').matches)$('#reader').classList.add('mobile-open');$('#reader').scrollTop=0;}
 document.addEventListener('click',e=>{const save=e.target.closest('[data-save]');if(save){toggleSave(save.dataset.save);return;}const item=e.target.closest('[data-id]');if(item){select(item.dataset.id);return;}const country=e.target.closest('[data-country]');if(country){state.country=country.dataset.country;state.limit=24;render();$('#directory').classList.remove('open');$('#menu-toggle').setAttribute('aria-expanded','false');}});
 $('#search').addEventListener('input',e=>{state.query=e.target.value;state.limit=24;render();});
 $('#date-filter').addEventListener('change',e=>{state.days=e.target.value;state.limit=24;render();});
 $('#sort').addEventListener('change',e=>{state.sort=e.target.value;render();});
 $('#more').addEventListener('click',()=>{state.limit+=24;render();});
 $('#saved-tab').addEventListener('click',()=>{state.mode='saved';reset();});$('#archive-tab').addEventListener('click',()=>{state.mode='archive';reset();});
 $('#menu-toggle').addEventListener('click',()=>{$('#directory').classList.toggle('open');$('#menu-toggle').setAttribute('aria-expanded',String($('#directory').classList.contains('open')));});
 $('#about-open').addEventListener('click',()=>$('#about').showModal());$('#about-close').addEventListener('click',()=>$('#about').close());
 $('#about').addEventListener('click',e=>{if(e.target===$('#about')){const r=$('#about').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('#about').close();}});
 $('#back-top').addEventListener('click',()=>window.scrollTo({top:0,behavior:'smooth'}));
 document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&!$('#about').open){e.preventDefault();$('#search').focus();}if(e.key==='Escape'){$('#reader').classList.remove('mobile-open');$('#directory').classList.remove('open');$('#menu-toggle').setAttribute('aria-expanded','false');}});
 render();
})();

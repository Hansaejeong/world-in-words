(() => {
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day = (date = new Date()) => new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
let data = window.NEWS, currentDay = day(), country = 'all', titleQuery = '', publisher = '', dateFrom = currentDay, dateTo = currentDay, sort = 'hot', limit = 50, loading = false, refreshQueued = false;
const translations = new Map(), translatedIds = new Set(), translating = new Set(), translationErrors = new Set();
const safeLink = url => {try{return new URL(url).protocol === 'https:' ? url : '#';}catch{return '#';}};
const labels = {Asia:'아시아',Europe:'유럽',Americas:'아메리카',Africa:'아프리카','Middle East':'중동',Oceania:'오세아니아'};
let view='today', user=null, accountReady=false, signup=false, libraryArticles=[], libraryTotal=0, libraryPublishers=[], libraryPage=0, libraryLoading=false, libraryError='', libraryRequest=0;
let countReady=false;
const counts=new Map(), savedIds=new Set(), saving=new Set();
const languageCode = value => value === 'zh-TW' ? value : String(value || '').split('-')[0];
const languages = new Map((data?.countries || []).map(c => [languageCode(c.lang),c.language]));
const allowedLanguages = new Set(languages.keys());
const storedLanguage = () => {try{return localStorage.getItem('wiw-language');}catch{return null;}};
let guestLanguage=allowedLanguages.has(storedLanguage())?storedLanguage():'ko', preferredLanguage=guestLanguage;
const translationKey = id => preferredLanguage+'\u0000'+id;
const articleById = id => libraryArticles.find(a=>a.id===id) || data?.articles.find(a=>a.id===id);
const originalLink = article => `go/${encodeURIComponent(article.id)}${article.articleToken ? "?article="+encodeURIComponent(article.articleToken) : ""}`;
const status = message => {$('#action-status').textContent=message;};
async function api(path, body) {
 const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(25000)});
 const result=await response.json();
 if(!response.ok){if(response.status===401){user=null;savedIds.clear();}throw new Error(result.error || '연결이 지연되고 있습니다.');}
 return result;
}
async function loadAccount() {
 try {const result=await api('api/account');user=result.user;accountReady=result.configured;preferredLanguage=user?.language || guestLanguage;}
 catch {accountReady=false;}
 render();
}
async function loadCounts() {
 const articles=data?.articles || [];
 try {
  const results=[];for(let i=0;i<articles.length;i+=1200)results.push(await api('api/counts',{ids:articles.slice(i,i+1200).map(a=>a.id)}));
  savedIds.clear();for(const result of results){for(const [id,count] of Object.entries(result.counts))counts.set(id,Number(count));for(const id of result.savedIds)savedIds.add(id);}
  countReady=true;render();
 } catch {countReady=false;render();}
}
async function loadLibrary(append=false) {
 if(view==='today' || !user)return;
 const ticket=++libraryRequest, requestedView=view;
 libraryLoading=true;libraryError='';if(!append){libraryPage=0;libraryArticles=[];}render();
 try {
  const params=new URLSearchParams({kind:view,from:dateFrom,to:dateTo,title:titleQuery,country,publisher,sort,page:String(libraryPage)});
  const result=await api('api/library?'+params);
  if(ticket!==libraryRequest || view!==requestedView)return;
  libraryArticles=append?[...libraryArticles,...result.articles]:result.articles;
  libraryTotal=result.total;libraryPublishers=result.publishers || [];
  for(const article of libraryArticles){if(article.saved)savedIds.add(article.id);else savedIds.delete(article.id);}
 } catch(error) {if(ticket===libraryRequest)libraryError=error.message;}
 finally {if(ticket===libraryRequest){libraryLoading=false;render();}}
}
async function toggleScrap(id) {
 if(!user){openAccount();return;}
 if(saving.has(id))return;
 const saved=!savedIds.has(id);saving.add(id);render();
 try {
  const result=await api('api/scrap',{id,saved,articleToken:articleById(id)?.articleToken});
  if(result.saved)savedIds.add(id);else savedIds.delete(id);
  status(result.saved?'스크랩에 저장했습니다.':'스크랩에서 해제했습니다.');
  if(view==='scraps')await loadLibrary();
 } catch(error){status(error.message);}
 finally {saving.delete(id);render();}
}
function openAccount() {
 $('#account-error').textContent='';$('#account-dialog').showModal();$('#username').focus();
}
const earliestDate=()=>{const value=new Date(currentDay+'T00:00:00Z');value.setUTCFullYear(value.getUTCFullYear()-1);return value.toISOString().slice(0,10);};
function validSearchRange(from=dateFrom,to=dateTo) {
 const start=new Date(from+'T00:00:00Z'),end=new Date(to+'T00:00:00Z'),anniversary=new Date(start);
 anniversary.setUTCFullYear(anniversary.getUTCFullYear()+1);
 return /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && Number.isFinite(start.getTime()) && start<=end && end<=anniversary && to<=currentDay;
}
async function runSearch() {
 const from=$('#date-from').value,to=$('#date-to').value;
 if(!validSearchRange(from,to)){$('#search-error').textContent='날짜는 같은 날부터 최대 1년까지, 오늘 이전 범위로 선택해주세요.';return;}
 $('#search-error').textContent='';dateFrom=from;dateTo=to;titleQuery=$('#title-search').value.trim();country=$('#country-search').value;publisher=$('#publisher-search').value;limit=50;
 if(view==='today')await refresh();else await loadLibrary();
}
async function resetFilters() {
 country='all';publisher='';titleQuery='';dateFrom=currentDay;dateTo=currentDay;limit=50;$('#search-error').textContent='';render();
 if(view==='today')await refresh();else await loadLibrary();
}
function applyLanguage(language) {
 if(!allowedLanguages.has(language))return;
 preferredLanguage=language;translatedIds.clear();translationErrors.clear();render();
}
async function setLanguage(language) {
 if(!allowedLanguages.has(language) || language===preferredLanguage)return;
 const previous=preferredLanguage;applyLanguage(language);
 try {
  if(user){const result=await api('api/account/language',{language});user=result.user;status(`${languages.get(language)} 번역 설정을 계정에 저장했습니다.`);}
  else {guestLanguage=language;try{localStorage.setItem('wiw-language',language);}catch{}status(`${languages.get(language)} 번역 설정을 이 브라우저에 저장했습니다.`);}
 } catch(error){applyLanguage(previous);status(error.message);}
}

function render() {
 currentDay = day();
 $('#today').textContent = currentDay.replaceAll('-', '.'); $('#today').dateTime = currentDay;
 $('#account-name').textContent=user?`${user.username} 님`:'';
 $('#account-open').hidden=Boolean(user);$('#account-logout').hidden=!user;
 $('#preferred-language').innerHTML=[...languages].map(([code,name])=>`<option value="${esc(code)}" ${code===preferredLanguage?'selected':''}>${esc(name)}</option>`).join('');
 $('#preferred-language').title=user?'이 계정의 번역 언어로 저장됩니다.':'이 브라우저에 번역 언어가 저장됩니다.';
 for(const input of [$('#date-from'),$('#date-to')]){input.min=earliestDate();input.max=currentDay;}
 $('#date-from').value=dateFrom;$('#date-to').value=dateTo;$('#title-search').value=titleQuery;
 $('#library-note').hidden=view==='today';
 $('#library-note').textContent=view==='history'?'원문 링크를 연 기사를 열람한 연도별로 보관합니다. 이전 연도 기록도 계속 남습니다.':'저장해 둔 기사를 연도와 국가로 다시 찾아보세요.';
 document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('selected',b.dataset.view===view);b.setAttribute('aria-pressed',String(b.dataset.view===view));});
 if (!data) {$('#article-list').textContent = '헤드라인을 불러오지 못했습니다.'; return;}
 const countries = new Map(data.countries.map(c => [c.code,c]));
 $('#country-search').innerHTML='<option value="all">전체 국가</option>'+data.countries.map(c=>`<option value="${esc(c.code)}" ${c.code===country?'selected':''}>${esc(c.ko)} · ${esc(c.name)}</option>`).join('');
 const publisherOptions=[...new Set([...(view==='today'?(data.publishers || data.articles.map(a=>a.source)):libraryPublishers),...(publisher?[publisher]:[])].filter(Boolean))].sort((a,b)=>a.localeCompare(b));
 $('#publisher-search').innerHTML='<option value="">전체 언론사</option>'+publisherOptions.map(source=>`<option value="${esc(source)}" ${source===publisher?'selected':''}>${esc(source)}</option>`).join('');
 $('#countries').innerHTML = Object.entries(labels).map(([region,label]) => `<p class="region">${label}</p>` + data.countries.filter(c => c.region === region).map(c => `<button data-country="${c.code}">${esc(c.ko)} <bdi class="country-native" lang="${c.lang}">${esc(c.name)}</bdi></button>`).join('')).join('');
 document.querySelectorAll('[data-country]').forEach(b => {b.classList.toggle('selected',b.dataset.country === country);b.setAttribute('aria-pressed',String(b.dataset.country === country));});
 const q = titleQuery.normalize('NFKC').toLocaleLowerCase();
 const source=view==='today'?data.articles:libraryArticles;
 const candidates = source.filter(a => {const published=day(new Date(a.date));return published>=dateFrom && published<=dateTo && (country==='all'||a.country===country) && (!publisher||a.source===publisher) && (!q||a.title.normalize('NFKC').toLocaleLowerCase().includes(q));});
 const hotness=rankHeadlines(candidates);
 const items = candidates.sort((a,b)=>(sort==='country'?a.country.localeCompare(b.country):0) || (hotness.get(b.id)-hotness.get(a.id)) || b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
 $('#section-title').textContent=view==='history'?'열람 기록':view==='scraps'?'스크랩':country==='all'?'세계의 헤드라인':`${countries.get(country)?.ko}의 헤드라인`;
 $('#result-count').textContent=`${view==='today'?items.length.toLocaleString()+(data.truncated?'개 이상':'개'):user?libraryTotal.toLocaleString()+'개':'0개'} 기사`;
 $('#more').hidden=view==='today'?items.length<=limit:!user||libraryLoading||libraryArticles.length>=libraryTotal;
 if(view!=='today' && !user){$('#article-list').innerHTML='<div class="library-empty"><p>로그인하면 열람 기록과 스크랩을 다른 기기에서도 찾을 수 있습니다.</p><button data-login>로그인 / 아이디 만들기</button></div>';return;}
 if(view!=='today' && libraryError){$('#article-list').innerHTML=`<div class="library-empty"><p>${esc(libraryError)}</p><button data-library-retry>다시 시도</button></div>`;return;}
 if(view!=='today' && libraryLoading && !libraryArticles.length){$('#article-list').innerHTML='<p class="empty" role="status">보관함 불러오는 중</p>';return;}
 $('#article-list').innerHTML = (view==='today'?items.slice(0,limit):items).map(a => {
  const key=translationKey(a.id), translated = translatedIds.has(a.id) && translations.has(key), busy = translating.has(key);
  const count=a.viewCount??(countReady?counts.get(a.id)??0:null), saved=savedIds.has(a.id);
  const languageName=languages.get(preferredLanguage), sameLanguage=languageCode(a.lang)===preferredLanguage;
  return `<article data-article="${esc(a.id)}"><p class="meta">${esc(countries.get(a.country)?.ko)} · ${esc(a.source)} · <time datetime="${esc(a.date)}">${day(new Date(a.date)).replaceAll('-','.')}</time> · <span class="view-count">조회 ${count===null?'—':Number(count).toLocaleString()}</span></p><h2 class="title" lang="${translated ? esc(preferredLanguage) : esc(a.lang)}" dir="${translated ? preferredLanguage==='ar'?'rtl':'ltr' : a.direction === 'rtl' ? 'rtl' : 'ltr'}">${esc(translated ? translations.get(key) : a.title)}</h2><div class="article-actions">${sameLanguage ? '' : `<button class="translation-toggle" data-translate="${esc(a.id)}" aria-label="${translated ? '원어 제목 보기' : `제목 ${languageName}로 보기`}: ${esc(a.title)}" aria-pressed="${translated}" ${busy ? 'disabled aria-busy="true"' : ''}>${busy ? '번역 중' : translationErrors.has(key) ? '번역 재시도' : translated ? '원어 보기' : `${languageName} 번역`}</button>`}<a href="${originalLink(a)}" target="_blank" rel="noopener noreferrer" data-original="${esc(a.id)}">기사 원문 ↗</a><button class="scrap-toggle" data-scrap="${esc(a.id)}" aria-pressed="${saved}" ${saving.has(a.id)?'disabled':''}>${saving.has(a.id)?'저장 중':saved?'스크랩 해제':'스크랩'}</button></div>${view==='history'&&a.lastViewedAt?`<p class="record-meta">${day(new Date(a.lastViewedAt)).replaceAll('-','.')} 열람 · ${a.openCount}회 방문</p>`:''}</article>`;
 }).join('') || ((titleQuery||country!=='all'||publisher||dateFrom!==currentDay||dateTo!==currentDay)?'<p class="empty">검색 조건에 맞는 기사가 없습니다.</p>':view==='history'?'<div class="library-empty"><p>아직 열람 기록이 없습니다. 로그인 상태에서 ‘기사 원문’을 열면 자동으로 보관됩니다.</p></div>':view==='scraps'?'<div class="library-empty"><p>저장한 기사가 없습니다. 기사 옆 ‘스크랩’을 눌러 보관해보세요.</p></div>':'<p class="empty">오늘 올라온 제목이 없습니다.</p>');
}
async function refresh() {
 currentDay = day(); render();
 if (loading) {refreshQueued=true;return;} loading = true; $('#update-status').textContent = '';
 try {
  const params=new URLSearchParams({from:dateFrom,to:dateTo,title:titleQuery,country,publisher});
  const response = await fetch(`api/headlines?${params}`, {cache:'no-store',signal:AbortSignal.timeout(40000)});
  if (response.status === 401 || response.status === 403) throw new Error('로그인이 필요합니다.');
  if (response.status === 404 || !response.headers.get('content-type')?.includes('application/json')) throw new Error('자동 갱신 서버로 열어주세요.');
  if (!response.ok) throw new Error('기사 수집 연결이 지연되고 있습니다.');
  const fresh = await response.json();
  if (!Array.isArray(fresh.articles) || !Array.isArray(fresh.countries) ) throw new Error('invalid');
  data = fresh; render();await loadCounts();
  const collectedDay = data.collectedAt ? day(new Date(data.collectedAt)) : '';
  $('#update-status').textContent = collectedDay !== currentDay ? '새 제목 수집 중' : data.failures?.length ? '일부 국가 수집 지연' : '';
 } catch (error) {
  $('#update-status').textContent = error.message?.includes('필요') || error.message?.includes('서버로') || error.message?.includes('지연') ? error.message : '기사 연결 재시도 중';
 } finally {loading = false;if(refreshQueued){refreshQueued=false;refresh();}}
}
function scheduleMidnight() {
 const now = new Date();
 const parts = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const values = Object.fromEntries(parts.map(p => [p.type,p.value]));
 const delay = (86400 - (+values.hour * 3600 + +values.minute * 60 + +values.second)) * 1000 - now.getMilliseconds();
 setTimeout(() => {currentDay = day();limit = 50;refresh();scheduleMidnight();}, Math.max(100,delay));
}
async function translateTitle(id) {
 const article = articleById(id);
 const key=translationKey(id), target=preferredLanguage;
 if (!article || translating.has(key)) return;
 if (translatedIds.has(id)) {translatedIds.delete(id);render();return;}
 if (translations.has(key)) {translatedIds.add(id);render();return;}
 translating.add(key);translationErrors.delete(key);render();
 try {
  const title=await translateNewsText(article.title,article.lang,target);
  translations.set(key,title);if(preferredLanguage===target)translatedIds.add(id);
 } catch {translationErrors.add(key);}
 finally {translating.delete(key);render();}
}
document.addEventListener('click', e => {
 const login=e.target.closest('[data-login]');if(login){openAccount();return;}
 const retryLibrary=e.target.closest('[data-library-retry]');if(retryLibrary){loadLibrary();return;}
 const category=e.target.closest('[data-view]');if(category){view=category.dataset.view;limit=50;libraryArticles=[];libraryTotal=0;libraryError='';libraryRequest++;libraryLoading=false;render();if(view!=='today')loadLibrary();return;}
 const scrap=e.target.closest('[data-scrap]');if(scrap){toggleScrap(scrap.dataset.scrap);return;}

 const translation = e.target.closest('[data-translate]');
 if (translation) {translateTitle(translation.dataset.translate);return;}
 const button = e.target.closest('[data-country]');
 if(button){country = button.dataset.country;$('#country-search').value=country;limit = 50;if(view==='today')refresh();else loadLibrary();}
});
$('#search-form').addEventListener('submit',e=>{e.preventDefault();runSearch();});
$('#country-search').addEventListener('change',runSearch);
$('#publisher-search').addEventListener('change',runSearch);
$('#filter-reset').addEventListener('click',resetFilters);
$('#sort').addEventListener('change',e => {sort=e.target.value;render();if(view!=='today')loadLibrary();});
$('#preferred-language').addEventListener('change',e=>setLanguage(e.target.value));
$('#more').addEventListener('click',()=>{if(view==='today'){limit+=50;render();}else {libraryPage++;loadLibrary(true);}});
$('#account-open').addEventListener('click',openAccount);
$('#account-close').addEventListener('click',()=>$('#account-dialog').close());
$('#account-mode').addEventListener('click',()=>{
 signup=!signup;$('#account-title').textContent=signup?'아이디 만들기':'로그인';$('#account-submit').textContent=signup?'가입하고 시작하기':'로그인';$('#account-mode').textContent=signup?'이미 아이디가 있다면 로그인':'처음이라면 아이디 만들기';$('#password').autocomplete=signup?'new-password':'current-password';$('#confirm-label').hidden=!signup;$('#password-confirm').hidden=!signup;$('#password-confirm').required=signup;$('#account-error').textContent='';
});
$('#account-form').addEventListener('submit',async e=>{
 e.preventDefault();$('#account-error').textContent='';
 if(!accountReady){$('#account-error').textContent='보관함 연결을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.';await loadAccount();return;}
 if(signup && $('#password').value!==$('#password-confirm').value){$('#account-error').textContent='비밀번호 확인이 일치하지 않습니다.';return;}
 const submit=$('#account-submit');submit.disabled=true;
 try {
  const result=await api('api/account/'+(signup?'signup':'login'),{username:$('#username').value,password:$('#password').value,language:preferredLanguage});
  user=result.user;applyLanguage(user.language);$('#password').value='';$('#password-confirm').value='';$('#account-dialog').close();status(signup?'가입했습니다. 원문을 열면 열람 기록이 저장됩니다.':'로그인했습니다.');await loadCounts();if(view!=='today')await loadLibrary();render();
 } catch(error){$('#account-error').textContent=error.message;}
 finally {submit.disabled=false;}
});
$('#account-logout').addEventListener('click',async()=>{
 try {await api('api/account/logout',{});user=null;applyLanguage(guestLanguage);savedIds.clear();libraryArticles=[];libraryTotal=0;libraryYears=[];libraryRequest++;status('로그아웃했습니다.');render();}
 catch(error){status(error.message);}
});
$('#back-top').addEventListener('click',() => window.scrollTo({top:0}));
document.addEventListener('visibilitychange',() => {if (!document.hidden) refresh();});
window.addEventListener('focus',async()=>{await loadAccount();refresh();if(view!=='today')loadLibrary();});
render();loadAccount().then(loadCounts);refresh();scheduleMidnight();setInterval(refresh,300000);
})();

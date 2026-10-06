(() => {
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day = (date = new Date()) => new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
let data = window.NEWS, currentDay = day(), country = 'all', query = '', sort = 'importance', limit = 50, loading = false;
const translations = new Map(), translatedIds = new Set(), translating = new Set(), translationErrors = new Set();
const opened = new Set(), bodies = new Map(), bodyLoading = new Set(), bodyTranslations = new Map(), bodyKorean = new Set(), bodyTranslating = new Set(), bodyErrors = new Set();
const safeLink = url => {try{return new URL(url).protocol === 'https:' ? url : '#';}catch{return '#';}};
const labels = {Asia:'아시아',Europe:'유럽',Americas:'아메리카',Africa:'아프리카','Middle East':'중동',Oceania:'오세아니아'};
function render() {
 currentDay = day();
 $('#today').textContent = currentDay.replaceAll('-', '.'); $('#today').dateTime = currentDay;
 if (!data) {$('#article-list').textContent = '헤드라인을 불러오지 못했습니다.'; return;}
 const countries = new Map(data.countries.map(c => [c.code,c]));
 $('#countries').innerHTML = Object.entries(labels).map(([region,label]) => `<p class="region">${label}</p>` + data.countries.filter(c => c.region === region).map(c => `<button data-country="${c.code}">${esc(c.ko)} <bdi class="country-native" lang="${c.lang}">${esc(c.name)}</bdi></button>`).join('')).join('');
 document.querySelectorAll('[data-country]').forEach(b => {b.classList.toggle('selected',b.dataset.country === country);b.setAttribute('aria-pressed',String(b.dataset.country === country));});
 const q = query.normalize('NFKC').toLocaleLowerCase();
 const todayArticles = data.articles.filter(a => day(new Date(a.date)) === currentDay);
 const scores = rankHeadlines(todayArticles);
 const items = todayArticles.filter(a => {const c = countries.get(a.country);return day(new Date(a.date)) === currentDay && (country === 'all' || a.country === country) && (!q || [a.title,a.source,c?.ko,c?.name].join(' ').normalize('NFKC').toLocaleLowerCase().includes(q));}).sort((a,b) => (sort === 'country' ? a.country.localeCompare(b.country) : 0) || (scores.get(b.id)-scores.get(a.id)) || a.title.localeCompare(b.title));
 $('#section-title').textContent = country === 'all' ? '세계의 헤드라인' : `${countries.get(country)?.ko}의 헤드라인`;
 $('#result-count').textContent = `${items.length}개 제목`;
 $('#article-list').innerHTML = items.slice(0,limit).map(a => {
  const translated = translatedIds.has(a.id) && translations.has(a.id);
  const busy = translating.has(a.id);
  return `<article data-article="${esc(a.id)}"><p class="meta">${esc(countries.get(a.country)?.ko)} · ${esc(a.source)} · <time datetime="${esc(a.date)}">${day(new Date(a.date)).replaceAll('-','.')}</time></p><h2 class="title" lang="${translated ? 'ko' : esc(a.lang)}" dir="${translated ? 'ltr' : a.direction === 'rtl' ? 'rtl' : 'ltr'}">${esc(translated ? translations.get(a.id) : a.title)}</h2>${a.lang === 'ko' ? '' : `<button class="translation-toggle" data-translate="${esc(a.id)}" aria-label="${translated ? '원어 제목 보기' : '제목 한국어로 보기'}: ${esc(a.title)}" aria-pressed="${translated}" ${busy ? 'disabled aria-busy="true"' : ''}>${busy ? '번역 중' : translationErrors.has(a.id) ? '번역 재시도' : translated ? '원어 보기' : '한국어 번역'}</button>`}<button class="expand-toggle" data-expand="${esc(a.id)}" aria-expanded="${opened.has(a.id)}">${opened.has(a.id) ? '접기' : '펼쳐보기'}</button>${opened.has(a.id) ? bodyView(a) : ''}</article>`;
 }).join('') || (query ? '<p class="empty">일치하는 제목이 없습니다.</p>' : '<p class="empty">오늘 올라온 제목이 없습니다.</p>');
 $('#more').hidden = items.length <= limit;
}
function bodyView(article) {
 const id=article.id, body=bodies.get(id);
 if(bodyLoading.has(id)) return '<div class="article-body" role="status">원문 불러오는 중</div>';
 const link=safeLink(body?.url || article.publisherUrl || article.url || article.sourceUrl);
 if(!body?.paragraphs?.length) return `<div class="article-body"><p>${body?.restricted ? '유료·로그인 기사는 원문에서 확인해주세요.' : '이 언론사의 본문을 불러올 수 없습니다.'}</p>${link !== '#' ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">기사 원문 보기</a>` : ''}<button data-retry-body="${esc(id)}">다시 시도</button></div>`;
 const translated=bodyKorean.has(id) && bodyTranslations.has(id);
 const paragraphs=translated ? bodyTranslations.get(id) : body.paragraphs;
 return `<div class="article-body"><div class="body-tools">${article.lang !== 'ko' ? `<button data-translate-body="${esc(id)}" aria-pressed="${translated}" ${bodyTranslating.has(id) ? 'disabled' : ''}>${bodyTranslating.has(id) ? '본문 번역 중' : translated ? '본문 원어 보기' : bodyErrors.has(id) ? '본문 번역 재시도' : '본문 한국어 번역'}</button>` : ''}<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">기사 원문 보기</a></div><div lang="${translated ? 'ko' : esc(article.lang)}" dir="${translated ? 'ltr' : article.direction === 'rtl' ? 'rtl' : 'ltr'}">${paragraphs.map(p => `<p>${esc(p)}</p>`).join('')}</div></div>`;
}
async function loadBody(id) {
 if(bodyLoading.has(id))return;
 bodyLoading.add(id);render();
 try {
  const response=await fetch('api/article?id='+encodeURIComponent(id),{signal:AbortSignal.timeout(40000)});
  if(!response.ok)throw new Error('article unavailable');
  const body=await response.json();
  if(!Array.isArray(body.paragraphs))throw new Error('invalid body');
  bodies.set(id,body);
 } catch {bodies.set(id,{unavailable:true,paragraphs:[]});}
 finally {bodyLoading.delete(id);render();}
}
async function translateBody(id) {
 if(bodyTranslating.has(id))return;
 if(bodyKorean.has(id)){bodyKorean.delete(id);render();return;}
 if(bodyTranslations.has(id)){bodyKorean.add(id);render();return;}
 const body=bodies.get(id);if(!body?.paragraphs?.length)return;
 bodyTranslating.add(id);bodyErrors.delete(id);render();
 try {
  const translated=[];
  const article=data.articles.find(a => a.id===id);
  for(const paragraph of body.paragraphs) translated.push(await translateNewsText(paragraph,article?.lang));
  bodyTranslations.set(id,translated);bodyKorean.add(id);
 } catch {bodyErrors.add(id);}
 finally {bodyTranslating.delete(id);render();}
}
async function refresh() {
 currentDay = day(); render();
 if (loading) return; loading = true; $('#update-status').textContent = '';
 try {
  const response = await fetch(`api/headlines?date=${currentDay}`, {cache:'no-store',signal:AbortSignal.timeout(20000)});
  if (response.status === 401 || response.status === 403) throw new Error('로그인이 필요합니다.');
  if (response.status === 404 || !response.headers.get('content-type')?.includes('application/json')) throw new Error('자동 갱신 서버로 열어주세요.');
  if (!response.ok) throw new Error('기사 수집 연결이 지연되고 있습니다.');
  const fresh = await response.json();
  if (!Array.isArray(fresh.articles) || !Array.isArray(fresh.countries) ) throw new Error('invalid');
  data = fresh; render();
  const collectedDay = data.collectedAt ? day(new Date(data.collectedAt)) : '';
  $('#update-status').textContent = collectedDay !== currentDay ? '새 제목 수집 중' : data.failures?.length ? '일부 국가 수집 지연' : '';
 } catch (error) {
  $('#update-status').textContent = error.message?.includes('필요') || error.message?.includes('서버로') || error.message?.includes('지연') ? error.message : '기사 연결 재시도 중';
 } finally {loading = false;}
}
function scheduleMidnight() {
 const now = new Date();
 const parts = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const values = Object.fromEntries(parts.map(p => [p.type,p.value]));
 const delay = (86400 - (+values.hour * 3600 + +values.minute * 60 + +values.second)) * 1000 - now.getMilliseconds();
 setTimeout(() => {currentDay = day();limit = 50;refresh();scheduleMidnight();}, Math.max(100,delay));
}
async function translateTitle(id) {
 const article = data?.articles.find(a => a.id === id);
 if (!article || translating.has(id)) return;
 if (translatedIds.has(id)) {translatedIds.delete(id);render();return;}
 if (translations.has(id)) {translatedIds.add(id);render();return;}
 translating.add(id);translationErrors.delete(id);render();
 try {
  const title=await translateNewsText(article.title,article.lang);
  translations.set(id,title);translatedIds.add(id);
 } catch {translationErrors.add(id);}
 finally {translating.delete(id);render();}
}
document.addEventListener('click', e => {
 const expand=e.target.closest('[data-expand]');
 if(expand){const id=expand.dataset.expand;if(opened.has(id))opened.delete(id);else {opened.add(id);if(!bodies.has(id))loadBody(id);}render();return;}
 const retry=e.target.closest('[data-retry-body]');if(retry){loadBody(retry.dataset.retryBody);return;}
 const bodyTranslate=e.target.closest('[data-translate-body]');if(bodyTranslate){translateBody(bodyTranslate.dataset.translateBody);return;}
 const translation = e.target.closest('[data-translate]');
 if (translation) {translateTitle(translation.dataset.translate);return;}
 const button = e.target.closest('[data-country]');
 if(button){country = button.dataset.country;limit = 50;render();}
});
$('#search').addEventListener('input',e => {query = e.target.value;limit = 50;render();});
$('#sort').addEventListener('change',e => {sort = e.target.value;render();});
$('#more').addEventListener('click',() => {limit += 50;render();});
$('#back-top').addEventListener('click',() => window.scrollTo({top:0}));
document.addEventListener('visibilitychange',() => {if (!document.hidden) refresh();});
window.addEventListener('focus',refresh);
render();refresh();scheduleMidnight();setInterval(refresh,300000);
})();

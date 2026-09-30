(() => {
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day = (date = new Date()) => new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
let data = window.NEWS, currentDay = day(), country = 'all', query = '', sort = 'new', limit = 50, loading = false;
const translations = new Map(), translatedIds = new Set(), translating = new Set(), translationErrors = new Set();
const labels = {Asia:'아시아',Europe:'유럽',Americas:'아메리카',Africa:'아프리카','Middle East':'중동',Oceania:'오세아니아'};
function render() {
 $('#today').textContent = currentDay.replaceAll('-', '.'); $('#today').dateTime = currentDay;
 if (!data) {$('#article-list').textContent = '헤드라인을 불러오지 못했습니다.'; return;}
 const countries = new Map(data.countries.map(c => [c.code,c]));
 $('#countries').innerHTML = Object.entries(labels).map(([region,label]) => `<p class="region">${label}</p>` + data.countries.filter(c => c.region === region).map(c => `<button data-country="${c.code}">${esc(c.ko)} <bdi class="country-native" lang="${c.lang}">${esc(c.name)}</bdi></button>`).join('')).join('');
 document.querySelectorAll('[data-country]').forEach(b => {b.classList.toggle('selected',b.dataset.country === country);b.setAttribute('aria-pressed',String(b.dataset.country === country));});
 const q = query.normalize('NFKC').toLocaleLowerCase();
 const items = data.articles.filter(a => {const c = countries.get(a.country);return (country === 'all' || a.country === country) && (!q || [a.title,a.source,c?.ko,c?.name].join(' ').normalize('NFKC').toLocaleLowerCase().includes(q));}).sort((a,b) => sort === 'old' ? a.date.localeCompare(b.date) : sort === 'country' ? a.country.localeCompare(b.country) || b.date.localeCompare(a.date) : b.date.localeCompare(a.date));
 $('#section-title').textContent = country === 'all' ? '세계의 헤드라인' : `${countries.get(country)?.ko}의 헤드라인`;
 $('#result-count').textContent = `${items.length}개 제목`;
 $('#article-list').innerHTML = items.slice(0,limit).map(a => {
  const translated = translatedIds.has(a.id) && translations.has(a.id);
  const busy = translating.has(a.id);
  return `<article><p class="meta">${esc(countries.get(a.country)?.ko)} · ${esc(a.source)} · <time datetime="${esc(a.date)}">${day(new Date(a.date)).replaceAll('-','.')}</time></p><h2 class="title" lang="${translated ? 'ko' : esc(a.lang)}" dir="${translated ? 'ltr' : a.direction === 'rtl' ? 'rtl' : 'ltr'}">${esc(translated ? translations.get(a.id) : a.title)}</h2>${a.lang === 'ko' ? '' : `<button class="translation-toggle" data-translate="${esc(a.id)}" aria-label="${translated ? '원어 제목 보기' : '제목 한국어로 보기'}: ${esc(a.title)}" aria-pressed="${translated}" ${busy ? 'disabled aria-busy="true"' : ''}>${busy ? '번역 중' : translationErrors.has(a.id) ? '번역 재시도' : translated ? '원어 보기' : '한국어 번역'}</button>`}</article>`;
 }).join('') || '<p class="empty">일치하는 제목이 없습니다.</p>';
 $('#more').hidden = items.length <= limit;
}
async function refresh() {
 if (loading) return; loading = true;
 currentDay = day(); render(); $('#update-status').textContent = '';
 try {
  const response = await fetch(`api/headlines?date=${currentDay}`, {cache:'no-store',signal:AbortSignal.timeout(20000)});
  if (!response.ok) throw new Error('unavailable');
  const fresh = await response.json();
  if (!Array.isArray(fresh.articles) || !Array.isArray(fresh.countries) || !fresh.articles.length) throw new Error('invalid');
  data = fresh; render();
  const collectedDay = day(new Date(data.collectedAt));
  $('#update-status').textContent = collectedDay !== currentDay ? '새 제목 수집 중' : data.failures?.length ? '일부 국가 수집 지연' : '';
 } catch {
  $('#update-status').textContent = data ? '최근 수집본 표시 중' : '연결 재시도 중';
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
 const controller = new AbortController(), timer = setTimeout(() => controller.abort(),12000);
 try {
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  Object.entries({client:'gtx',sl:'auto',tl:'ko',dt:'t',q:article.title}).forEach(([key,value]) => url.searchParams.set(key,value));
  const response = await fetch(url,{signal:controller.signal});
  if (!response.ok) throw new Error('translation unavailable');
  const payload = await response.json();
  const title = payload?.[0]?.map(part => part?.[0] || '').join('').trim();
  if (!title) throw new Error('empty translation');
  translations.set(id,title);translatedIds.add(id);
 } catch {translationErrors.add(id);}
 finally {clearTimeout(timer);translating.delete(id);render();}
}
document.addEventListener('click', e => {
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

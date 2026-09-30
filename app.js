(() => {
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day = (date = new Date()) => new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
let data = window.NEWS, currentDay = day(), country = 'all', query = '', sort = 'new', limit = 40, loading = false;
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
 $('#article-list').innerHTML = items.slice(0,limit).map(a => `<article><p class="meta">${esc(countries.get(a.country)?.ko)} · ${esc(a.source)} · <time datetime="${esc(a.date)}">${day(new Date(a.date)).replaceAll('-','.')}</time></p><h2 class="title" lang="${esc(a.lang)}" dir="${a.direction === 'rtl' ? 'rtl' : 'ltr'}">${esc(a.title)}</h2></article>`).join('') || '<p class="empty">일치하는 제목이 없습니다.</p>';
 $('#more').hidden = items.length <= limit;
}
async function refresh() {
 if (loading) return; loading = true;
 currentDay = day(); render(); $('#update-status').textContent = '새 헤드라인을 확인하고 있습니다.';
 try {
  const response = await fetch(`api/headlines?date=${currentDay}`, {cache:'no-store',signal:AbortSignal.timeout(20000)});
  if (!response.ok) throw new Error('unavailable');
  const fresh = await response.json();
  if (!Array.isArray(fresh.articles) || !Array.isArray(fresh.countries) || !fresh.articles.length) throw new Error('invalid');
  data = fresh; render();
  const collectedDay = day(new Date(data.collectedAt));
  $('#update-status').textContent = collectedDay === currentDay ? `매일 한국 시간 00:00 갱신 · 최근 수집 ${new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit'}).format(new Date(data.collectedAt))}${data.failures?.length ? ' · 일부 국가 수집 지연' : ''}` : `새 제목 수집 중 · 최근 수집 ${collectedDay.replaceAll('-','.')}`;
 } catch {
  $('#update-status').textContent = `자동 수집 서버에 연결할 수 없습니다. ${data ? day(new Date(data.collectedAt)).replaceAll('-','.') + ' 수집 제목을 표시합니다.' : '잠시 후 다시 시도합니다.'}`;
 } finally {loading = false;}
}
function scheduleMidnight() {
 const now = new Date();
 const parts = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const values = Object.fromEntries(parts.map(p => [p.type,p.value]));
 const delay = (86400 - (+values.hour * 3600 + +values.minute * 60 + +values.second)) * 1000 - now.getMilliseconds();
 setTimeout(() => {currentDay = day();limit = 40;refresh();scheduleMidnight();}, Math.max(100,delay));
}
document.addEventListener('click', e => {const button = e.target.closest('[data-country]');if(button){country = button.dataset.country;limit = 40;render();}});
$('#search').addEventListener('input',e => {query = e.target.value;limit = 40;render();});
$('#sort').addEventListener('change',e => {sort = e.target.value;render();});
$('#more').addEventListener('click',() => {limit += 40;render();});
$('#back-top').addEventListener('click',() => window.scrollTo({top:0}));
document.addEventListener('visibilitychange',() => {if (!document.hidden) refresh();});
window.addEventListener('focus',refresh);
render();refresh();scheduleMidnight();setInterval(refresh,300000);
})();

(() => {
'use strict';
const CFG = window.MASKA_CONFIG;
const tg = window.Telegram && window.Telegram.WebApp;
// Адрес API: из ссылки ?api=https://xxx.trycloudflare.com (его ставит бот), иначе из config.js
(() => {
  try {
    const q = new URLSearchParams(location.search).get('api');
    if (q && /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(q)) { CFG.API = q; localStorage.setItem('maska_api', q); }
    else if (!CFG.API) { const saved = localStorage.getItem('maska_api'); if (saved) CFG.API = saved; }
  } catch (e) {}
})();
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---------- Темы ---------- */
const TOPICS = [
  { id: 'any',   name: 'Любая тема',   sub: 'Всё, что захочется',    icon: 'chat',  tone: 'violet', free: true },
  { id: 'flirt', name: 'Флирт',        sub: 'Лёгкий разговор · PRO', icon: 'heart', tone: 'pink',   adult: true },
  { id: 'adult', name: 'Для взрослых', sub: 'Только взрослым · 18+', icon: '18',    tone: 'orange', adult: true },
  { id: 'music', name: 'Музыка',       sub: 'Треки и плейлисты',     icon: 'music', tone: 'blue' },
  { id: 'games', name: 'Игры',         sub: 'Игры и болтовня',       icon: 'game',  tone: 'green' },
  { id: 'movies',name: 'Кино',         sub: 'Фильмы и сериалы',      icon: 'film',  tone: 'yellow' },
];
const topicById = id => TOPICS.find(t => t.id === id) || TOPICS[0];

/* ---------- Состояние ---------- */
const state = {
  screen: 'home', stack: [],
  topic: 'flirt',
  user: { id: null, premium: false, age18: false },
  demo: false, online: null,
  chat: { status: 'idle', topic: 'any' },
};
try { state.user.age18 = localStorage.getItem('maska_age18') === '1'; } catch (e) {}

/* ---------- Telegram ---------- */
if (tg) {
  tg.ready(); tg.expand();
  try { tg.setHeaderColor('#07070c'); tg.setBackgroundColor('#07070c'); tg.disableVerticalSwipes && tg.disableVerticalSwipes(); } catch (e) {}
}
const haptic = (k = 'light') => { try { tg && tg.HapticFeedback.impactOccurred(k); } catch (e) {} };
const hapticN = k => { try { tg && tg.HapticFeedback.notificationOccurred(k); } catch (e) {} };

/* ---------- UI helpers ---------- */
let toastT;
function toast(text) {
  const t = $('#toast'); t.textContent = text; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2400);
}
const sheet = open => $('#app').classList.toggle('sheet-open', open);

function go(name, { push = true } = {}) {
  if (push && state.screen !== name) state.stack.push(state.screen);
  state.screen = name;
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === 's-' + name));
  const tabs = name === 'home' || name === 'profile';
  $('#tabbar').classList.toggle('show', tabs);
  $$('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  if (tg) {
    const canBack = !tabs;
    canBack ? tg.BackButton.show() : tg.BackButton.hide();
  }
}
function back() {
  if (state.screen === 'chat') { leaveChat(); return; }
  const prev = state.stack.pop() || 'home';
  go(prev, { push: false });
}
function tab(name) { state.stack = []; go(name, { push: false }); if (name === 'profile') renderProfile(); }
if (tg) tg.BackButton.onClick(back);

/* ---------- Транспорт: сервер или демо ---------- */
class PollTransport {
  constructor(onEvent) {
    this.onEvent = onEvent; this.closed = false; this.fails = 0;
    this.ready = new Promise(res => { this._ready = res; });
    this.loop();
  }
  async loop() {
    while (!this.closed) {
      try {
        const r = await fetch(CFG.API + '/api/poll', { headers: { Authorization: 'tma ' + tg.initData } });
        if (!r.ok) throw new Error(r.status);
        const evs = await r.json();
        if (this.fails >= 2) this.onEvent({ t: 'reconnected' });
        this.fails = 0;
        for (const e of evs) this.handle(e.event, e.data || {});
      } catch (err) {
        if (++this.fails === 2) this.onEvent({ t: 'closed' });
        await new Promise(res => setTimeout(res, Math.min(1000 * this.fails, 5000)));
      }
    }
  }
  handle(ev, d) {
    const o = this.onEvent;
    if (ev === 'ready') this._ready();
    else if (ev === 'matched') o({ t: 'matched', topic: d.topic });
    else if (ev === 'ended') o({ t: 'ended' });
    else if (ev === 'message') o({ t: 'msg', text: d.text });
    else if (ev === 'typing') o({ t: 'typing', on: true });
    else if (ev === 'online') o({ t: 'online', n: d.count });
  }
  async send(m) {
    try {
      if (m.t === 'find') {
        await this.ready;
        this.onEvent({ t: 'searching' });
        await api('/api/search', { topic: m.topic });
      }
      else if (m.t === 'msg') await api('/api/send', { text: m.text });
      else if (m.t === 'typing') await api('/api/typing');
      else if (m.t === 'leave') await api('/api/stop');
      else if (m.t === 'report') await api('/api/report');
    } catch (e) {
      if (e.code === 'premium_required') this.onEvent({ t: 'need_premium' });
      else if (e.code === 'age_required') this.onEvent({ t: 'need_age' });
      else if (e.code === 'banned') this.onEvent({ t: 'error', message: 'Доступ временно ограничен за нарушения' });
      else if (e.code === 'rate_limit') this.onEvent({ t: 'error', message: 'Слишком быстро, подожди секунду' });
      else if (e.code === 'no_partner') this.onEvent({ t: 'ended' });
      else if (e.code === 'no_stream') { this.ready = new Promise(res => { this._ready = res; }); this.onEvent({ t: 'error', message: 'Переподключаемся, попробуй ещё раз' }); }
      else this.onEvent({ t: 'error', message: 'Нет связи с сервером' });
    }
  }
  close() { this.closed = true; }
}

class DemoTransport {
  constructor(onEvent) { this.onEvent = onEvent; this.timers = []; }
  later(fn, ms) { this.timers.push(setTimeout(fn, ms)); }
  clear() { this.timers.forEach(clearTimeout); this.timers = []; }
  send(m) {
    if (m.t === 'find') {
      this.clear(); this.onEvent({ t: 'searching' });
      this.later(() => this.onEvent({ t: 'matched', topic: m.topic }), 1500);
      this.later(() => this.say(['Привет! Как настроение сегодня?', 'Хей) чем занимаешься?', 'Привет, скучаешь?'][Math.random() * 3 | 0]), 2600);
    } else if (m.t === 'msg') {
      const replies = ['Привет, нормально, особенно после такого начала', 'Мне нравится твой ответ. Расскажешь что-нибудь о себе (без имён)?', 'Люблю ночные прогулки и музыку в наушниках', 'Хаха, понимаю тебя', 'А ты давно здесь?', 'Интересно! Расскажи ещё'];
      this.onEvent({ t: 'typing', on: true });
      this.later(() => { this.onEvent({ t: 'typing', on: false }); this.say(replies[Math.random() * replies.length | 0]); }, 1400 + Math.random() * 1200);
    } else if (m.t === 'next' || m.t === 'leave') {
      this.clear(); this.onEvent({ t: 'ended' });
    }
  }
  say(text) { this.onEvent({ t: 'msg', text }); }
  close() { this.clear(); }
}

/* ---------- API ---------- */
async function api(path, body) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), CFG.AUTH_TIMEOUT_MS);
  try {
    const r = await fetch(CFG.API + path, {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'tma ' + (tg ? tg.initData : '') },
      body: JSON.stringify(body || {}),
    });
    if (!r.ok) {
      const err = new Error(r.status); err.status = r.status;
      try { err.code = (await r.json()).error; } catch (x) {}
      throw err;
    }
    return await r.json();
  } finally { clearTimeout(to); }
}

async function auth() {
  const initData = tg && tg.initData;
  const forceDemo = /[?&]demo=1/.test(location.search);
  if (initData && CFG.API && !forceDemo) {
    try {
      const d = await api('/api/me');
      Object.assign(state.user, { premium: !!d.premium, age18: !!d.ageOk });
      state.online = d.online ?? null;
      return;
    } catch (e) { /* сервер недоступен → демо */ }
  }
  state.demo = true;
  state.user.id = 'demo';
}

/* ---------- Главная ---------- */
function renderHome() {
  $('#onlineText').textContent = state.online ? `Сейчас онлайн · ${state.online}` : 'Сейчас онлайн';
}

/* ---------- Темы ---------- */
function renderTopics() {
  $('#topicGrid').innerHTML = TOPICS.map(t => {
    const icon = t.icon === '18' ? '18+' : `<svg><use href="#i-${t.icon}"/></svg>`;
    const mark = t.free ? '<span class="tag">Бесплатно</span>' : '<span class="lk"><svg><use href="#i-lock"/></svg></span>';
    return `<button class="tcard tone-${t.tone}${t.id === state.topic ? ' sel' : ''}" data-id="${t.id}">
      <span class="ti">${icon}</span><b>${t.name}</b><small>${t.sub}</small>
      ${mark}<span class="ck"><svg><use href="#i-check"/></svg></span></button>`;
  }).join('');
  const t = topicById(state.topic);
  $('#btnSearchTopic').textContent = `Искать в теме «${t.name === 'Для взрослых' ? '18+' : t.name}»`;
  $('#btnSearchTopic').className = 'btn wide ' + ({ pink: 'pink', orange: 'orange' }[t.tone] || 'primary');
  $('#topicNote').innerHTML = t.free ? 'Тема «Любая» доступна бесплатно' : `Флирт и 18+ входят в <b>Маска Premium</b> · ${CFG.PREMIUM_STARS} ⭐ в месяц`;
}
function openTopics(id) { if (id) state.topic = id; renderTopics(); go('topics'); }

/* Запуск поиска с проверками: Premium → 18+ → чат */
function begin(topicId) {
  const t = topicById(topicId);
  state.topic = t.id;
  if (!t.free && !state.user.premium && !state.demo) { sheet(true); return; }
  if (t.adult && !state.user.age18) { $('#ageBox').checked = false; $('#btnAgeOk').disabled = true; go('age'); return; }
  startChat(t.id);
}

/* ---------- Чат ---------- */
let tr = null, typingEl = null, typingT = null;
const getTransport = () => tr || (tr = state.demo ? new DemoTransport(onEvent) : new PollTransport(onEvent));
const box = () => $('#messages');
function addSys(text) { const d = document.createElement('div'); d.className = 'sys'; d.textContent = text; box().appendChild(d); scrollDown(); }
function addMsg(text, who) { const d = document.createElement('div'); d.className = 'msg ' + who; d.textContent = text; box().appendChild(d); scrollDown(); }
function setTyping(on) {
  if (on && !typingEl) { typingEl = document.createElement('div'); typingEl.className = 'typing'; typingEl.innerHTML = '<i></i><i></i><i></i>'; box().appendChild(typingEl); scrollDown(); }
  if (!on && typingEl) { typingEl.remove(); typingEl = null; }
}
function scrollDown() { const b = box(); b.scrollTop = b.scrollHeight; }

function onEvent(m) {
  switch (m.t) {
    case 'searching': state.chat.status = 'searching'; setTyping(false); addSys('Ищем собеседника…'); break;
    case 'matched':
      if (state.screen !== 'chat') break;
      state.chat.status = 'matched';
      addSys(`Тема: ${topicById(m.topic || state.chat.topic).name} · Общайтесь уважительно`); hapticN('success'); break;
    case 'msg': if (state.screen !== 'chat') break; setTyping(false); addMsg(m.text, 'in'); haptic(); break;
    case 'typing': if (state.screen !== 'chat') break; setTyping(!!m.on); clearTimeout(typingT); if (m.on) typingT = setTimeout(() => setTyping(false), 3500); break;
    case 'online': state.online = m.n; renderHome(); break;
    case 'ended':
      if (state.screen !== 'chat') break;
      state.chat.status = 'idle'; setTyping(false); addSys('Собеседник завершил диалог. Нажми «Дальше»'); break;
    case 'need_premium': state.chat.status = 'idle'; state.stack = ['home']; go('topics', { push: false }); sheet(true); break;
    case 'need_age': state.user.age18 = false; state.chat.status = 'idle'; state.stack = ['topics']; go('age', { push: false }); break;
    case 'premium': state.user.premium = true; toast('Premium активирован ⭐'); break;
    case 'error': toast(m.message || 'Что-то пошло не так'); break;
    case 'reconnected': if (state.screen === 'chat') toast('Связь восстановлена'); break;
    case 'closed': if (state.screen === 'chat' && state.chat.status !== 'idle') { addSys('Соединение потеряно. Нажми «Дальше»'); state.chat.status = 'idle'; } break;
  }
}

function startChat(topicId) {
  const t = topicById(topicId);
  state.chat = { status: 'searching', topic: t.id };
  box().innerHTML = '';
  $('#chatTopic').textContent = t.name === 'Для взрослых' ? '18+' : t.name;
  $('#chatBanner').style.display = state.user.premium ? 'none' : '';
  getTransport().send({ t: 'find', topic: t.id });
  go('chat');
}
function leaveChat() {
  if (tr) tr.send({ t: 'leave' });
  state.chat.status = 'idle';
  state.stack = []; go('home', { push: false });
}
function nextChat() {
  if (!tr) return;
  haptic('medium');
  box().innerHTML = '';
  tr.send({ t: 'find', topic: state.chat.topic });
}

/* ---------- Профиль / Premium ---------- */
function renderProfile() {
  $('#profId').textContent = tg && tg.initDataUnsafe && tg.initDataUnsafe.user ? 'Аноним #' + String(tg.initDataUnsafe.user.id).slice(-4) : 'Аноним';
  $('#profPlan').textContent = state.user.premium ? 'Premium ⭐' : 'Бесплатный план';
  $('#profAge').textContent = state.user.age18 ? 'подтверждён' : 'не подтверждён';
  $('#profMode').textContent = state.demo ? 'демо (сервер недоступен)' : 'онлайн';
}
async function buyPremium() {
  if (state.demo) { state.user.premium = true; sheet(false); toast('Демо: Premium включён'); renderProfile(); return; }
  try {
    const { link } = await api('/api/premium/invoice');
    tg.openInvoice(link, status => {
      if (status === 'paid') {
        state.user.premium = true; toast('Premium активирован ⭐'); renderProfile();
        setTimeout(() => api('/api/me').then(d => { state.user.premium = !!d.premium; renderProfile(); }).catch(() => {}), 2500);
      }
    });
    sheet(false);
  } catch (e) { toast('Не удалось открыть оплату'); }
}

/* ---------- События ---------- */
$('#btnFind').onclick = () => { haptic(); begin('any'); };
$('#allTopics').onclick = e => { e.preventDefault(); openTopics(); };
$$('.pill').forEach(p => p.onclick = () => openTopics(p.dataset.topic));
$('#btnPremium').onclick = $('#btnPremium2').onclick = () => sheet(true);
$('#chatBanner').onclick = () => sheet(true);
$('#btnSheetClose').onclick = $('#sheetBg').onclick = () => sheet(false);
$('#btnBuy').onclick = buyPremium;

$('#topicGrid').onclick = e => {
  const c = e.target.closest('.tcard'); if (!c) return;
  haptic(); state.topic = c.dataset.id; renderTopics();
};
$('#btnSearchTopic').onclick = () => begin(state.topic);

$('#ageBox').onchange = e => { $('#btnAgeOk').disabled = !e.target.checked; haptic(); };
$('#btnAgeOk').onclick = async () => {
  state.user.age18 = true;
  try { localStorage.setItem('maska_age18', '1'); } catch (e) {}
  if (!state.demo) { try { await api('/api/age', { confirm: true }); } catch (e) { toast('Нет связи с сервером'); return; } }
  startChat(state.topic);
};

$$('[data-back]').forEach(b => b.onclick = back);
$('#chatBack').onclick = leaveChat;
$('#btnNext').onclick = nextChat;
$('#btnReport').onclick = () => {
  if (state.chat.status !== 'matched') return toast('Пока не на кого жаловаться');
  const send = () => { tr.send({ t: 'report' }); toast('Жалоба отправлена. Спасибо!'); nextChat(); };
  tg && tg.showConfirm ? tg.showConfirm('Пожаловаться на собеседника и завершить диалог?', ok => ok && send()) : confirm('Пожаловаться на собеседника?') && send();
};
$$('#tabbar button').forEach(b => b.onclick = () => tab(b.dataset.tab));

let lastTyping = 0;
$('#msgInput').oninput = () => { const n = Date.now(); if (tr && state.chat.status === 'matched' && n - lastTyping > 2500) { lastTyping = n; tr.send({ t: 'typing' }); } };
$('#composer').onsubmit = e => {
  e.preventDefault();
  const inp = $('#msgInput'), text = inp.value.trim();
  if (!text) return;
  if (state.chat.status !== 'matched') return toast('Собеседник ещё не найден');
  addMsg(text, 'out'); tr.send({ t: 'msg', text }); inp.value = ''; haptic();
};

/* ---------- Старт ---------- */
renderTopics();
auth().then(() => { if (!state.demo) getTransport(); renderHome(); renderProfile(); });
// для проверки экранов из консоли / скриншотов
window.__maska = { go, state, startChat, openTopics };
})();
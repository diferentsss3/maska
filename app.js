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
  const tabs = name === 'home' || name === 'profile' || name === 'admin';
  $('#tabbar').classList.toggle('show', tabs);
  $$('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  if (tg) {
    const canBack = !tabs;
    canBack ? tg.BackButton.show() : tg.BackButton.hide();
  }
}
function back() {
  if (state.screen === 'chat') { leaveChat(); return; }
  state.afterAge = null;
  const prev = state.stack.pop() || 'home';
  go(prev, { push: false });
}
function tab(name) {
  state.stack = []; go(name, { push: false });
  if (name === 'profile') renderProfile();
  if (name === 'admin') loadAdmin();
}
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
    else if (ev === 'media') o({ t: 'media', id: d.id, kind: d.kind, mime: d.mime });
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
    } catch (e) { this.fail(e); }
  }
  fail(e) {
    const err = message => this.onEvent({ t: 'error', message });
    if (e.code === 'premium_required') this.onEvent({ t: 'need_premium' });
    else if (e.code === 'age_required') this.onEvent({ t: 'need_age' });
    else if (e.code === 'media_age') this.onEvent({ t: 'need_media_age' });
    else if (e.code === 'partner_age') err('Собеседник не подтвердил 18+, фото и видео недоступны');
    else if (e.code === 'too_large') err('Файл слишком большой');
    else if (e.code === 'bad_media') err('Формат не поддерживается. Подойдут JPG, PNG, WebP, GIF, MP4, MOV, WebM');
    else if (e.code === 'busy') err('Сервер занят, попробуй чуть позже');
    else if (e.code === 'banned') err('Доступ временно ограничен за нарушения');
    else if (e.code === 'rate_limit') err('Слишком быстро, подожди секунду');
    else if (e.code === 'no_partner') this.onEvent({ t: 'ended' });
    else if (e.code === 'no_stream') { this.ready = new Promise(res => { this._ready = res; }); err('Переподключаемся, попробуй ещё раз'); }
    else err('Нет связи с сервером');
  }
  /* Загрузка фото/видео: XHR, чтобы показывать прогресс */
  sendMedia(blob, onProgress) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('POST', CFG.API + '/api/media');
      x.setRequestHeader('Authorization', 'tma ' + tg.initData);
      x.setRequestHeader('Content-Type', blob.type || 'application/octet-stream');
      x.timeout = 180000;
      x.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      x.onload = () => {
        if (x.status >= 200 && x.status < 300) return resolve();
        let code; try { code = JSON.parse(x.responseText).error; } catch (_) {}
        this.fail({ code }); reject(new Error(code || String(x.status)));
      };
      x.onerror = x.ontimeout = () => { this.fail({}); reject(new Error('network')); };
      x.send(blob);
    });
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
  sendMedia(blob, onProgress) {
    if (onProgress) onProgress(1);
    this.onEvent({ t: 'typing', on: true });
    this.later(() => { this.onEvent({ t: 'typing', on: false }); this.say(['Классно!', 'О, круто, спасибо, что поделился(ась)', 'Хаха, неожиданно)'][Math.random() * 3 | 0]); }, 1500);
    return Promise.resolve();
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
      Object.assign(state.user, { premium: !!d.premium, age18: !!d.ageOk, admin: !!d.admin });
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
  if (t.adult && !state.user.age18) { showAge(false); return; }
  startChat(t.id);
}

/* Экран 18+: forMedia — открыт из чата, после подтверждения вернёмся в диалог */
function showAge(forMedia) {
  state.afterAge = forMedia ? 'media' : null;
  $('#ageSub').textContent = forMedia
    ? 'Фото и видео в чате доступны только взрослым, и только если собеседник тоже подтвердил возраст. Подтвердите, что вам есть 18 лет.'
    : 'Тема «Для взрослых» доступна пользователям старше 18 лет. Подтвердите возраст, чтобы продолжить.';
  $('#ageBackBtn').textContent = forMedia ? 'Вернуться в чат' : 'Вернуться к темам';
  $('#ageBox').checked = false; $('#btnAgeOk').disabled = true;
  go('age');
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

/* ---------- Фото и видео ---------- */
const MB = 1024 * 1024, MEDIA_LIMIT = { image: 10 * MB, video: 30 * MB };
let objUrls = [], chatEpoch = 0;
const mkUrl = blob => { const u = URL.createObjectURL(blob); objUrls.push(u); return u; };
function clearMessages() {
  chatEpoch++; typingEl = null;
  box().innerHTML = '';
  objUrls.forEach(u => URL.revokeObjectURL(u)); objUrls = [];
}
function mediaBubble(who, kind) {
  const el = document.createElement('div'); el.className = 'msg media ' + who;
  const wrap = document.createElement('div'); wrap.className = 'mwrap';
  const prog = document.createElement('div'); prog.className = 'mprog hide';
  wrap.appendChild(prog); el.appendChild(wrap); box().appendChild(el); scrollDown();
  return {
    prog,
    status(text, err) { prog.className = 'mprog' + (err ? ' err' : ''); prog.textContent = text; },
    done() { prog.className = 'mprog hide'; },
    show(url, blurred) {
      const m = document.createElement(kind === 'video' ? 'video' : 'img');
      if (kind === 'video') { m.src = url + '#t=0.1'; m.controls = true; m.playsInline = true; m.preload = 'metadata'; m.onloadedmetadata = scrollDown; }
      else { m.src = url; m.alt = ''; m.draggable = false; m.onload = scrollDown; }
      wrap.insertBefore(m, prog);
      if (blurred) {
        wrap.classList.add('blur');
        const veil = document.createElement('div'); veil.className = 'veil';
        veil.innerHTML = '<svg><use href="#i-eye"/></svg>Нажми, чтобы посмотреть<small>' + (kind === 'video' ? 'Видео' : 'Фото') + ' от собеседника скрыто</small>';
        veil.onclick = () => { wrap.classList.remove('blur'); haptic(); };
        wrap.insertBefore(veil, prog);
      }
    },
  };
}
/* Входящее: скачиваем с сервера (после выдачи он файл удаляет) и показываем размытым */
function receiveMedia(info) {
  const epoch = chatEpoch, b = mediaBubble('in', info.kind);
  let gone = false;
  const load = async () => {
    b.status('Загрузка…');
    try {
      const r = await fetch(CFG.API + '/api/media/' + info.id, { headers: { Authorization: 'tma ' + (tg ? tg.initData : '') } });
      if (r.status === 404) { gone = true; throw new Error('gone'); }
      if (!r.ok) throw new Error(String(r.status));
      const blob = await r.blob();
      if (epoch !== chatEpoch) return;
      b.show(mkUrl(blob), true); b.done(); haptic();
    } catch (e) {
      if (epoch !== chatEpoch) return;
      b.status(gone ? 'Файл недоступен' : 'Не удалось загрузить. Нажми, чтобы повторить', true);
    }
  };
  b.prog.onclick = () => { if (!gone && b.prog.classList.contains('err')) load(); };
  load();
}
/* Фото сжимаем и перекодируем в JPEG: меньше трафика, и пропадают EXIF-метки с геолокацией */
async function shrinkImage(file, max = 1600) {
  let src, tmp;
  if (window.createImageBitmap) { try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) {} }
  if (!src) {
    tmp = URL.createObjectURL(file);
    src = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = tmp; });
  }
  const k = Math.min(1, max / Math.max(src.width, src.height));
  const c = document.createElement('canvas'); c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(src, 0, 0, c.width, c.height);
  if (src.close) src.close();
  if (tmp) URL.revokeObjectURL(tmp);
  return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('toBlob')), 'image/jpeg', 0.85));
}
async function sendFile(file) {
  if (state.chat.status !== 'matched') return toast('Собеседник ещё не найден');
  const kind = /^video\//.test(file.type) ? 'video' : /^image\//.test(file.type) ? 'image' : null;
  if (!kind) return toast('Можно отправлять только фото и видео');
  const epoch = chatEpoch;
  let blob = file;
  if (kind === 'image' && file.type !== 'image/gif') {
    try { blob = await shrinkImage(file); }
    catch (e) { if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return toast('Не удалось обработать фото. Попробуй JPG или PNG'); }
  }
  if (blob.size > MEDIA_LIMIT[kind]) return toast(`Файл слишком большой (максимум ${MEDIA_LIMIT[kind] / MB} МБ)`);
  if (epoch !== chatEpoch || state.chat.status !== 'matched') return toast('Диалог уже завершён');
  const b = mediaBubble('out', kind);
  b.show(mkUrl(blob), false); b.status('0%');
  try { await tr.sendMedia(blob, p => b.status(Math.round(p * 100) + '%')); b.done(); haptic(); }
  catch (e) { b.status('Не отправлено', true); }
}

function onEvent(m) {
  switch (m.t) {
    case 'searching': state.chat.status = 'searching'; setTyping(false); addSys('Ищем собеседника…'); break;
    case 'matched':
      if (state.screen !== 'chat') break;
      state.chat.status = 'matched';
      addSys(`Тема: ${topicById(m.topic || state.chat.topic).name} · Общайтесь уважительно`); hapticN('success'); break;
    case 'msg': if (state.screen !== 'chat') break; setTyping(false); addMsg(m.text, 'in'); haptic(); break;
    case 'typing': if (state.screen !== 'chat') break; setTyping(!!m.on); clearTimeout(typingT); if (m.on) typingT = setTimeout(() => setTyping(false), 3500); break;
    case 'media': if (state.screen !== 'chat') break; setTyping(false); receiveMedia(m); break;
    case 'need_media_age': state.user.age18 = false; showAge(true); break;
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
  clearMessages();
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
  clearMessages();
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

/* ---------- Админка ---------- */
const adm = { days: 30, data: null };
const fmtN = n => Number(n || 0).toLocaleString('ru-RU');
const fmtD = s => s.slice(8, 10) + '.' + s.slice(5, 7);
const fmtK = v => v >= 10000 ? Math.round(v / 1000) + 'к' : v >= 1000 ? (v / 1000).toFixed(1).replace('.0', '') + 'к' : String(Math.round(v));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const renderTabbar = () => { $('#tabAdmin').hidden = !state.user.admin; };

async function loadAdmin() {
  if (!state.user.admin) return;
  try {
    adm.data = await api('/api/admin/stats', { days: adm.days, off: -new Date().getTimezoneOffset() });
    renderAdmin();
  } catch (e) { toast(e.status === 403 ? 'Нет доступа' : 'Не удалось загрузить статистику'); }
}

/* График на SVG: столбцы (за день) + линия (накопительно). Тап/движение по графику показывает значения за день */
function drawChart(host, labels, bars, line, caption, barColor, lineColor) {
  const W = 340, H = 170, L = 34, R = 34, T = 10, B = 22, iw = W - L - R, ih = H - T - B, n = labels.length, slot = iw / n;
  const bm = Math.max(1, ...bars), lm = Math.max(1, ...line);
  const cx = i => L + (i + .5) * slot;
  const yb = v => T + ih - v / bm * ih, yl = v => T + ih - v / lm * ih;
  let s = `<svg viewBox="0 0 ${W} ${H}">`;
  for (let k = 0; k <= 2; k++) {
    const y = T + ih - ih * k / 2;
    s += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" style="stroke:var(--line)"/>`;
    s += `<text x="${L - 5}" y="${y + 3}" text-anchor="end" style="fill:var(--dim);font-size:9px">${fmtK(bm * k / 2)}</text>`;
    s += `<text x="${W - R + 5}" y="${y + 3}" style="fill:var(--dim);font-size:9px">${fmtK(lm * k / 2)}</text>`;
  }
  const bw = Math.max(1.2, Math.min(14, slot * .68));
  bars.forEach((v, i) => { if (v > 0) s += `<rect x="${cx(i) - bw / 2}" y="${yb(v)}" width="${bw}" height="${T + ih - yb(v)}" rx="2" style="fill:${barColor};opacity:.85"/>`; });
  s += `<path d="${line.map((v, i) => (i ? 'L' : 'M') + cx(i).toFixed(1) + ' ' + yl(v).toFixed(1)).join('')}" fill="none" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" style="stroke:${lineColor}"/>`;
  [0, Math.floor((n - 1) / 2), n - 1].forEach((i, k) => {
    if (n > 1 && k && i === 0) return;
    s += `<text x="${cx(i)}" y="${H - 6}" text-anchor="${k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}" style="fill:var(--dim);font-size:9px">${fmtD(labels[i])}</text>`;
  });
  s += `<line id="mk" y1="${T}" y2="${T + ih}" style="stroke:var(--text);opacity:0;stroke-width:1"/><rect x="${L}" y="${T}" width="${iw}" height="${ih}" fill="transparent"/></svg><div class="ccap"></div>`;
  host.innerHTML = s;
  const svg = host.querySelector('svg'), mk = host.querySelector('#mk'), cap = host.querySelector('.ccap');
  const pick = i => { i = Math.max(0, Math.min(n - 1, i)); mk.setAttribute('x1', cx(i)); mk.setAttribute('x2', cx(i)); mk.style.opacity = .35; cap.textContent = caption(i); };
  const at = e => { const r = svg.getBoundingClientRect(); pick(Math.floor(((e.clientX - r.left) / r.width * W - L) / slot)); };
  svg.addEventListener('pointerdown', at); svg.addEventListener('pointermove', at);
  pick(n - 1);
}

function renderAdmin() {
  const d = adm.data; if (!d) return;
  const t = d.totals, p = adm.days;
  $('#adminKpis').innerHTML = [
    ['Пользователей', fmtN(t.users), `+${fmtN(t.newUsers)} за ${p} дн.`],
    ['Онлайн сейчас', fmtN(t.online), 'в приложении'],
    ['Premium активен', fmtN(t.premiumNow), 'сейчас подписчиков'],
    ['Выручка', fmtN(t.revenue) + ' ⭐', `за ${p} дн. · всего ${fmtN(t.revenueAll)} ⭐`],
    ['Покупок Premium', fmtN(t.purchases), `за ${p} дн. · всего ${fmtN(t.purchasesAll)}`],
    ['Средний чек', t.purchases ? fmtN(Math.round(t.revenue / t.purchases)) + ' ⭐' : '—', 'за период'],
  ].map(([a, b, c]) => `<div class="card kpi"><small>${a}</small><b>${b}</b><i>${c}</i></div>`).join('');

  $('#chUsersSub').textContent = `+${fmtN(t.newUsers)} за ${p} дн.`;
  drawChart($('#chUsers'), d.labels, d.newUsers, d.usersCum,
    i => `${fmtD(d.labels[i])} · +${fmtN(d.newUsers[i])} новых · всего ${fmtN(d.usersCum[i])}`, 'var(--violet)', 'var(--pink)');
  $('#chPaySub').textContent = `${fmtN(t.revenue)} ⭐ за ${p} дн.`;
  drawChart($('#chPay'), d.labels, d.payStars, d.revCum,
    i => `${fmtD(d.labels[i])} · ${fmtN(d.payCount[i])} покуп. · ${fmtN(d.payStars[i])} ⭐ · всего ${fmtN(d.revCum[i])} ⭐`, 'var(--gold)', 'var(--green)');
  renderRefs();
}

function renderRefs() {
  const d = adm.data, o = d.organic;
  const conv = (b, s) => s ? Math.round(b / s * 1000) / 10 + '%' : '0%';
  const rows = d.refs.map(r => `<div class="card ref" data-code="${r.code}">
    <div class="ref-top"><b>${esc(r.name)}</b><span><button class="mini" data-act="copy">Копировать</button><button class="mini danger" data-act="del">Удалить</button></span></div>
    <div class="ref-link">${r.link ? esc(r.link) : 'Ссылка появится, когда бот узнает своё имя (задайте BOT_USERNAME в .env)'}</div>
    <div class="ref-stats">
      <div><b>${fmtN(r.clicks)}</b><small>переходов</small></div>
      <div><b>${fmtN(r.signups)}</b><small>новых</small></div>
      <div><b>${fmtN(r.buyers)}</b><small>купили · ${conv(r.buyers, r.signups)}</small></div>
      <div><b>${fmtN(r.revenue)} ⭐</b><small>выручка</small></div>
    </div></div>`).join('');
  const organic = `<div class="card ref"><div class="ref-top"><b>Без метки</b></div>
    <div class="ref-link" style="color:var(--muted)">Пришли сами или не через рекламную ссылку</div>
    <div class="ref-stats"><div><b>—</b><small>переходов</small></div><div><b>${fmtN(o.signups)}</b><small>новых</small></div>
    <div><b>${fmtN(o.buyers)}</b><small>купили · ${conv(o.buyers, o.signups)}</small></div><div><b>${fmtN(o.revenue)} ⭐</b><small>выручка</small></div></div></div>`;
  $('#refList').innerHTML = (rows || '<div class="empty">Ссылок пока нет. Создайте первую выше и вставьте её в рекламу.</div>') + organic;
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) {}
  const a = document.createElement('textarea'); a.value = text; a.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(a); a.select(); let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) {}
  a.remove(); return ok;
}

/* ---------- События ---------- */
$('#adminRefresh').onclick = () => { haptic(); loadAdmin(); };
$('#adminRange').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  adm.days = +b.dataset.days; $$('#adminRange button').forEach(x => x.classList.toggle('on', x === b)); haptic(); loadAdmin();
};
$('#refForm').onsubmit = async e => {
  e.preventDefault();
  const inp = $('#refName'), name = inp.value.trim();
  try { await api('/api/admin/ref/create', { name }); inp.value = ''; toast('Ссылка создана'); hapticN('success'); loadAdmin(); }
  catch (err) { toast(err.code === 'too_many' ? 'Слишком много ссылок, удалите ненужные' : 'Не удалось создать ссылку'); }
};
$('#refList').onclick = async e => {
  const btn = e.target.closest('button[data-act]'); if (!btn) return;
  const code = btn.closest('.ref').dataset.code, r = adm.data.refs.find(x => x.code === code); if (!r) return;
  if (btn.dataset.act === 'copy') {
    if (!r.link) return toast('Ссылка ещё не готова');
    toast(await copyText(r.link) ? 'Ссылка скопирована' : 'Не удалось скопировать'); haptic();
  } else {
    const del = async () => { try { await api('/api/admin/ref/delete', { code }); toast('Ссылка удалена'); loadAdmin(); } catch (err) { toast('Не удалось удалить'); } };
    const q = `Удалить ссылку «${r.name}»? Статистика по ней пропадёт, а сама ссылка перестанет учитываться.`;
    tg && tg.showConfirm ? tg.showConfirm(q, ok => ok && del()) : confirm(q) && del();
  }
};
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
  if (state.afterAge === 'media') {          // подтверждали возраст ради медиа — возвращаемся в тот же диалог
    state.afterAge = null; state.stack.pop(); go('chat', { push: false });
    toast('Готово, теперь можно отправлять фото и видео'); return;
  }
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

$('#btnAttach').onclick = () => {
  if (state.chat.status !== 'matched') return toast('Собеседник ещё не найден');
  if (!state.demo && !state.user.age18) return showAge(true);
  $('#fileInput').click();
};
$('#fileInput').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) sendFile(f); };

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
auth().then(() => { if (!state.demo) getTransport(); renderHome(); renderProfile(); renderTabbar(); });
// для проверки экранов из консоли / скриншотов
window.__maska = { go, state, startChat, openTopics };
})();
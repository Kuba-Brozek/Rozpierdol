'use strict';

/* ============ Pomocnicze ============ */
const IMG = 'img/'; // zdjęcia ćwiczeń są częścią apki (pomniejszone kopie z Free Exercise DB)
const KEY = 'postep-v1';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 1) => (n == null || isNaN(n)) ? '–' : Number(n).toLocaleString('pl-PL', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtSigned = (n, d = 1) => (n == null || isNaN(n)) ? '–' : (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n), d);
const pad = n => String(n).padStart(2, '0');
const dstr = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = () => dstr(new Date());
const parseD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return dstr(d); };
const daysBetween = (a, b) => Math.round((parseD(b) - parseD(a)) / 864e5);
const dayLabel = (s, opts = { day: 'numeric', month: 'short' }) => parseD(s).toLocaleDateString('pl-PL', opts);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
// liczba + odmiana: plural(3, 'plan', 'plany', 'planów') → „3 plany” (używane też w sync.js)
const plural = (n, one, few, many) => n + ' ' + (n === 1 ? one : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) ? few : many);
const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n; };

/* ============ Stan ============ */
let S = { profile: { height: null, goalLoss: null }, weights: [], workouts: [], active: null, custom: [], fav: [], plans: [], measures: [] };
try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s) S = Object.assign(S, s); } catch (e) {}
if (!Array.isArray(S.fav)) S.fav = [];
if (!Array.isArray(S.plans)) S.plans = [];
if (!Array.isArray(S.measures)) S.measures = [];
const isFav = id => S.fav.includes(id);
function toggleFav(id) {
  if (isFav(id)) S.fav = S.fav.filter(x => x !== id); else S.fav.push(id);
  save(); return isFav(id);
}
// Filtr listy ćwiczeń: przełącznik „tylko ulubione” + kategoria
const newFilter = () => ({ fav: S.fav.length > 0, g: S.fav.length ? 'all' : 'pop', eq: '', q: '', lim: 60 });
// Filtr sprzętu: kolejność przycisków (pokazujemy tylko te, dla których są ćwiczenia)
const EQUIP_ORDER = ['barbell', 'dumbbell', 'machine', 'cable', 'body only', 'kettlebells', 'e-z curl bar', 'bands', 'exercise ball', 'medicine ball', 'foam roll', 'other'];
// Zapis lokalny; każda zmiana danych zleca też (z opóźnieniem) wysyłkę do chmury, jeśli jesteś zalogowany.
// silent = zapis danych właśnie pobranych z chmury (nie odsyłaj ich z powrotem)
function save(silent) {
  if (!silent) S.updatedAt = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Nie udało się zapisać danych'); }
  if (!silent && typeof syncSoon === 'function') syncSoon();
}
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}

const UI = { tab: 'dieta', range: 90, showAll: false, cw: newFilter() };

/* ============ Słowniki ============ */
const MUSCLE = { abdominals: 'Brzuch', abductors: 'Odwodziciele', adductors: 'Przywodziciele', biceps: 'Biceps', calves: 'Łydki', chest: 'Klatka', forearms: 'Przedramiona', glutes: 'Pośladki', hamstrings: 'Dwugłowe ud', lats: 'Najszersze grzbietu', 'lower back': 'Dolny grzbiet', 'middle back': 'Środek pleców', neck: 'Szyja', quadriceps: 'Czworogłowe ud', shoulders: 'Barki', traps: 'Kaptury', triceps: 'Triceps' };
const EQUIP = { bands: 'Gumy', barbell: 'Sztanga', 'body only': 'Masa ciała', cable: 'Wyciąg', dumbbell: 'Hantle', 'exercise ball': 'Piłka', 'e-z curl bar': 'Sztanga łamana', 'foam roll': 'Roller', kettlebells: 'Kettlebell', machine: 'Maszyna', 'medicine ball': 'Piłka lekarska', other: 'Inne' };
const LEVEL = { beginner: 'Początkujący', intermediate: 'Średnio zaawansowany', expert: 'Zaawansowany' };
const GROUPS = [
  { id: 'pop', label: 'Popularne', test: e => !!e.pl || e.own },
  { id: 'all', label: 'Wszystkie', test: () => true },
  { id: 'chest', label: 'Klatka', m: ['chest'] },
  { id: 'back', label: 'Plecy', m: ['lats', 'middle back', 'lower back', 'traps'] },
  { id: 'legs', label: 'Nogi', m: ['quadriceps', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors'] },
  { id: 'shoulders', label: 'Barki', m: ['shoulders'] },
  { id: 'biceps', label: 'Biceps', m: ['biceps'] },
  { id: 'triceps', label: 'Triceps', m: ['triceps'] },
  { id: 'forearms', label: 'Przedramiona', m: ['forearms'] },
  { id: 'abs', label: 'Brzuch', m: ['abdominals'] },
  { id: 'cardio', label: 'Cardio', test: e => e.c === 'cardio' },
  { id: 'stretch', label: 'Rozciąganie', test: e => e.c === 'stretching' },
];
const groupTest = g => g.test || (e => (e.m || []).some(m => g.m.includes(m)));

/* ============ Baza ćwiczeń ============ */
let EX = [], EXMAP = {}, EX_STATE = 'loading', EX_ERR = '';
async function loadExercises() {
  EX_STATE = 'loading';
  try {
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 20000);
    const r = await fetch('data/exercises.json', { signal: ctrl.signal, cache: 'no-cache' });
    clearTimeout(to);
    if (!r.ok) throw new Error('serwer zwrócił błąd ' + r.status + ' dla data/exercises.json');
    EX = await r.json();
    EX_STATE = 'ok';
  } catch (e) {
    EX = []; EX_STATE = 'error';
    EX_ERR = e.name === 'AbortError' ? 'pobieranie trwało ponad 20 s' : (e instanceof SyntaxError ? 'plik bazy jest uszkodzony' : (e.message || String(e)));
  }
  rebuildExMap();
  if (UI.tab === 'cwiczenia') renderCw();
  if (UI.tab === 'trening') renderTrening();
}
function rebuildExMap() {
  const own = (S.custom || []).map(c => Object.assign({ own: true, img: [], ins: [], s: [] }, c));
  EXMAP = {};
  [...own, ...EX].forEach(e => EXMAP[e.id] = e);
}
const exCount = n => n + (n === 1 ? ' ćwiczenie' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) ? ' ćwiczenia' : ' ćwiczeń');
const exName = e => e ? (e.pl || e.n) : 'Nieznane ćwiczenie';
const isCardio = e => e && e.c === 'cardio';
function exSorted() {
  const own = (S.custom || []).map(c => EXMAP[c.id]).filter(Boolean);
  const list = [...own, ...EX];
  return list.sort((a, b) => (!!b.own - !!a.own) || (!!b.pl - !!a.pl) || exName(a).localeCompare(exName(b), 'pl'));
}
function thumbHTML(e, cls = 'thumb') {
  if (e && e.img && e.img[0]) return `<img class="${cls}" src="${IMG + e.img[0]}" alt="" loading="lazy" decoding="async" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'${cls} ph',textContent:'🏋️'}))">`;
  return `<div class="${cls} ph" aria-hidden="true">${isCardio(e) ? '🏃' : '🏋️'}</div>`;
}

/* ============ Nawigacja ============ */
// Ekrany bez własnej zakładki: otwierane przyciskiem z innej zakładki, która zostaje podświetlona
const TAB_PARENT = { cialo: 'dieta', miesnie: 'start', cwiczenia: 'plany' };
function setTab(t, fromHistory) {
  UI.tab = t;
  if (!fromHistory) UI.sec = null; // zakładka z dolnego paska zawsze otwiera listę ustawień
  const nav = TAB_PARENT[t] || t;
  $$('.tabs button').forEach(b => b.dataset.tab === nav ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  $$('main > .view').forEach(v => v.hidden = v.id !== 'view-' + t);
  // historia: ekran podrzędny dostaje wpis, żeby działał gest/przycisk „wstecz”
  if (!fromHistory) {
    try {
      if (TAB_PARENT[t]) { if (!(history.state && history.state.sub === t)) history.pushState({ sub: t }, ''); }
      else if (history.state && history.state.sub) history.replaceState(null, '');
    } catch (e) {}
  }
  rerender();
  window.scrollTo(0, 0);
}
// „Wstecz” z ekranu podrzędnego: przez historię (żeby nie zostawiać w niej śmieci), inaczej wprost do rodzica
let lastPop = 0, ignorePop = false;
function goBack() {
  if (UI.tab === 'wiecej' && UI.sec) { // z ekranu ustawień do listy ustawień
    if (history.state && history.state.sec) { ignorePop = true; history.back(); }
    UI.sec = null; renderWiecej(); window.scrollTo(0, 0); return;
  }
  const p = TAB_PARENT[UI.tab]; if (!p) return;
  // ekran zmieniamy od razu (zdarzenie popstate potrafi przyjść z opóźnieniem), a wpis historii zdejmujemy w tle
  if (history.state && history.state.sub) { ignorePop = true; history.back(); }
  setTab(p, true);
}
window.addEventListener('popstate', e => {
  if (ignorePop) { ignorePop = false; return; }
  lastPop = Date.now();
  if (!$('#sheet').hidden) { // najpierw zamknij okno, a ekran zostaw
    sheetBack();
    if (TAB_PARENT[UI.tab]) try { history.pushState({ sub: UI.tab }, ''); } catch (er) {}
    else if (UI.tab === 'wiecej' && UI.sec) try { history.pushState({ sub: 'wiecej', sec: UI.sec }, ''); } catch (er) {}
    return;
  }
  const st = e.state;
  if (UI.tab === 'wiecej' && !(st && st.sub && st.sub !== 'wiecej')) { // ekrany w Ustawieniach
    const s = st && st.sec || null;
    if (s !== UI.sec) { UI.sec = s; renderWiecej(); window.scrollTo(0, 0); }
    return;
  }
  if (st && st.sub && st.sub !== UI.tab) setTab(st.sub, true);
  else if (TAB_PARENT[UI.tab] && !(st && st.sub === UI.tab)) setTab(TAB_PARENT[UI.tab], true);
});
// Gest przesunięcia od lewej krawędzi w apce na ekranie głównym iPhone'a (w Safari robi to sama przeglądarka)
if (navigator.standalone === true) {
  let sx = null, sy = 0, dx = 0, tracking = false, target = null;
  const reset = () => { if (!target) return; const t = target; t.style.transition = 'transform .2s ease'; t.style.transform = ''; setTimeout(() => { t.style.transition = ''; }, 220); };
  document.addEventListener('touchstart', e => {
    sx = null; tracking = false; dx = 0;
    const t = e.touches[0], sheetOpen = !$('#sheet').hidden;
    if (e.touches.length !== 1 || t.clientX > 28 || DRAG.on) return;
    if (!sheetOpen && !TAB_PARENT[UI.tab] && !(UI.tab === 'wiecej' && UI.sec)) return;
    sx = t.clientX; sy = t.clientY;
    target = sheetOpen ? $('#sheet .sheet') : $('#view-' + UI.tab);
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (sx == null) return;
    const t = e.touches[0], mx = t.clientX - sx, my = t.clientY - sy;
    if (!tracking) {
      if (Math.abs(my) > 10 && Math.abs(my) > mx) { sx = null; return; } // to przewijanie
      if (mx < 10) return;
      tracking = true;
    }
    e.preventDefault();
    dx = Math.max(0, mx);
    target.style.transition = 'none'; target.style.transform = `translateX(${dx}px)`;
  }, { passive: false });
  document.addEventListener('touchend', () => {
    if (sx == null) return; sx = null;
    if (!tracking) return;
    if (dx > Math.min(110, innerWidth * 0.3) && Date.now() - lastPop > 700) {
      const t = target; t.style.transition = 'transform .18s ease'; t.style.transform = `translateX(${innerWidth}px)`;
      setTimeout(() => { t.style.transition = ''; t.style.transform = ''; if (!$('#sheet').hidden) sheetBack(); else goBack(); }, 170);
    } else reset();
  });
  document.addEventListener('touchcancel', () => { if (sx != null && tracking) reset(); sx = null; });
}
function rerender() {
  ({ start: renderStart, dieta: renderDieta, cialo: renderCialo, miesnie: renderMiesnie, trening: renderTrening, plany: renderPlany, cwiczenia: renderCw, wiecej: renderWiecej })[UI.tab]();
}
$$('.tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
// przyciski „‹ Forma”, „Pomiary ciała ›” itp.
document.addEventListener('click', e => {
  const g = e.target.closest('[data-go]'); if (!g) return;
  const [t, sec] = g.dataset.go.split(':'); // np. „wiecej:profil” = Ustawienia → Profil
  if (g.classList.contains('back') && TAB_PARENT[UI.tab] === t) goBack();
  else { setTab(t); if (sec) openSec(sec); }
});

/* ============ Okno od dołu / komunikaty ============ */
let SHEET_BACK = null; // gdy ustawione: zamknięcie okna wraca do poprzedniego (np. z wyboru ćwiczenia do edytora planu)
function openSheet(title, html, onMount) {
  SHEET_BACK = null;
  $('#sheet-title').textContent = title;
  // świeży element = brak starych nasłuchiwaczy kliknięć z poprzedniego okna
  const old = $('#sheet-body'), fresh = old.cloneNode(false);
  old.replaceWith(fresh);
  fresh.innerHTML = html;
  $('#sheet').hidden = false;
  document.body.style.overflow = 'hidden';
  fresh.scrollTop = 0;
  onMount && onMount(fresh);
}
function closeSheet() { SHEET_BACK = null; $('#sheet').hidden = true; document.body.style.overflow = ''; $('#sheet-body').innerHTML = ''; }
// „✕” okna (i gest wstecz): wraca do poprzedniego okna, jeśli jest, inaczej zamyka
function sheetBack() { if (SHEET_BACK) { const f = SHEET_BACK; SHEET_BACK = null; f(); } else closeSheet(); }
$('#sheet').addEventListener('click', e => {
  if (!e.target.closest('[data-close]')) return;
  if (e.target.closest('#sheet-body')) { closeSheet(); return; }
  sheetBack();
});
function confirmBox(title, text, okLabel, danger) {
  return new Promise(res => {
    openSheet(title, `<p>${text}</p><div class="btns"><button class="btn" data-a="no" type="button">Anuluj</button><button class="btn ${danger ? 'danger solid' : 'primary'}" data-a="ok" type="button">${esc(okLabel)}</button></div>`, b => {
      b.addEventListener('click', e => { const a = e.target.closest('[data-a]'); if (!a) return; closeSheet(); res(a.dataset.a === 'ok'); });
    });
  });
}
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2200); }

/* ============ DIETA: obliczenia ============ */
function bmiCat(b) {
  if (b == null) return null;
  if (b > 40) return 'Otyłość III stopnia';
  if (b > 35) return 'Otyłość II stopnia';
  if (b > 30) return 'Otyłość I stopnia';
  if (b > 25) return 'Nadwaga';
  if (b > 18.5) return 'Waga prawidłowa';
  return 'Niedowaga';
}
// Kafelek BMI: liczba + krótka nazwa kategorii w jej kolorze + pasek stref z kropką
const BMI_ZONES = [
  { to: 18.5, short: 'Niedowaga', cls: 'z-under' },
  { to: 25, short: 'Norma', cls: 'z-ok' },
  { to: 30, short: 'Nadwaga', cls: 'z-over' },
  { to: 35, short: 'Otyłość I st.', cls: 'z-o1' },
  { to: 40, short: 'Otyłość II st.', cls: 'z-o2' },
  { to: Infinity, short: 'Otyłość III st.', cls: 'z-o3' },
];
function bmiTileHTML(bmi) {
  if (bmi == null) return '<span class="k">BMI</span><span class="v">–</span><span class="d">podaj wzrost w Ustawieniach</span>';
  const z = BMI_ZONES.find(x => bmi <= x.to);
  const pos = Math.max(0, Math.min(100, (bmi - 15) / 30 * 100)); // skala 15–45
  return `<span class="k">BMI</span><span class="v">${fmt(bmi, 1)}</span>
    <span class="bmi-cat ${z.cls}">${z.short}</span>
    <span class="bmi-scale" role="img" aria-label="BMI ${fmt(bmi, 1)}, ${bmiCat(bmi)}"><b style="left:${pos.toFixed(1)}%"></b></span>`;
}
function avgBetween(from, to) {
  const a = S.weights.filter(x => x.d >= from && x.d <= to);
  return a.length ? a.reduce((s, x) => s + x.w, 0) / a.length : null;
}
/* ---- profil: cel (redukcja / utrzymanie / masa), kalorie, tłuszcz z obwodów ---- */
const GOALS = { cut: { l: 'Redukcja', dir: -1 }, keep: { l: 'Utrzymanie', dir: 0 }, bulk: { l: 'Masa', dir: 1 } };
const goalType = () => GOALS[S.profile.goalType] ? S.profile.goalType : 'cut';
const goalDir = () => GOALS[goalType()].dir;
// klasa koloru dla zmiany wagi: zielona, gdy zmiana idzie w stronę celu
const wcls = delta => { const d = goalDir(); if (!delta || !d) return ''; return Math.sign(delta) === d ? 'down' : 'up'; };
const ACTIVITY = [
  { k: 1.2, l: 'Siedzący tryb, mało ruchu' },
  { k: 1.375, l: 'Lekka aktywność (1–3 treningi/tydz.)' },
  { k: 1.55, l: 'Średnia aktywność (3–5 treningów/tydz.)' },
  { k: 1.725, l: 'Duża aktywność (6–7 treningów/tydz.)' },
  { k: 1.9, l: 'Bardzo duża (praca fizyczna + treningi)' },
];
const ageNow = () => S.profile.born ? new Date().getFullYear() - S.profile.born : null;
// Zapotrzebowanie kaloryczne: BMR wzorem Mifflina-St Jeora × aktywność, ± deficyt/nadwyżka z tempa (7700 kcal ≈ 1 kg)
function calories(weight) {
  const p = S.profile, age = ageNow();
  if (!weight || !p.height || !p.sex || !age || !p.activity) return null;
  const bmr = 10 * weight + 6.25 * p.height * 100 - 5 * age + (p.sex === 'm' ? 5 : -161);
  const tdee = bmr * p.activity, dir = goalDir(), rate = p.rate || (dir > 0 ? 0.25 : 0.5);
  const floor = p.sex === 'm' ? 1500 : 1200;
  const raw = tdee + dir * rate * 7700 / 7, target = dir ? Math.max(floor, raw) : tdee;
  return { bmr, tdee, target, rate, dir, clamped: dir < 0 && raw < floor };
}
// % tkanki tłuszczowej z obwodów (wzór US Navy, cm). Mężczyźni: szyja + brzuch na wysokości pępka; kobiety: szyja + talia + biodra.
function navyFat(v) {
  const p = S.profile; if (!v || !p.height || !p.sex) return null;
  const h = p.height * 100, neck = v.neck;
  if (p.sex === 'm') {
    const waist = v.belly ?? v.waist; if (!neck || !waist || waist <= neck) return null;
    return 495 / (1.0324 - 0.19077 * Math.log10(waist - neck) + 0.15456 * Math.log10(h)) - 450;
  }
  const waist = v.waist ?? v.belly, hips = v.hips; if (!neck || !waist || !hips || waist + hips <= neck) return null;
  return 495 / (1.29579 - 0.35004 * Math.log10(waist + hips - neck) + 0.22100 * Math.log10(h)) - 450;
}
const navySeries = () => S.measures.map(x => ({ d: x.d, w: navyFat(x.v) })).filter(x => x.w != null && x.w > 2 && x.w < 70).map(x => ({ d: x.d, w: Math.round(x.w * 10) / 10 }));
// tygodnie od poniedziałku: ile treningów w danym tygodniu
const weekStart = d => addDays(d, -((parseD(d).getDay() + 6) % 7));
const workoutsInWeek = ws => S.workouts.filter(w => w.date >= ws && w.date <= addDays(ws, 6)).length;
function weeklyStreak() {
  const t = S.profile.weekly; if (!t) return 0;
  let ws = weekStart(today()), n = workoutsInWeek(ws) >= t ? 1 : 0; // bieżący tydzień liczy się, gdy już wykonany
  for (ws = addDays(ws, -7); workoutsInWeek(ws) >= t; ws = addDays(ws, -7)) n++;
  return n;
}

function stats() {
  const w = S.weights; if (!w.length) return null;
  const h = S.profile.height, goal = S.profile.goalLoss, dir = goalDir();
  const first = w[0], lastE = w[w.length - 1];
  const start = first.w, cur = lastE.w, last = lastE.d;
  const bmi = h ? cur / (h * h) : null;
  const lost = start - cur;
  const prog = dir ? (cur - start) * dir : null; // postęp w stronę celu (kg)
  const ref30 = [...w].reverse().find(x => x.d <= addDays(last, -30));
  const prev = w.length > 1 ? w[w.length - 2] : null;
  return {
    start, cur, last, day: daysBetween(first.d, last) + 1, bmi, cat: bmiCat(bmi), lost, goal, prog, dir,
    pct: goal && dir ? prog / goal * 100 : null, target: goal && dir ? start + dir * goal : null,
    wk: avgBetween(addDays(last, -6), last), pwk: avgBetween(addDays(last, -13), addDays(last, -7)),
    m30: ref30 ? ref30.w - cur : null, prevDiff: prev ? cur - prev.w : null,
  };
}
function sortWeights() { S.weights.sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : 0); }
function setWeight(d, w) {
  const i = S.weights.findIndex(x => x.d === d);
  if (i >= 0) S.weights[i].w = w; else S.weights.push({ d, w });
  sortWeights(); save();
  if (typeof checkBadges === 'function') setTimeout(checkBadges, 600);
}

/* ============ DIETA: wykres ============ */
function chartSVG(weights = S.weights, rangeDays = UI.range) {
  const all = weights;
  if (all.length < 2) return '<p class="muted small">Wykres pojawi się po dwóch pomiarach.</p>';
  const last = all[all.length - 1].d;
  const from = rangeDays === 0 ? all[0].d : addDays(last, -rangeDays + 1);
  const pts = all.filter(x => x.d >= from);
  if (pts.length < 2) return '<p class="muted small">Za mało pomiarów w tym okresie.</p>';
  const W = 340, H = 190, L = 38, R = 8, T = 10, B = 24;
  let lo = Math.min(...pts.map(p => p.w)), hi = Math.max(...pts.map(p => p.w));
  const padY = Math.max(0.5, (hi - lo) * 0.1); lo -= padY; hi += padY;
  const span = hi - lo, stepRaw = span / 4;
  const step = [0.5, 1, 2, 2.5, 5, 10, 20].find(s => s >= stepRaw) || 50;
  const yLo = Math.floor(lo / step) * step, yHi = Math.ceil(hi / step) * step;
  const d0 = pts[0].d, dn = daysBetween(d0, pts[pts.length - 1].d) || 1;
  const x = d => L + (W - L - R) * daysBetween(d0, d) / dn;
  const y = v => T + (H - T - B) * (1 - (v - yLo) / (yHi - yLo));
  let g = '';
  for (let v = yLo; v <= yHi + 1e-9; v += step) {
    g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`;
    g += `<text class="lbl" x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${fmt(v, step < 1 ? 1 : 0)}</text>`;
  }
  const xl = [pts[0].d, pts[Math.floor(pts.length / 2)].d, pts[pts.length - 1].d];
  xl.forEach((d, i) => g += `<text class="lbl" x="${x(d).toFixed(1)}" y="${H - 6}" text-anchor="${['start', 'middle', 'end'][i]}">${dayLabel(d)}</text>`);
  // Linia łączy rzeczywiste pomiary; przy krótkim zakresie widać też punkty
  const dots = pts.length <= 45 ? pts.map(p => `<circle class="dot" cx="${x(p.d).toFixed(1)}" cy="${y(p.w).toFixed(1)}" r="2.6"/>`).join('') : '';
  const line = pts.map(p => `${x(p.d).toFixed(1)},${y(p.w).toFixed(1)}`).join(' ');
  const area = `${x(pts[0].d).toFixed(1)},${H - B} ${line} ${x(pts[pts.length - 1].d).toFixed(1)},${H - B}`;
  const e = pts[pts.length - 1];
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Wykres wagi">${g}<polygon class="area" points="${area}"/><polyline class="avg" points="${line}"/>${dots}<circle class="end" cx="${x(e.d).toFixed(1)}" cy="${y(e.w).toFixed(1)}" r="4.5"/></svg>`;
}

/* ============ DIETA: widok ============ */
// Kafelek-przycisk prowadzący do ekranu bez własnej zakładki
const navCard = (go, icon, title, sub) => `<button class="card nav-card" type="button" data-go="${go}">
  <span class="nav-ic" aria-hidden="true">${icon}</span><span class="grow"><b>${title}</b><span class="small muted">${sub}</span></span><span class="chev" aria-hidden="true">›</span></button>`;
function cialoNavCard() {
  const last = S.measures[S.measures.length - 1];
  return navCard('cialo', '📏', 'Pomiary ciała', last ? `${plural(S.measures.length, 'pomiar', 'pomiary', 'pomiarów')} · ostatni ${dayLabel(last.d)}` : 'obwody i tkanka tłuszczowa');
}

/* ---- losowy pozytywny fakt o postępach ---- */
function positiveFacts() {
  const out = [], st = stats(), w = S.weights;
  const kg = v => fmt(v, v >= 10 ? 1 : v >= 1 ? 1 : 2) + ' kg';
  if (st) {
    const g = goalType();
    if (g === 'cut') {
      if (st.lost >= 0.1) {
        out.push(`Od startu masz już <b>${kg(st.lost)}</b> mniej. Tyle waży mniej więcej ${plural(Math.max(1, Math.round(st.lost / 0.2)), 'kostka', 'kostki', 'kostek')} masła.`);
        if (st.day > 6) out.push(`Średnio ubywa ci <b>${kg(st.lost / st.day * 7)}</b> na tydzień od startu. Stałe tempo to najlepsze tempo.`);
      }
      if (st.m30 != null && st.m30 >= 0.1) out.push(`W ostatnich 30 dniach waga spadła o <b>${kg(st.m30)}</b>.`);
      if (st.wk != null && st.pwk != null && st.pwk - st.wk >= 0.05) out.push(`Średnia waga z ostatnich 7 dni jest o <b>${kg(st.pwk - st.wk)}</b> niższa niż średnia z tygodnia wcześniej.`);
      const min = Math.min(...w.map(x => x.w));
      if (w.length > 2 && st.cur <= min && st.cur < st.start) out.push(`Ostatni pomiar to <b>najniższa waga</b> od początku pomiarów: ${fmt(st.cur, 1)} kg.`);
      const h = S.profile.height;
      if (h && st.lost > 0) { const d = (st.start - st.cur) / (h * h); if (d >= 0.1) out.push(`Twoje BMI spadło od startu o <b>${fmt(d, 1)}</b>.`); }
    } else if (g === 'bulk') {
      const gain = -st.lost;
      if (gain >= 0.1) {
        out.push(`Od startu masz już <b>+${kg(gain)}</b>. Budowanie masy idzie do przodu.`);
        if (st.day > 13) { const r = gain / st.day * 7; out.push(`Przybierasz średnio <b>${kg(r)}</b> na tydzień${r <= 0.5 ? '. Spokojne tempo to więcej mięśni, mniej tłuszczu.' : '.'}`); }
      }
      if (st.m30 != null && -st.m30 >= 0.1) out.push(`W ostatnich 30 dniach waga wzrosła o <b>${kg(-st.m30)}</b>.`);
      const max = Math.max(...w.map(x => x.w));
      if (w.length > 2 && st.cur >= max && st.cur > st.start) out.push(`Ostatni pomiar to <b>najwyższa waga</b> od początku pomiarów: ${fmt(st.cur, 1)} kg.`);
    } else {
      // utrzymanie: pozytywne jest to, że waga stoi w miejscu
      const recent = w.filter(x => x.d >= addDays(st.last, -29));
      if (recent.length >= 4) {
        const span = Math.max(...recent.map(x => x.w)) - Math.min(...recent.map(x => x.w));
        if (span <= 2) out.push(`Przez ostatnie 30 dni waga trzyma się w przedziale <b>${kg(span)}</b>. Utrzymanie wychodzi ci świetnie.`);
      }
      if (Math.abs(st.lost) <= 1 && st.day >= 14) out.push(`Od startu waga zmieniła się tylko o <b>${kg(Math.abs(st.lost))}</b>. Stabilnie!`);
    }
    if (st.pct != null && st.pct >= 1) out.push(st.pct >= 100 ? `Cel osiągnięty! Masz za sobą <b>${fmt(st.pct, 0)}%</b> zaplanowanej drogi. 🎉` : `Masz za sobą <b>${fmt(st.pct, 0)}%</b> drogi do celu.${st.pct >= 50 ? ' Z górki!' : ''}`);
    if (w.length >= 5) out.push(`Zapisanych pomiarów wagi: <b>${w.length}</b>. Regularność to połowa sukcesu.`);
    if (st.day >= 7) out.push(`To już <b>${st.day}.</b> dzień twojej drogi. Dobrze, że jesteś dalej w grze.`);
    // najdłuższa seria dni z ważeniem pod rząd
    let best = 1, run = 1; for (let i = 1; i < w.length; i++) { run = daysBetween(w[i - 1].d, w[i].d) === 1 ? run + 1 : 1; best = Math.max(best, run); }
    if (best >= 5) out.push(`Rekord regularności: <b>${best} dni</b> ważenia pod rząd.`);
  }
  // Ile już dbasz o siebie: od założenia konta (bez konta: od pierwszego wpisu).
  // Tydzień jest aktywny, jeśli było w nim cokolwiek: ważenie, trening albo pomiar ciała.
  // Pokazujemy, gdy aktywnych tygodni jest min. 75% i aktywne są ostatnie 2 tygodnie.
  {
    const acts = [...w.map(x => x.d), ...S.workouts.map(x => x.date), ...S.measures.map(x => x.d)].filter(Boolean).sort();
    const created = typeof SY !== 'undefined' && SY.session && SY.session.createdAt;
    const since = created ? dstr(new Date(created)) : acts[0];
    const days = since ? daysBetween(since, today()) : 0;
    if (days >= 7) {
      // tygodnie liczone wstecz od dziś (7-dniowe okna); najstarsze może być niepełne
      const total = Math.ceil((days + 1) / 7), active = [];
      for (let k = 0; k < total; k++) {
        const to = addDays(today(), -7 * k), from = addDays(to, -6);
        active.push(acts.some(d => d >= from && d <= to && d >= since));
      }
      const n = active.filter(Boolean).length;
      const recentOk = active[0] && (total < 2 || active[1]);
      if (recentOk && n / total >= 0.75) {
        const head = `${created ? 'Od założenia konta' : 'Od pierwszego wpisu'} dbasz o siebie już <b>${plural(days, 'dzień', 'dni', 'dni')}</b>`;
        out.push(n === total && total >= 2
          ? `<b>${plural(total, 'tydzień', 'tygodnie', 'tygodni')} z rzędu</b> dbasz o siebie, bez ani jednej przerwy. 🔥`
          : `${head}. Aktywnie w <b>${n} z ${total}</b> ${total === 1 ? 'tygodnia' : 'tygodni'}. 💪`);
        if (n === total && total >= 2) out.push(`${head}. Każdy tydzień z jakimś pomiarem albo treningiem. 💪`);
      }
    }
  }
  const mon = today().slice(0, 7), wm =S.workouts.filter(x => x.date.slice(0, 7) === mon).length;
  if (wm >= 1) out.push(`W tym miesiącu ${wm === 1 ? 'zrobiony jest już' : 'masz już'} <b>${plural(wm, 'trening', 'treningi', 'treningów')}</b>.`);
  if (S.workouts.length >= 3) out.push(`Łącznie <b>${plural(S.workouts.length, 'trening', 'treningi', 'treningów')}</b> w historii. Każdy się liczy.`);
  const tons = S.workouts.reduce((s, x) => s + volume(x), 0) / 1000;
  if (tons >= 1.5) out.push(`Łącznie podniesiono już <b>${fmt(tons, 1)} t</b>. To tyle, co ${plural(Math.floor(tons / 1.3), 'samochód osobowy', 'samochody osobowe', 'samochodów osobowych')}.`);
  if (S.workouts.length) {
    const prs = Object.values(prTimeline().byW).reduce((s, a) => s + a.length, 0);
    if (prs >= 1) out.push(`Pobitych rekordów osobistych: <b>${prs}</b> 🏆`);
  }
  const streak = weeklyStreak();
  if (streak >= 2) out.push(`<b>${plural(streak, 'tydzień', 'tygodnie', 'tygodni')} z rzędu</b> z wykonanym planem treningów (${S.profile.weekly}/tydz.). 🔥`);
  const nf = navySeries();
  if (nf.length >= 2 && nf[0].w - nf[nf.length - 1].w >= 0.3) out.push(`Tkanka tłuszczowa (z obwodów) spadła o <b>${fmt(nf[0].w - nf[nf.length - 1].w, 1)} pkt proc.</b> od pierwszego pomiaru.`);
  if (goalType() !== 'bulk') [['waist', 'Talia'], ['belly', 'Brzuch'], ['hips', 'Biodra']].forEach(([k, l]) => {
    const xs = S.measures.filter(x => x.v && x.v[k] != null);
    if (xs.length >= 2) { const d = xs[0].v[k] - xs[xs.length - 1].v[k]; if (d >= 0.5) out.push(`${l}: <b>−${fmt(d, 1)} cm</b> od pierwszego pomiaru.`); }
  });
  return out;
}
function factCardHTML() {
  const facts = positiveFacts();
  const txt = facts.length ? facts[((UI.fact ?? (UI.fact = Math.floor(Math.random() * 1000))) % facts.length)] : 'Każdy zapisany pomiar to krok do przodu. Dobrze, że tu jesteś.';
  return `<button class="card fact" type="button" id="fact-card"${facts.length > 1 ? ' aria-label="Pokaż inny fakt"' : ''}>
    <span class="fact-ic" aria-hidden="true">✨</span><span class="grow"><span class="fact-t">${txt}</span>${facts.length > 1 ? '<span class="small muted">Stuknij, żeby zobaczyć inny</span>' : ''}</span></button>`;
}
function wireFact(root) {
  const c = $('#fact-card', root); if (!c) return;
  c.onclick = () => { UI.fact = (UI.fact || 0) + 1; c.outerHTML = factCardHTML(); wireFact(root); };
}

// Przełączniki kafelków na ekranie Forma (S.prefs, zapisywane w chmurze); domyślnie włączone
const PREFS = [['kcal', 'Dzienne kalorie', 'zapotrzebowanie z profilu', '🔥'], ['fact', 'Losowy pozytywny fakt', 'kafelek w zakładce Postęp', '✨']];
const pref = k => !(S.prefs && S.prefs[k] === false);
// Kafelek „Kalorie”: zapotrzebowanie z profilu albo zachęta do uzupełnienia profilu
function kcalCardHTML(st) {
  const ref = st.wk != null ? st.wk : st.cur, k = calories(ref);
  if (!k) {
    const p = S.profile, miss = [!p.height && 'wzrost', !p.sex && 'płeć', !ageNow() && 'rok urodzenia', !p.activity && 'aktywność'].filter(Boolean);
    return navCard('wiecej:profil', '🔥', 'Dzienne kalorie', `Brakuje w profilu (Ustawienia): ${miss.join(', ') || 'wagi'}. Wtedy policzę zapotrzebowanie.`);
  }
  const r = n => fmt(Math.round(n / 10) * 10, 0);
  const what = k.dir < 0 ? `na redukcję −${fmtN(k.rate)} kg/tydz.` : k.dir > 0 ? `na masę +${fmtN(k.rate)} kg/tydz.` : 'na utrzymanie wagi';
  return `<button class="card nav-card kcal" type="button" id="kcal-card"><span class="nav-ic" aria-hidden="true">🔥</span>
    <span class="grow"><span class="small muted">Dzienne kalorie ${what}</span><b class="kcal-v num">~${r(k.target)} kcal</b>
    <span class="small muted">utrzymanie ~${r(k.tdee)} kcal${k.clamped ? ' · ograniczone do bezpiecznego minimum' : ''}</span></span><span class="chev" aria-hidden="true">›</span></button>`;
}
function showKcal() {
  const st = stats(); if (!st) return;
  const ref = st.wk != null ? st.wk : st.cur, k = calories(ref); if (!k) { setTab('wiecej'); openSec('profil'); return; }
  const r = n => fmt(Math.round(n / 10) * 10, 0), act = ACTIVITY.find(a => a.k === S.profile.activity);
  openSheet('Dzienne kalorie', `
    <div class="card">
      <div class="row"><span>Podstawowa przemiana materii (BMR)</span><b class="num">${r(k.bmr)} kcal</b></div>
      <div class="row"><span>× aktywność ${fmtN(S.profile.activity)}</span><b class="num">${r(k.tdee)} kcal</b></div>
      ${k.dir ? `<div class="row"><span>${k.dir < 0 ? 'Deficyt' : 'Nadwyżka'} na ${fmtN(k.rate)} kg/tydz.</span><b class="num">${k.dir < 0 ? '−' : '+'}${r(k.rate * 1100)} kcal</b></div>` : ''}
      <hr class="sep"><div class="row"><b>Cel na dzień</b><b class="num">~${r(k.target)} kcal</b></div>
    </div>
    <p class="muted small" style="margin:0">Liczone wzorem Mifflina-St Jeora z wagi ${fmt(ref, 1)} kg (średnia z 7 dni), wzrostu, wieku (${ageNow()} lat) i płci. Aktywność: ${esc(act ? act.l : '')}. 1 kg tkanki ≈ 7700 kcal.${k.clamped ? ' Wynik podniosłem do bezpiecznego minimum, więc tempo będzie wolniejsze.' : ''}</p>
    <p class="muted small" style="margin:0">To szacunek. Jeśli przez 2–3 tygodnie waga zmienia się wolniej albo szybciej, niż zakładasz, skoryguj kalorie o 100–200 kcal.</p>
    <button class="btn block" type="button" data-close>OK</button>`);
}

// Duże liczby w kafelku wagi: jeśli nie mieszczą się w swojej kolumnie (np. szersza czcionka iPhone'a), zmniejsz je
function fitHero(root = document) {
  $$('.hero-nums', root).forEach(h => {
    const bigs = $$('.big', h); if (!bigs.length) return;
    bigs.forEach(b => b.style.fontSize = '');
    let size = parseFloat(getComputedStyle(bigs[0]).fontSize);
    const tooWide = () => bigs.some(b => b.scrollWidth > b.clientWidth + 1) || h.scrollWidth > h.clientWidth + 1;
    while (tooWide() && size > 22) { size -= 1; bigs.forEach(b => b.style.fontSize = size + 'px'); }
  });
}
window.addEventListener('resize', () => {
  if (UI.tab === 'start') {
    fitHero($('#start-body'));
  }
});

/* ============ WAGA: wpis, wykres, lista pomiarów, pomiary ciała ============
   (identyfikator zakładki to wciąż „dieta” — tak zapisują go starsze wersje i historia przeglądarki) */
function renderDieta() {
  const st = stats();
  const body = $('#dieta-body');

  const form = `
    <form class="card" id="f-weight" autocomplete="off">
      <h2>Dzisiejszy pomiar</h2>
      <div class="add-weight">
        <div class="field">
          <label for="w-date">Data</label>
          <input type="date" id="w-date" value="${today()}" max="${today()}" required>
        </div>
        <div class="field">
          <label for="w-val">Waga (kg)</label>
          <input type="number" id="w-val" inputmode="decimal" step="0.01" min="20" max="400"
            placeholder="${st ? fmt(st.cur, 1).replace(',', '.') : '80.0'}" required>
        </div>
        <button class="btn primary" type="submit">Zapisz</button>
      </div>
    </form>`;

  if (!st) {
    body.innerHTML = `
      <div class="card empty">
        <strong>Zacznij śledzić wagę</strong>
        <span>Wpisz dzisiejszy pomiar poniżej albo zaimportuj swój arkusz z Excela (kolumny DATA i WAGA).</span>
        <label class="btn primary file-btn">
          Importuj plik Excel
          <input type="file" id="imp-xlsx-empty" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
        </label>
      </div>
      ${form}
      ${cialoNavCard()}`;
    $('#imp-xlsx-empty').addEventListener('change', onXlsxPicked);
  } else {
    const list = [...S.weights].reverse();
    const shown = UI.showAll ? list : list.slice(0, 10);

    const ranges = [[30, '30 dni'], [90, '90 dni'], [0, 'Całość']]
      .map(([v, l]) => `<button type="button" data-range="${v}" aria-pressed="${UI.range === v}">${l}</button>`)
      .join('');

    const rows = shown
      .map(x => {
        const prev = list[list.indexOf(x) + 1];
        const df = prev ? x.w - prev.w : null;
        const diff = df != null
          ? `<div class="small ${wcls(df) || 'muted'}">${fmtSigned(df, 2)}</div>`
          : '';
        return `
          <button class="li" type="button" data-wd="${x.d}">
            <div class="grow">
              <div class="t">${dayLabel(x.d, { weekday: 'short', day: 'numeric', month: 'long' })}</div>
            </div>
            <div class="r">
              <div class="num"><b>${fmt(x.w, 2)}</b> kg</div>
              ${diff}
            </div>
          </button>`;
      })
      .join('');

    const moreBtn = list.length > 10
      ? `<button class="link" type="button" id="w-more">${UI.showAll ? 'Pokaż mniej' : 'Pokaż wszystkie (' + list.length + ')'}</button>`
      : '';

    body.innerHTML = `
      ${form}
      <section class="card chart">
        <div class="row">
          <h2>Wykres</h2>
          <div class="seg" role="group" aria-label="Zakres wykresu">${ranges}</div>
        </div>
        ${chartSVG()}
        <div class="legend"><span><i></i>waga z pomiarów (kg)</span></div>
      </section>
      <section class="view" style="gap:10px">
        <div class="row">
          <h3>Pomiary</h3>
          <span class="muted small">${S.weights.length} wpisów</span>
        </div>
        <div class="list">${rows}</div>
        ${moreBtn}
      </section>
      ${cialoNavCard()}`;

    $$('[data-range]', body).forEach(b => {
      b.addEventListener('click', () => {
        UI.range = +b.dataset.range;
        renderDieta();
      });
    });
    $$('[data-wd]', body).forEach(b => {
      b.addEventListener('click', () => editWeight(b.dataset.wd));
    });
    const more = $('#w-more');
    if (more) {
      more.addEventListener('click', () => {
        UI.showAll = !UI.showAll;
        renderDieta();
      });
    }
  }

  $('#f-weight').addEventListener('submit', e => {
    e.preventDefault();
    const d = $('#w-date').value || today();
    const w = num($('#w-val').value);
    if (!w || w < 20 || w > 400) {
      toast('Wpisz wagę w kilogramach, np. 108.4');
      return;
    }
    setWeight(d, Math.round(w * 100) / 100);
    toast('Zapisano ' + fmt(w, 2) + ' kg');
    renderDieta();
  });
}
/* ============ PODSUMOWANIE: ogólne liczby w jednym miejscu ============
   Kafelek z wagą i celem, BMI / średnia / 30 dni, seria ważenia, kalorie, fakt dnia,
   podsumowanie miesiąca i skróty (graf partii, odznaki). Wpisy wagi są w zakładce Waga. */
function heroHTML(st) {
  const pct = st.pct != null
    ? Math.max(0, Math.min(100, st.pct))
    : null;
  const lostSign = st.lost > 0 ? '−' : st.lost < 0 ? '+' : '';

  let goalPart;
  if (pct != null) {
    goalPart = `
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}">
        <i style="width:${pct}%"></i>
      </div>
      <div class="row small">
        <span>${st.dir > 0 ? 'Przybrane' : 'Zrzucone'} <b class="num">${fmt(st.prog, 2)}</b> z ${fmt(st.goal, 1)} kg</span>
        <b class="num">${fmt(st.pct, 0)}%</b>
      </div>
      <div class="muted small">
        Start ${fmt(st.start, 1)} kg → cel ${fmt(st.target, 1)} kg · zostało ${fmt(Math.max(0, (st.target - st.cur) * st.dir), 1)} kg
      </div>`;
  } else if (goalType() === 'keep') {
    goalPart = `<div class="muted small">Utrzymanie wagi startowej ${fmt(st.start, 1)} kg · teraz ${fmtSigned(st.cur - st.start, 1)} kg</div>`;
  } else {
    goalPart = `<div class="muted small">${st.dir > 0 ? 'Przybrane' : 'Zrzucone'} ${fmt(st.prog, 2)} kg od startu (${fmt(st.start, 1)} kg). Ustaw cel w Ustawieniach.</div>`;
  }

  return `
    <section class="card hero">
      <div class="hero-nums">
        <div>
          <h3>Aktualna waga</h3>
          <div class="big">${fmt(st.cur, 2)}<small>kg</small></div>
        </div>
        <div class="lost">
          <h3>Od startu</h3>
          <div class="big ${wcls(-st.lost)}">${lostSign}${fmt(Math.abs(st.lost), 2)}<small>kg</small></div>
        </div>
      </div>
      <div class="muted small">${GOALS[goalType()].l} · dzień ${st.day} · ostatni pomiar ${dayLabel(st.last)}</div>
      ${typeof weighStreakHTML === 'function' ? weighStreakHTML() : ''}
      ${st.prevDiff != null
        ? `<div class="small ${wcls(st.prevDiff) || 'muted'}">${fmtSigned(st.prevDiff, 2)} kg od poprzedniego pomiaru</div>`
        : ''}
      ${goalPart}
    </section>`;
}

function statTilesHTML(st) {
  const wkDiff = st.wk != null && st.pwk != null
    ? st.wk - st.pwk
    : null;

  return `
    <div class="tiles">
      <div class="tile">${bmiTileHTML(st.bmi)}</div>
      <div class="tile">
        <span class="k">Średnia 7 dni</span>
        <span class="v">${fmt(st.wk, 1)}</span>
        <span class="d ${wcls(wkDiff)}">${wkDiff != null ? fmtSigned(wkDiff, 2) + ' kg / tydz.' : 'za mało danych'}</span>
      </div>
      <div class="tile">
        <span class="k">Ostatnie 30 dni</span>
        <span class="v ${st.m30 != null ? wcls(-st.m30) : ''}">${st.m30 != null ? fmtSigned(-st.m30, 1) : '–'}</span>
        <span class="d">kg</span>
      </div>
    </div>`;
}

function renderStart() {
  $('#start-date').textContent = new Date().toLocaleDateString('pl-PL', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  const st = stats();
  const body = $('#start-body');

  const badgesCard = typeof badgeCount === 'function'
    ? `<button class="card nav-card" type="button" id="st-badges">
        <span class="nav-ic" aria-hidden="true">🎖️</span>
        <span class="grow">
          <b>Odznaki</b>
          <span class="small muted">zdobyte ${badgeCount()}</span>
        </span>
        <span class="chev" aria-hidden="true">›</span>
      </button>`
    : '';

  const weightPart = st
    ? `
      ${heroHTML(st)}
      ${statTilesHTML(st)}
      ${typeof weightTrendHTML === 'function' ? weightTrendHTML() : ''}
      ${pref('kcal') ? kcalCardHTML(st) : ''}
      ${pref('fact') ? factCardHTML() : ''}`
    : `
      <div class="card empty">
        <strong>Zacznij od wagi</strong>
        <span>Wpisz pierwszy pomiar w zakładce Waga, a tu pojawi się podsumowanie: postęp do celu, BMI, średnie i ciekawostki.</span>
        <button class="btn primary" type="button" data-go="dieta">Przejdź do Wagi</button>
      </div>`;

  body.innerHTML = `
    ${weightPart}
    ${typeof monthSummaryHTML === 'function' ? monthSummaryHTML() : ''}
    ${typeof muscleBarsHTML === 'function' ? muscleBarsHTML() : ''}
    ${musclesNavCard()}
    ${badgesCard}
    ${S.profile.height ? '' : '<p class="muted small">Podaj wzrost i cel w zakładce Ustawienia, żeby zobaczyć BMI i postęp do celu.</p>'}`;

  if (st) {
    wireFact(body);
    fitHero(body);
    const kc = $('#kcal-card', body);
    if (kc) {
      kc.onclick = showKcal;
    }
  }

  const ms = $('#month-sum', body);
  if (ms && typeof wireMonthSummary === 'function') {
    wireMonthSummary(ms);
  }

  const tr = $('#trend-card', body);
  if (tr && typeof wireWeightTrend === 'function') {
    wireWeightTrend(tr);
  }

  const mb = $('#mbars', body);
  if (mb && typeof wireMuscleBars === 'function') {
    wireMuscleBars(mb);
  }

  const bd = $('#st-badges', body);
  if (bd) {
    bd.onclick = () => showBadges();
  }
}

function editWeight(d) {
  const e = S.weights.find(x => x.d === d); if (!e) return;
  openSheet(dayLabel(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), `
    <div class="field"><label for="ew">Waga (kg)</label><input type="number" id="ew" inputmode="decimal" step="0.01" value="${e.w}"></div>
    <div class="btns"><button class="btn danger" type="button" id="ew-del">Usuń pomiar</button><button class="btn primary" type="button" id="ew-ok">Zapisz</button></div>`, b => {
    $('#ew-ok', b).onclick = () => { const w = num($('#ew', b).value); if (!w) return; setWeight(d, Math.round(w * 100) / 100); closeSheet(); renderDieta(); toast('Zapisano'); };
    $('#ew-del', b).onclick = () => { S.weights = S.weights.filter(x => x.d !== d); save(); closeSheet(); renderDieta(); toast('Usunięto pomiar'); };
  });
}

/* ============ IMPORT EXCELA (.xlsx, bez bibliotek) ============ */
async function unzip(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf), td = new TextDecoder();
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('To nie jest plik .xlsx.');
  const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const files = {};
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    files[td.decode(u8.subarray(p + 46, p + 46 + nlen))] = { method, csize, off };
    p += 46 + nlen + elen + clen;
  }
  return {
    async text(name) {
      const f = files[name]; if (!f) return null;
      const start = f.off + 30 + dv.getUint16(f.off + 26, true) + dv.getUint16(f.off + 28, true);
      const data = u8.subarray(start, start + f.csize);
      if (f.method === 0) return td.decode(data);
      if (typeof DecompressionStream === 'undefined') throw new Error('Ta przeglądarka jest za stara, żeby czytać pliki Excel. Zaktualizuj iOS.');
      return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
    }
  };
}
const splitRef = r => { const m = /^([A-Z]+)(\d+)$/.exec(r); return m ? { col: m[1], row: +m[2] } : null; };
const colNum = c => [...c].reduce((s, ch) => s * 26 + ch.charCodeAt(0) - 64, 0);
const colStr = n => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

async function readXlsxBook(file) {
  const z = await unzip(await file.arrayBuffer());
  const xml = s => new DOMParser().parseFromString(s, 'application/xml');
  const ss = [];
  const sst = await z.text('xl/sharedStrings.xml');
  if (sst) for (const si of xml(sst).getElementsByTagName('si')) ss.push([...si.getElementsByTagName('t')].map(t => t.textContent).join(''));
  const sheets = [];
  const wbx = await z.text('xl/workbook.xml');
  const relx = await z.text('xl/_rels/workbook.xml.rels');
  const targets = {};
  if (relx) for (const r of xml(relx).getElementsByTagName('Relationship')) {
    const t = r.getAttribute('Target'); targets[r.getAttribute('Id')] = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
  }
  const list = wbx ? [...xml(wbx).getElementsByTagName('sheet')].map(s => ({ name: s.getAttribute('name') || '', path: targets[s.getAttribute('r:id')] })) : [];
  if (!list.length) list.push({ name: 'Arkusz1', path: 'xl/worksheets/sheet1.xml' });
  for (const sh of list) {
    const sx = sh.path && await z.text(sh.path);
    if (!sx) continue;
    const cells = {};
    for (const c of xml(sx).getElementsByTagName('c')) {
      const r = c.getAttribute('r'), t = c.getAttribute('t'), v = c.getElementsByTagName('v')[0];
      let val = null;
      if (t === 's') val = v ? ss[+v.textContent] : null;
      else if (t === 'inlineStr') val = [...c.getElementsByTagName('t')].map(x => x.textContent).join('');
      else if (t === 'str' || t === 'e') val = v ? v.textContent : null;
      else if (v) val = Number(v.textContent);
      if (val !== null && val !== '' && r) cells[r] = val;
    }
    sheets.push({ name: sh.name, cells });
  }
  if (!sheets.length) throw new Error('Nie znalazłem arkusza w pliku.');
  return sheets;
}
function parseDateCell(v) {
  if (typeof v === 'number' && v > 20000 && v < 80000) return dstr(new Date(1899, 11, 30 + Math.floor(v)));
  if (typeof v === 'string') {
    let m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(v.trim());
    if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
    m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v.trim());
    if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  }
  return null;
}
const normTxt = s => String(s).trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/Ł/g, 'L');
function interpretDiet(cells) {
  let hdr = null, colW = null, colD = null, height = null, goal = null;
  for (const [ref, v] of Object.entries(cells)) {
    if (typeof v !== 'string') continue;
    const p = splitRef(ref); if (!p) continue;
    const t = normTxt(v);
    if (t === 'WAGA' && (hdr === null || p.row < hdr)) { hdr = p.row; colW = p.col; }
    if (t.includes('WZROST')) {
      const left = cells[colStr(colNum(p.col) - 1) + p.row];
      if (typeof left === 'number') {
        height = left > 3 ? left / 100 : left;
        const below = cells[colStr(colNum(p.col) - 1) + (p.row + 1)];
        if (typeof below === 'number' && below > 0 && below < 200) goal = below;
      }
    }
  }
  if (hdr === null) return null;
  for (const [ref, v] of Object.entries(cells)) {
    const p = splitRef(ref);
    if (p && p.row === hdr && typeof v === 'string' && normTxt(v) === 'DATA') colD = p.col;
  }
  if (!colD) return null;
  const maxRow = Math.max(...Object.keys(cells).map(r => (splitRef(r) || { row: 0 }).row));
  const rows = [];
  for (let r = hdr + 1; r <= maxRow; r++) {
    const w = cells[colW + r], d = parseDateCell(cells[colD + r]);
    if (typeof w === 'number' && w > 10 && w < 400 && d) rows.push({ d, w: Math.round(w * 100) / 100 });
  }
  rows.sort((a, b) => a.d < b.d ? -1 : 1);
  return { rows, height, goal };
}
// Tabela z nagłówkami w 1. wierszu → lista obiektów {NAGŁÓWEK: wartość}
function sheetTable(cells) {
  const heads = {};
  let maxRow = 0;
  for (const [ref, v] of Object.entries(cells)) {
    const p = splitRef(ref); if (!p) continue;
    if (p.row === 1 && typeof v === 'string') heads[p.col] = normTxt(v);
    if (p.row > maxRow) maxRow = p.row;
  }
  const out = [];
  for (let r = 2; r <= maxRow; r++) {
    const o = {}; let any = false;
    for (const [col, h] of Object.entries(heads)) { const v = cells[col + r]; if (v != null) { o[h] = v; any = true; } }
    if (any) out.push(o);
  }
  return out;
}
function interpretBook(sheets) {
  const find = (...names) => sheets.find(s => names.includes(normTxt(s.name)));
  const res = { diet: null, workouts: null, fav: null, custom: null, plans: null };
  for (const s of [find('DIETA'), ...sheets].filter(Boolean)) { const d = interpretDiet(s.cells); if (d && d.rows.length) { res.diet = d; break; } }
  const cs = find('WLASNE CWICZENIA', 'WLASNE');
  if (cs) res.custom = sheetTable(cs.cells).filter(r => r['ID'] && r['NAZWA']).map(r => ({ id: String(r['ID']), n: String(r['NAZWA']), pl: String(r['NAZWA']), m: [String(r['PARTIA'] || 'chest')], c: String(r['RODZAJ'] || 'strength'), e: 'other' }));
  const ts = find('TRENINGI');
  if (ts) {
    const byId = new Map();
    const extraCustom = [];
    for (const r of sheetTable(ts.cells)) {
      const date = parseDateCell(r['DATA']); if (!date) continue;
      const wid = String(r['TRENING'] || date);
      let exId = r['ID CWICZENIA'] != null ? String(r['ID CWICZENIA']) : '';
      const exNm = r['CWICZENIE'] != null ? String(r['CWICZENIE']) : '';
      if (!exId || (!EXMAP[exId] && !(res.custom || []).some(c => c.id === exId))) {
        const hit = [...EX, ...(res.custom || []), ...extraCustom].find(e => (e.pl || e.n) === exNm || e.n === exNm);
        if (hit) exId = hit.id;
        else if (exNm) { const c = { id: exId || 'c_' + uid(), n: exNm, pl: exNm, m: ['chest'], c: 'strength', e: 'other' }; extraCustom.push(c); exId = c.id; }
        else continue;
      }
      if (!byId.has(wid)) byId.set(wid, { id: wid, date, start: parseD(date).getTime() + 12 * 36e5, end: null, ex: [] });
      const w = byId.get(wid);
      if (r['PLAN'] && !w.planName) w.planName = String(r['PLAN']);
      let e = w.ex.find(x => x.id === exId);
      if (!e) { e = { id: exId, sets: [] }; w.ex.push(e); }
      const set = { a: num(r['KG / MIN']), b: num(r['POWT. / KM']) };
      FIELDS.forEach(F => { const v = r[normTxt(F.x)]; if (hasVal(v)) set[F.id] = F.text ? String(v) : num(v); });
      if (filled(set) || num(r['SERIA']) != null) e.sets.push(set);
    }
    res.workouts = [...byId.values()];
    if (extraCustom.length) res.custom = [...(res.custom || []), ...extraCustom];
  }
  const fs = find('ULUBIONE');
  if (fs) res.fav = sheetTable(fs.cells).map(r => r['ID CWICZENIA'] != null ? String(r['ID CWICZENIA']) : null).filter(Boolean);
  const ps = find('PLANY');
  if (ps) {
    const byPlan = new Map();
    for (const r of sheetTable(ps.cells)) {
      const name = r['PLAN'] != null ? String(r['PLAN']) : ''; if (!name) continue;
      const pid = r['ID PLANU'] != null ? String(r['ID PLANU']) : 'p_' + name;
      let exId = r['ID CWICZENIA'] != null ? String(r['ID CWICZENIA']) : '';
      const exNm = r['CWICZENIE'] != null ? String(r['CWICZENIE']) : '';
      if (!exId || !(EXMAP[exId] || (res.custom || []).some(c => c.id === exId))) {
        const hit = [...EX, ...(res.custom || [])].find(e => (e.pl || e.n) === exNm || e.n === exNm);
        if (!hit) continue;
        exId = hit.id;
      }
      if (!byPlan.has(pid)) byPlan.set(pid, { id: pid, name, ex: [] });
      byPlan.get(pid).ex.push({ id: exId, sets: Math.max(1, Math.round(num(r['SERIE']) || 3)) });
    }
    res.plans = [...byPlan.values()];
  }
  const fls = find('POLA CWICZEN');
  if (fls) {
    res.exFields = {};
    sheetTable(fls.cells).forEach(r => {
      const id = r['ID CWICZENIA'] != null ? String(r['ID CWICZENIA']) : '';
      const f = String(r['POLA'] || '').split(/[\s,;]+/).filter(x => FIELD[x]).slice(0, FIELDS_MAX);
      if (id && f.length) res.exFields[id] = f;
    });
  }
  const ms = find('POMIARY', 'POMIARY CIALA');
  if (ms) {
    const hdr = {}; MEAS.forEach(m => hdr[normTxt(`${m.l} (${measUnit(m)})`)] = m.k);
    hdr[normTxt('Ramię (biceps) (cm)')] = 'arm'; // nazwa kolumny ze starszych kopii
    res.measures = sheetTable(ms.cells).map(r => {
      const d = parseDateCell(r['DATA']); if (!d) return null;
      const v = {};
      for (const [h, val] of Object.entries(r)) { const k = hdr[h]; const n = typeof val === 'number' ? val : num(val); if (k && n != null && n > 0) v[k] = Math.round(n * 10) / 10; }
      return Object.keys(v).length ? { d, v } : null;
    }).filter(Boolean);
  }
  return res;
}
// Wspólne łączenie danych: import z Excela i synchronizacja z chmurą.
// R = { diet: {rows, height, goal} | null, workouts, plans, fav, custom } ; replace = zastąp zamiast dopisać
function applyData(R, replace) {
  if (R.diet) {
    if (replace) S.weights = [];
    R.diet.rows.forEach(r => { const i = S.weights.findIndex(x => x.d === r.d); if (i >= 0) S.weights[i].w = r.w; else S.weights.push({ d: r.d, w: r.w }); });
    sortWeights();
    if (R.diet.height) S.profile.height = R.diet.height;
    if (R.diet.goal) S.profile.goalLoss = R.diet.goal;
  }
  if (R.custom) {
    if (replace) S.custom = [];
    R.custom.forEach(c => { if (!S.custom.some(x => x.id === c.id)) S.custom.push(c); });
  }
  if (R.workouts) {
    if (replace) S.workouts = [];
    R.workouts.forEach(w => { if (!S.workouts.some(x => x.id === w.id)) S.workouts.push(w); });
    S.workouts.sort((x, y) => x.start - y.start);
  }
  if (R.plans) {
    if (replace) S.plans = [];
    R.plans.forEach(p => { const i = S.plans.findIndex(x => x.id === p.id); if (i >= 0) S.plans[i] = p; else S.plans.push(p); });
  }
  if (R.fav) {
    if (replace) S.fav = [];
    R.fav.forEach(id => { if (!S.fav.includes(id)) S.fav.push(id); });
  }
  if (R.exFields) S.exFields = Object.assign(replace ? {} : (S.exFields || {}), R.exFields);
  if (R.measures) {
    if (replace) S.measures = [];
    R.measures.forEach(m => { const i = S.measures.findIndex(x => x.d === m.d); if (i >= 0) S.measures[i] = { d: m.d, v: Object.assign({}, S.measures[i].v, m.v) }; else S.measures.push({ d: m.d, v: Object.assign({}, m.v) }); });
    sortMeasures();
  }
}
// Pełny stan apki → format dla applyData
const stateAsData = d => ({
  diet: d.weights && d.weights.length ? { rows: d.weights, height: d.profile && d.profile.height, goal: d.profile && d.profile.goalLoss } : null,
  workouts: d.workouts || [], plans: d.plans || [], fav: d.fav || [], custom: d.custom || [], measures: d.measures || [], exFields: d.exFields || null,
});
async function onXlsxPicked(ev) {
  const file = ev.target.files && ev.target.files[0]; ev.target.value = '';
  if (!file) return;
  let R;
  try {
    if (/\.json$/i.test(file.name)) {
      const j = JSON.parse(await file.text());
      if (!j || j.app !== 'postep' || !j.data) throw new Error('To nie jest plik kopii z tej apki.');
      const d = j.data;
      R = { diet: d.weights && d.weights.length ? { rows: d.weights, height: d.profile && d.profile.height, goal: d.profile && d.profile.goalLoss } : null, workouts: d.workouts || null, fav: d.fav || null, custom: d.custom || null, plans: d.plans || null, measures: d.measures || null, exFields: d.exFields || null };
    } else {
      R = interpretBook(await readXlsxBook(file));
    }
    if (!(R.diet && R.diet.rows.length) && !(R.workouts && R.workouts.length) && !(R.fav && R.fav.length) && !(R.plans && R.plans.length) && !(R.measures && R.measures.length)) throw new Error('Nie znalazłem w pliku pomiarów wagi ani treningów. Arkusz z wagą powinien mieć nagłówki DATA i WAGA.');
  } catch (e) { openSheet('Nie udało się wczytać pliku', `<p>${esc(e.message || e)}</p><button class="btn block" data-close type="button">OK</button>`); return; }
  const rows = R.diet ? R.diet.rows : [];
  const hasAny = S.weights.length || S.workouts.length || S.fav.length || S.plans.length || S.measures.length;
  const row = (k, v) => `<div class="row"><span>${k}</span><b class="num" style="text-align:right">${v}</b></div>`;
  openSheet('Wczytaj z Excela', `
    <div class="card">
      ${row('Plik', `<span style="overflow-wrap:anywhere">${esc(file.name)}</span>`)}
      ${rows.length ? row('Pomiary wagi', rows.length) + row('Okres', `${dayLabel(rows[0].d)} – ${dayLabel(rows[rows.length - 1].d, { day: 'numeric', month: 'short', year: 'numeric' })}`) + row('Waga', `${fmt(rows[0].w, 1)} → ${fmt(rows[rows.length - 1].w, 1)} kg`) : ''}
      ${R.diet && R.diet.height ? row('Wzrost', fmt(R.diet.height, 2) + ' m') : ''}
      ${R.diet && R.diet.goal ? row('Cel do zrzucenia', fmt(R.diet.goal, 1) + ' kg') : ''}
      ${R.workouts ? row('Treningi', R.workouts.length) : ''}
      ${R.plans ? row('Plany treningowe', R.plans.length) : ''}
      ${R.measures ? row('Pomiary ciała', R.measures.length) : ''}
      ${R.fav ? row('Ulubione ćwiczenia', R.fav.length) : ''}
      ${R.custom && R.custom.length ? row('Własne ćwiczenia', R.custom.length) : ''}
    </div>
    ${hasAny ? `<p class="muted small" style="margin:0"><b>Połącz</b> dopisze dane z pliku do obecnych (ten sam dzień wagi zostanie nadpisany). <b>Zastąp</b> usunie obecne dane tego rodzaju i wstawi te z pliku.</p>` : ''}
    <div class="btns">
      ${hasAny ? '<button class="btn" type="button" data-imp="merge">Połącz</button>' : ''}
      <button class="btn primary" type="button" data-imp="replace">${hasAny ? 'Zastąp' : 'Wczytaj'}</button>
    </div>`, b => {
    b.addEventListener('click', e => {
      const a = e.target.closest('[data-imp]'); if (!a) return;
      applyData(R, a.dataset.imp === 'replace');
      save(); rebuildExMap(); closeSheet();
      const parts = [rows.length && `${rows.length} pomiarów`, R.workouts && R.workouts.length && `${R.workouts.length} treningów`, R.plans && R.plans.length && `${R.plans.length} planów`, R.measures && R.measures.length && `${R.measures.length} pomiarów ciała`, R.fav && R.fav.length && `${R.fav.length} ulubionych`].filter(Boolean);
      toast('Wczytano: ' + parts.join(', '));
      UI.cw = newFilter();
      setTab(UI.tab === 'wiecej' ? 'wiecej' : 'dieta');
    });
  });
}

/* ============ ZAPIS DO EXCELA (.xlsx, bez bibliotek) ============ */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = u8 => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zipStore(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  const d = new Date();
  const dt = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dd = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, dt, true); lh.setUint16(12, dd, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, dt, true); ch.setUint16(14, dd, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
    ch.setUint32(38, 0, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), name);
    off += 30 + name.length + data.length;
  }
  const csize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, csize, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
const xmlEsc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const excelSerial = s => Math.round((parseD(s) - new Date(1899, 11, 30)) / 864e5);
const H = v => ({ v, s: 2 });           // nagłówek (pogrubiony)
const N2 = v => v == null ? null : { v: Math.round(v * 100) / 100, s: 3 };  // liczba 0,00
const N1 = v => v == null ? null : { v: Math.round(v * 10) / 10, s: 4 };    // liczba 0,0
function sheetXML(rows, widths) {
  const body = rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((c, ci) => {
    if (c == null || c === '') return '';
    const ref = colStr(ci + 1) + (ri + 1);
    let v = c, s = 0;
    if (typeof c === 'object') { if (c.d) { v = excelSerial(c.d); s = 1; } else { v = c.v; s = c.s || 0; } }
    if (v == null || v === '') return '';
    const st = s ? ` s="${s}"` : '';
    if (typeof v === 'number') return isFinite(v) ? `<c r="${ref}"${st}><v>${v}</v></c>` : '';
    return `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
  }).join('') + '</row>').join('');
  const cols = widths ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${body}</sheetData></worksheet>`;
}
function buildXlsx(sheets) {
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RNS}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${NS}" xmlns:r="${RNS}"><sheets>${sheets.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="${RNS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${RNS}/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${NS}"><numFmts count="2"><numFmt numFmtId="164" formatCode="dd.mm.yyyy"/><numFmt numFmtId="165" formatCode="0.0"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXML(s.rows, s.widths) })),
  ];
  return zipStore(files);
}
function backupXlsx() {
  const h = S.profile.height, g = S.profile.goalLoss, start = S.weights[0] ? S.weights[0].w : null;
  // DIETA — ten sam układ co arkusz „DIETA 2026”: wzrost w J1, cel w J2
  const diet = [[H('DZIEŃ'), H('DATA'), H('WAGA'), H('BMI'), H('ZRZUCONE KG'), H('RODZAJ OTYŁOŚCI'), H('% CELU'), H('MIESIĄC'), H('ŚREDNIA TYGODNIOWA'), N2(h), '<- wzrost (m)']];
  S.weights.forEach((x, i) => {
    const bmi = h ? x.w / (h * h) : null;
    const ref30 = [...S.weights].reverse().find(y => y.d <= addDays(x.d, -30));
    diet.push([i + 1, { d: x.d }, N2(x.w), N2(bmi), N2(start - x.w), bmiCat(bmi) || '', g ? N1((start - x.w) / g * 100) : null, ref30 ? N2(ref30.w - x.w) : null, N2(avgBetween(addDays(x.d, -6), x.d))]);
  });
  if (diet.length < 2) diet.push([]);
  diet[1][9] = N1(g); diet[1][10] = '<- cel: ile kg zrzucić';
  // dodatkowe pola serii (tempo, RIR, …) dostają kolumny tylko, gdy gdzieś mają wartość
  const extra = FIELDS.filter(F => S.workouts.some(w => w.ex.some(e => e.sets.some(s => hasVal(s[F.id])))));
  const tr = [[H('DATA'), H('TRENING'), H('ĆWICZENIE'), H('ID ĆWICZENIA'), H('SERIA'), H('KG / MIN'), H('POWT. / KM'), H('PLAN'), ...extra.map(F => H(F.x))]];
  S.workouts.forEach(w => w.ex.forEach(e => e.sets.length
    ? e.sets.forEach((s, i) => tr.push([{ d: w.date }, w.id, exName(EXMAP[e.id]), e.id, i + 1, s.a, s.b, w.planName || '', ...extra.map(F => hasVal(s[F.id]) ? s[F.id] : null)]))
    : tr.push([{ d: w.date }, w.id, exName(EXMAP[e.id]), e.id, null, null, null, w.planName || ''])));
  const flds = [[H('ID ĆWICZENIA'), H('ĆWICZENIE'), H('POLA')], ...Object.entries(S.exFields || {}).map(([id, f]) => [id, exName(EXMAP[id]), f.join(', ')])];
  const plans = [[H('PLAN'), H('ID PLANU'), H('KOLEJNOŚĆ'), H('ĆWICZENIE'), H('ID ĆWICZENIA'), H('SERIE')]];
  S.plans.forEach(p => p.ex.forEach((e, i) => plans.push([p.name, p.id, i + 1, exName(EXMAP[e.id]), e.id, e.sets])));
  const fav = [[H('ID ĆWICZENIA'), H('NAZWA')], ...S.fav.map(id => [id, exName(EXMAP[id])])];
  const own = [[H('ID'), H('NAZWA'), H('PARTIA'), H('RODZAJ')], ...(S.custom || []).map(c => [c.id, c.n, (c.m || [])[0] || '', c.c || 'strength'])];
  const meas = [[H('DATA'), ...MEAS.map(m => H(`${m.l} (${measUnit(m)})`))], ...S.measures.map(x => [{ d: x.d }, ...MEAS.map(m => x.v[m.k] != null ? N1(x.v[m.k]) : null)])];
  return buildXlsx([
    { name: 'DIETA', rows: diet, widths: [8, 12, 9, 9, 13, 20, 9, 10, 20, 8, 24] },
    { name: 'TRENINGI', rows: tr, widths: [12, 14, 38, 34, 7, 10, 11, 18, ...extra.map(() => 14)] },
    { name: 'PLANY', rows: plans, widths: [18, 16, 11, 38, 34, 8] },
    { name: 'POMIARY', rows: meas, widths: [12, ...MEAS.map(() => 16)] },
    { name: 'ULUBIONE', rows: fav, widths: [34, 38] },
    { name: 'WŁASNE ĆWICZENIA', rows: own, widths: [16, 34, 14, 10] },
    { name: 'POLA ĆWICZEŃ', rows: flds, widths: [34, 38, 30] },
  ]);
}

/* ============ TRENING ============ */
function lastSetsFor(exId, beforeId) {
  for (let i = S.workouts.length - 1; i >= 0; i--) {
    const w = S.workouts[i]; if (w.id === beforeId) continue;
    const e = w.ex.find(x => x.id === exId);
    if (e && e.sets.some(filled)) return { date: w.date, sets: e.sets };
  }
  return null;
}
/* ---- pola serii: co wpisujemy przy ćwiczeniu (konfigurowalne per ćwiczenie w S.exFields) ---- */
const fmtN = v => typeof v !== 'number' ? String(v) : fmt(v, Math.round(v) === v ? 0 : Math.round(v * 10) === v * 10 ? 1 : 2);
const FIELDS = [
  { id: 'kg', h: 'kg', l: 'Ciężar (kg)', x: 'CIĘŻAR (KG)', step: '0.5', im: 'decimal', f: v => fmtN(v) + ' kg' },
  { id: 'reps', h: 'powt.', l: 'Powtórzenia', x: 'POWTÓRZENIA', step: '1', im: 'numeric', f: v => fmtN(v) + ' powt.' },
  { id: 'min', h: 'min', l: 'Czas (minuty)', x: 'CZAS (MIN)', step: '0.5', im: 'decimal', f: v => fmtN(v) + ' min' },
  { id: 'sec', h: 'sek.', l: 'Czas (sekundy)', x: 'CZAS (S)', step: '1', im: 'numeric', f: v => fmtN(v) + ' s' },
  { id: 'km', h: 'km', l: 'Dystans (km)', x: 'DYSTANS (KM)', step: '0.1', im: 'decimal', f: v => fmtN(v) + ' km' },
  { id: 'm', h: 'metry', l: 'Dystans (metry)', x: 'DYSTANS (M)', step: '1', im: 'numeric', f: v => fmtN(v) + ' m' },
  { id: 'speed', h: 'km/h', l: 'Prędkość (km/h)', x: 'PRĘDKOŚĆ (KM/H)', step: '0.1', im: 'decimal', f: v => fmtN(v) + ' km/h' },
  { id: 'incline', h: 'nachyl. %', l: 'Nachylenie (%)', x: 'NACHYLENIE (%)', step: '0.5', im: 'decimal', f: v => 'nachyl. ' + fmtN(v) + '%' },
  { id: 'level', h: 'poziom', l: 'Poziom / opór maszyny', x: 'POZIOM', step: '1', im: 'numeric', f: v => 'poziom ' + fmtN(v) },
  { id: 'tempo', h: 'tempo', l: 'Tempo (np. 3-1-1-0)', x: 'TEMPO', text: true, f: v => 'tempo ' + v },
  { id: 'rir', h: 'RIR', l: 'RIR (powtórzenia w zapasie)', x: 'RIR', step: '1', im: 'numeric', f: v => 'RIR ' + fmtN(v) },
  { id: 'rpe', h: 'RPE', l: 'RPE (wysiłek 1–10)', x: 'RPE', step: '0.5', im: 'decimal', f: v => 'RPE ' + fmtN(v) },
  { id: 'hr', h: 'tętno', l: 'Tętno (bpm)', x: 'TĘTNO (BPM)', step: '1', im: 'numeric', f: v => fmtN(v) + ' bpm' },
];
const FIELD = Object.fromEntries(FIELDS.map(f => [f.id, f]));
const FIELDS_MAX = 5;
const defaultFields = ex => isCardio(ex) ? ['min', 'km'] : ['kg', 'reps'];
const exFields = id => { const c = S.exFields && S.exFields[id]; return Array.isArray(c) && c.length ? c.filter(f => FIELD[f]) : defaultFields(EXMAP[id]); };
// gdzie w serii leży wartość pola: dwa podstawowe pola ćwiczenia w a/b (zgodność ze starszymi danymi), reszta pod własną nazwą
const fieldKey = (ex, f) => (isCardio(ex) ? { min: 'a', km: 'b' } : { kg: 'a', reps: 'b' })[f] || f;
const hasVal = v => v != null && v !== '';
const filled = s => Object.keys(s).some(k => k !== 'done' && k !== 'drop' && hasVal(s[k]));
const setVals = s => { const o = { a: null, b: null }; for (const k in s) if (k !== 'done' && k !== 'drop' && hasVal(s[k])) o[k] = s[k]; if (s.drop) o.drop = true; return o; };
function setText(ex, s) {
  const cardio = isCardio(ex), parts = [];
  if (!cardio && hasVal(s.a) && hasVal(s.b)) parts.push(`${fmtN(s.a)}×${fmtN(s.b)}`);
  else { if (hasVal(s.a)) parts.push(FIELD[cardio ? 'min' : 'kg'].f(s.a)); if (hasVal(s.b)) parts.push(FIELD[cardio ? 'km' : 'reps'].f(s.b)); }
  FIELDS.forEach(F => { const k = fieldKey(ex, F.id); if (k !== 'a' && k !== 'b' && hasVal(s[k])) parts.push(F.f(s[k])); });
  return parts.join(' ');
}
// dropset dopisany do poprzedniej serii strzałką: „80×8 ↘ 60×6, 80×7”
const setsSummary = (e, sets) => !(sets = sets.filter(filled)).length ? 'bez serii' : sets.map((s, i) => (i ? (s.drop ? ' ↘ ' : ', ') : '') + setText(e, s)).join('');
/* ---- rekordy osobiste ---- */
// szacowany ciężar maksymalny na 1 powtórzenie (wzór Epleya), liczony z serii do 12 powtórzeń
const e1rm = s => s.a > 0 && s.b >= 1 && s.b <= 12 ? (s.b === 1 ? s.a : s.a * (1 + s.b / 30)) : 0;
const PR_KINDS = {
  w: { l: 'Najcięższa seria', s: 'najcięższa seria', f: r => `${fmtN(r.s.a)} kg${hasVal(r.s.b) ? ' × ' + fmtN(r.s.b) : ''}` },
  e1rm: { l: 'Szacowany 1RM', s: 'szacowany 1RM', f: r => `${fmtN(Math.round(r.v * 2) / 2)} kg` },
  reps: { l: 'Najwięcej powtórzeń', s: 'najwięcej powtórzeń', f: r => `${fmtN(r.v)} powt.` },
  vol: { l: 'Największa objętość', s: 'objętość', f: r => `${fmt(r.v, 0)} kg`, quiet: true },
  dist: { l: 'Najdłuższy dystans', s: 'najdłuższy dystans', f: r => `${fmtN(r.v)} km` },
  time: { l: 'Najdłuższy czas', s: 'najdłuższy czas', f: r => `${fmtN(r.v)} min` },
};
function bestsOf(ex, sets) {
  const out = {}, put = (k, v, s) => { if (v > 0 && (!out[k] || v > out[k].v)) out[k] = { v, s }; };
  let vol = 0;
  sets.filter(filled).forEach(s => {
    if (isCardio(ex)) { put('dist', s.b || 0, s); put('time', s.a || 0, s); return; }
    if (s.a > 0) { put('w', s.a, s); put('e1rm', e1rm(s), s); vol += s.a * (s.b || 0); }
    else put('reps', s.b || 0, s); // ćwiczenia bez obciążenia
  });
  put('vol', vol, null);
  return out;
}
// Jedno przejście po historii: najlepsze wyniki każdego ćwiczenia + rekordy pobite w każdym treningu.
// Pierwszy wynik w danej kategorii nie jest „pobitym rekordem”, bo nie ma z czym porównać.
function prTimeline() {
  const best = {}, byW = {};
  [...S.workouts].sort((a, b) => a.start - b.start).forEach(w => w.ex.forEach(e => {
    const b = bestsOf(EXMAP[e.id], e.sets), cur = best[e.id] || (best[e.id] = {});
    for (const k in b) {
      if (cur[k] && b[k].v > cur[k].v && !PR_KINDS[k].quiet) (byW[w.id] = byW[w.id] || []).push({ id: e.id, k, cur: b[k], prev: cur[k] });
      if (!cur[k] || b[k].v > cur[k].v) cur[k] = Object.assign({ date: w.date, wid: w.id }, b[k]);
    }
  }));
  return { best, byW };
}
function celebratePRs(wid) {
  const prs = prTimeline().byW[wid]; if (!prs) return false;
  if (navigator.vibrate) navigator.vibrate([20, 60, 20]);
  openSheet('🏆 Nowe rekordy!', `
    <p class="muted small" style="margin:0">Trening zapisany. Pobite rekordy osobiste:</p>
    <div class="list">${[...new Set(prs.map(p => p.id))].map(id => { const ex = EXMAP[id]; return `
      <div class="li">${thumbHTML(ex)}<div class="grow"><div class="t">${esc(exName(ex))}</div>
        ${prs.filter(p => p.id === id).map(p => { const K = PR_KINDS[p.k]; return `<div class="s">${K.l}: <b class="num pr-val">${K.f(p.cur)}</b> <span class="muted">(było ${K.f(p.prev)})</span></div>`; }).join('')}</div></div>`; }).join('')}</div>
    <button class="btn primary block" type="button" data-close>Super</button>`);
  return true;
}
function showRecords() {
  const { best } = prTimeline();
  const rows = Object.entries(best).filter(([id, r]) => EXMAP[id] && Object.keys(r).some(k => !PR_KINDS[k].quiet))
    .map(([id, r]) => ({ id, r, last: Object.values(r).reduce((m, x) => x.date > m ? x.date : m, '') }))
    .sort((a, b) => a.last < b.last ? 1 : -1);
  openSheet('🏆 Rekordy osobiste', rows.length ? `
    <p class="muted small" style="margin:0">Najlepsze wyniki z całej historii. Szacowany 1RM liczony z serii do 12 powtórzeń.</p>
    <div class="list">${rows.map(({ id, r, last }) => {
      const parts = ['w', 'e1rm', 'reps', 'dist', 'time'].filter(k => r[k]).map(k => k === 'e1rm' ? '1RM ≈ ' + PR_KINDS[k].f(r[k]) : PR_KINDS[k].f(r[k]));
      return `<button class="li" type="button" data-ex="${esc(id)}">${thumbHTML(EXMAP[id])}<div class="grow"><div class="t">${esc(exName(EXMAP[id]))}</div><div class="s num">${parts.join(' · ')}</div></div><div class="r small muted">${dayLabel(last)}</div></button>`;
    }).join('')}</div>` : '<div class="card empty"><span>Zapisz pierwszy trening z wpisanymi seriami, a tu pojawią się twoje najlepsze wyniki.</span></div>', b => {
    b.addEventListener('click', e => { const x = e.target.closest('[data-ex]'); if (x) { showExercise(x.dataset.ex); SHEET_BACK = showRecords; } });
  });
}
const volume = w => w.ex.reduce((sum, e) => isCardio(EXMAP[e.id]) ? sum : sum + e.sets.reduce((s, x) => s + (x.a || 0) * (x.b || 0), 0), 0);
const durMin = w => w.end ? Math.max(1, Math.round((w.end - w.start) / 60000)) : null;

/* ---- przytrzymaj i przeciągnij: zmiana kolejności na liście ---- */
const DRAG = { on: false, until: 0 };
const GRIP = '<span class="grip" aria-hidden="true"><svg viewBox="0 0 12 20" width="12" height="20"><circle cx="3" cy="4" r="1.6"/><circle cx="9" cy="4" r="1.6"/><circle cx="3" cy="10" r="1.6"/><circle cx="9" cy="10" r="1.6"/><circle cx="3" cy="16" r="1.6"/><circle cx="9" cy="16" r="1.6"/></svg></span>';
document.addEventListener('touchmove', e => { if (DRAG.on) e.preventDefault(); }, { passive: false });
document.addEventListener('click', e => { if (Date.now() < DRAG.until) { e.preventDefault(); e.stopPropagation(); } }, true);
document.addEventListener('contextmenu', e => { if (DRAG.on || (e.target.closest && e.target.closest('.drag-item'))) e.preventDefault(); });
function dragSort(box, sel, onMove) {
  box._ds = { sel, onMove };
  if (box._dsBound) return; // nasłuch tylko raz na kontener (render podmienia tylko ustawienia)
  box._dsBound = true;
  box.addEventListener('pointerdown', ev => {
    if (ev.button > 0 || DRAG.on) return;
    const { sel, onMove } = box._ds;
    const el = ev.target.closest(sel);
    if (!el || !box.contains(el) || ev.target.closest('input, textarea, select')) return;
    const x0 = ev.clientX, y0 = ev.clientY, pid = ev.pointerId;
    const scroller = box.closest('.sheet-body') || document.scrollingElement;
    let st = null, timer = setTimeout(start, ev.pointerType === 'mouse' ? 250 : 380);
    function start() {
      timer = null;
      const items = [...box.querySelectorAll(sel)].filter(n => n.parentElement === el.parentElement);
      const from = items.indexOf(el);
      if (items.length < 2 || from < 0) { cleanup(); return; }
      const s0 = scroller.scrollTop;
      const R = items.map(n => { const r = n.getBoundingClientRect(); return { top: r.top + s0, h: r.height }; });
      const gap = from < items.length - 1 ? R[from + 1].top - R[from].top - R[from].h : R[from].top - R[from - 1].top - R[from - 1].h;
      st = { items, from, to: from, s0, R, shift: R[from].h + gap, y: y0, raf: 0 };
      DRAG.on = true;
      el.classList.add('dragging'); el.parentElement.classList.add('drag-active');
      items.forEach(n => { if (n !== el) n.style.transition = 'transform .18s ease'; });
      if (navigator.vibrate) navigator.vibrate(15);
      try { el.setPointerCapture(pid); } catch (e) {}
      update(); st.raf = requestAnimationFrame(autoScroll);
    }
    function update() {
      const dy = st.y - y0 + scroller.scrollTop - st.s0, R = st.R;
      el.style.transform = `translateY(${dy}px) scale(1.02)`;
      const c = R[st.from].top + R[st.from].h / 2 + dy;
      let to = st.from;
      st.items.forEach((n, i) => {
        if (i === st.from) return;
        const ci = R[i].top + R[i].h / 2;
        let t = 0;
        if (i > st.from && c > ci) { t = -st.shift; to++; }
        if (i < st.from && c < ci) { t = st.shift; to--; }
        n.style.transform = t ? `translateY(${t}px)` : '';
      });
      st.to = to;
    }
    function autoScroll() {
      if (!st) return;
      const vr = scroller === document.scrollingElement ? { top: 0, bottom: innerHeight } : scroller.getBoundingClientRect();
      const edge = 90; let v = 0;
      if (st.y < vr.top + edge) v = -Math.ceil((vr.top + edge - st.y) / 5);
      else if (st.y > vr.bottom - edge) v = Math.ceil((st.y - vr.bottom + edge) / 5);
      if (v) { const before = scroller.scrollTop; scroller.scrollTop += v; if (scroller.scrollTop !== before) update(); }
      st.raf = requestAnimationFrame(autoScroll);
    }
    function move(e) {
      if (e.pointerId !== pid) return;
      if (!st) { if (Math.hypot(e.clientX - x0, e.clientY - y0) > 8) cleanup(); return; } // to przewijanie, nie przeciąganie
      e.preventDefault(); st.y = e.clientY; update();
    }
    function up(e) {
      if (e.pointerId !== pid) return;
      const s = st; cleanup();
      if (s) { DRAG.until = Date.now() + 350; if (s.to !== s.from) onMove(s.from, s.to); }
    }
    function cleanup() {
      if (timer) clearTimeout(timer); timer = null;
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      if (st) {
        cancelAnimationFrame(st.raf);
        st.items.forEach(n => { n.style.transform = ''; n.style.transition = ''; });
        el.classList.remove('dragging'); el.parentElement && el.parentElement.classList.remove('drag-active');
      }
      st = null; DRAG.on = false;
    }
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  });
}
const moveItem = (arr, from, to) => { arr.splice(to, 0, arr.splice(from, 1)[0]); };

/* ============ Mapa partii mięśni: serie z ostatnich 7 dni ============
   Sylwetki (przód i tył) to obrazki z Pixabay (licencja Pixabay: wolno używać i przerabiać).
   Obrazek zamieniamy na maskę: ciemne = mięsień, jasne tło i linie między mięśniami = przezroczyste (widać tło motywu).
   Każdy mięsień to osobny „kawałek” maski; BODY_IMG.seeds to punkty leżące w kawałkach danej partii.
   Kolor = ile serii (ćwiczenie główne = 1 seria, pomocnicze = ½). Szczegóły po stuknięciu w partię. */
const BODY_IMG = {
  m: { src: 'icons/body-m.png', seeds: {"neck":[[292,212],[351,212],[301,217],[291,246],[352,246],[941,193],[969,193]],"traps":[[284,247],[357,247],[900,263],[994,263]],"shoulders":[[214,268],[417,268],[845,274],[1067,274]],"chest":[[273,280],[359,280]],"biceps":[[215,340],[428,340],[185,359],[454,359]],"abdominals":[[307,379],[331,379],[311,427],[328,427],[301,474],[326,474],[276,516],[337,516],[239,495],[402,495],[240,464],[403,464],[239,439],[404,439],[243,423],[398,423],[264,397],[378,398],[227,403],[416,403],[227,382],[416,382],[229,369],[412,369],[880,502],[1033,502]],"forearms":[[158,440],[485,440],[172,466],[465,466],[183,477],[459,477],[789,458],[1125,458],[776,472],[1138,472],[767,483],[1147,483],[815,489],[1096,489]],"quadriceps":[[235,590],[407,590],[243,583],[400,583],[214,701],[428,701],[275,741],[367,741],[851,655],[1063,655]],"adductors":[[247,572],[395,572],[309,679],[333,679],[930,693],[970,693],[930,757],[985,757]],"calves":[[359,852],[283,853],[233,860],[410,860],[227,891],[415,891],[278,907],[364,907],[887,859],[1021,859],[1027,859],[893,860],[871,1027],[1036,1027],[895,1029],[1012,1029]],"middle back":[[886,285],[1025,285],[847,318],[1065,318]],"lats":[[911,355],[1002,355]],"lower back":[[944,430],[971,430]],"triceps":[[839,337],[1076,337],[846,377],[1068,377],[803,388],[1112,388]],"abductors":[[890,547],[1012,547]],"glutes":[[929,562],[978,562]],"hamstrings":[[880,672],[1034,672],[910,700],[1004,700]]} },
  f: { src: 'icons/body-f.png', seeds: {"neck":[[305,285],[348,285],[320,291]],"traps":[[296,302],[354,302],[882,307],[1013,307]],"shoulders":[[241,311],[410,311],[260,317],[391,317],[860,314],[1036,314]],"chest":[[297,337],[354,337],[303,316],[350,316]],"biceps":[[230,386],[417,386]],"abdominals":[[253,410],[400,410],[311,429],[335,430],[312,454],[340,454],[297,488],[343,488],[289,520],[358,520],[268,473],[385,473],[895,509],[1009,509],[268,418],[385,418],[268,431],[383,431],[267,442],[385,442],[265,451],[388,451]],"forearms":[[239,425],[413,425],[203,462],[450,462],[217,480],[437,480],[209,512],[444,512],[200,517],[452,517],[833,465],[1064,465],[807,483],[812,483],[1092,483],[1098,483],[844,490],[1060,490]],"quadriceps":[[253,558],[400,559],[245,568],[408,568],[235,643],[418,644],[294,717],[359,717],[856,673],[1049,673]],"adductors":[[393,562],[261,563],[314,623],[339,623],[937,664],[967,664],[923,762],[982,762]],"calves":[[302,840],[352,840],[266,845],[387,845],[301,897],[352,897],[265,898],[388,898],[260,926],[394,926],[899,846],[1005,846],[911,855],[993,855],[931,1009],[973,1010],[894,1012],[1010,1012]],"middle back":[[890,334],[1013,334]],"lats":[[907,383],[996,383]],"lower back":[[945,481],[960,481]],"triceps":[[859,365],[1045,365],[840,384],[1065,384],[839,412],[1066,412]],"abductors":[[886,551],[1013,551]],"glutes":[[943,576],[960,576]],"hamstrings":[[908,685],[997,685],[896,693],[1006,693]]} },
};
const BODY_CACHE = {};
const bodySex = () => S.profile.sex === 'f' ? 'f' : 'm';
// Raz na uruchomienie: wczytaj obrazek, zrób maskę, podziel ją na kawałki i przypisz kawałki do partii
function loadBody(sex) {
  if (BODY_CACHE[sex]) return BODY_CACHE[sex];
  return BODY_CACHE[sex] = new Promise((res, rej) => {
    const img = new Image();
    img.onerror = () => { delete BODY_CACHE[sex]; rej(new Error('img')); };
    img.onload = () => {
      const W = img.naturalWidth, H = img.naturalHeight, c = document.createElement('canvas');
      c.width = W; c.height = H; const cx = c.getContext('2d'); cx.drawImage(img, 0, 0);
      const d = cx.getImageData(0, 0, W, H).data, N = W * H, A = new Uint8Array(N);
      for (let i = 0; i < N; i++) { const L = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3; A[i] = Math.max(0, Math.min(255, Math.round((200 - L) / 104 * 255))); }
      // kawałki: spójne obszary pikseli z kryciem >= 50%
      const lab = new Int32Array(N).fill(-1), st = new Int32Array(N); let nl = 0;
      for (let s = 0; s < N; s++) {
        if (A[s] < 128 || lab[s] >= 0) continue;
        let sp = 0; st[sp++] = s; lab[s] = nl;
        while (sp) {
          const p = st[--sp], px = p % W;
          if (px > 0 && A[p - 1] >= 128 && lab[p - 1] < 0) { lab[p - 1] = nl; st[sp++] = p - 1; }
          if (px < W - 1 && A[p + 1] >= 128 && lab[p + 1] < 0) { lab[p + 1] = nl; st[sp++] = p + 1; }
          if (p >= W && A[p - W] >= 128 && lab[p - W] < 0) { lab[p - W] = nl; st[sp++] = p - W; }
          if (p < N - W && A[p + W] >= 128 && lab[p + W] < 0) { lab[p + W] = nl; st[sp++] = p + W; }
        }
        nl++;
      }
      const keys = Object.keys(BODY_IMG[sex].seeds), labM = new Int8Array(nl).fill(-1);
      keys.forEach((k, ki) => BODY_IMG[sex].seeds[k].forEach(([x, y]) => { const l = lab[y * W + x]; if (l >= 0) labM[l] = ki; }));
      // piksel -> partia (-1 = głowa, dłonie, kolana itp.); półprzezroczyste krawędzie biorą partię sąsiada
      const mus = new Int8Array(N).fill(-1);
      for (let i = 0; i < N; i++) if (lab[i] >= 0) mus[i] = labM[lab[i]];
      for (let pass = 0; pass < 2; pass++) for (let i = W; i < N - W; i++) if (A[i] && lab[i] < 0 && mus[i] < 0) {
        const n = [i - 1, i + 1, i - W, i + W].find(q => mus[q] >= 0); if (n !== undefined) mus[i] = mus[n];
      }
      // przycięcie do sylwetek
      let x0 = W, y0 = H, x1 = 0, y1 = 0;
      for (let i = 0; i < N; i++) if (A[i] > 20) { const x = i % W, y = (i / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      x0 = Math.max(0, x0 - 4); y0 = Math.max(0, y0 - 4); x1 = Math.min(W - 1, x1 + 4); y1 = Math.min(H - 1, y1 + 4);
      const w = x1 - x0 + 1, h = y1 - y0 + 1, cA = new Uint8Array(w * h), cM = new Int8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = (y + y0) * W + x + x0; cA[y * w + x] = A[s]; cM[y * w + x] = mus[s]; }
      res({ w, h, A: cA, mus: cM, keys });
    };
    img.src = BODY_IMG[sex].src;
  });
}
const hexRGB = h => { h = (h || '').trim().replace('#', ''); if (h.length === 3) h = h.split('').map(x => x + x).join(''); const n = parseInt(h, 16); return isNaN(n) ? [128, 128, 128] : [n >> 16 & 255, n >> 8 & 255, n & 255]; };
// poziom 0 = kolor „wyciszony” motywu, 1–3 = coraz mocniejsza czerwień
const BODY_HOT = [[240, 153, 123], [232, 97, 60], [217, 48, 28]];
function drawBody(cv, B, data, days = 7) {
  const base = hexRGB(getComputedStyle(document.documentElement).getPropertyValue('--muted'));
  const col = B.keys.map(k => { const lv = muscleLevel(muscleScore(data[k]), days); return lv ? BODY_HOT[lv - 1] : base; });
  cv.width = B.w; cv.height = B.h;
  const x = cv.getContext('2d'), im = x.createImageData(B.w, B.h), o = im.data;
  for (let i = 0; i < B.A.length; i++) {
    const a = B.A[i]; if (!a) continue;
    const c = B.mus[i] >= 0 ? col[B.mus[i]] : base, j = i * 4;
    o[j] = c[0]; o[j + 1] = c[1]; o[j + 2] = c[2]; o[j + 3] = B.mus[i] >= 0 ? a : a * .55;
  }
  x.putImageData(im, 0, 0);
}
// partia pod palcem (albo najbliższa w promieniu ~2% szerokości — palec jest grubszy niż linie)
function bodyHit(B, px, py) {
  const at = (x, y) => x >= 0 && y >= 0 && x < B.w && y < B.h ? B.mus[y * B.w + x] : -1;
  const r = Math.round(B.w * .02);
  for (let d = 0; d <= r; d += 2) for (let a = 0; a < 16; a++) {
    const m = at(Math.round(px + Math.cos(a * Math.PI / 8) * d), Math.round(py + Math.sin(a * Math.PI / 8) * d));
    if (m >= 0) return B.keys[m];
    if (!d) break;
  }
  return null;
}
// serie „liczone”: wypełnione, a dropset (ciąg dalszy poprzedniej serii) nie liczy się jako osobna seria
const countSets = sets => sets.filter(s => filled(s) && !s.drop).length;
const MUS_DAYS = [7, 14, 30];
const musDays = () => MUS_DAYS.includes(UI.mDays) ? UI.mDays : 7;
function muscleSets(days = musDays()) {
  const from = addDays(today(), -(days - 1)), out = {};
  S.workouts.filter(w => w.date >= from && w.date <= today()).forEach(w => w.ex.forEach(e => {
    const ex = EXMAP[e.id]; if (!ex || isCardio(ex)) return;
    const n = countSets(e.sets); if (!n) return;
    const add = (m, k) => { const o = out[m] = out[m] || { main: 0, help: 0, items: [] }; o[k] += n; o.items.push({ w, e, n, k }); };
    (ex.m || []).forEach(m => add(m, 'main'));
    (ex.s || []).forEach(m => { if (!(ex.m || []).includes(m)) add(m, 'help'); });
  }));
  return out;
}
const muscleScore = o => o ? o.main + o.help / 2 : 0;
// progi kolorów są „na tydzień” (1–3, 4–9, 10+ serii); przy 14 i 30 dniach przeliczamy na średnią tygodniową
const muscleLevel = (v, days = 7) => { v = v * 7 / days; return v <= 0 ? 0 : v < 4 ? 1 : v < 10 ? 2 : 3; };
const seriiWord = v => v === 1 ? 'seria' : v % 1 === 0 && v % 10 >= 2 && v % 10 <= 4 && (v % 100 < 10 || v % 100 >= 20) ? 'serie' : 'serii';
function bodyMapHTML() {
  const d = musDays();
  return `<div class="seg seg-full" role="group" aria-label="Okres">${MUS_DAYS.map(n => `<button type="button" data-mdays="${n}" aria-pressed="${n === d}">${n} dni</button>`).join('')}</div>
    <section class="card bodymap">
    <p class="muted small" style="margin:0;text-align:center">Serie z ostatnich ${d} dni</p>
    <div class="body-wrap"><canvas class="body-cv" role="img" aria-label="Sylwetka z przodu i z tyłu: stuknij partię, żeby zobaczyć serie"></canvas>
      <p class="muted small body-load">Wczytuję sylwetkę…</p></div>
    <div class="body-lab muted small"><span>Przód</span><span>Tył</span></div>
    <div class="body-leg small muted"><i class="l1"></i>1–3<i class="l2"></i>4–9<i class="l3"></i>10+ serii${d > 7 ? ' na tydzień' : ''}</div>
    <p class="muted small" style="margin:0;text-align:center">Stuknij partię, żeby zobaczyć serie</p></section>`;
}
function musclesNavCard() {
  const n = Object.values(muscleSets(7)).reduce((s, o) => s + o.main, 0);
  return navCard('miesnie', '💪', 'Graf trenowanych partii mięśniowych', n ? `ostatnie 7 dni: ${plural(n, 'seria', 'serie', 'serii')}` : 'serie na każdą partię z ostatnich 7 dni');
}
// Osobny ekran pod zakładką Postęp
function renderMiesnie() {
  const body = $('#miesnie-body');
  body.innerHTML = bodyMapHTML();
  $$('[data-mdays]', body).forEach(b => b.onclick = () => { UI.mDays = +b.dataset.mdays; renderMiesnie(); });
  const cv = $('.body-cv', body), load = $('.body-load', body);
  loadBody(bodySex()).then(B => {
    if (!cv.isConnected) return;
    drawBody(cv, B, muscleSets(), musDays()); load.remove();
    cv.addEventListener('click', e => {
      const r = cv.getBoundingClientRect(), m = bodyHit(B, (e.clientX - r.left) * B.w / r.width, (e.clientY - r.top) * B.h / r.height);
      if (m) showMuscle(m);
    });
  }).catch(() => { load.textContent = 'Nie udało się wczytać sylwetki.'; });
}
function showMuscle(m) {
  const days = musDays(), o = muscleSets(days)[m] || { main: 0, help: 0, items: [] }, name = MUSCLE[m] || m;
  const val = x => x.k === 'main' ? x.n : x.n / 2;
  // słupki: dzień po dniu (7 i 14 dni) albo tydzień po tygodniu (30 dni)
  const step = days > 14 ? 7 : 1, buckets = [];
  for (let end = today(); buckets.length * step < days; end = addDays(end, -step)) {
    const start = addDays(end, -(Math.min(step, days - buckets.length * step) - 1));
    buckets.unshift({ start, end, v: o.items.filter(x => x.w.date >= start && x.w.date <= end).reduce((s, x) => s + val(x), 0) });
  }
  const max = Math.max(1, ...buckets.map(b => b.v)), v = muscleScore(o);
  const lab = b => step === 1 ? parseD(b.end).toLocaleDateString('pl-PL', days > 7 ? { day: 'numeric' } : { weekday: 'short' }).replace('.', '') : dayLabel(b.start, { day: 'numeric', month: 'numeric' });
  openSheet(name, `
    <div class="mus-head"><b class="num">${fmt(v, v % 1 ? 1 : 0)}</b><span>${seriiWord(v)} w ${days} dni</span></div>
    <p class="muted small" style="margin:0">${o.main} jako główna partia${o.help ? `, ${o.help} jako pomocnicza (liczone po ½)` : ''}${days > 7 ? ` · średnio ${fmt(v * 7 / days, 1)} na tydzień` : ''}.</p>
    <div class="mus-bars${buckets.length > 7 ? ' dense' : ''}" style="grid-template-columns:repeat(${buckets.length},1fr)" role="img" aria-label="Serie ${step === 1 ? 'dzień po dniu' : 'tydzień po tygodniu'}">${buckets.map(b => `<div class="mb${b.end === today() ? ' today' : ''}">
      <span class="v num">${b.v ? fmt(b.v, b.v % 1 ? 1 : 0) : ''}</span>
      <span class="bar" style="height:${Math.round(b.v / max * 100)}%"></span>
      <span class="d">${lab(b)}</span></div>`).join('')}</div>
    ${o.items.length ? `<div class="list">${[...o.items].sort((a, b) => b.w.date < a.w.date ? -1 : 1).map(x => `
      <button class="li" type="button" data-w="${x.w.id}">${thumbHTML(EXMAP[x.e.id])}<div class="grow"><div class="t">${esc(exName(EXMAP[x.e.id]))}</div>
        <div class="s">${dayLabel(x.w.date, { weekday: 'long', day: 'numeric', month: 'short' })}${x.k === 'help' ? ' · pomocniczo' : ''}</div></div>
        <div class="r small muted">${plural(x.n, 'seria', 'serie', 'serii')}</div></button>`).join('')}</div>`
      : `<p class="muted" style="margin:0">W ostatnich ${days} dniach nic na tę partię.</p>`}
    <button class="btn block" type="button" data-close>OK</button>`, b => {
    $$('[data-w]', b).forEach(x => x.onclick = () => showWorkout(x.dataset.w));
  });
}

function renderTrening() {
  const body = $('#trening-body');
  const A = S.active;
  if (!A) {
    const hist = [...S.workouts].reverse(), prW = hist.length ? prTimeline().byW : {};
    body.innerHTML = `
      <button class="btn primary block" type="button" id="t-start">Rozpocznij trening</button>
      ${hist.length ? `
        <div class="tiles">
          <div class="tile"><span class="k">Treningi</span><span class="v">${hist.length}</span><span class="d">łącznie</span></div>
          ${(() => { // ostatnie 7 dni (dziś + 6 wcześniejszych), a nie tydzień kalendarzowy
            const from = addDays(today(), -6), n = S.workouts.filter(w => w.date >= from && w.date <= today()).length, t = S.profile.weekly;
            if (!t) return `<div class="tile"><span class="k">Ostatnie 7 dni</span><span class="v">${n}</span><span class="d">${n === 1 ? 'trening' : n >= 2 && n <= 4 ? 'treningi' : 'treningów'}</span></div>`;
            const C = 2 * Math.PI * 26, frac = Math.min(1, n / t);
            return `<div class="tile donut-tile" role="img" aria-label="Treningi w ostatnich 7 dniach: ${n} z ${t}"><span class="k">Ostatnie 7 dni</span>
              <div class="donut${n >= t ? ' done' : ''}"><svg viewBox="0 0 64 64" aria-hidden="true"><circle class="bg" cx="32" cy="32" r="26" fill="none" stroke-width="8"/>
                <circle class="fg" cx="32" cy="32" r="26" fill="none" stroke-width="8" stroke-linecap="round" stroke-dasharray="${frac ? Math.max(0.01, frac * C).toFixed(1) : 0} ${C.toFixed(1)}"/></svg>
                <b>${n}<small>/${t}</small></b></div>
              <span class="d ${n >= t ? 'down' : ''}">${n >= t ? 'plan wykonany ✓' : 'zostało ' + (t - n)}</span></div>`; })()}
          <div class="tile"><span class="k">Ostatni</span><span class="v" style="font-size:17px">${dayLabel(hist[0].date)}</span><span class="d">${(n => n === 0 ? 'dziś' : n === 1 ? 'wczoraj' : n + ' dni temu')(daysBetween(hist[0].date, today()))}</span></div>
        </div>
        <div class="btns"><button class="btn" type="button" id="t-prs">🏆 Rekordy</button><button class="btn" type="button" id="t-badges">🎖️ Odznaki${typeof badgeCount === 'function' ? ` <span class="muted">${badgeCount()}</span>` : ''}</button></div>
        <h3>Historia</h3>
        <div class="list">${hist.map(w => `
          <button class="li" type="button" data-w="${w.id}">
            <div class="grow"><div class="t">${dayLabel(w.date, { weekday: 'long', day: 'numeric', month: 'long' })}${w.planName ? ` <span class="pill">${esc(w.planName)}</span>` : ''}${prW[w.id] ? ` <span class="pill pr" title="Pobite rekordy">🏆 ${prW[w.id].length}</span>` : ''}</div>
            <div class="s">${w.ex.map(e => esc(exName(EXMAP[e.id]))).slice(0, 3).join(', ')}${w.ex.length > 3 ? ` +${w.ex.length - 3}` : ''}</div></div>
            <div class="r small muted">
              ${plural(
                w.ex.reduce((s, e) => s + countSets(e.sets), 0),
                'seria',
                'serie',
                'serii',
              )}
              ${volume(w) ? '<br>' + fmt(volume(w), 0) + ' kg' : ''}
            </div>
          </button>`).join('')}</div>`
      : `<div class="card empty"><strong>Brak treningów</strong><span>Rozpocznij trening, dodaj ćwiczenia z bazy i zapisuj serie: ciężar i powtórzenia. Przy kolejnym treningu zobaczysz, co zrobiłeś ostatnio.</span></div>`}`;
    $('#t-start').onclick = startWorkoutSheet;
    const prb = $('#t-prs', body); if (prb) prb.onclick = showRecords;
    const bdg = $('#t-badges', body); if (bdg) bdg.onclick = () => typeof showBadges === 'function' && showBadges();
    $$('[data-w]', body).forEach(b => {
      b.onclick = () => showWorkout(b.dataset.w);
    });
    return;
  }
  const editing = !!A.editId;
  body.innerHTML = `
    ${editing ? `<section class="card edit-head">
        <div class="row"><b>Edycja zapisanego treningu</b>${A.planName ? `<span class="pill good">Plan: ${esc(A.planName)}</span>` : ''}</div>
        <div class="field"><label for="t-date">Data treningu</label><input type="date" id="t-date" value="${A.date}" max="${today()}"></div>
        <p class="muted small" style="margin:0">Zmień serie, dodaj lub usuń ćwiczenia, potem stuknij „Zapisz trening”.</p>
      </section>`
    : A.planName ? `<div class="row"><span class="pill good">Plan: ${esc(A.planName)}</span><span class="muted small">${dayLabel(A.date, { weekday: 'long', day: 'numeric', month: 'long' })}</span></div>` : ''}
    ${A.ex.length ? `<div class="seg seg-full" role="group" aria-label="Widok ćwiczeń">
        <button type="button" data-view="full" aria-pressed="${!compactView()}">Pełny widok</button>
        <button type="button" data-view="compact" aria-pressed="${compactView()}">Kompaktowy</button>
      </div>` : ''}
    ${A.ex.map((e, ei) => {
      const ex = EXMAP[e.id], prev = lastSetsFor(e.id, A.id);
      if (compactView()) {
        const n = e.sets.filter(filled).length;
        return `<section class="ex-card compact drag-item" data-ei="${ei}">
          <div class="head">${A.ex.length > 1 ? GRIP : ''}${thumbHTML(ex)}
            <button class="grow ex-open" type="button" data-act="open"><div class="t" style="font-weight:650">${esc(exName(ex))}</div>
              <div class="small muted">${n ? `${n}/${e.sets.length} · ${esc(setsSummary(ex, e.sets))}` : `${setsWord(e.sets.length)} · nic nie wpisane`}</div></button>
            <span class="chev" aria-hidden="true">›</span>
            <button class="icon-btn" type="button" data-act="rm" aria-label="Usuń ćwiczenie">✕</button>
          </div>
        </section>`;
      }
      return `<section class="ex-card drag-item" data-ei="${ei}">
        <div class="head">${A.ex.length > 1 ? GRIP : ''}${thumbHTML(ex)}
          <div class="grow"><div class="t" style="font-weight:650">${esc(exName(ex))}</div>
          <div class="small muted">${prev ? `Ostatnio (${dayLabel(prev.date)}): ${setsSummary(ex, prev.sets)}` : 'Pierwszy raz'}</div></div>
          <button class="icon-btn" type="button" data-act="more" aria-label="Opcje ćwiczenia: zamień, co wpisujesz">${MORE_ICON}</button>
          <button class="icon-btn" type="button" data-act="rm" aria-label="Usuń ćwiczenie">✕</button>
        </div>
        ${setsEditorHTML(e, prev)}
      </section>`;
    }).join('')}
    ${A.ex.length ? '' : `<div class="card empty"><strong>${editing ? 'Brak ćwiczeń' : 'Trening trwa'}</strong><span>Dodaj ${editing ? '' : 'pierwsze '}ćwiczenie.</span></div>`}
    <button class="btn block" type="button" id="t-add">+ Dodaj ćwiczenie</button>
    <div class="btns"><button class="btn danger" type="button" id="t-cancel">${editing ? 'Odrzuć zmiany' : 'Odrzuć'}</button><button class="btn primary" type="button" id="t-finish">Zapisz trening</button></div>`;
  const dateInp = $('#t-date', body);
  if (dateInp) dateInp.onchange = () => { if (dateInp.value) { A.date = dateInp.value; save(); } };

  body.oninput = setsInput;
  body.onclick = e => {
    const v = e.target.closest('[data-view]');
    if (v) { setCompactView(v.dataset.view === 'compact'); renderTrening(); return; }
    const b = e.target.closest('[data-act]'); if (!b) return;
    const ei = +b.closest('[data-ei]').dataset.ei;
    if (b.dataset.act === 'open') { exDetail(ei); return; }
    if (b.dataset.act === 'rm') {
      const n = A.ex[ei].sets.filter(filled).length;
      // w kompaktowym widoku serii nie widać, więc przy wpisanych seriach pytamy
      if (compactView() && n) { confirmBox('Usunąć ćwiczenie?', `Wpisane serie (${n}) zostaną usunięte z tego treningu.`, 'Usuń', true).then(ok => { if (ok) { A.ex.splice(ei, 1); save(); renderTrening(); } }); return; }
      A.ex.splice(ei, 1); save(); renderTrening(); return;
    }
    if (setsAction(b, ei)) renderTrening();
  };
  dragSort(body, '.ex-card', (from, to) => { moveItem(A.ex, from, to); save(); renderTrening(); });
  $('#t-add').onclick = () => pickExercise(id => { addExToActive(id); closeSheet(); renderTrening(); toast('Dodano: ' + exName(EXMAP[id])); });
  $('#t-cancel').onclick = async () => {
    const ok = editing
      ? await confirmBox('Odrzucić zmiany?', 'Zapisany trening zostanie taki, jak był przed edycją.', 'Odrzuć zmiany', true)
      : await confirmBox('Odrzucić trening?', 'Wpisane serie z tego treningu zostaną usunięte.', 'Odrzuć', true);
    if (ok) { S.active = null; save(); renderTrening(); }
  };
  $('#t-finish').onclick = finishWorkout;
}
/* ---- edytor serii (wspólny dla pełnego widoku i szczegółów ćwiczenia) ---- */
const MORE_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
const compactView = () => { try { return localStorage.getItem('rozpierdol-kompakt') === '1'; } catch (e) { return false; } };
const setCompactView = on => { try { localStorage.setItem('rozpierdol-kompakt', on ? '1' : '0'); } catch (e) {} };
function setsEditorHTML(e, prev) {
  const ex = EXMAP[e.id], fs = exFields(e.id).map(f => FIELD[f]);
  return `<div class="sets${fs.length > 3 ? ' many' : ''}" style="grid-template-columns:24px ${fs.map(F => F.text ? 'minmax(0, 1.6fr)' : 'minmax(0, 1fr)').join(' ')} 44px">
      <span class="hd">#</span>${fs.map(F => `<span class="hd">${F.h}</span>`).join('')}<span class="hd">✓</span>
      ${(() => { let no = 0; return e.sets.map((s, si) => {
        const ph = prev && prev.sets[Math.min(si, prev.sets.length - 1)];
        // numer serii; dropset (ciąg dalszy poprzedniej) dostaje strzałkę zamiast numeru. Stuknięcie w numer przełącza dropset.
        const drop = si > 0 && s.drop; if (!drop) no++;
        return `${si > 0 ? `<button type="button" class="n n-btn${drop ? ' drop' : ''}" data-act="drop" data-si="${si}" aria-pressed="${!!drop}" aria-label="Seria ${si + 1}: ${drop ? 'dropset, stuknij, żeby zrobić zwykłą serię' : 'stuknij, żeby oznaczyć jako dropset'}">${drop ? '↘' : no}</button>` : `<span class="n">${no}</span>`}
        ${fs.map(F => { const k = fieldKey(ex, F.id), v = s[k], p = ph && hasVal(ph[k]) ? ph[k] : '';
          return F.text
            ? `<input type="text" inputmode="text" autocomplete="off" maxlength="12" data-si="${si}" data-f="${k}" data-text="1" value="${esc(v ?? '')}" placeholder="${esc(p)}" aria-label="${F.l} seria ${si + 1}" class="${s.done ? 'set-done' : ''}">`
            : `<input type="number" inputmode="${F.im}" step="${F.step}" data-si="${si}" data-f="${k}" value="${v ?? ''}" placeholder="${p}" aria-label="${F.l} seria ${si + 1}" class="${s.done ? 'set-done' : ''}">`;
        }).join('')}
        <button class="check" type="button" data-act="done" data-si="${si}" aria-pressed="${!!s.done}" aria-label="Seria ${si + 1} zrobiona">✓</button>`;
      }).join(''); })()}
    </div>
    <div class="row"><span class="set-links"><button class="link" type="button" data-act="add">+ Seria</button>${e.sets.length && !isCardio(ex) ? ' <button class="link" type="button" data-act="adddrop">+ Drop</button>' : ''}</span>${e.sets.length ? '<button class="link" type="button" data-act="pop" style="color:var(--muted)">Usuń ostatnią</button>' : ''}</div>
    ${e.sets.length > 1 && !isCardio(ex) && !e.sets.some(s => s.drop) ? '<p class="muted small" style="margin:0">Dropset: „+ Drop” albo stuknij numer serii.</p>' : ''}`;
}
function setsInput(e) {
  const inp = e.target.closest('input[data-f]'); if (!inp || !S.active) return;
  const ei = +inp.closest('[data-ei]').dataset.ei;
  S.active.ex[ei].sets[+inp.dataset.si][inp.dataset.f] = inp.dataset.text ? (inp.value.trim() || null) : num(inp.value);
  save();
}
// zwraca true, gdy trzeba przerysować
function setsAction(b, ei) {
  const ex = S.active.ex[ei], act = b.dataset.act;
  if (act === 'more') { exMenu(ei); return false; }
  if (act === 'add') { const l = [...ex.sets].reverse().find(s => filled(s) && !s.drop); const n = l ? setVals(l) : { a: null, b: null }; delete n.drop; ex.sets.push(Object.assign(n, { done: false })); }
  else if (act === 'adddrop') {
    // dropset: ok. 20% lżej niż ostatnia seria (zaokrąglone do 2,5 kg), powtórzenia do wpisania
    const l = [...ex.sets].reverse().find(filled), kg = l && l.a > 0 ? Math.max(0, Math.round(l.a * 0.8 / 2.5) * 2.5) : null;
    ex.sets.push({ a: kg, b: null, drop: true, done: false });
  }
  else if (act === 'drop') { const s = ex.sets[+b.dataset.si]; if (s.drop) delete s.drop; else s.drop = true; }
  else if (act === 'pop') ex.sets.pop();
  else if (act === 'done') {
    const s = ex.sets[+b.dataset.si];
    if (!s.done) { // uzupełnij puste pola podpowiedzią z poprzedniego treningu
      $$(`input[data-si="${b.dataset.si}"]`, b.closest('[data-ei]')).forEach(i => { if (i.value === '' && i.placeholder !== '') s[i.dataset.f] = i.dataset.text ? i.placeholder : num(i.placeholder); });
    }
    s.done = !s.done;
    if (s.done && navigator.vibrate) navigator.vibrate(10);
    // timer przerwy po zrobionej serii (nie przed dropsetem — tam nie ma przerwy; nie przy edycji starego treningu)
    const next = ex.sets[+b.dataset.si + 1];
    if (s.done && !S.active.editId && !isCardio(EXMAP[ex.id]) && !(next && next.drop) && typeof restStart === 'function') restStart();
  } else return false;
  save(); return true;
}
// Szczegóły ćwiczenia w trwającym/edytowanym treningu: tu w widoku kompaktowym wpisuje się serie
function exDetail(ei) {
  const A = S.active, e = A && A.ex[ei]; if (!e) return;
  const ex = EXMAP[e.id], prev = lastSetsFor(e.id, A.id);
  const redraw = () => { const st = $('#sheet-body').scrollTop; exDetail(ei); $('#sheet-body').scrollTop = st; renderTrening(); };
  openSheet(exName(ex), `
    <div data-ei="${ei}" class="ex-detail">
      <div class="row" style="align-items:flex-start">
        <div class="small muted" style="flex:1">${prev ? `Ostatnio (${dayLabel(prev.date)}): ${setsSummary(ex, prev.sets)}` : 'Pierwszy raz'}</div>
        <button class="icon-btn" type="button" data-act="more" aria-label="Opcje ćwiczenia: zamień, co wpisujesz">${MORE_ICON}</button>
      </div>
      ${setsEditorHTML(e, prev)}
    </div>
    <button class="btn primary block" type="button" data-close>Gotowe</button>`, b => {
    b.addEventListener('input', e2 => { setsInput(e2); renderTrening(); });
    b.addEventListener('click', e2 => {
      const btn = e2.target.closest('[data-act]'); if (!btn) return;
      if (btn.dataset.act === 'more') { exMenu(ei); SHEET_BACK = () => exDetail(ei); return; }
      if (setsAction(btn, ei)) redraw();
    });
  });
}
// Menu ćwiczenia w trwającym treningu: zamiana na inne (serie zostają), pola serii, usunięcie
function exMenu(ei) {
  const A = S.active, e = A && A.ex[ei]; if (!e) return;
  const ex = EXMAP[e.id], n = e.sets.filter(filled).length;
  openSheet(exName(ex), `
    <button class="btn block" type="button" id="em-swap">Zamień na inne ćwiczenie<br><span class="small muted" style="font-weight:400">${n ? `wpisane serie (${n}) przejdą do nowego` : 'liczba serii zostaje'}</span></button>
    <button class="btn block" type="button" id="em-fields">Co wpisujesz w serii<br><span class="small muted" style="font-weight:400">${exFields(e.id).map(f => FIELD[f].h).join(', ')}</span></button>
    <button class="btn danger block" type="button" id="em-rm">Usuń z treningu</button>`, b => {
    $('#em-fields', b).onclick = () => { pickFields(e.id); SHEET_BACK = () => exMenu(ei); };
    $('#em-rm', b).onclick = async () => {
      if (n && !await confirmBox('Usunąć ćwiczenie?', `Wpisane serie (${n}) zostaną usunięte z tego treningu.`, 'Usuń', true)) return;
      A.ex.splice(ei, 1); save(); closeSheet(); renderTrening();
    };
    $('#em-swap', b).onclick = () => pickExercise(newId => {
      if (newId === e.id) { closeSheet(); return; }
      const oldId = e.id, nw = EXMAP[newId];
      // własny wybór pól starego ćwiczenia przechodzi na nowe, jeśli nowe go nie ma (żeby np. tempo i RIR nie zniknęły z widoku)
      if (S.exFields && S.exFields[oldId] && !S.exFields[newId] && isCardio(ex) === isCardio(nw)) S.exFields[newId] = S.exFields[oldId].slice();
      e.id = newId;
      save(); closeSheet(); renderTrening();
      toast(`Zamieniono: ${exName(ex)} → ${exName(nw)}`);
    }, 'Zamień na…', () => exMenu(ei));
  });
}
// Wybór pól serii dla ćwiczenia (zapamiętywany dla tego ćwiczenia na kolejne treningi)
function pickFields(exId) {
  const ex = EXMAP[exId], def = defaultFields(ex);
  let sel = exFields(exId).slice();
  const draw = b => {
    $('#fl-list', b).innerHTML = FIELDS.map(F => {
      const on = sel.includes(F.id), full = !on && sel.length >= FIELDS_MAX;
      return `<label class="share-opt${full ? ' off' : ''}"><input type="checkbox" data-fl="${F.id}" ${on ? 'checked' : ''} ${full ? 'disabled' : ''}>
        <span>${esc(F.l)}${def.includes(F.id) ? ' <span class="muted small">· domyślne</span>' : ''}</span></label>`;
    }).join('');
    $('#fl-count', b).textContent = `Wybrane: ${sel.length} z maks. ${FIELDS_MAX}. Kolejność kolumn jak na liście.`;
  };
  openSheet('Co wpisujesz', `
    <p class="muted small" style="margin:0"><b>${esc(exName(ex))}</b>: zaznacz, co chcesz zapisywać w każdej serii. Wybór zostaje dla tego ćwiczenia w kolejnych treningach. Wcześniej wpisane wartości nie znikają.</p>
    <div class="share-opts" id="fl-list"></div>
    <p class="muted small" id="fl-count" style="margin:0"></p>
    <div class="btns"><button class="btn" type="button" id="fl-def">Domyślne</button><button class="btn primary" type="button" id="fl-save">Zapisz</button></div>`, b => {
    draw(b);
    b.addEventListener('change', e => {
      const c = e.target.closest('[data-fl]'); if (!c) return;
      sel = c.checked ? [...sel, c.dataset.fl] : sel.filter(x => x !== c.dataset.fl);
      sel = FIELDS.map(F => F.id).filter(id => sel.includes(id)); // kolejność jak w katalogu
      draw(b);
    });
    $('#fl-def', b).onclick = () => { sel = def.slice(); draw(b); };
    $('#fl-save', b).onclick = () => {
      if (!sel.length) { toast('Zaznacz przynajmniej jedno pole'); return; }
      S.exFields = S.exFields || {};
      if (sel.join() === def.join()) delete S.exFields[exId]; else S.exFields[exId] = sel;
      save(); closeSheet(); renderTrening(); toast('Zapisano pola dla: ' + exName(ex));
    };
  });
}
function addExToActive(id) {
  const prev = lastSetsFor(id);
  const n = prev ? prev.sets.length : 3;
  S.active.ex.push({ id, sets: Array.from({ length: n }, () => ({ a: null, b: null, done: false })) });
  save();
}
function emptySets(id) {
  const prev = lastSetsFor(id);
  return Array.from({ length: prev ? prev.sets.length : 3 }, () => ({ a: null, b: null, done: false }));
}
async function finishWorkout() {
  const A = S.active;
  // ćwiczenia zostają w treningu nawet bez wpisanych serii (zachowany układ) i z pełną liczbą serii, także pustych
  const ex = A.ex.map(e => ({ id: e.id, sets: e.sets.map(setVals) }));
  if (!ex.length) {
    if (A.editId) { toast('Trening musi mieć co najmniej jedno ćwiczenie. Żeby go skasować, użyj „Usuń trening”.'); return; }
    if (await confirmBox('Pusty trening', 'Nie dodałeś żadnego ćwiczenia. Odrzucić ten trening?', 'Odrzuć', true)) { S.active = null; save(); renderTrening(); }
    return;
  }
  if (A.editId) {
    // edycja: nadpisz zapisany trening (ten sam identyfikator), zachowaj godziny; przy zmianie daty przestaw w historii
    const i = S.workouts.findIndex(x => x.id === A.editId);
    const old = i >= 0 ? S.workouts[i] : {};
    const dateChanged = old.date && old.date !== A.date;
    const start = dateChanged ? parseD(A.date).getTime() + 12 * 36e5 : (old.start || A.start);
    const w = Object.assign({}, old, { id: A.editId, date: A.date, start, end: dateChanged ? start : (old.end || start), ex });
    if (A.planName) { w.planId = A.planId; w.planName = A.planName; }
    if (i >= 0) S.workouts[i] = w; else S.workouts.push(w);
    S.workouts.sort((a, b) => a.start - b.start);
    S.active = null; save(); renderTrening();
    if (!celebratePRs(w.id)) toast('Zapisano zmiany w treningu');
    if (typeof checkBadges === 'function') checkBadges();
    return;
  }
  const w = { id: A.id, date: A.date, start: A.start, end: Date.now(), ex };
  if (A.planName) { w.planId = A.planId; w.planName = A.planName; }
  S.workouts.push(w); S.workouts.sort((a, b) => a.start - b.start);
  S.active = null; save(); renderTrening();
  if (typeof restStop === 'function') restStop();
  if (!celebratePRs(w.id)) toast('Zapisano trening');
  if (typeof checkBadges === 'function') checkBadges();
}
function editWorkout(id) {
  const w = S.workouts.find(x => x.id === id); if (!w) return;
  if (S.active) { toast(S.active.editId ? 'Najpierw zapisz albo odrzuć zmiany w edytowanym treningu.' : 'Najpierw zapisz albo odrzuć trening, który trwa.'); return; }
  // kopia treningu jako „trening w toku” z oznaczeniem edycji; serie oznaczone jako zrobione
  S.active = { id: w.id, editId: w.id, date: w.date, start: w.start, ex: w.ex.map(e => ({ id: e.id, sets: e.sets.length ? e.sets.map(s => Object.assign(setVals(s), { done: filled(s) })) : emptySets(e.id) })) };
  if (w.planName) { S.active.planId = w.planId; S.active.planName = w.planName; }
  save(); closeSheet(); setTab('trening');
}
function showWorkout(id) {
  const w = S.workouts.find(x => x.id === id); if (!w) return;
  const prs = prTimeline().byW[id] || [];
  const prLine = exId => { const l = prs.filter(p => p.id === exId).map(p => PR_KINDS[p.k].s + ' ' + PR_KINDS[p.k].f(p.cur)); return l.length ? `<div class="s pr-line">🏆 Rekord: ${l.join(', ')}</div>` : ''; };
  openSheet(dayLabel(w.date, { weekday: 'long', day: 'numeric', month: 'long' }), `
    <div class="tiles">
      <div class="tile"><span class="k">Ćwiczenia</span><span class="v">${w.ex.length}</span><span class="d">w treningu</span></div>
      <div class="tile"><span class="k">Serie</span><span class="v">${w.ex.reduce((s, e) => s + e.sets.filter(filled).length, 0)}</span><span class="d">łącznie</span></div>
      <div class="tile"><span class="k">Objętość</span><span class="v">${fmt(volume(w), 0)}</span><span class="d">kg × powt.</span></div>
    </div>
    <div class="list">${w.ex.map(e => { const ex = EXMAP[e.id]; return `<div class="li">${thumbHTML(ex)}<div class="grow"><div class="t">${esc(exName(ex))}</div><div class="s num">${setsSummary(ex, e.sets)}</div>${prLine(e.id)}</div></div>`; }).join('')}</div>
    ${w.planName ? `<p class="muted small" style="margin:0">Według planu: <b>${esc(w.planName)}</b></p>` : ''}
    <button class="btn primary block" type="button" id="wd-edit">Edytuj trening</button>
    <div class="btns">
      <button class="btn" type="button" id="wd-plan">Zapisz jako plan</button>
      <button class="btn danger" type="button" id="wd-del">Usuń trening</button>
    </div>`, b => {
    $('#wd-edit', b).onclick = () => editWorkout(id);
    $('#wd-plan', b).onclick = () => editPlan(null, { id: 'p_' + uid(), name: w.planName ? w.planName + ' (kopia)' : '', ex: w.ex.map(e => ({ id: e.id, sets: e.sets.length || emptySets(e.id).length })) });
    $('#wd-del', b).onclick = async () => {
      if (await confirmBox('Usunąć trening?', 'Tego nie da się cofnąć.', 'Usuń', true)) { S.workouts = S.workouts.filter(x => x.id !== id); save(); renderTrening(); toast('Usunięto trening'); }
    };
  });
}

/* ============ ĆWICZENIA ============ */
// Skróty i potoczne nazwy z siłowni, po których też da się znaleźć ćwiczenie
const ALIASES = {
  Standing_Military_Press: 'ohp overhead press wyciskanie nad glowe stojac military',
  Barbell_Shoulder_Press: 'ohp overhead press military barki sztanga',
  Seated_Barbell_Military_Press: 'ohp siedzac wyciskanie zolnierskie siedzac',
  Dumbbell_Shoulder_Press: 'db ohp hantle nad glowe barki',
  Arnold_Dumbbell_Press: 'arnold arnoldki wyciskanie arnolda',
  'Barbell_Bench_Press_-_Medium_Grip': 'bench bp klata lawka plaska wyciskanie lezac',
  'Barbell_Incline_Bench_Press_-_Medium_Grip': 'incline skos klata skosna',
  Dumbbell_Bench_Press: 'db bench hantle klata',
  Barbell_Squat: 'squat przysiad back squat',
  Front_Barbell_Squat: 'front squat przysiad przedni',
  Goblet_Squat: 'goblet',
  Split_Squat_with_Dumbbells: 'bulgar bulgarian split squat przysiad bulgarski',
  Barbell_Deadlift: 'dl deadlift mc martwy',
  Romanian_Deadlift: 'rdl rumun martwy rumunski',
  Sumo_Deadlift: 'sumo mc sumo',
  Bent_Over_Barbell_Row: 'row wioslo wioslowanie',
  Seated_Cable_Rows: 'row wyciag wioslowanie siedzac',
  Pullups: 'pull up pullup drazek podciaganie',
  'Chin-Up': 'chin up chinup podchwyt drazek',
  'Wide-Grip_Lat_Pulldown': 'lat pulldown sciaganie drazka wyciag gorny',
  Barbell_Hip_Thrust: 'hip thrust hipthrust posladki',
  Side_Lateral_Raise: 'lateral wznosy bokiem boczne barki',
  Machine_Lateral_Raise: 'lateral maszyna wznosy bokiem boczne barki machine',
  Cable_Seated_Lateral_Raise: 'lateral wyciag wznosy bokiem boczne barki',
  Seated_Side_Lateral_Raise: 'lateral wznosy siedzac',
  Face_Pull: 'facepull face pull',
  Machine_Row: 'row wioslowanie maszyna rear delt machine row seated row plecy podparcie',
  Machine_Rear_Delt_Row: 'rear delt row tyl barkow maszyna wioslowanie szeroko machine',
  Leverage_Iso_Row: 'row wioslowanie maszyna iso row hammer talerze',
  Leverage_High_Row: 'row high row wioslowanie z gory maszyna',
  'Cable_Rope_Rear-Delt_Rows': 'rear delt row tyl barkow lina wyciag',
  Reverse_Machine_Flyes:'reverse fly rear delt tyl barkow odwrotne rozpietki maszyna oburacz pec deck butterfly odwrotny',
  Reverse_Machine_Flyes_One_Arm: 'reverse fly rear delt tyl barkow odwrotne rozpietki maszyna jednoracz jedna reka pec deck',
  Reverse_Flyes: 'reverse fly rear delt tyl barkow hantle',
  Cable_Rear_Delt_Fly: 'reverse fly rear delt tyl barkow wyciag',
  Leg_Press: 'suwnica leg press wypychanie',
  Lying_Leg_Curls: 'leg curl uginanie nog dwuglowe',
  Leg_Extensions: 'prostowanie nog wyprosty czworoglowe',
  Standing_Calf_Raises: 'lydki calf wspiecia',
  Triceps_Pushdown: 'pushdown triceps wyciag prostowanie',
  Barbell_Curl: 'biceps curl uginanie sztanga',
  Hammer_Curls: 'mlotki hammer',
  'Dips_-_Chest_Version': 'dipy dips porecze',
  Pushups: 'pompki push up pushup',
  Plank: 'plank deska',
  Hanging_Leg_Raise: 'wznosy nog w zwisie brzuch',
};
// Porównujemy bez wielkości liter i polskich znaków („zolnierskie” = „żołnierskie”)
const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
function exFiltered(F) {
  const g = GROUPS.find(x => x.id === F.g) || GROUPS[0];
  const t = groupTest(g);
  const q = fold(F.q.trim());
  const hit = e => fold(e.pl).includes(q) || fold(e.n).includes(q) || fold(ALIASES[e.id]).includes(q);
  const list = exSorted().filter(e => (!F.fav || isFav(e.id)) && t(e) && (!F.eq || e.e === F.eq) && (!q || hit(e)));
  if (!q) return list;
  // przy wyszukiwaniu: najpierw trafienia po skrócie (np. „ohp”, „bench”), potem od początku nazwy, potem reszta
  const rank = e => fold(ALIASES[e.id]).split(' ').some(w => w.startsWith(q)) ? 0 : (fold(e.pl).startsWith(q) || fold(e.n).startsWith(q)) ? 1 : 2;
  return list.map((e, i) => [rank(e), i, e]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(x => x[2]);
}
function starBtn(id) {
  const on = isFav(id);
  return `<button class="star" type="button" data-fav="${esc(id)}" aria-pressed="${on}" aria-label="${on ? 'Usuń z ulubionych' : 'Dodaj do ulubionych'}">${on ? '★' : '☆'}</button>`;
}
function exListHTML(items, F) {
  if (EX_STATE === 'loading' && !items.length) return '<div class="card empty"><span>Wczytuję bazę ćwiczeń…</span></div>';
  if (EX_STATE === 'error' && !items.length) return `<div class="card empty"><strong>Nie udało się wczytać bazy ćwiczeń</strong><span>Powód: ${esc(EX_ERR)}.</span><button class="btn primary" type="button" data-retry>Spróbuj ponownie</button></div>`;
  if (!items.length && F.fav && !F.q.trim()) {
    return S.fav.length
      ? `<div class="card empty"><strong>Brak ulubionych w tej kategorii</strong><span>Wybierz inną kategorię albo wyłącz filtr ★, żeby dodać ćwiczenia z całej bazy.</span><button class="btn" type="button" data-favoff>Pokaż całą bazę</button></div>`
      : `<div class="card empty"><strong>Nie masz jeszcze ulubionych</strong><span>Stuknij gwiazdkę ☆ przy ćwiczeniu, żeby mieć je zawsze pod ręką.</span><button class="btn" type="button" data-favoff>Przeglądaj bazę</button></div>`;
  }
  if (!items.length) return '<div class="card empty"><strong>Nic nie znalazłem</strong><span>Spróbuj innej nazwy, także po angielsku (np. „curl”, „squat”), albo dodaj własne ćwiczenie.</span></div>';
  return `<div class="list">${items.slice(0, F.lim).map(e => `
    <div class="li li-row">
      <button class="li-main" type="button" data-ex="${esc(e.id)}">${thumbHTML(e)}
        <div class="grow"><div class="t">${esc(exName(e))}</div>
        <div class="s">${[...(e.m || []).map(m => MUSCLE[m] || m), EQUIP[e.e] || ''].filter(Boolean).join(' · ')}${e.pl ? ` · <i>${esc(e.n)}</i>` : ''}</div></div>
      </button>
      ${starBtn(e.id)}
    </div>`).join('')}</div>
    ${items.length > F.lim ? `<button class="btn block" type="button" data-more>Pokaż więcej (${items.length - F.lim})</button>` : ''}`;
}
function countLabel(n, F) { return exCount(n) + (F.fav ? ' w ulubionych' : ''); }
function listShellHTML(F, idp) {
  const items = exFiltered(F);
  return `<input type="search" id="${idp}-q" placeholder="Szukaj ćwiczenia…" value="${esc(F.q)}" autocomplete="off" aria-label="Szukaj ćwiczenia">
    <div class="chips" role="group" aria-label="Filtry">
      <span class="chips-sticky"><button class="chip chip-fav" type="button" data-favonly aria-pressed="${F.fav}">★ Ulubione${S.fav.length ? ` <span class="chip-n">${S.fav.length}</span>` : ''}</button><span class="chip-sep" aria-hidden="true"></span></span>
      ${GROUPS.map(g => `<button class="chip" type="button" data-g="${g.id}" aria-pressed="${g.id === F.g}">${g.label}</button>`).join('')}
    </div>
    <div class="chips chips-eq" role="group" aria-label="Sprzęt">
      <span class="chips-label">Sprzęt</span>
      <button class="chip chip-eq" type="button" data-eq="" aria-pressed="${!F.eq}">Dowolny</button>
      ${EQUIP_ORDER.filter(k => EX.some(e => e.e === k) || (S.custom || []).some(c => c.e === k)).map(k => `<button class="chip chip-eq" type="button" data-eq="${esc(k)}" aria-pressed="${F.eq === k}">${EQUIP[k] || k}</button>`).join('')}
    </div>
    <div class="muted small" id="${idp}-count">${countLabel(items.length, F)}</div>
    <div id="${idp}-list">${exListHTML(items, F)}</div>`;
}
function renderCw() {
  // świeży element przy każdym rysowaniu — inaczej obsługa kliknięć dokładałaby się przy każdym wejściu
  // do zakładki i np. gwiazdka przełączałaby ulubione kilka razy na jedno stuknięcie
  const old = $('#cw-body'), body = old.cloneNode(false);
  old.replaceWith(body);
  body.innerHTML = listShellHTML(UI.cw, 'cw');
  wireList(body, 'cw', UI.cw, id => showExercise(id));
}
function wireList(root, idp, F, onPick) {
  const refresh = () => {
    const items = exFiltered(F);
    $(`#${idp}-list`, root).innerHTML = exListHTML(items, F);
    $(`#${idp}-count`, root).textContent = countLabel(items.length, F);
    $$('[data-g]', root).forEach(c => c.setAttribute('aria-pressed', c.dataset.g === F.g));
    $$('[data-eq]', root).forEach(c => c.setAttribute('aria-pressed', c.dataset.eq === (F.eq || '')));
    const fc = $('[data-favonly]', root);
    fc.setAttribute('aria-pressed', F.fav);
    fc.innerHTML = `★ Ulubione${S.fav.length ? ` <span class="chip-n">${S.fav.length}</span>` : ''}`;
  };
  $(`#${idp}-q`, root).addEventListener('input', e => { F.q = e.target.value; F.lim = 60; refresh(); });
  root.addEventListener('click', e => {
    if (e.target.closest('[data-favonly]')) {
      F.fav = !F.fav; F.lim = 60;
      if (F.fav && F.g === 'pop') F.g = 'all';
      refresh(); return;
    }
    if (e.target.closest('[data-favoff]')) { F.fav = false; F.g = 'pop'; F.lim = 60; refresh(); return; }
    const chip = e.target.closest('[data-g]');
    if (chip) { F.g = chip.dataset.g; F.lim = 60; refresh(); return; }
    const eq = e.target.closest('[data-eq]');
    if (eq) { F.eq = eq.dataset.eq; F.lim = 60; refresh(); return; }
    const fav = e.target.closest('[data-fav]');
    if (fav) {
      const on = toggleFav(fav.dataset.fav);
      if (F.fav) refresh();
      else { fav.outerHTML = starBtn(fav.dataset.fav); const fc = $('[data-favonly]', root); fc.innerHTML = `★ Ulubione${S.fav.length ? ` <span class="chip-n">${S.fav.length}</span>` : ''}`; }
      toast(on ? 'Dodano do ulubionych' : 'Usunięto z ulubionych');
      return;
    }
    if (e.target.closest('[data-retry]')) { closeSheet(); loadExercises(); renderCw(); return; }
    if (e.target.closest('[data-more]')) { F.lim += 100; refresh(); return; }
    const ex = e.target.closest('[data-ex]'); if (ex) onPick(ex.dataset.ex);
  });
}
function pickExercise(onPick, title = 'Dodaj ćwiczenie', onBack = null) {
  const P = newFilter();
  openSheet(title, listShellHTML(P, 'pk'), b => {
    wireList(b, 'pk', P, id => onPick(id));
  });
  SHEET_BACK = onBack;
}

/* ============ POMIARY CIAŁA ============ */
// d = data, v = { klucz: wartość }; obwody w cm, tkanka tłuszczowa w %
// s = krótka nazwa do historii; legacy = dawny wspólny pomiar ramienia (zostaje dla starych wpisów)
const MEAS = [
  { k: 'neck', l: 'Szyja' }, { k: 'shoulders', l: 'Barki' }, { k: 'chest', l: 'Klatka' },
  { k: 'armL', l: 'Biceps lewy', s: 'Biceps L' }, { k: 'armR', l: 'Biceps prawy', s: 'Biceps P' },
  { k: 'waist', l: 'Talia', less: true }, { k: 'belly', l: 'Brzuch (pępek)', s: 'Brzuch', less: true }, { k: 'hips', l: 'Biodra', less: true },
  { k: 'thigh', l: 'Udo' }, { k: 'calf', l: 'Łydka' }, { k: 'fat', l: 'Tkanka tłuszczowa', s: 'Tłuszcz', u: '%', less: true },
  { k: 'arm', l: 'Ramię (dawny pomiar)', s: 'Ramię', legacy: true },
];
const measUnit = m => m.u || 'cm';
const measShort = m => m.s || m.l;
// Co mierzy ta osoba (S.measCfg, zapisywane w chmurze). Domyślnie wszystko poza dawnym pomiarem ramienia.
function measActive() {
  const cfg = Array.isArray(S.measCfg) && S.measCfg.length ? S.measCfg : MEAS.filter(m => !m.legacy).map(m => m.k);
  return MEAS.filter(m => cfg.includes(m.k));
}
const measHasData = k => S.measures.some(x => x.v && x.v[k] != null);
function pickMeasures() {
  const active = measActive().map(m => m.k);
  const options = MEAS.filter(m => !m.legacy || measHasData(m.k));
  openSheet('Co chcesz mierzyć?', `
    <p class="muted small" style="margin:0">Zaznaczone pomiary pojawią się w formularzu, kafelkach i na wykresie. Odznaczenie niczego nie kasuje — stare wpisy zostają w historii.</p>
    <div class="share-opts">${options.map(m => `<label class="share-opt"><input type="checkbox" data-pick="${m.k}" ${active.includes(m.k) ? 'checked' : ''}><span>${m.l} <span class="muted small">(${measUnit(m)})</span></span></label>`).join('')}</div>
    <button class="btn primary block" type="button" id="pick-ok">Zapisz wybór</button>`, b => {
    $('#pick-ok', b).onclick = () => {
      const keys = $$('[data-pick]', b).filter(i => i.checked).map(i => i.dataset.pick);
      if (!keys.length) { toast('Zaznacz przynajmniej jeden pomiar'); return; }
      S.measCfg = keys; save(); closeSheet(); renderCialo(); toast('Zapisano wybór pomiarów');
    };
  });
}
function sortMeasures() { S.measures.sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : 0); }
const measSeries = k => S.measures.filter(x => x.v && x.v[k] != null).map(x => ({ d: x.d, w: x.v[k] }));
function lastMeas(k, beforeDate) {
  for (let i = S.measures.length - 1; i >= 0; i--) { const x = S.measures[i]; if ((!beforeDate || x.d < beforeDate) && x.v && x.v[k] != null) return x.v[k]; }
  return null;
}
function measFormHTML(date, vals, idp) {
  return `<div class="field"><label for="${idp}-date">Data</label><input type="date" id="${idp}-date" value="${date}" max="${today()}"></div>
    <div class="meas-grid">${MEAS.filter(m => measActive().includes(m) || (vals && vals[m.k] != null)).map(m => {
      const ph = lastMeas(m.k, date);
      return `<div class="field"><label for="${idp}-${m.k}">${m.l} (${measUnit(m)})</label>
        <input type="number" inputmode="decimal" step="0.1" min="0" id="${idp}-${m.k}" data-mk="${m.k}" value="${vals && vals[m.k] != null ? vals[m.k] : ''}" placeholder="${ph != null ? ph : ''}"></div>`;
    }).join('')}</div>`;
}
function readMeasForm(root, idp) {
  const v = {};
  $$('[data-mk]', root).forEach(i => { const n = num(i.value); if (n != null && n > 0 && n < 400) v[i.dataset.mk] = Math.round(n * 10) / 10; });
  return { d: ($(`#${idp}-date`, root).value || today()), v };
}
function saveMeasure(entry, replaceDate) {
  if (replaceDate && replaceDate !== entry.d) S.measures = S.measures.filter(x => x.d !== replaceDate);
  const i = S.measures.findIndex(x => x.d === entry.d);
  if (i >= 0) S.measures[i] = entry; else S.measures.push(entry);
  sortMeasures(); save();
}
// Karta: % tkanki tłuszczowej policzony z obwodów (US Navy)
function navyCardHTML() {
  const p = S.profile, ser = navySeries();
  const need = p.sex === 'f' ? 'szyję, talię i biodra' : 'szyję i brzuch (na wysokości pępka)';
  if (!p.height || !p.sex) return `<section class="card"><h2>Tkanka tłuszczowa z obwodów</h2>
    <p class="muted small" style="margin:0">Podaj w Ustawieniach wzrost i płeć, a policzę % tkanki tłuszczowej z obwodów (wzór US Navy).</p>
    <button class="btn" type="button" data-go="wiecej:profil">Uzupełnij profil</button></section>`;
  if (!ser.length) return `<section class="card"><h2>Tkanka tłuszczowa z obwodów</h2>
    <p class="muted small" style="margin:0">Zmierz ${need}, a policzę % tkanki tłuszczowej (wzór US Navy). Zaznacz te pomiary przez „Wybierz pomiary”.</p></section>`;
  const cur = ser[ser.length - 1], diff = ser.length > 1 ? cur.w - ser[0].w : null;
  return `<section class="card chart">
    <div class="row"><h2>Tkanka tłuszczowa z obwodów</h2><span class="muted small">${dayLabel(cur.d)}</span></div>
    <div class="row" style="align-items:flex-end"><span class="navy-v">${fmt(cur.w, 1)}<small class="muted" style="font-size:16px"> %</small></span>
      ${diff != null ? `<span class="small ${diff < 0 ? 'down' : diff > 0 ? 'up' : 'muted'}">${fmtSigned(diff, 1)} pkt proc. od ${dayLabel(ser[0].d)}</span>` : ''}</div>
    ${ser.length > 1 ? chartSVG(ser, 0) : ''}
    <p class="muted small" style="margin:0">Szacunek z ${need}, wzrostu i płci. Błąd to zwykle ±3–4 pkt proc., ale trend w czasie jest wiarygodny, gdy mierzysz zawsze tak samo.</p>
  </section>`;
}
function renderCialo() {
  const body = $('#cialo-body');
  const list = [...S.measures].reverse();
  const first = S.measures[0], last = S.measures[S.measures.length - 1];
  const act = measActive();
  const shown = act.filter(m => lastMeas(m.k) != null);
  if (!UI.measK || !shown.some(m => m.k === UI.measK)) UI.measK = (shown[0] || act[0] || MEAS[0]).k;
  const curM = MEAS.find(m => m.k === UI.measK);
  const tiles = last ? shown.map(m => {
    const now = lastMeas(m.k), start = (S.measures.find(x => x.v && x.v[m.k] != null) || {}).v[m.k];
    const diff = now - start, good = diff === 0 ? '' : (m.less ? (diff < 0 ? 'down' : 'up') : '');
    return `<button class="tile meas-tile" type="button" data-mk-pick="${m.k}" aria-pressed="${m.k === UI.measK}">
      <span class="k">${m.l}</span><span class="v">${fmt(now, 1)}<small> ${measUnit(m)}</small></span>
      <span class="d ${good}">${diff ? fmtSigned(diff, 1) + ' od startu' : 'start'}</span></button>`;
  }).join('') : '';
  body.innerHTML = `
    ${last && shown.length ? `
      <section class="view" style="gap:10px">
        <div class="row"><h3>Ostatni pomiar</h3><span class="muted small">${dayLabel(last.d, { day: 'numeric', month: 'long', year: 'numeric' })}${first !== last ? ' · start ' + dayLabel(first.d) : ''}</span></div>
        <div class="tiles meas-tiles">${tiles}</div>
      </section>
      <section class="card chart">
        <div class="row"><h2>${curM.l}</h2><span class="muted small">${measUnit(curM)}</span></div>
        ${chartSVG(measSeries(curM.k), 0)}
        <p class="muted small" style="margin:0">Stuknij kafelek wyżej, żeby zobaczyć wykres innego pomiaru.</p>
      </section>
      ${navyCardHTML()}` : `
      <div class="card empty"><strong>${last ? 'Brak danych dla wybranych pomiarów' : 'Zacznij mierzyć obwody'}</strong><span>Mierz się co 1–2 tygodnie, rano, w tym samym miejscu ciała. Talia i biodra często pokazują postęp, gdy waga stoi w miejscu.</span></div>`}
    <form class="card" id="meas-form" autocomplete="off">
      <div class="row"><h2>Nowy pomiar</h2><button class="link" type="button" id="meas-pick">Wybierz pomiary</button></div>
      ${measFormHTML(today(), null, 'mf')}
      <p class="muted small" style="margin:0">Wypełnij tylko to, co zmierzyłeś. Szare liczby to poprzedni pomiar.</p>
      <button class="btn primary" type="submit">Zapisz pomiar</button>
    </form>
    ${list.length ? `<section class="view" style="gap:10px">
      <div class="row"><h3>Historia</h3><span class="muted small">${plural2(list.length, 'pomiar', 'pomiary', 'pomiarów')}</span></div>
      <div class="list">${list.map(x => `
        <button class="li" type="button" data-md="${x.d}">
          <div class="grow"><div class="t">${dayLabel(x.d, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}</div>
          <div class="s">${MEAS.filter(m => x.v[m.k] != null).map(m => `${measShort(m)} ${fmt(x.v[m.k], 1)}`).join(' · ')}</div></div>
          <span class="chev" aria-hidden="true">›</span>
        </button>`).join('')}</div>
    </section>` : ''}`;
  $$('[data-mk-pick]', body).forEach(b => b.onclick = () => { UI.measK = b.dataset.mkPick; renderCialo(); });
  $$('[data-md]', body).forEach(b => b.onclick = () => editMeasure(b.dataset.md));
  $('#meas-pick', body).onclick = pickMeasures;
  $('#meas-form', body).addEventListener('submit', e => {
    e.preventDefault();
    const entry = readMeasForm(body, 'mf');
    if (!Object.keys(entry.v).length) { toast('Wpisz przynajmniej jeden pomiar'); return; }
    const existed = S.measures.find(x => x.d === entry.d);
    if (existed) entry.v = Object.assign({}, existed.v, entry.v); // ten sam dzień — dopisz do istniejącego
    saveMeasure(entry); toast('Zapisano pomiar'); renderCialo();
  });
}
function editMeasure(d) {
  const x = S.measures.find(m => m.d === d); if (!x) return;
  openSheet('Pomiar z ' + dayLabel(d, { day: 'numeric', month: 'long', year: 'numeric' }), `
    ${measFormHTML(d, x.v, 'me')}
    <div class="btns"><button class="btn danger" type="button" id="me-del">Usuń pomiar</button><button class="btn primary" type="button" id="me-ok">Zapisz</button></div>`, b => {
    $('#me-ok', b).onclick = () => {
      const entry = readMeasForm(b, 'me');
      if (!Object.keys(entry.v).length) { toast('Wpisz przynajmniej jeden pomiar albo usuń cały wpis'); return; }
      saveMeasure(entry, d); closeSheet(); renderCialo(); toast('Zapisano zmiany');
    };
    $('#me-del', b).onclick = async () => {
      if (await confirmBox('Usunąć pomiar?', 'Wszystkie obwody z tego dnia znikną.', 'Usuń', true)) { S.measures = S.measures.filter(m => m.d !== d); save(); renderCialo(); toast('Usunięto pomiar'); }
    };
  });
}
const plural2 = (n, one, few, many) => n + ' ' + (n === 1 ? one : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) ? few : many);

/* ============ PLANY TRENINGOWE ============ */
function renderPlany() {
  const body = $('#plany-body');
  body.innerHTML = navCard('cwiczenia', '🏋️', 'Baza ćwiczeń', `${EX.length} ćwiczeń${S.fav.length ? ` · ${plural(S.fav.length, 'ulubione', 'ulubione', 'ulubionych')}` : ''}${S.custom.length ? ` · ${plural(S.custom.length, 'własne', 'własne', 'własnych')}` : ''}`) + (S.plans.length ? `
    <div class="list">${S.plans.map(p => `
      <button class="li" type="button" data-plan="${p.id}">
        <div class="grow"><div class="t">${esc(p.name)}</div>
        <div class="s">${planSummary(p)}</div></div>
        <span class="chev" aria-hidden="true">›</span>
      </button>`).join('')}</div>
    <p class="muted small" style="margin:0">Stuknij plan, żeby go edytować. Plan wybierasz w zakładce Trening przy „Rozpocznij trening”.</p>`
    : `<div class="card empty"><strong>Nie masz jeszcze planów</strong><span>Ułóż plan, np. „Push”, „Nogi” albo „FBW A”. Na starcie treningu wybierzesz go, a ćwiczenia i liczba serii same się wpiszą.</span><button class="btn primary" type="button" id="plan-new2">Ułóż pierwszy plan</button></div>`);
  const n2 = $('#plan-new2', body); if (n2) n2.onclick = () => editPlan(null);
  $$('[data-plan]', body).forEach(b => b.onclick = () => editPlan(b.dataset.plan));
}
$('#plan-new').addEventListener('click', () => editPlan(null));
const setsWord = n => n + (n === 1 ? ' seria' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) ? ' serie' : ' serii');
function planSummary(p) {
  const names = p.ex.map(e => exName(EXMAP[e.id]));
  const sets = p.ex.reduce((s, e) => s + (e.sets || 0), 0);
  return `${exCount(p.ex.length)} · ${setsWord(sets)}${names.length ? ' · ' + esc(names.slice(0, 3).join(', ')) + (names.length > 3 ? '…' : '') : ''}`;
}
function startWorkout(plan) {
  S.active = { id: uid(), date: today(), start: Date.now(), ex: [] };
  if (plan) {
    S.active.planId = plan.id; S.active.planName = plan.name;
    S.active.ex = plan.ex.filter(e => EXMAP[e.id]).map(e => ({ id: e.id, sets: Array.from({ length: Math.max(1, e.sets || 3) }, () => ({ a: null, b: null, done: false })) }));
  }
  save(); closeSheet(); setTab('trening');
}
function startWorkoutSheet() {
  openSheet('Nowy trening', `
    ${S.plans.length ? `<h3>Z planu</h3>
      <div class="list">${S.plans.map(p => `
        <button class="li" type="button" data-start="${p.id}">
          <div class="grow"><div class="t">${esc(p.name)}</div><div class="s">${planSummary(p)}</div></div>
          <span class="chev" aria-hidden="true">›</span>
        </button>`).join('')}</div>
      <h3>Albo</h3>` : '<p class="muted small" style="margin:0">Nie masz jeszcze planów. Możesz zacząć pusty trening albo najpierw ułożyć plan.</p>'}
    <button class="btn ${S.plans.length ? '' : 'primary'} block" type="button" id="start-empty">Pusty trening<br><span class="small muted" style="font-weight:400">dodajesz ćwiczenia na bieżąco</span></button>
    ${S.plans.length ? '' : '<button class="btn block" type="button" id="start-newplan">Ułóż plan</button>'}`, b => {
    b.addEventListener('click', e => {
      const s = e.target.closest('[data-start]');
      if (s) startWorkout(S.plans.find(p => p.id === s.dataset.start));
    });
    $('#start-empty', b).onclick = () => startWorkout(null);
    const np = $('#start-newplan', b); if (np) np.onclick = () => { setTab('plany'); editPlan(null); };
  });
}
function editPlan(id, draft) {
  const orig = id ? S.plans.find(p => p.id === id) : null;
  const D = draft || (orig ? JSON.parse(JSON.stringify(orig)) : { id: 'p_' + uid(), name: '', ex: [] });
  const isNew = !S.plans.some(p => p.id === D.id);
  openSheet(isNew ? 'Nowy plan' : 'Edytuj plan', `
    <div class="field"><label for="pl-name">Nazwa planu</label><input type="text" id="pl-name" maxlength="40" placeholder="np. Push, Nogi, FBW A" value="${esc(D.name)}"></div>
    ${D.ex.length ? `<div class="list">${D.ex.map((e, i) => {
      const ex = EXMAP[e.id];
      return `<div class="li plan-ex drag-item" data-i="${i}">
        ${D.ex.length > 1 ? GRIP : ''}${thumbHTML(ex)}
        <div class="grow"><div class="t">${esc(exName(ex))}</div>
          <div class="stepper">
            <button class="icon-btn" type="button" data-pa="minus" aria-label="Mniej serii">−</button>
            <span class="num"><b>${e.sets}</b> ${e.sets === 1 ? 'seria' : e.sets < 5 ? 'serie' : 'serii'}</span>
            <button class="icon-btn" type="button" data-pa="plus" aria-label="Więcej serii">+</button>
          </div>
        </div>
        <button class="icon-btn" type="button" data-pa="rm" aria-label="Usuń z planu">✕</button>
      </div>`;
    }).join('')}</div>${D.ex.length > 1 ? '<p class="muted small drag-hint">Przytrzymaj ćwiczenie i przeciągnij, żeby zmienić kolejność.</p>' : ''}` :'<div class="card empty" style="padding:20px 16px"><span>Plan jest pusty. Dodaj ćwiczenia i ustaw, ile serii każdego robisz.</span></div>'}
    <button class="btn block" type="button" id="pl-add">+ Dodaj ćwiczenie</button>
    <div class="btns">
      ${isNew ? '' : '<button class="btn danger" type="button" id="pl-del">Usuń plan</button>'}
      <button class="btn primary" type="button" id="pl-save">Zapisz plan</button>
    </div>
    ${!isNew && !S.active ? '<button class="btn block" type="button" id="pl-start">Zacznij trening z tym planem</button>' : ''}`, b => {
    const keepName = () => { D.name = $('#pl-name', b).value.trim(); };
    b.addEventListener('click', e => {
      const btn = e.target.closest('[data-pa]'); if (!btn) return;
      keepName();
      const i = +btn.closest('[data-i]').dataset.i, act = btn.dataset.pa;
      if (act === 'minus') D.ex[i].sets = Math.max(1, D.ex[i].sets - 1);
      if (act === 'plus') D.ex[i].sets = Math.min(20, D.ex[i].sets + 1);
      if (act === 'rm') D.ex.splice(i, 1);
      const st = $('#sheet-body').scrollTop;
      editPlan(null, D); $('#sheet-body').scrollTop = st;
    });
    dragSort(b, '.plan-ex', (from, to) => {
      keepName(); moveItem(D.ex, from, to);
      const st = $('#sheet-body').scrollTop;
      editPlan(null, D); $('#sheet-body').scrollTop = st;
    });
    $('#pl-add', b).onclick = () => {
      keepName();
      pickExercise(exId => {
        const prev = lastSetsFor(exId);
        D.ex.push({ id: exId, sets: prev ? prev.sets.length : 3 });
        editPlan(null, D); toast('Dodano: ' + exName(EXMAP[exId]));
      }, 'Dodaj do planu', () => editPlan(null, D));
    };
    $('#pl-save', b).onclick = () => {
      keepName();
      if (!D.name) { toast('Wpisz nazwę planu'); $('#pl-name', b).focus(); return; }
      if (!D.ex.length) { toast('Dodaj przynajmniej jedno ćwiczenie'); return; }
      const i = S.plans.findIndex(p => p.id === D.id);
      if (i >= 0) S.plans[i] = D; else S.plans.push(D);
      save(); closeSheet(); rerender(); toast('Zapisano plan „' + D.name + '”');
    };
    const del = $('#pl-del', b);
    if (del) del.onclick = async () => {
      if (await confirmBox('Usunąć plan?', `Plan „${esc(D.name)}” zniknie. Zapisane treningi zostaną.`, 'Usuń plan', true)) {
        S.plans = S.plans.filter(p => p.id !== D.id); save(); rerender(); toast('Usunięto plan');
      }
    };
    const stb = $('#pl-start', b);
    if (stb) stb.onclick = () => { keepName(); startWorkout(S.plans.find(p => p.id === D.id)); };
  });
}
function exHistory(id) {
  const out = [];
  S.workouts.forEach(w => w.ex.forEach(e => { if (e.id === id) out.push({ date: w.date, sets: e.sets }); }));
  return out.reverse();
}
function showExercise(id) {
  const e = EXMAP[id]; if (!e) return;
  const hist = exHistory(id);
  const rec = prTimeline().best[id] || {};
  const recHTML = Object.keys(PR_KINDS).filter(k => rec[k]).map(k => `<div class="row"><span>${PR_KINDS[k].l}</span><span style="text-align:right"><b class="num">${PR_KINDS[k].f(rec[k])}</b> <span class="muted small">${dayLabel(rec[k].date)}</span></span></div>`).join('');
  openSheet(exName(e), `
    ${e.img && e.img.length ? `<div class="ex-anim">${e.img.slice(0, 2).map((p, i) => `<img src="${IMG + p}" alt="${i ? 'Pozycja końcowa' : 'Pozycja początkowa'}" crossorigin="anonymous">`).join('')}</div>` : ''}
    ${e.pl ? `<div class="muted small">${esc(e.n)}</div>` : ''}
    <div class="tags">
      ${(e.m || []).map(m => `<span class="pill good">${MUSCLE[m] || m}</span>`).join('')}
      ${(e.s || []).map(m => `<span class="pill">${MUSCLE[m] || m}</span>`).join('')}
      ${e.e ? `<span class="pill">${EQUIP[e.e] || e.e}</span>` : ''}
      ${e.l ? `<span class="pill">${LEVEL[e.l] || e.l}</span>` : ''}
    </div>
    <div class="btns">
      <button class="btn" type="button" id="ex-fav" aria-pressed="${isFav(id)}">${isFav(id) ? '★ W ulubionych' : '☆ Dodaj do ulubionych'}</button>
      ${S.active ? `<button class="btn primary" type="button" id="ex-add">Dodaj do treningu</button>` : ''}
    </div>
    ${recHTML ? `<div class="card"><h3>🏆 Rekordy osobiste</h3>${recHTML}</div>` : ''}
    ${typeof exProgressHTML === 'function' ? exProgressHTML(id) : ''}
    ${hist.length ? `<div class="card"><h3>Twoja historia</h3>
      ${hist.slice(0, 5).map(h => `<div class="row small"><span class="muted">${dayLabel(h.date)}</span><span class="num">${setsSummary(e, h.sets)}</span></div>`).join('')}</div>` : ''}
    ${e.ins && e.ins.length ? `<div class="card"><h3>Jak wykonać${e.insPl ? '' : ' (po angielsku)'}</h3><ol class="steps">${e.ins.map(s => `<li>${esc(s)}</li>`).join('')}</ol></div>` : ''}
    ${e.own ? `<button class="btn danger" type="button" id="ex-del">Usuń własne ćwiczenie</button>` : ''}`, b => {
    $('#ex-fav', b).onclick = ev => {
      const on = toggleFav(id), btn = ev.currentTarget;
      btn.setAttribute('aria-pressed', on); btn.textContent = on ? '★ W ulubionych' : '☆ Dodaj do ulubionych';
      if (UI.tab === 'cwiczenia') renderCw();
    };
    const add = $('#ex-add', b); add && (add.onclick = () => { addExToActive(id); closeSheet(); setTab('trening'); toast('Dodano do treningu'); });
    const pg = $('.exprog', b); if (pg && typeof wireExProgress === 'function') wireExProgress(pg);
    const del = $('#ex-del', b); del && (del.onclick = () => { S.custom = S.custom.filter(c => c.id !== id); save(); rebuildExMap(); closeSheet(); renderCw(); });
  });
}
$('#btn-custom').addEventListener('click', () => {
  openSheet('Własne ćwiczenie', `
    <div class="field"><label for="c-name">Nazwa</label><input type="text" id="c-name" placeholder="np. Wyciskanie na maszynie Hammer" maxlength="80"></div>
    <div class="field"><label for="c-m">Główna partia</label><select id="c-m">${Object.entries(MUSCLE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
    <div class="field"><label for="c-e">Sprzęt</label><select id="c-e">${EQUIP_ORDER.map(k => `<option value="${k}"${k === 'machine' ? ' selected' : ''}>${EQUIP[k]}</option>`).join('')}</select></div>
    <div class="field"><label for="c-t">Rodzaj</label><select id="c-t"><option value="strength">Siłowe (kg × powtórzenia)</option><option value="cardio">Cardio (minuty / km)</option></select></div>
    <button class="btn primary" type="button" id="c-ok">Dodaj</button>`, b => {
    $('#c-ok', b).onclick = () => {
      const n = $('#c-name', b).value.trim(); if (!n) { toast('Wpisz nazwę ćwiczenia'); return; }
      S.custom = S.custom || [];
      S.custom.push({ id: 'c_' + uid(), n, pl: n, m: [$('#c-m', b).value], c: $('#c-t', b).value, e: $('#c-e', b).value });
      save(); rebuildExMap(); closeSheet(); UI.cw = newFilter(); UI.cw.fav = false; UI.cw.g = 'pop'; renderCw(); toast('Dodano ćwiczenie');
    };
  });
});

/* ============ USTAWIENIA ============ */
async function shareOrDownload(name, blob) {
  const file = new File([blob], name, { type: blob.type });
  try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* Wygląd: kolor akcentu + tryb jasny/ciemny (zapisywane osobno, żeby ustawić je przed pierwszym rysowaniem) */
const THEME_KEY = 'postep-theme';
const ACCENTS = [
  { id: 'ocean', label: 'Ocean', c: '#1f5fd1' },
  { id: 'orange', label: 'Pomarańcz', c: '#d9480f' },
  { id: 'violet', label: 'Fiolet', c: '#6d3fd9' },
  { id: 'teal', label: 'Turkus', c: '#0b7f8a' },
  { id: 'raspberry', label: 'Malina', c: '#c2255c' },
  { id: 'green', label: 'Zieleń', c: '#1d7a52' },
  { id: 'pink', label: 'Różowy szał', c: 'linear-gradient(135deg, #ff1493, #ff9ccf)' },
  { id: 'oliwka', label: 'Oliwka 🌸', c: 'linear-gradient(135deg, #ffc2d4, #d94f80)', only: 'oliwka' },
];
/* Motyw tylko dla jednego konta. W kodzie (publicznym) jest wyłącznie skrót SHA-256 adresu e-mail,
   nie sam adres — apka liczy skrót e-maila zalogowanej osoby i porównuje. */
const OLIWKA_HASH = '2e9efe58a8ebfbc0468a417eb1ae8319921686b01fa2d18dc069923ab4c5dfc0';
let IS_OLIWKA = false;
async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
// Wywoływane przy starcie, po zalogowaniu i po wylogowaniu
// Konto admina (czyta sugestie) — też tylko jako skrót, bez adresu w publicznym kodzie.
// Prawdziwą ochronę daje reguła Firestore; ta flaga tylko pokazuje przycisk.
const ADMIN_HASH = '70e7cfed3d3bccc14147962aa0ab55fc4a21e8395a0b51c549cf486fcbfffa18';
let IS_ADMIN = false;
async function checkSpecialTheme(email) {
  let h = '';
  try { h = !!email && window.crypto && crypto.subtle ? await sha256hex(String(email).trim().toLowerCase()) : ''; } catch (e) {}
  IS_OLIWKA = h === OLIWKA_HASH; IS_ADMIN = h === ADMIN_HASH;
  const th = getTheme();
  if (IS_OLIWKA) {
    let welcomed = false; try { welcomed = localStorage.getItem('oliwka-powitanie') === '1'; } catch (e) {}
    if (!welcomed) {
      try { localStorage.setItem('oliwka-powitanie', '1'); } catch (e) {}
      setTheme({ accent: 'oliwka' });
      setTimeout(() => toast('Cześć Oliwka! Ten motyw jest tylko dla Ciebie 🌸'), 2300);
    }
  } else if (th.accent === 'oliwka') {
    setTheme({ accent: 'ocean' }); // inne konto albo wylogowanie — wracamy do domyślnego
  }
  if (UI.tab === 'wiecej') renderWiecej();
}
const MODES = [['auto', 'Automatyczny'], ['light', 'Jasny'], ['dark', 'Ciemny']];
function getTheme() { try { return Object.assign({ accent: 'ocean', mode: 'auto' }, JSON.parse(localStorage.getItem(THEME_KEY) || '{}')); } catch (e) { return { accent: 'ocean', mode: 'auto' }; } }
function applyTheme(t) {
  const r = document.documentElement;
  r.setAttribute('data-accent', t.accent);
  if (t.mode === 'auto') r.removeAttribute('data-mode'); else r.setAttribute('data-mode', t.mode);
  const bg = getComputedStyle(document.body).backgroundColor;
  $$('meta[name="theme-color"]').forEach(m => { m.setAttribute('content', bg); m.removeAttribute('media'); });
}
function setTheme(patch) {
  const t = Object.assign(getTheme(), patch);
  try { localStorage.setItem(THEME_KEY, JSON.stringify(t)); } catch (e) {}
  applyTheme(t);
}

function renderWiecej() {
  const p = S.profile, th = getTheme();
  const body = $('#wiecej-body');
  body.innerHTML = `
    <section class="card" id="sync-card" data-sec="konto"></section>
    <section class="card" id="share-card" data-sec="share"></section>
    <section class="card" id="lock-card" data-sec="lock"></section>
    <section class="card" data-sec="wyglad">
      <h2>Wygląd</h2>
      <div class="swatches" role="group" aria-label="Kolor apki">
        ${ACCENTS.filter(a => !a.only || (a.only === 'oliwka' && IS_OLIWKA)).map(a => `<button class="swatch" type="button" data-accent="${a.id}" aria-pressed="${th.accent === a.id}"><i style="background:${a.c}"></i><span>${a.label}</span></button>`).join('')}
      </div>
      <div class="seg seg-full" role="group" aria-label="Tryb">
        ${MODES.map(([v, l]) => `<button type="button" data-mode="${v}" aria-pressed="${th.mode === v}">${l}</button>`).join('')}
      </div>
    </section>
    <section class="card" data-sec="dieta">
      <h2>Ekran Postęp</h2>
      <div class="pref-list">${PREFS.map(([k, l, s, ic]) => `<label class="pref-row"><span class="pref-ic" aria-hidden="true">${ic}</span>
        <span class="grow"><span class="pref-l">${l}</span><span class="small muted">${s}</span></span>
        <input type="checkbox" class="switch" role="switch" data-pref="${k}" ${pref(k) ? 'checked' : ''}></label>`).join('')}</div>
    </section>
    <section class="card" data-sec="profil">
      <h2>Profil</h2>
      <p class="muted small" style="margin:0">Wszystkie pola są opcjonalne. Płeć, rok urodzenia i aktywność są potrzebne do kalorii i % tkanki tłuszczowej z obwodów. Te dane nie trafiają do udostępniania.</p>
      <div class="add-weight" style="grid-template-columns:1fr 1fr">
        <div class="field"><label for="p-h">Wzrost (m)</label><input type="number" id="p-h" inputmode="decimal" step="0.01" min="1" max="2.5" value="${p.height ?? ''}" placeholder="1.76"></div>
        <div class="field"><label for="p-born">Rok urodzenia</label><input type="number" id="p-born" inputmode="numeric" step="1" min="1920" max="${new Date().getFullYear() - 10}" value="${p.born ?? ''}" placeholder="1998"></div>
      </div>
      <div class="field"><span class="lbl">Płeć</span>
        <div class="seg seg-full" role="group" aria-label="Płeć">${[['m', 'Mężczyzna'], ['f', 'Kobieta']].map(([v, l]) => `<button type="button" data-sex="${v}" aria-pressed="${p.sex === v}">${l}</button>`).join('')}</div></div>
      <div class="field"><label for="p-act">Aktywność na co dzień</label>
        <select id="p-act"><option value="">— wybierz —</option>${ACTIVITY.map(a => `<option value="${a.k}" ${p.activity === a.k ? 'selected' : ''}>${a.l}</option>`).join('')}</select></div>
      <hr class="sep">
      <div class="field"><span class="lbl">Cel</span>
        <div class="seg seg-full" role="group" aria-label="Cel">${Object.entries(GOALS).map(([v, g]) => `<button type="button" data-goal="${v}" aria-pressed="${goalType() === v}">${g.l}</button>`).join('')}</div></div>
      ${goalType() !== 'keep' ? `<div class="add-weight" style="grid-template-columns:1fr 1fr">
        <div class="field"><label for="p-g">${goalType() === 'bulk' ? 'Ile kg przybrać' : 'Ile kg zrzucić'}</label><input type="number" id="p-g" inputmode="decimal" step="0.1" min="0" value="${p.goalLoss ?? ''}" placeholder="${goalType() === 'bulk' ? '5' : '10'}"></div>
        <div class="field"><label for="p-rate">Tempo (kg/tydz.)</label><select id="p-rate">${(goalType() === 'bulk' ? [0.1, 0.25, 0.5] : [0.25, 0.5, 0.75, 1]).map(v => `<option value="${v}" ${(p.rate || (goalType() === 'bulk' ? 0.25 : 0.5)) === v ? 'selected' : ''}>${fmtN(v)}</option>`).join('')}</select></div>
      </div>` : ''}
      <div class="muted small" id="p-info"></div>
      <hr class="sep">
      <div class="row"><span>Treningi w tygodniu (plan)</span>
        <div class="stepper"><button class="icon-btn" type="button" data-wk="-1" aria-label="Mniej">−</button><b class="num" id="p-wk">${p.weekly || '–'}</b><button class="icon-btn" type="button" data-wk="1" aria-label="Więcej">+</button></div></div>
    </section>
    <section class="card" data-sec="excel">
      <h2>Kopia zapasowa w Excelu</h2>
      <p class="muted small" style="margin:0">Zapisuje wszystko do jednego pliku .xlsx: arkusz <b>DIETA</b> (w układzie jak „DIETA 2026”), <b>TRENINGI</b> (każda seria w osobnym wierszu), <b>PLANY</b>, <b>ULUBIONE</b> i <b>WŁASNE ĆWICZENIA</b>. Plik otworzysz w Excelu, a wczytasz z powrotem przyciskiem obok.</p>
      <div class="btns">
        <button class="btn primary" type="button" id="exp-xlsx">Zapisz kopię</button>
        <label class="btn file-btn">Wczytaj plik<input type="file" id="imp-xlsx" accept=".xlsx,.json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/json"></label>
      </div>
      <p class="muted small" style="margin:0">„Wczytaj plik” przyjmie też twój arkusz z wagą (kolumny DATA i WAGA). Plik czyta tylko telefon, nic nie jest wysyłane.</p>
    </section>
    <section class="card" data-sec="dane">
      <h2>Dane na tym telefonie</h2>
      <div class="row small"><span>Pomiary wagi</span><b class="num">${S.weights.length}</b></div>
      <div class="row small"><span>Treningi</span><b class="num">${S.workouts.length}</b></div>
      <div class="row small"><span>Plany treningowe</span><b class="num">${S.plans.length}</b></div>
      <div class="row small"><span>Pomiary ciała</span><b class="num">${S.measures.length}</b></div>
      <div class="row small"><span>Ulubione ćwiczenia</span><b class="num">${S.fav.length}</b></div>
      <div class="row small"><span>Własne ćwiczenia</span><b class="num">${(S.custom || []).length}</b></div>
      <button class="btn danger" type="button" id="wipe">Usuń wszystkie dane</button>
    </section>
    <section class="card" data-sec="log"></section>
    <section class="card" data-sec="sug" id="sug-box"></section>
    ${IS_ADMIN ? '<section class="card" data-sec="sugadmin" id="sugadmin-box"></section><section class="card" data-sec="admin"></section>' : ''}
    <section class="card rodo" data-sec="rodo">
      <h3>Kto przetwarza dane</h3>
      <p>Apkę prowadzi jej autor, osoba prywatna, na własny i znajomych użytek. Kontakt: przez „Sugestie” w tej karcie.</p>
      <h3>Jakie dane</h3>
      <ul>
        <li><b>Konto:</b> adres e-mail i hasło. Hasło trzyma Google (Firebase Authentication) w postaci zaszyfrowanej. Autor apki go nie zna.</li>
        <li><b>To, co wpisujesz:</b> waga, pomiary ciała, treningi, plany, ulubione i własne ćwiczenia oraz profil: wzrost, płeć, rok urodzenia, aktywność i cel.</li>
        <li><b>Sugestie:</b> treść i twój e-mail, żeby dało się odpisać.</li>
        <li><b>Lista kont:</b> e-mail, data założenia konta, kiedy ostatnio otwarto apkę i ile jest wpisów (sama liczba, bez treści). Autor używa jej do porządków, np. usuwania nieużywanych kont.</li>
      </ul>
      <p>Waga, pomiary ciała i inne dane o zdrowiu są danymi wrażliwymi. Podajesz je dobrowolnie, a wszystkie pola profilu są opcjonalne.</p>
      <h3>Gdzie leżą</h3>
      <ul>
        <li><b>Na telefonie:</b> w pamięci przeglądarki. Bez konta dane nigdzie nie wychodzą.</li>
        <li><b>W chmurze</b> (po zalogowaniu): w bazie Google Firebase (Firestore). Google działa tu jako dostawca usługi.</li>
        <li><b>Apka</b> jest hostowana na GitHub Pages. GitHub, jak każdy serwer, może zapisywać techniczne logi wejść, np. adres IP.</li>
      </ul>
      <h3>Po co</h3>
      <p>Tylko żeby apka działała: zapis, synchronizacja między telefonami i udostępnianie, które sam włączysz. Nie ma reklam, analityki ani śledzenia. Dane nie są sprzedawane ani nikomu przekazywane.</p>
      <h3>Kto ma dostęp</h3>
      <ul>
        <li>Do swoich danych masz dostęp tylko ty. Pilnują tego reguły bezpieczeństwa bazy.</li>
        <li>Osoby, którym coś udostępnisz, widzą tylko zaznaczone rzeczy: plany, ulubione albo wagę. Dostęp zabierasz w każdej chwili.</li>
        <li>Sugestie czyta tylko autor apki.</li>
        <li>Autor, jako właściciel projektu Firebase, ma techniczny dostęp do bazy, ale z niego nie korzysta.</li>
      </ul>
      <h3>Jak długo</h3>
      <p>Dopóki ich nie usuniesz. Usunięcie konta kasuje wszystkie twoje dane w chmurze od razu.</p>
      <h3>Twoje prawa</h3>
      <ul>
        <li><b>Wgląd i kopia:</b> „Zapisz kopię” w karcie Excel.</li>
        <li><b>Poprawianie:</b> edycja wpisów w apce.</li>
        <li><b>Usunięcie:</b> „Usuń konto” w karcie Konto i chmura albo „Usuń wszystkie dane”.</li>
        <li><b>Wycofanie zgody na udostępnianie:</b> usunięcie osoby z listy.</li>
        <li>Pytania i inne żądania: przez „Sugestie”.</li>
      </ul>
    </section>
    <section class="card about" data-sec="about">
      <p class="big-note" style="text-align:left">Cześć! 👋</p>
      <p>Wszystko zaczęło się od zwykłego pliku Excel. Codziennie rano nowy wiersz: data i waga. Obok formuły liczyły BMI, zrzucone kilogramy, procent celu i średnią tygodniową, a w osobnej kolumnie świeciła brutalnie szczera „rodzaj otyłości”. Wzrost i cel miały swoje stałe komórki, żeby żadna formuła się nie zgubiła.</p>
      <p>Działało, ale wpisywanie wagi w Excelu na telefonie o 7 rano to sport ekstremalny. W końcu padło pytanie: „a może by tak zrobić to porządnie?”. Tak powstał Rozpierdol. Zakładki Postęp i Waga wciąż liczą to samo co tamten arkusz, a kopia zapasowa zapisuje się w jego układzie.</p>
      <p>Teraz liczy treningi, rekordy, kalorie i ma motyw tak różowy, że aż boli.</p>
      <p>Robię ją sam, za darmo i bez reklam. Pomysły i błędy wrzucaj do „Sugestii”.</p>
      <p><i>Kurwy niech giną pod ciepłą pierzyną, a zwycięzcy mają czuć chłód zwycięstwa.</i> 💪</p>
      <p>Na co dzień jestem programistą SAP ABAP z 5-letnim stażem komercyjnym, a hobbystycznie klaunem cyrkowym 🤡. Ten projekt robię czysto dla zabawy.</p>
    </section>
    <section class="card" data-sec="priv"><p class="big-note">Używaj jak chcesz, tylko nie wkurwiaj kodera.</p></section>
    <section class="card" data-sec="compl"><div class="xd" aria-label="XD">XD</div></section>
    <p class="muted small settings-foot">Zdjęcia i opisy ćwiczeń: <a href="https://github.com/yuhonas/free-exercise-db" target="_blank" rel="noopener" style="color:inherit">Free Exercise DB</a> (domena publiczna). Sylwetki mięśni: <a href="https://pixabay.com/vectors/anatomical-anatomy-anatomy-chart-6826992/" target="_blank" rel="noopener" style="color:inherit">Pixabay</a>. Zdjęcia są częścią apki: telefon pobiera każde przy pierwszym obejrzeniu, potem działa ono też offline.</p>
    <p class="muted small settings-foot" id="app-version" style="margin:0">Wersja apki: …</p>
    <p class="muted small settings-foot" style="margin:4px 0 0">© 2026${new Date().getFullYear() > 2026 ? '–' + new Date().getFullYear() : ''} Rozpierdol. Wszelkie prawa zastrzeżone.<br>Zrobione z miłością i odrobiną bólu mięśni 💪</p>`;
  // numer wersji = nazwa schowka plików apki (ustawiana przy budowaniu)
  if (window.caches) caches.keys().then(k => {
    const v = k.find(n => /^rozpierdol-(?!img)/.test(n));
    const el = $('#app-version'); if (el) el.textContent = 'Wersja apki: ' + (v ? v.replace('rozpierdol-', '') : 'podgląd (bez pamięci offline)');
  }).catch(() => {});
  if (typeof renderSyncCard === 'function') renderSyncCard($('#sync-card', body)); else $('#sync-card', body).remove();
  if (typeof renderShareCard === 'function') renderShareCard($('#share-card', body)); else $('#share-card', body).remove();
  if (typeof renderLockCard === 'function') renderLockCard($('#lock-card', body)); else $('#lock-card', body).remove();
  // Zawsze aktualny profil (synchronizacja w tle może podmienić obiekt S)
  const P = () => S.profile;
  const info = () => {
    const st = stats(), el = $('#p-info'), g = P().goalLoss; if (!el) return;
    el.textContent = st && g && goalDir() ? `Waga docelowa: ${fmt(st.start + goalDir() * g, 1)} kg (start ${fmt(st.start, 1)} kg)` : '';
  };
  $$('[data-pref]', body).forEach(c => c.onchange = () => { S.prefs = Object.assign({}, S.prefs, { [c.dataset.pref]: c.checked }); save(); toast(c.checked ? 'Włączone' : 'Wyłączone'); });
  const rerenderKeep = () => { const y = window.scrollY; renderWiecej(); window.scrollTo(0, y); };
  $$('[data-sex]', body).forEach(b => b.onclick = () => { P().sex = b.dataset.sex; save(); rerenderKeep(); toast('Zapisano płeć'); });
  $$('[data-goal]', body).forEach(b => b.onclick = () => { P().goalType = b.dataset.goal; save(); rerenderKeep(); toast('Cel: ' + GOALS[b.dataset.goal].l); });
  $$('[data-wk]', body).forEach(b => b.onclick = () => { const p2 = P(); p2.weekly = Math.max(0, Math.min(14, (p2.weekly || 0) + +b.dataset.wk)) || null; save(); $('#p-wk').textContent = p2.weekly || '–'; });
  // Pola liczbowe zapisują się już przy wpisywaniu: na iPhonie zdarzenie „change” nie przychodzi,
  // gdy po wpisaniu stuknie się w inne miejsce zamiast „Gotowe”
  const numField = (sel, read, okMsg) => {
    const el = $(sel, body); if (!el) return;
    el.addEventListener('input', () => { read(el.value); save(true); info(); syncSoonSafe(); });
    el.addEventListener('change', () => { const ok = read(el.value); save(); info(); toast(ok === false ? okMsg[1] : okMsg[0]); });
  };
  const syncSoonSafe = () => { if (typeof syncSoon === 'function') syncSoon(); };
  numField('#p-h', v => { let n = num(v); if (n > 3) n = n / 100; P().height = n; }, ['Zapisano wzrost']);
  numField('#p-born', v => { const n = Math.round(num(v)); const ok = n >= 1920 && n <= new Date().getFullYear() - 10; P().born = ok ? n : null; return ok; }, ['Zapisano rok urodzenia', 'Wpisz rok, np. 1998']);
  numField('#p-g', v => { P().goalLoss = num(v); }, ['Zapisano cel']);
  $('#p-act').addEventListener('change', e => { P().activity = num(e.target.value); save(); toast('Zapisano aktywność'); });
  const pr = $('#p-rate'); if (pr) pr.addEventListener('change', e => { P().rate = num(e.target.value); save(); toast('Zapisano tempo'); });
  info();
  body.querySelectorAll('[data-accent]').forEach(b => b.onclick = () => { setTheme({ accent: b.dataset.accent }); body.querySelectorAll('[data-accent]').forEach(x => x.setAttribute('aria-pressed', x === b)); });
  body.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { setTheme({ mode: b.dataset.mode }); body.querySelectorAll('[data-mode]').forEach(x => x.setAttribute('aria-pressed', x === b)); });
  $('#imp-xlsx').addEventListener('change', onXlsxPicked);
  $('#exp-xlsx').onclick = () => {
    if (!S.weights.length && !S.workouts.length && !S.fav.length && !S.plans.length && !(S.custom || []).length) { toast('Nie ma jeszcze danych do zapisania'); return; }
    shareOrDownload(`Rozpierdol-kopia-${today()}.xlsx`, backupXlsx());
  };
  $('#wipe').onclick = async () => {
    const inCloud = typeof SY !== 'undefined' && SY.session;
    if (await confirmBox('Usunąć wszystkie dane?', `Pomiary, treningi, plany, ulubione i własne ćwiczenia znikną z tego telefonu${inCloud ? ' <b>i z chmury</b> (konto jest zsynchronizowane)' : ''}. Tego nie da się cofnąć, chyba że masz plik kopii.`, 'Usuń wszystko', true)) {
      S = { profile: { height: null, goalLoss: null }, weights: [], workouts: [], active: null, custom: [], fav: [], plans: [], measures: [] };
      save(); rebuildExMap(); UI.cw = newFilter(); toast('Usunięto dane'); renderWiecej();
    }
  };
  applySettingsNav(body);
}

/* ---- Ustawienia jak w iPhonie: lista pozycji, każda otwiera osobny ekran ---- */
const SECS = [
  ['konto', '👤', 'Konto i chmura'], ['share', '🤝', 'Udostępnianie'], ['lock', '🔒', 'Blokada apki'], null,
  ['profil', '🧍', 'Profil i cel'], ['dieta', '📈', 'Ekran Postęp'], ['wyglad', '🎨', 'Wygląd'], null,
  ['excel', '📄', 'Kopia zapasowa w Excelu'], ['dane', '🗂️', 'Dane na tym telefonie'], null,
  ['log', '🆕', 'Co nowego'], ['sug', '💡', 'Sugestie'], ['sugadmin', '📬', 'Sugestie użytkowników'], ['admin', '🛠️', 'Panel administratora'], ['about', '👨‍💻', 'O autorze'], ['rodo', '🛡️', 'Przetwarzanie danych osobowych'], ['priv', '🔒', 'Polityka prywatności'], ['compl', '📮', 'Reklamacje'],
];
function secSub(k) {
  const p = S.profile, th = getTheme(), sy = typeof SY !== 'undefined' ? SY : null;
  switch (k) {
    case 'konto': return sy && sy.session ? esc(sy.session.email || '') : 'Nie zalogowano';
    case 'share': { const n = ((S.share || {}).viewers || []).length; return n ? 'Udostępniasz: ' + plural(n, 'osoba', 'osoby', 'osób') : 'Nikomu nie udostępniasz'; }
    case 'profil': return [GOALS[goalType()].l, p.height ? fmt(p.height, 2) + ' m' : '', p.weekly ? p.weekly + ' tr./tydz.' : ''].filter(Boolean).join(' · ');
    case 'dieta': return PREFS.filter(([k2]) => pref(k2)).map(([, l]) => l).join(', ') || 'Wszystko wyłączone';
    case 'wyglad': { const a = ACCENTS.find(x => x.id === th.accent), m = MODES.find(([v]) => v === th.mode); return [a && a.label, m && m[1]].filter(Boolean).join(' · '); }
    case 'excel': return 'Zapisz albo wczytaj plik .xlsx';
    case 'dane': return `${plural(S.weights.length, 'pomiar', 'pomiary', 'pomiarów')} wagi, ${plural(S.workouts.length, 'trening', 'treningi', 'treningów')}`;
    case 'log': return 'Ostatnio: ' + esc(CHANGELOG[0].t);
    case 'sug': return 'Napisz, co ulepszyć w apce';
    case 'sugadmin': return 'Widoczne tylko dla admina';
    case 'admin': return 'Konta użytkowników';
    case 'rodo': return 'Jakie dane, gdzie leżą, kto ma dostęp';
    default: return '';
  }
}
// Ustawienia na jednej stronie z kartami. Sugestie / polityka / reklamacje: karta „Inne”, każda pozycja otwiera okno.
const SHEET_SECS = ['log', 'sug', 'sugadmin', 'admin', 'about', 'rodo', 'priv', 'compl'];
function applySettingsNav(body) {
  UI.sec = null;
  $('#h-wiecej').textContent = 'Ustawienia';
  $('#wiecej-back').hidden = true;
  $$('[data-sec]', body).forEach(s => s.hidden = SHEET_SECS.includes(s.dataset.sec));
  const rows = SECS.filter(s => s && SHEET_SECS.includes(s[0]) && $(`[data-sec="${s[0]}"]`, body));
  const foot = $('.settings-foot', body);
  foot.insertAdjacentHTML('beforebegin', `<section class="card"><h2>Inne</h2><div class="list set-menu">${rows.map(([k, ic, l]) => {
    const sub = secSub(k);
    return `<button class="li" type="button" data-open-sec="${k}"><span class="nav-ic" aria-hidden="true">${ic}</span><span class="grow"><span class="t">${l}</span>${sub ? `<span class="s">${sub}</span>` : ''}</span><span class="chev" aria-hidden="true">›</span></button>`;
  }).join('')}</div></section>`);
  $$('[data-open-sec]', body).forEach(b => b.onclick = () => openSec(b.dataset.openSec));
}
// Otwiera część ustawień: pozycje z karty „Inne” w oknie, pozostałe karty — przewija do nich
function openSec(k) {
  const s = SECS.find(x => x && x[0] === k), src = $(`#wiecej-body [data-sec="${k}"]`);
  if (!s || !src) return;
  if (!SHEET_SECS.includes(k)) { src.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  openSheet(s[2], `<div class="view" style="gap:12px" id="sec-box"></div>`, b => {
    const box = $('#sec-box', b);
    if (k === 'sug') typeof renderSuggest === 'function' ? renderSuggest(box) : box.innerHTML = '<p style="margin:0">Sugestie wymagają połączenia z chmurą.</p>';
    else if (k === 'sugadmin') { if (typeof renderSuggestAdmin === 'function') renderSuggestAdmin(box); }
    else if (k === 'admin') { if (typeof renderAdmin === 'function') renderAdmin(box); }
    else if (k === 'log') { box.classList.add('log'); box.innerHTML = changelogHTML(CHANGELOG) + '<button class="btn block" type="button" data-close>OK</button>'; }
    else { src.classList.forEach(c => c !== 'card' && box.classList.add(c)); box.innerHTML = src.innerHTML + '<button class="btn block" type="button" data-close>OK</button>'; }
  });
}
$('#wiecej-back').addEventListener('click', () => goBack());

/* ============ Przycisk ✕ do czyszczenia pola ============
   Jeden wspólny przycisk: pojawia się po prawej stronie aktywnego pola, gdy coś w nim jest.
   Stuknięcie czyści pole, zostawia w nim kursor (klawiatura się nie chowa) i zapisuje zmianę jak przy wpisywaniu. */
(function clearButton() {
  const CLEARABLE = 'input[type="number"], input[type="text"], input[type="search"], input[type="email"]';
  const btn = document.createElement('button');
  btn.type = 'button'; btn.id = 'clear-x'; btn.hidden = true; btn.setAttribute('aria-label', 'Wyczyść pole'); btn.textContent = '✕';
  document.body.appendChild(btn);
  let target = null;
  const place = () => {
    if (!target || !document.contains(target) || !target.value || target.disabled) { btn.hidden = true; return; }
    const r = target.getBoundingClientRect();
    if (r.width < 60 || r.bottom < 0 || r.top > innerHeight) { btn.hidden = true; return; }
    const size = Math.min(28, r.height - 8);
    btn.style.width = btn.style.height = size + 'px';
    btn.style.left = (r.right - size - 6) + 'px';
    btn.style.top = (r.top + (r.height - size) / 2) + 'px';
    btn.hidden = false;
  };
  document.addEventListener('focusin', e => {
    if (e.target.matches && e.target.matches(CLEARABLE)) { target = e.target; target.classList.add('has-clear'); place(); }
  });
  document.addEventListener('focusout', e => {
    if (e.target === target) setTimeout(() => { if (document.activeElement !== target) { target.classList.remove('has-clear'); target = null; btn.hidden = true; } }, 0);
  });
  document.addEventListener('input', e => {
    if (e.target !== target && e.target.matches && e.target.matches(CLEARABLE)) { if (target) target.classList.remove('has-clear'); target = e.target; target.classList.add('has-clear'); }
    if (e.target === target) place();
  });
  window.addEventListener('scroll', place, true);
  window.addEventListener('resize', place);
  // pointerdown + preventDefault: pole nie traci kursora, więc klawiatura na iPhonie zostaje
  btn.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (!target) return;
    target.value = '';
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    target.focus(); place();
  });
  btn.addEventListener('click', e => e.preventDefault());
})();

/* ============ Co nowego ============
   Lista zmian, najnowsze na górze. Przy nowym wydaniu dopisz wpis z kolejnym numerem (id).
   S.seenLog = numer ostatniego obejrzanego wydania (synchronizuje się z kontem, więc okno nie wyskakuje na każdym telefonie osobno).
   Po aktualizacji okno pokazuje wszystkie wydania, których ktoś jeszcze nie widział. */
const CHANGELOG = [
  {
    id: 8,
    t: 'Postęp i Waga',
    items: [
      'Nowa pierwsza zakładka <b>Postęp</b>: aktualna waga, wynik od startu, postęp do celu, BMI, średnia 7 dni, ostatnie 30 dni, kalorie, fakt dnia i seria ważenia.',
      'Jest tam też <b>podsumowanie miesiąca</b> oraz skróty do grafu partii mięśniowych i odznak.',
      'Wpisy wagi, wykres i lista pomiarów są w osobnej zakładce <b>Waga</b>, razem z Pomiarami ciała.',
      'W zakładce Postęp jest też <b>wykres trendu wagi</b> (średnia z 7 dni, linia celu) i <b>paski serii na partie</b> z ostatnich 7 dni.',
    ],
  },
  {
    id: 7,
    t: 'Statystyki, odznaki i timer',
    items: [
      '<b>Timer przerwy</b>: startuje sam po odhaczeniu serii ✓. Możesz dodać albo odjąć 15 s, a stuknięcie w czas zmienia domyślną długość.',
      '<b>Dropsety</b>: „+ Drop” dodaje lżejszą serię ze strzałką ↘. Możesz też stuknąć numer serii. Dropset liczy się razem z poprzednią serią.',
      '<b>Wykres postępu</b> w szczegółach ćwiczenia: szacowany 1RM i objętość z każdego treningu.',
      '<b>Podsumowanie miesiąca</b> w zakładce Trening: treningi, serie, objętość, rekordy i zmiana wagi.',
      'Graf partii mięśniowych pokazuje teraz okres <b>7, 14 albo 30 dni</b>.',
      '<b>Odznaki</b> za treningi, rekordy, ciężary, ważenie i cele (Trening → 🎖️ Odznaki).',
      '<b>Seria dni ważenia</b> 🔥 w zakładce Postęp.',
    ],
  },
  { id: 6, t: 'Blokada apki', items: [
    'Możesz zablokować apkę <b>4-cyfrowym kodem</b>: Ustawienia → Blokada apki.',
    'Odblokowanie <b>Face ID / Touch ID</b>, jeśli telefon je ma.',
    'Wybierasz, kiedy apka ma się blokować: od razu po wyjściu albo po 1, 5 lub 15 minutach.',
    'Zapomniany kod zdejmiesz hasłem do konta.',
  ] },
  { id: 5, t: 'Forma i mapa mięśni', items: [
    'Zakładka Dieta nazywa się teraz <b>Forma</b> i ma nową ikonę. Pasuje do każdego celu: redukcji, utrzymania i masy.',
    'Nowy ekran <b>Graf trenowanych partii mięśniowych</b> (Forma → 💪). Sylwetka z przodu i z tyłu, a ćwiczone partie świecą na czerwono. Stuknij partię, żeby zobaczyć serie z ostatnich 7 dni, dzień po dniu.',
    'Osobna sylwetka dla profilu „Kobieta”.',
    'Okno „Co nowego” po aktualizacji. Pełną listę zmian znajdziesz w Ustawieniach → Inne.',
  ] },
  { id: 4, t: 'Konto i ustawienia', items: [
    'Zmiana hasła, zmiana e-maila i usuwanie konta w karcie Konto i chmura.',
    '<b>Sugestie</b>: napisz, co dodać albo poprawić w apce.',
    'Nowe pozycje w Ustawieniach → Inne: O autorze, Przetwarzanie danych osobowych, Polityka prywatności i Reklamacje.',
    'Losowe teksty na ekranie startowym.',
  ] },
  { id: 3, t: 'Profil i cele', items: [
    'Profil: płeć, rok urodzenia, aktywność, cel (redukcja, utrzymanie albo masa) i tempo.',
    'Kafelek z dziennym zapotrzebowaniem na kalorie.',
    'Szacowany % tkanki tłuszczowej w Pomiarach ciała.',
    'Cel treningów na tydzień i wykres kołowy z ostatnich 7 dni.',
    'Przełączniki w Ustawieniach: pokaż albo ukryj kafelek kalorii i losowy fakt.',
  ] },
  { id: 2, t: 'Nowy układ', items: [
    '4 zakładki zamiast 6: Baza ćwiczeń jest teraz w Planach, a Pomiary ciała w Formie.',
    'Kafelek z losowym, pozytywnym faktem o twoich postępach.',
    'Na iPhonie cofasz się gestem od lewej krawędzi ekranu.',
  ] },
  { id: 1, t: 'Treningi', items: [
    'Kolejność ćwiczeń i serii zmieniasz przytrzymaniem i przeciągnięciem.',
    'Własne pola w seriach: kg, powtórzenia, czas, dystans, prędkość, nachylenie, tempo, RIR, RPE i inne.',
    '<b>Rekordy osobiste</b> z gratulacjami po pobiciu.',
    'Podmiana ćwiczenia na inne bez utraty wpisanych serii.',
    'Widok kompaktowy treningu.',
    'Puste ćwiczenia i ustawiona liczba serii zostają po zapisaniu treningu.',
  ] },
];
const LOG_LATEST = CHANGELOG[0].id;
const hasAnyData = () => S.weights.length || S.workouts.length || S.plans.length || (S.measures || []).length;
function changelogHTML(list) {
  return list.map(r => `<section class="log-rel"><h3>${esc(r.t)}</h3><ul>${r.items.map(i => `<li>${i}</li>`).join('')}</ul></section>`).join('');
}
function showChangelog(list, title) {
  openSheet(title, `<div class="log">${changelogHTML(list)}</div><button class="btn primary block" type="button" data-close>Super</button>`);
}
// Wywoływane po starcie, po zalogowaniu i po zamknięciu ekranu logowania
let whatsNewTries = 0;
function whatsNew() {
  if ((S.seenLog || 0) >= LOG_LATEST) return;
  // nowy użytkownik (pusty telefon, bez konta): nie ma czego nadrabiać
  if (!hasAnyData()) { if (!(typeof SY !== 'undefined' && SY.session)) { S.seenLog = LOG_LATEST; save(true); } return; }
  // nie przykrywaj ekranu logowania ani innego okna — spróbuj za chwilę
  if (document.getElementById('auth') || !$('#sheet').hidden || $('#splash')) { if (whatsNewTries++ < 30) setTimeout(whatsNew, 1500); return; }
  const missed = CHANGELOG.filter(r => r.id > (S.seenLog || 0));
  S.seenLog = LOG_LATEST; save();
  showChangelog(missed, missed.length > 1 ? 'Co nowego od twojej ostatniej wizyty' : 'Co nowego 🎉');
}

/* ============ Start ============ */
const splashStart = performance.now();
function hideSplash() {
  const sp = $('#splash'); if (!sp || sp.dataset.out) return;
  sp.dataset.out = '1';
  setTimeout(() => { sp.classList.add('hide'); setTimeout(() => sp.remove(), 400); }, Math.max(0, 2000 - (performance.now() - splashStart)));
}
setTimeout(hideSplash, 6000); // zabezpieczenie: ekran startowy znika zawsze, nawet po błędzie niżej
try { applyTheme(getTheme()); } catch (e) { console.error(e); }
rebuildExMap();
try { setTab(S.active ? 'trening' : 'start'); } catch (e) { console.error(e); }
loadExercises().finally(hideSplash);
setTimeout(() => { try { whatsNew(); } catch (e) { console.error(e); } }, 2600);

// odznaki: przy starcie sprawdź, czy coś nowego (np. zdobyte na innym telefonie albo po aktualizacji)
setTimeout(() => {
  if (typeof checkBadges === 'function') {
    checkBadges();
  }
}, 4000);
// po powrocie do apki odśwież ekrany z „dzisiejszymi” liczbami
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    return;
  }
  if (UI.tab === 'start') {
    renderStart();
  } else if (UI.tab === 'dieta') {
    renderDieta();
  }
});
// Apka działa z pamięci telefonu. Nowa wersja pobiera się w tle (raz), a potem proponujemy odświeżenie.
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').then(reg => {
    // sprawdzaj aktualizacje przy powrocie do apki (to jeden mały plik, sw.js)
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {}));
  // kiedy ostatnio coś było klikane/wpisywane — żeby nie przeładować apki komuś pod palcami
  let lastTouch = 0;
  ['pointerdown', 'input', 'keydown'].forEach(ev => document.addEventListener(ev, () => { lastTouch = Date.now(); }, true));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || $('#update-bar')) return; // pierwsza instalacja — nic nie pokazuj
    const typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    // ekran blokady / Face ID też liczy się jako „zajęty”: odświeżenie w tym momencie kazałoby odblokowywać drugi raz
    const busy = typing || !$('#sheet').hidden || Date.now() - lastTouch < 4000 || !!$('#lock') || (typeof bioBusy !== 'undefined' && bioBusy);
    // Nowa wersja (wszystkie dane są już zapisane w telefonie): jeśli nic nie robisz — odśwież od razu.
    if (!busy) { location.reload(); return; }
    const bar = document.createElement('div');
    bar.id = 'update-bar'; bar.setAttribute('role', 'status');
    bar.innerHTML = '<span>Jest nowa wersja apki</span><button type="button">Odśwież</button>';
    bar.querySelector('button').onclick = () => location.reload();
    document.body.appendChild(bar);
  });
}

/* ============ Dodatki: postęp w ćwiczeniu, podsumowanie miesiąca, odznaki, seria ważenia, timer przerwy ============
   Plik ładuje się PRZED app.js (żeby pierwsze rysowanie ekranów już je miało), więc na górnym poziomie
   tylko definiuje funkcje; dane i pomocnicze funkcje z app.js są używane dopiero przy wywołaniu. */


/* ---------- mały wykres liniowy (SVG) ---------- */

function lineSVG(pts, fv) {
  const W = 320;
  const H = 150;
  const L = 8;
  const R = 8;
  const T = 22;
  const B = 22;

  if (pts.length < 2) {
    return '';
  }

  const xs = pts.map(p => parseD(p.d).getTime());
  const vs = pts.map(p => p.v);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const pad = (hi - lo) * 0.15 || hi * 0.1 || 1;

  const x = t => {
    const share = x1 > x0
      ? (t - x0) / (x1 - x0)
      : 0.5;
    return L + share * (W - L - R);
  };
  const y = v => {
    const share = (v - (lo - pad)) / (hi - lo + 2 * pad);
    return T + (1 - share) * (H - T - B);
  };

  const line = pts
    .map((p, i) => `${x(xs[i]).toFixed(1)},${y(p.v).toFixed(1)}`)
    .join(' ');
  const last = pts.length - 1;
  const iMax = vs.indexOf(hi);
  const maxX = Math.min(W - 40, Math.max(40, x(xs[iMax])));

  const dots = pts
    .map((p, i) => {
      const r = i === last ? 4 : 2.5;
      const cls = i === last ? 'end' : 'pt';
      return `<circle cx="${x(xs[i]).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="${r}" class="${cls}"/>`;
    })
    .join('');

  return `
    <svg viewBox="0 0 ${W} ${H}" class="mini-chart" role="img" aria-label="Wykres">
      <polygon class="area" points="${x(xs[0]).toFixed(1)},${H - B} ${line} ${x(xs[last]).toFixed(1)},${H - B}"/>
      <polyline class="avg" points="${line}"/>
      ${dots}
      <text x="${maxX.toFixed(1)}" y="${(y(hi) - 8).toFixed(1)}" text-anchor="middle" class="lbl">${fv(hi)}</text>
      <text x="${L}" y="${H - 5}" class="lbl">${dayLabel(pts[0].d)}</text>
      <text x="${W - R}" y="${H - 5}" text-anchor="end" class="lbl">${dayLabel(pts[last].d)}</text>
    </svg>`;
}


/* ---------- postęp w ćwiczeniu: szacowany 1RM i objętość z każdego treningu ---------- */

function exMetrics(id) {
  const ex = EXMAP[id];
  const cardio = isCardio(ex);
  const hist = exHistory(id)
    .slice()
    .reverse();

  const rows = hist.map(h => {
    const ss = h.sets.filter(filled);
    return {
      d: h.date,
      e1: Math.max(0, ...ss.map(e1rm)),
      vol: ss.reduce((sum, s) => sum + (s.a || 0) * (s.b || 0), 0),
      reps: Math.max(0, ...ss.map(s => s.a > 0 ? 0 : (s.b || 0))),
      km: ss.reduce((sum, s) => sum + (s.b || 0), 0),
      min: ss.reduce((sum, s) => sum + (s.a || 0), 0),
    };
  });

  const kgHalf = v => fmtN(Math.round(v * 2) / 2) + ' kg';

  let metrics;
  if (cardio) {
    metrics = [
      ['km', 'Dystans', v => fmtN(Math.round(v * 100) / 100) + ' km'],
      ['min', 'Czas', v => fmtN(Math.round(v)) + ' min'],
    ];
  } else if (rows.some(r => r.e1 > 0)) {
    metrics = [
      ['e1', 'Szacowany 1RM', kgHalf],
      ['vol', 'Objętość', v => fmt(v, 0) + ' kg'],
    ];
  } else {
    metrics = [
      ['reps', 'Powtórzenia', v => fmtN(v) + ' powt.'],
    ];
  }

  return metrics
    .map(([k, l, f]) => ({
      k,
      l,
      f,
      pts: rows
        .filter(r => r[k] > 0)
        .map(r => ({ d: r.d, v: r[k] })),
    }))
    .filter(m => m.pts.length);
}

function exProgressHTML(id) {
  const ms = exMetrics(id);
  if (!ms.length || ms[0].pts.length < 2) {
    return '';
  }

  const switcher = ms.length > 1
    ? `<div class="seg" role="group" aria-label="Co pokazać">
        ${ms
          .map((m, i) => `<button type="button" data-pm="${i}" aria-pressed="${!i}">${m.l}</button>`)
          .join('')}
      </div>`
    : '';

  return `
    <div class="card exprog" data-id="${esc(id)}">
      <div class="row">
        <h3 style="margin:0">📈 Postęp</h3>
        ${switcher}
      </div>
      <div class="exprog-body"></div>
    </div>`;
}

function wireExProgress(el) {
  const ms = exMetrics(el.dataset.id);
  const body = $('.exprog-body', el);

  const show = i => {
    const m = ms[i];
    const p = m.pts;
    const first = p[0].v;
    const last = p[p.length - 1].v;
    const diff = last - first;

    const chart = p.length >= 2
      ? lineSVG(p, m.f)
      : '<p class="muted small" style="margin:0">Za mało treningów na wykres.</p>';

    const sign = diff > 0 ? '+' : diff < 0 ? '−' : '±';
    const cls = diff > 0 ? 'good-t' : diff < 0 ? 'bad-t' : 'muted';
    const change = p.length > 1
      ? ` <span class="${cls}">(${sign}${m.f(Math.abs(diff))} od pierwszego)</span>`
      : '';

    body.innerHTML = `
      ${chart}
      <div class="row small">
        <span class="muted">${plural(p.length, 'trening', 'treningi', 'treningów')}</span>
        <span>teraz <b class="num">${m.f(last)}</b>${change}</span>
      </div>`;

    $$('[data-pm]', el).forEach(b => {
      b.setAttribute('aria-pressed', +b.dataset.pm === i);
    });
  };

  $$('[data-pm]', el).forEach(b => {
    b.onclick = () => show(+b.dataset.pm);
  });

  show(0);
}


/* ---------- podsumowanie miesiąca (zakładka Trening) ---------- */

const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
const MONTHS_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

function monthKey(off) {
  const d = parseD(today());
  d.setDate(1);
  d.setMonth(d.getMonth() + off);
  return [d.getFullYear(), d.getMonth()];
}

function monthData(off) {
  const [y, m] = monthKey(off);
  const prefix = `${y}-${String(m + 1).padStart(2, '0')}`;
  const byW = prTimeline().byW;

  const ws = S.workouts.filter(w => (w.date || '').startsWith(prefix));
  const wts = S.weights.filter(x => x.d.startsWith(prefix));

  return {
    y,
    m,
    prefix,
    n: ws.length,
    vol: ws.reduce((sum, w) => sum + volume(w), 0),
    sets: ws.reduce(
      (sum, w) => sum + w.ex.reduce((t, e) => t + countSets(e.sets), 0),
      0,
    ),
    prs: ws.reduce(
      (sum, w) => sum + (byW[w.id] ? byW[w.id].length : 0),
      0,
    ),
    wch: wts.length > 1
      ? wts[wts.length - 1].w - wts[0].w
      : null,
  };
}

function monthSummaryHTML() {
  if (!S.workouts.length && !S.weights.length) {
    return '';
  }
  return `<section class="card month-sum" id="month-sum"></section>`;
}

function wireMonthSummary(el, off = UI.mOff || 0) {
  UI.mOff = off;

  const c = monthData(off);
  const p = monthData(off - 1);
  const diff = c.n - p.n;

  const firstDates = [
    S.workouts.length ? S.workouts[0].date : null,
    S.weights.length ? S.weights[0].d : null,
  ].filter(Boolean);
  const first = firstDates.sort()[0] || today();
  const canBack = c.prefix > first.slice(0, 7);
  const canFwd = off < 0;

  const tile = (k, v, s, wide) => `
    <div class="ms-t${wide ? ' wide' : ''}">
      <span class="k">${k}</span>
      <span class="v num">${v}</span>
      ${s ? `<span class="d">${s}</span>` : ''}
    </div>`;

  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '±';
  const vsPrev = p.n || c.n
    ? `${sign}${Math.abs(diff)} vs ${MONTHS_SHORT[p.m]}`
    : '';
  const volTxt = c.vol >= 10000
    ? fmt(c.vol / 1000, 1) + ' t'
    : fmt(c.vol, 0) + ' kg';
  const weightTxt = c.wch == null
    ? '–'
    : `<span class="${wcls(c.wch)}">${fmtSigned(c.wch, 1)}</span>`;

  el.innerHTML = `
    <div class="row">
      <button class="icon-btn" type="button" data-mo="-1" aria-label="Poprzedni miesiąc" ${canBack ? '' : 'disabled'}>‹</button>
      <h3 style="margin:0;text-transform:capitalize">${MONTHS[c.m]} ${c.y}</h3>
      <button class="icon-btn" type="button" data-mo="1" aria-label="Następny miesiąc" ${canFwd ? '' : 'disabled'}>›</button>
    </div>
    <div class="ms-grid">
      ${tile('Treningi', c.n, vsPrev)}
      ${tile('Serie', c.sets)}
      ${tile('Objętość', volTxt)}
      ${tile('Rekordy', c.prs ? '🏆 ' + c.prs : '0')}
      ${tile('Waga', weightTxt, c.wch == null ? 'za mało pomiarów' : 'kg w miesiącu', true)}
    </div>`;

  $$('[data-mo]', el).forEach(b => {
    b.onclick = () => wireMonthSummary(el, off + +b.dataset.mo);
  });
}


/* ---------- seria dni ważenia ---------- */

function weighStreak() {
  const days = new Set(S.weights.map(x => x.d));
  const weighedToday = days.has(today());

  let d = weighedToday ? today() : addDays(today(), -1);
  let n = 0;
  while (days.has(d)) {
    n++;
    d = addDays(d, -1);
  }

  return { n, today: weighedToday };
}

function bestWeighStreak() {
  const days = [...new Set(S.weights.map(x => x.d))].sort();

  let best = 0;
  let cur = 0;
  let prev = null;
  days.forEach(d => {
    cur = prev && addDays(prev, 1) === d
      ? cur + 1
      : 1;
    best = Math.max(best, cur);
    prev = d;
  });

  return best;
}

function weighStreakHTML() {
  const s = weighStreak();
  if (s.n < 2) {
    return '';
  }

  const hint = s.today
    ? ''
    : ' · <span class="muted">zważ się dziś, żeby nie przerwać</span>';

  return `
    <div class="streak small">
      <span class="flame" aria-hidden="true">🔥</span>
      <b class="num">${s.n}</b> dni ważenia z rzędu${hint}
    </div>`;
}


/* ---------- osiągnięcia ---------- */

// k = który licznik z achVals(), g = ile trzeba, u = jednostka do paska postępu, c = kategoria
const ACH_CATS = [
  ['tr', '💪 Treningi'],
  ['si', '🏋️ Siła'],
  ['re', '🏆 Rekordy'],
  ['rg', '🔥 Regularność'],
  ['ci', '⚖️ Waga i ciało'],
];

const BADGES = [
  // treningi
  { c: 'tr', id: 'w1', ic: '🎉', t: 'Pierwszy trening', d: 'Zapisz pierwszy trening', k: 'w', g: 1 },
  { c: 'tr', id: 'w10', ic: '💪', t: '10 treningów', d: 'Zapisz 10 treningów', k: 'w', g: 10 },
  { c: 'tr', id: 'w25', ic: '🥉', t: '25 treningów', d: 'Zapisz 25 treningów', k: 'w', g: 25 },
  { c: 'tr', id: 'w50', ic: '🦾', t: '50 treningów', d: 'Zapisz 50 treningów', k: 'w', g: 50 },
  { c: 'tr', id: 'w100', ic: '🏛️', t: '100 treningów', d: 'Zapisz 100 treningów', k: 'w', g: 100 },
  { c: 'tr', id: 'w200', ic: '🗿', t: '200 treningów', d: 'Zapisz 200 treningów', k: 'w', g: 200 },
  { c: 'tr', id: 'set500', ic: '🔁', t: '500 serii', d: 'Zrób łącznie 500 serii', k: 'sets', g: 500 },
  { c: 'tr', id: 'set2k', ic: '♾️', t: '2000 serii', d: 'Zrób łącznie 2000 serii', k: 'sets', g: 2000 },
  { c: 'tr', id: 'ex20', ic: '🧭', t: 'Odkrywca', d: 'Zrób 20 różnych ćwiczeń', k: 'exN', g: 20 },
  { c: 'tr', id: 'plan3', ic: '📋', t: 'Planista', d: 'Ułóż 3 plany treningowe', k: 'plans', g: 3 },
  { c: 'tr', id: 'early', ic: '🌅', t: 'Ranny ptaszek', d: 'Zacznij trening przed 7:00', k: 'early', g: 1 },
  { c: 'tr', id: 'late', ic: '🦉', t: 'Nocny marek', d: 'Zacznij trening po 22:00', k: 'late', g: 1 },
  // siła
  { c: 'si', id: 'kg60', ic: '🥈', t: '60 kg na sztandze', d: 'Seria z ciężarem 60 kg lub więcej', k: 'kg', g: 60, u: ' kg' },
  { c: 'si', id: 'kg100', ic: '🏋️', t: 'Pierwsze 100 kg', d: 'Seria z ciężarem 100 kg lub więcej', k: 'kg', g: 100, u: ' kg' },
  { c: 'si', id: 'kg140', ic: '🦍', t: '140 kg', d: 'Seria z ciężarem 140 kg lub więcej', k: 'kg', g: 140, u: ' kg' },
  { c: 'si', id: 'kg200', ic: '🐘', t: '200 kg', d: 'Seria z ciężarem 200 kg lub więcej', k: 'kg', g: 200, u: ' kg' },
  { c: 'si', id: 'ton5', ic: '🚚', t: '5 ton', d: 'Objętość jednego treningu: 5000 kg', k: 'vol', g: 5000, u: ' kg' },
  { c: 'si', id: 'ton10', ic: '🚛', t: '10 ton', d: 'Objętość jednego treningu: 10 000 kg', k: 'vol', g: 10000, u: ' kg' },
  { c: 'si', id: 'ton20', ic: '🚂', t: '20 ton', d: 'Objętość jednego treningu: 20 000 kg', k: 'vol', g: 20000, u: ' kg' },
  { c: 'si', id: 'tot100', ic: '🏗️', t: '100 ton łącznie', d: 'Podnieś łącznie 100 000 kg', k: 'volT', g: 100000, u: ' kg' },
  { c: 'si', id: 'tot1k', ic: '🌋', t: '1000 ton łącznie', d: 'Podnieś łącznie 1 000 000 kg', k: 'volT', g: 1000000, u: ' kg' },
  // rekordy
  { c: 're', id: 'pr1', ic: '⭐', t: 'Pierwszy rekord', d: 'Pobij pierwszy rekord osobisty', k: 'pr', g: 1 },
  { c: 're', id: 'pr10', ic: '🏆', t: '10 rekordów', d: 'Pobij 10 rekordów osobistych', k: 'pr', g: 10 },
  { c: 're', id: 'pr25', ic: '🥇', t: '25 rekordów', d: 'Pobij 25 rekordów osobistych', k: 'pr', g: 25 },
  { c: 're', id: 'pr50', ic: '👑', t: '50 rekordów', d: 'Pobij 50 rekordów osobistych', k: 'pr', g: 50 },
  { c: 're', id: 'pr100', ic: '💎', t: '100 rekordów', d: 'Pobij 100 rekordów osobistych', k: 'pr', g: 100 },
  { c: 're', id: 'drop', ic: '↘️', t: 'Dropset', d: 'Zrób pierwszy dropset', k: 'drop', g: 1 },
  { c: 're', id: 'drop25', ic: '🪜', t: 'Mistrz dropsetów', d: 'Zrób 25 dropsetów', k: 'drop', g: 25 },
  // regularność
  { c: 'rg', id: 'wk4', ic: '📅', t: 'Plan na 4 tygodnie', d: 'Cel treningów na tydzień 4 tygodnie z rzędu', k: 'wk', g: 4 },
  { c: 'rg', id: 'wk8', ic: '🗓️', t: 'Plan na 8 tygodni', d: 'Cel treningów na tydzień 8 tygodni z rzędu', k: 'wk', g: 8 },
  { c: 'rg', id: 'wk12', ic: '🏁', t: 'Kwartał bez wymówek', d: 'Cel treningów na tydzień 12 tygodni z rzędu', k: 'wk', g: 12 },
  { c: 'rg', id: 'mo6', ic: '🌗', t: 'Pół roku w grze', d: 'Treningi w 6 różnych miesiącach', k: 'mo', g: 6 },
  { c: 'rg', id: 's7', ic: '🔥', t: 'Tydzień ważenia', d: 'Waż się 7 dni z rzędu', k: 'st', g: 7 },
  { c: 'rg', id: 's14', ic: '🔥', t: '2 tygodnie ważenia', d: 'Waż się 14 dni z rzędu', k: 'st', g: 14 },
  { c: 'rg', id: 's30', ic: '☄️', t: 'Miesiąc ważenia', d: 'Waż się 30 dni z rzędu', k: 'st', g: 30 },
  { c: 'rg', id: 's100', ic: '🌟', t: '100 dni ważenia', d: 'Waż się 100 dni z rzędu', k: 'st', g: 100 },
  // waga i ciało
  { c: 'ci', id: 'wi30', ic: '⚖️', t: '30 ważeń', d: 'Zapisz 30 pomiarów wagi', k: 'wi', g: 30 },
  { c: 'ci', id: 'wi100', ic: '📈', t: '100 ważeń', d: 'Zapisz 100 pomiarów wagi', k: 'wi', g: 100 },
  { c: 'ci', id: 'wi365', ic: '📆', t: 'Rok na wadze', d: 'Zapisz 365 pomiarów wagi', k: 'wi', g: 365 },
  { c: 'ci', id: 'm5', ic: '📏', t: 'Pod kontrolą', d: 'Zapisz 5 pomiarów ciała', k: 'ms', g: 5 },
  { c: 'ci', id: 'm20', ic: '📐', t: 'Krawiec', d: 'Zapisz 20 pomiarów ciała', k: 'ms', g: 20 },
  { c: 'ci', id: 'g25', ic: '🎯', t: 'Ćwierć drogi', d: '25% drogi do celu wagi', k: 'goal', g: 25, u: '%' },
  { c: 'ci', id: 'g50', ic: '🎯', t: 'Półmetek', d: '50% drogi do celu wagi', k: 'goal', g: 50, u: '%' },
  { c: 'ci', id: 'goal', ic: '🏅', t: 'Cel osiągnięty', d: 'Osiągnij cel wagi z profilu', k: 'goal', g: 100, u: '%' },
];

function achVals() {
  let kg = 0;
  let vol = 0;
  let volT = 0;
  let drop = 0;
  let sets = 0;
  let early = 0;
  let late = 0;
  const exIds = new Set();
  const months = new Set();

  S.workouts.forEach(w => {
    const v = volume(w);
    vol = Math.max(vol, v);
    volT += v;
    months.add((w.date || '').slice(0, 7));

    // godzina startu tylko dla treningów zapisanych „na żywo” (start ≠ koniec)
    if (w.start && w.end && w.end - w.start > 60000) {
      const h = new Date(w.start).getHours();
      if (h < 7) {
        early++;
      }
      if (h >= 22) {
        late++;
      }
    }

    w.ex.forEach(e => {
      const ex = EXMAP[e.id];
      if (e.sets.some(filled)) {
        exIds.add(e.id);
      }
      if (isCardio(ex)) {
        return;
      }
      sets += countSets(e.sets);
      e.sets
        .filter(filled)
        .forEach(s => {
          if (s.a > kg) {
            kg = s.a;
          }
          if (s.drop) {
            drop++;
          }
        });
    });
  });

  const st = stats();
  const prCount = Object
    .values(prTimeline().byW)
    .reduce((sum, list) => sum + list.length, 0);

  return {
    w: S.workouts.length,
    sets,
    kg,
    vol,
    volT,
    drop,
    early,
    late,
    exN: exIds.size,
    mo: months.size,
    plans: S.plans.length,
    pr: prCount,
    wk: weeklyStreak(),
    st: bestWeighStreak(),
    wi: S.weights.length,
    ms: (S.measures || []).length,
    goal: st && st.pct != null
      ? Math.floor(st.pct)
      : 0,
  };
}

// stara nazwa (używana w innych miejscach)
const badgeVals = achVals;

const badgeEarned = (b, v) => (v[b.k] || 0) >= b.g;

function badgeCount() {
  const v = achVals();
  const got = BADGES.filter(b => badgeEarned(b, v)).length;
  return `${got}/${BADGES.length}`;
}


/* ---------- poziomy użytkownika (XP) ---------- */

const LEVEL_NAMES = [
  'Świeżak', 'Rozgrzewka', 'Bywalec', 'Wyjadacz', 'Koksik',
  'Byczek', 'Twardziel', 'Kocur', 'Pakernik', 'Maszyna',
  'Bestia', 'Tytan', 'Gladiator', 'Spartanin', 'Wiking',
  'Herkules', 'Atlas', 'Olimpijczyk', 'Legenda siłowni', 'Rozpierdol',
];

// skąd biorą się punkty
const XP_RULES = [
  ['w', 50, 'za każdy trening'],
  ['sets', 2, 'za każdą serię'],
  ['pr', 25, 'za każdy pobity rekord'],
  ['wi', 5, 'za każde ważenie'],
  ['ms', 10, 'za każdy pomiar ciała'],
  ['ach', 100, 'za każde osiągnięcie'],
];

// XP potrzebne do osiągnięcia poziomu L (poziom 1 = 0 XP), coraz większe odstępy
const levelXP = L => Math.round(250 * Math.pow(L - 1, 1.5));

function xpOf(v) {
  const ach = BADGES.filter(b => badgeEarned(b, v)).length;
  const counts = Object.assign({}, v, { ach });
  return XP_RULES.reduce((sum, [k, pts]) => sum + (counts[k] || 0) * pts, 0);
}

function levelInfo(v = achVals()) {
  const xp = xpOf(v);
  const max = LEVEL_NAMES.length;

  let lvl = 1;
  while (lvl < max && xp >= levelXP(lvl + 1)) {
    lvl++;
  }

  const cur = levelXP(lvl);
  const next = lvl < max ? levelXP(lvl + 1) : null;
  const pct = next
    ? Math.round((xp - cur) / (next - cur) * 100)
    : 100;

  return {
    lvl,
    name: LEVEL_NAMES[lvl - 1],
    xp,
    cur,
    next,
    pct,
  };
}

function levelCardHTML() {
  const L = levelInfo();
  const sub = L.next
    ? `${fmtN(L.xp)} / ${fmtN(L.next)} XP · do poziomu ${L.lvl + 1}: ${fmtN(L.next - L.xp)} XP`
    : `${fmtN(L.xp)} XP · najwyższy poziom!`;

  return `
    <button class="card level-card" type="button" id="level-card">
      <span class="lvl-badge num">${L.lvl}</span>
      <span class="grow">
        <span class="lvl-t">Poziom ${L.lvl} · <b>${L.name}</b></span>
        <span class="bprog"><i style="width:${L.pct}%"></i></span>
        <span class="small muted">${sub}</span>
      </span>
      <span class="chev" aria-hidden="true">›</span>
    </button>`;
}

function showLevels() {
  const v = achVals();
  const L = levelInfo(v);
  const counts = Object.assign({}, v, {
    ach: BADGES.filter(b => badgeEarned(b, v)).length,
  });

  const rules = XP_RULES
    .map(([k, pts, label]) => `
      <div class="row small">
        <span>+${pts} XP ${label}</span>
        <span class="muted num">${fmtN(counts[k] || 0)} × ${pts} = ${fmtN((counts[k] || 0) * pts)}</span>
      </div>`)
    .join('');

  const levels = LEVEL_NAMES
    .map((name, i) => {
      const n = i + 1;
      const cls = n < L.lvl ? 'done' : n === L.lvl ? 'cur' : '';
      return `
        <div class="lvl-row ${cls}">
          <span class="lvl-badge sm num">${n}</span>
          <span class="grow">${name}</span>
          <span class="small muted num">${fmtN(levelXP(n))} XP</span>
        </div>`;
    })
    .join('');

  openSheet('Twój poziom', `
    ${levelCardHTML().replace('id="level-card"', '').replace('<button', '<div').replace('</button>', '</div>')}
    <h3 style="margin:0">Jak zdobywać XP</h3>
    <div class="view" style="gap:6px">${rules}</div>
    <h3 style="margin:0">Poziomy</h3>
    <div class="lvl-list">${levels}</div>
    <button class="btn block" type="button" data-close>OK</button>`);
}


/* ---------- ekran osiągnięć ---------- */

function badgeCardHTML(b, v, got) {
  const ok = badgeEarned(b, v);
  const have = Math.min(v[b.k] || 0, b.g);
  const pct = Math.round(have / b.g * 100);
  const unit = b.u || '';

  const footer = ok
    ? `<span class="small good-t">✓ ${got[b.id] ? dayLabel(got[b.id]) : 'zdobyte'}</span>`
    : `<span class="bprog"><i style="width:${pct}%"></i></span>
       <span class="small muted num">${fmtN(have)}${unit} / ${fmtN(b.g)}${unit}</span>`;

  return `
    <div class="badge${ok ? ' on' : ''}">
      <span class="bi" aria-hidden="true">${b.ic}</span>
      <b>${b.t}</b>
      <span class="small muted">${b.d}</span>
      ${footer}
    </div>`;
}

function showBadges() {
  const v = achVals();
  const got = S.badges || {};

  const sections = ACH_CATS
    .map(([cat, title]) => {
      const list = BADGES.filter(b => b.c === cat);
      const done = list.filter(b => badgeEarned(b, v)).length;
      return `
        <div class="row">
          <h3 style="margin:0">${title}</h3>
          <span class="small muted">${done}/${list.length}</span>
        </div>
        <div class="badges">
          ${list
            .map(b => badgeCardHTML(b, v, got))
            .join('')}
        </div>`;
    })
    .join('');

  openSheet('🏅 Osiągnięcia', `
    ${levelCardHTML()}
    ${sections}
    <button class="btn block" type="button" data-close>OK</button>`,
    b => {
      const lc = $('#level-card', b);
      if (lc) {
        lc.onclick = showLevels;
      }
    });
}


/* ---------- gratulacje: nowe osiągnięcia i awans na wyższy poziom ---------- */

let badgeTries = 0;

function checkBadges() {
  if (typeof EX_STATE !== 'undefined' && EX_STATE === 'loading') {
    setTimeout(checkBadges, 1500);
    return;
  }

  const v = achVals();
  const earned = BADGES.filter(b => badgeEarned(b, v));
  const L = levelInfo(v);

  // pierwszy raz (konta sprzed osiągnięć / poziomów): zapisz stan bez wyskakującego okna
  let firstRun = false;
  if (!S.badges) {
    S.badges = {};
    earned.forEach(b => {
      S.badges[b.id] = today();
    });
    firstRun = true;
  }
  if (!S.level) {
    S.level = L.lvl;
    firstRun = true;
  }
  if (firstRun) {
    save();
    return;
  }

  const fresh = earned.filter(b => !S.badges[b.id]);
  const levelUp = L.lvl > S.level;
  if (!fresh.length && !levelUp) {
    return;
  }

  const busy = !$('#sheet').hidden
    || document.getElementById('lock')
    || document.getElementById('auth');
  if (busy) {
    if (badgeTries++ < 60) {
      setTimeout(checkBadges, 1500);
    }
    return;
  }
  badgeTries = 0;

  fresh.forEach(b => {
    S.badges[b.id] = today();
  });
  S.level = Math.max(S.level, L.lvl);
  save();

  if (navigator.vibrate) {
    navigator.vibrate([20, 60, 20]);
  }

  const lvlBox = levelUp
    ? `
      <div class="lvl-up">
        <span class="lvl-badge big num">${L.lvl}</span>
        <b>Awans! Poziom ${L.lvl}</b>
        <span>${L.name}</span>
      </div>`
    : '';

  const cards = fresh
    .map(b => `
      <div class="badge on wide">
        <span class="bi" aria-hidden="true">${b.ic}</span>
        <b>${b.t}</b>
        <span class="small muted">${b.d}</span>
      </div>`)
    .join('');

  let title;
  if (levelUp && !fresh.length) {
    title = '⬆️ Nowy poziom!';
  } else if (fresh.length > 1) {
    title = '🏅 Nowe osiągnięcia!';
  } else {
    title = '🏅 Nowe osiągnięcie!';
  }

  openSheet(title, `
    ${lvlBox}
    ${cards ? `<div class="badges">${cards}</div>` : ''}
    <button class="btn primary block" type="button" data-close>Super</button>
    <button class="btn block" type="button" id="bd-all">Wszystkie osiągnięcia</button>`,
    b => {
      $('#bd-all', b).onclick = showBadges;
    });
}


/* ---------- timer przerwy między seriami ---------- */

const REST_KEY = 'rozpierdol-przerwa';
const REST_CHOICES = [45, 60, 90, 120, 150, 180, 240];

let REST = { end: 0, total: 0 };
let restTimer = null;
let restCtx = null;

try {
  REST = Object.assign(REST, JSON.parse(localStorage.getItem(REST_KEY) || '{}'));
} catch (e) {}

const restSec = () => (S.prefs && S.prefs.rest) || 90;

const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function restSave() {
  try {
    localStorage.setItem(REST_KEY, JSON.stringify(REST));
  } catch (e) {}
}

// iPhone pozwala grać dźwięk dopiero po stuknięciu — „odblokowujemy” go przy starcie przerwy (stuknięcie ✓)
function restAudio() {
  try {
    if (!restCtx) {
      restCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (restCtx.state === 'suspended') {
      restCtx.resume();
    }
  } catch (e) {}
}

// trzy krótkie piknięcia
function restBeep() {
  try {
    const t = restCtx.currentTime;
    [0, 0.25, 0.5].forEach((offset, i) => {
      const gain = restCtx.createGain();
      const osc = restCtx.createOscillator();

      osc.frequency.value = i === 2 ? 1175 : 880;
      osc.connect(gain);
      gain.connect(restCtx.destination);

      gain.gain.setValueAtTime(0.0001, t + offset);
      gain.gain.exponentialRampToValueAtTime(0.35, t + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.2);

      osc.start(t + offset);
      osc.stop(t + offset + 0.22);
    });
  } catch (e) {}
}

function restStart(sec = restSec()) {
  restAudio();
  REST = {
    end: Date.now() + sec * 1000,
    total: sec,
  };
  restSave();
  restTick();
}

function restStop() {
  REST = { end: 0, total: 0 };
  restSave();
  clearTimeout(restTimer);

  const bar = document.getElementById('rest-bar');
  if (bar) {
    bar.remove();
  }
}

function restShift(sec) {
  REST.end = Math.max(Date.now() + 1000, REST.end + sec * 1000);
  REST.total = Math.max(REST.total + sec, 1);
  restSave();
  restTick();
}

function restBar() {
  let bar = document.getElementById('rest-bar');

  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'rest-bar';
    bar.setAttribute('role', 'timer');
    bar.innerHTML = `
      <i class="rest-prog"></i>
      <button type="button" class="rest-t" aria-label="Zmień domyślną długość przerwy"></button>
      <button type="button" data-rs="-15">−15</button>
      <button type="button" data-rs="15">+15</button>
      <button type="button" data-rs="x" aria-label="Zakończ przerwę">✕</button>`;
    document.body.appendChild(bar);

    bar.addEventListener('click', e => {
      const btn = e.target.closest('[data-rs]');
      if (btn) {
        if (btn.dataset.rs === 'x') {
          restStop();
        } else {
          restShift(+btn.dataset.rs);
        }
        return;
      }
      if (e.target.closest('.rest-t')) {
        restPick();
      }
    });
  }

  // nad dolnym paskiem zakładek
  const tabs = document.querySelector('.tabs');
  const tabsH = tabs ? tabs.offsetHeight : 64;
  bar.style.bottom = (tabsH + 10) + 'px';

  return bar;
}

function restTick() {
  clearTimeout(restTimer);

  if (!REST.end) {
    return;
  }
  if (!S.active) {
    restStop();
    return;
  }

  const left = Math.ceil((REST.end - Date.now()) / 1000);
  const bar = restBar();

  if (left > 0) {
    const share = Math.max(0, Math.min(100, left / REST.total * 100));
    bar.classList.remove('over');
    $('.rest-t', bar).innerHTML = `Przerwa <b class="num">${mmss(left)}</b>`;
    $('.rest-prog', bar).style.width = share + '%';
    restTimer = setTimeout(restTick, 250);
    return;
  }

  // koniec przerwy: dźwięk + wibracja (gdy apka jest na wierzchu), komunikat na 5 s
  if (!bar.classList.contains('over')) {
    const justNow = Date.now() - REST.end < 3000;

    bar.classList.add('over');
    $('.rest-t', bar).innerHTML = justNow ? 'Koniec przerwy 💪' : 'Przerwa minęła 💪';
    $('.rest-prog', bar).style.width = '0%';

    if (justNow && !document.hidden) {
      restBeep();
      if (navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
      }
    }

    restTimer = setTimeout(restStop, 5000);
  }
}

function restPick() {
  const choices = REST_CHOICES
    .map(s => `<button class="btn" type="button" data-rc="${s}" aria-pressed="${s === restSec()}">${mmss(s)}</button>`)
    .join('');

  openSheet('Długość przerwy', `
    <p class="muted small" style="margin:0">Timer startuje sam po odhaczeniu serii ✓. Wybierz domyślną długość:</p>
    <div class="rest-choices">${choices}</div>
    <p class="muted small" style="margin:0">Na iPhonie dźwięk nie zagra, gdy telefon jest wyciszony albo zablokowany. Czas i tak liczy się dobrze.</p>`,
    b => {
      $$('[data-rc]', b).forEach(btn => {
        btn.onclick = () => {
          const sec = +btn.dataset.rc;
          S.prefs = Object.assign({}, S.prefs, { rest: sec });
          save();
          closeSheet();
          toast('Przerwa: ' + mmss(sec));

          if (REST.end && REST.end > Date.now()) {
            restStart(sec);
          }
        };
      });
    });
}

// po powrocie do apki / po starcie: dokończ trwającą przerwę
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && REST.end) {
    restTick();
  }
});
setTimeout(() => {
  if (REST.end) {
    restTick();
  }
}, 500);


/* ---------- zakładka Postęp: wykres trendu wagi ---------- */

// średnia krocząca z 7 dni: dla każdego pomiaru średnia ze wszystkich pomiarów z 7 dni do tego dnia
function movingAvg(pts, days = 7) {
  return pts.map(p => {
    const from = addDays(p.d, -(days - 1));
    const win = pts.filter(q => q.d >= from && q.d <= p.d);
    const avg = win.reduce((s, q) => s + q.w, 0) / win.length;
    return { d: p.d, w: avg };
  });
}

const TREND_RANGES = [[30, '30 dni'], [90, '90 dni'], [0, 'Całość']];

function weightTrendHTML() {
  if (S.weights.length < 2) {
    return '';
  }
  return `<section class="card chart" id="trend-card"></section>`;
}

function wireWeightTrend(el) {
  const range = TREND_RANGES.some(([v]) => v === UI.trend) ? UI.trend : 90;
  const all = S.weights;
  const last = all[all.length - 1].d;
  const from = range === 0 ? all[0].d : addDays(last, -range + 1);
  const pts = all.filter(x => x.d >= from);
  const st = stats();

  const buttons = TREND_RANGES
    .map(([v, l]) => `<button type="button" data-tr="${v}" aria-pressed="${v === range}">${l}</button>`)
    .join('');

  const chart = pts.length < 2
    ? '<p class="muted small" style="margin:0">Za mało pomiarów w tym okresie.</p>'
    : trendSVG(pts, st && st.target);

  el.innerHTML = `
    <div class="row">
      <h2>Waga</h2>
      <div class="seg" role="group" aria-label="Zakres wykresu">${buttons}</div>
    </div>
    ${chart}
    <div class="legend">
      <span><i></i>średnia z 7 dni</span>
      <span><i class="dots"></i>pomiary</span>
      ${st && st.target ? '<span><i class="goal"></i>cel</span>' : ''}
    </div>
    <button class="link" type="button" data-go="dieta">Wszystkie wpisy ›</button>`;

  $$('[data-tr]', el).forEach(b => {
    b.onclick = () => {
      UI.trend = +b.dataset.tr;
      wireWeightTrend(el);
    };
  });
}

function trendSVG(pts, target) {
  const W = 340;
  const H = 180;
  const L = 36;
  const R = 8;
  const T = 10;
  const B = 24;

  const avg = movingAvg(pts);
  const vals = pts.map(p => p.w);
  if (target) {
    vals.push(target);
  }

  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const padY = Math.max(0.5, (hi - lo) * 0.08);
  lo -= padY;
  hi += padY;

  const step = [0.5, 1, 2, 2.5, 5, 10, 20].find(s => s >= (hi - lo) / 4) || 50;
  const yLo = Math.floor(lo / step) * step;
  const yHi = Math.ceil(hi / step) * step;

  const d0 = pts[0].d;
  const dn = daysBetween(d0, pts[pts.length - 1].d) || 1;
  const x = d => L + (W - L - R) * daysBetween(d0, d) / dn;
  const y = v => T + (H - T - B) * (1 - (v - yLo) / (yHi - yLo));

  let grid = '';
  for (let v = yLo; v <= yHi + 1e-9; v += step) {
    grid += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`;
    grid += `<text class="lbl" x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${fmt(v, step < 1 ? 1 : 0)}</text>`;
  }

  const xLabels = [pts[0].d, pts[pts.length - 1].d]
    .map((d, i) => `<text class="lbl" x="${x(d).toFixed(1)}" y="${H - 6}" text-anchor="${i ? 'end' : 'start'}">${dayLabel(d)}</text>`)
    .join('');

  const goal = target
    ? `<line class="goal" x1="${L}" x2="${W - R}" y1="${y(target).toFixed(1)}" y2="${y(target).toFixed(1)}"/>
       <text class="lbl goal-l" x="${W - R}" y="${(y(target) - 4).toFixed(1)}" text-anchor="end">cel ${fmt(target, 1)}</text>`
    : '';

  const dots = pts
    .map(p => `<circle class="raw" cx="${x(p.d).toFixed(1)}" cy="${y(p.w).toFixed(1)}" r="2"/>`)
    .join('');

  const line = avg
    .map(p => `${x(p.d).toFixed(1)},${y(p.w).toFixed(1)}`)
    .join(' ');
  const end = avg[avg.length - 1];

  return `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Trend wagi">
      ${grid}
      ${goal}
      ${dots}
      <polyline class="avg" points="${line}"/>
      <circle class="end" cx="${x(end.d).toFixed(1)}" cy="${y(end.w).toFixed(1)}" r="4.5"/>
      ${xLabels}
    </svg>`;
}


/* ---------- zakładka Postęp: serie na partie w ostatnich 7 dniach (poziome paski) ---------- */

function muscleBarsHTML() {
  if (!S.workouts.length) {
    return '';
  }

  const data = muscleSets(7);
  const rows = Object.entries(data)
    .map(([m, o]) => ({ m, v: muscleScore(o) }))
    .filter(r => r.v > 0)
    .sort((a, b) => b.v - a.v);

  const max = Math.max(10, ...rows.map(r => r.v));

  const list = rows.length
    ? rows
      .map(r => {
        const lv = muscleLevel(r.v, 7);
        const width = Math.max(4, Math.round(r.v / max * 100));
        const vTxt = fmt(r.v, r.v % 1 ? 1 : 0);
        return `
          <button class="mbar" type="button" data-mbar="${r.m}">
            <span class="mbar-l">${MUSCLE[r.m] || r.m}</span>
            <span class="mbar-t"><i class="l${lv}" style="width:${width}%"></i></span>
            <span class="mbar-v num">${vTxt}</span>
          </button>`;
      })
      .join('')
    : '<p class="muted small" style="margin:0">W ostatnich 7 dniach nie było treningów siłowych.</p>';

  return `
    <section class="card" id="mbars">
      <div class="row">
        <h2>Partie w tygodniu</h2>
        <span class="muted small">serie, 7 dni</span>
      </div>
      <div class="mbars">${list}</div>
    </section>`;
}

function wireMuscleBars(el) {
  $$('[data-mbar]', el).forEach(b => {
    b.onclick = () => {
      UI.mDays = 7;
      showMuscle(b.dataset.mbar);
    };
  });
}


/* ---------- górny pasek: poziom, XP i ikona użytkownika (otwiera Ustawienia) ---------- */

const USER_ICON = `
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
    <circle cx="12" cy="8.5" r="3.6"/>
    <path d="M4.8 20c1.2-3.6 4-5.4 7.2-5.4s6 1.8 7.2 5.4"/>
  </svg>`;

function updateTopbar() {
  const lvlBtn = document.getElementById('tb-level');
  const userBtn = document.getElementById('tb-user');
  if (!lvlBtn || !userBtn) {
    return;
  }

  const L = levelInfo();
  const xpTxt = L.next
    ? `${fmtN(L.xp)} / ${fmtN(L.next)} XP`
    : `${fmtN(L.xp)} XP · max`;

  // druga linijka paska: [poziom] nazwa ▬▬▬ XP — wszystko w jednym rzędzie
  lvlBtn.innerHTML = `
    <span class="tb-lvl num">${L.lvl}</span>
    <span class="tb-name">${esc(L.name)}</span>
    <span class="tb-bar"><i style="width:${L.pct}%"></i></span>
    <span class="tb-xp num">${xpTxt}</span>`;
  lvlBtn.setAttribute('aria-label', `Poziom ${L.lvl}, ${L.name}, ${xpTxt}`);

  // nazwa ekranu = nagłówek bieżącego widoku (ten na samym ekranie jest ukryty)
  const h1 = document.querySelector(`#view-${UI.tab} .vhead h1`);
  const title = document.getElementById('tb-title');
  if (title) {
    title.textContent = h1 ? h1.textContent : '';
    fitTopbarTitle();
    requestAnimationFrame(fitTopbarTitle);
  }

  // inicjał z e-maila zalogowanego konta, inaczej ikonka ludzika
  const email = typeof SY !== 'undefined' && SY.session && SY.session.email;
  const initial = email ? email.trim()[0].toUpperCase() : '';
  userBtn.innerHTML = initial
    ? `<span class="tb-initial">${esc(initial)}</span>`
    : USER_ICON;
  userBtn.classList.toggle('on', UI.tab === 'wiecej');
}

// długa nazwa (np. „Graf trenowanych partii mięśniowych”): zmniejszaj czcionkę, aż się zmieści
function fitTopbarTitle() {
  const title = document.getElementById('tb-title');
  if (!title || !title.clientWidth) {
    return;
  }
  let size = 22;
  title.style.fontSize = size + 'px';
  while (title.scrollWidth > title.clientWidth && size > 14) {
    size--;
    title.style.fontSize = size + 'px';
  }
}

// czcionka z nagłówków ładuje się chwilę po starcie i ma inną szerokość — dopasuj jeszcze raz
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(fitTopbarTitle);
}
window.addEventListener('resize', fitTopbarTitle);

let topbarTimer = null;
function scheduleTopbar() {
  clearTimeout(topbarTimer);
  topbarTimer = setTimeout(updateTopbar, 400);
}

function openSettings() {
  if (UI.tab === 'wiecej') {
    goBack();
    return;
  }
  setTab('wiecej');
}

document.addEventListener('click', e => {
  if (e.target.closest('#tb-user')) {
    openSettings();
  } else if (e.target.closest('#tb-level')) {
    showLevels();
  }
});

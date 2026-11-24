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
  ['ca', '🏃 Cardio'],
  ['ci', '⚖️ Waga i ciało'],
  ['in', '✨ Inne'],
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

  /* ---- nowe (listopad 2026) ---- */
  // treningi
  { c: 'tr', id: 'w300', ic: '🏰', t: '300 treningów', d: 'Zapisz 300 treningów', k: 'w', g: 300 },
  { c: 'tr', id: 'w500', ic: '🌌', t: '500 treningów', d: 'Zapisz 500 treningów', k: 'w', g: 500 },
  { c: 'tr', id: 'set5k', ic: '🔂', t: '5000 serii', d: 'Zrób łącznie 5000 serii', k: 'sets', g: 5000 },
  { c: 'tr', id: 'set10k', ic: '🌀', t: '10 000 serii', d: 'Zrób łącznie 10 000 serii', k: 'sets', g: 10000 },
  { c: 'tr', id: 'ex50', ic: '🗺️', t: 'Podróżnik', d: 'Zrób 50 różnych ćwiczeń', k: 'exN', g: 50 },
  { c: 'tr', id: 'ex100', ic: '🧰', t: 'Encyklopedia', d: 'Zrób 100 różnych ćwiczeń', k: 'exN', g: 100 },
  { c: 'tr', id: 'exMax8', ic: '🍱', t: 'Pełny talerz', d: '8 ćwiczeń w jednym treningu', k: 'exMax', g: 8 },
  { c: 'tr', id: 'setMax30', ic: '🧱', t: 'Ściana serii', d: '30 serii w jednym treningu', k: 'setMax', g: 30 },
  { c: 'tr', id: 'wknd10', ic: '🛋️', t: 'Weekendowy wojownik', d: '10 treningów w sobotę albo niedzielę', k: 'wknd', g: 10 },
  { c: 'tr', id: 'early10', ic: '☀️', t: 'Skowronek', d: '10 treningów przed 7:00', k: 'early', g: 10 },
  { c: 'tr', id: 'late10', ic: '🌙', t: 'Sowa', d: '10 treningów po 22:00', k: 'late', g: 10 },
  // siła
  { c: 'si', id: 'kg250', ic: '🦏', t: '250 kg', d: 'Seria z ciężarem 250 kg lub więcej', k: 'kg', g: 250, u: ' kg' },
  { c: 'si', id: 'ton30', ic: '🚢', t: '30 ton', d: 'Objętość jednego treningu: 30 000 kg', k: 'vol', g: 30000, u: ' kg' },
  { c: 'si', id: 'tot5k', ic: '🏔️', t: '5000 ton łącznie', d: 'Podnieś łącznie 5 000 000 kg', k: 'volT', g: 5000000, u: ' kg' },
  { c: 'si', id: 'reps50', ic: '🔟', t: 'Maraton powtórzeń', d: '50 powtórzeń w jednej serii', k: 'reps', g: 50 },
  { c: 'si', id: 'reps100', ic: '💯', t: 'Setka', d: '100 powtórzeń w jednej serii', k: 'reps', g: 100 },
  // rekordy
  { c: 're', id: 'pr250', ic: '🔱', t: '250 rekordów', d: 'Pobij 250 rekordów osobistych', k: 'pr', g: 250 },
  { c: 're', id: 'pr500', ic: '🪐', t: '500 rekordów', d: 'Pobij 500 rekordów osobistych', k: 'pr', g: 500 },
  { c: 're', id: 'prDay3', ic: '🎆', t: 'Dzień rekordów', d: '3 rekordy w jednym treningu', k: 'prMax', g: 3 },
  { c: 're', id: 'prDay5', ic: '🎇', t: 'Rekordowy dzień', d: '5 rekordów w jednym treningu', k: 'prMax', g: 5 },
  { c: 're', id: 'drop100', ic: '🧗', t: 'Dropsetowy maniak', d: 'Zrób 100 dropsetów', k: 'drop', g: 100 },
  // regularność
  { c: 'rg', id: 'wk26', ic: '🗓️', t: 'Pół roku z planem', d: 'Cel treningów na tydzień 26 tygodni z rzędu', k: 'wk', g: 26 },
  { c: 'rg', id: 'wk52', ic: '🏆', t: 'Rok z planem', d: 'Cel treningów na tydzień 52 tygodnie z rzędu', k: 'wk', g: 52 },
  { c: 'rg', id: 'mo12', ic: '🌕', t: 'Rok w grze', d: 'Treningi w 12 różnych miesiącach', k: 'mo', g: 12 },
  { c: 'rg', id: 'td3', ic: '📈', t: '3 dni z rzędu', d: 'Trenuj 3 dni z rzędu', k: 'td', g: 3 },
  { c: 'rg', id: 'td7', ic: '🚀', t: 'Tydzień bez przerwy', d: 'Trenuj 7 dni z rzędu', k: 'td', g: 7 },
  { c: 'rg', id: 's200', ic: '💫', t: '200 dni ważenia', d: 'Waż się 200 dni z rzędu', k: 'st', g: 200 },
  { c: 'rg', id: 's365', ic: '🌠', t: 'Rok ważenia', d: 'Waż się 365 dni z rzędu', k: 'st', g: 365 },
  // cardio
  { c: 'ca', id: 'c1', ic: '👟', t: 'Pierwsze cardio', d: 'Zapisz pierwszy trening cardio', k: 'cN', g: 1 },
  { c: 'ca', id: 'c25', ic: '🏃', t: '25 razy cardio', d: 'Zapisz 25 treningów cardio', k: 'cN', g: 25 },
  { c: 'ca', id: 'km10', ic: '🛣️', t: 'Pierwsze 10 km', d: 'Łącznie 10 km cardio', k: 'km', g: 10, u: ' km' },
  { c: 'ca', id: 'km42', ic: '🏅', t: 'Maraton', d: 'Łącznie 42,2 km cardio', k: 'km', g: 42.2, u: ' km' },
  { c: 'ca', id: 'km100', ic: '🚴', t: '100 km', d: 'Łącznie 100 km cardio', k: 'km', g: 100, u: ' km' },
  { c: 'ca', id: 'km500', ic: '🌍', t: '500 km', d: 'Łącznie 500 km cardio', k: 'km', g: 500, u: ' km' },
  { c: 'ca', id: 'cmin600', ic: '⏱️', t: '10 godzin cardio', d: 'Łącznie 600 minut cardio', k: 'cMin', g: 600, u: ' min' },
  { c: 'ca', id: 'kmMax10', ic: '🎽', t: 'Dycha', d: '10 km w jednym treningu', k: 'kmMax', g: 10, u: ' km' },
  // waga i ciało
  { c: 'ci', id: 'g75', ic: '🎯', t: 'Na ostatniej prostej', d: '75% drogi do celu wagi', k: 'goal', g: 75, u: '%' },
  { c: 'ci', id: 'kg5', ic: '📉', t: 'Pierwsze 5 kg', d: '5 kg w stronę celu wagi', k: 'prog', g: 5, u: ' kg' },
  { c: 'ci', id: 'kg10c', ic: '🪶', t: '10 kg', d: '10 kg w stronę celu wagi', k: 'prog', g: 10, u: ' kg' },
  { c: 'ci', id: 'kg20c', ic: '🦋', t: '20 kg', d: '20 kg w stronę celu wagi', k: 'prog', g: 20, u: ' kg' },
  { c: 'ci', id: 'wi500', ic: '🗃️', t: '500 ważeń', d: 'Zapisz 500 pomiarów wagi', k: 'wi', g: 500 },
  { c: 'ci', id: 'm50', ic: '🧵', t: 'Mistrz centymetra', d: 'Zapisz 50 pomiarów ciała', k: 'ms', g: 50 },
  // inne
  { c: 'in', id: 'prof', ic: '🪪', t: 'Wizytówka', d: 'Uzupełnij cały profil: wzrost, płeć, rok urodzenia, aktywność i cel', k: 'prof', g: 1 },
  { c: 'in', id: 'fav10', ic: '⭐', t: 'Ulubieniec', d: 'Dodaj 10 ćwiczeń do ulubionych', k: 'fav', g: 10 },
  { c: 'in', id: 'custom1', ic: '🛠️', t: 'Konstruktor', d: 'Dodaj własne ćwiczenie', k: 'cust', g: 1 },
  { c: 'in', id: 'plan10', ic: '📚', t: 'Strateg', d: 'Ułóż 10 planów treningowych', k: 'plans', g: 10 },
  { c: 'in', id: 'share1', ic: '🤝', t: 'Drużyna', d: 'Udostępnij coś innej osobie', k: 'share', g: 1 },
];

// najdłuższa seria tygodni z wykonanym celem treningów (cała historia, nie tylko bieżąca)
function bestWeekStreak() {
  const t = S.profile.weekly;
  if (!t || !S.workouts.length) {
    return 0;
  }
  let ws = weekStart(S.workouts[0].date);
  const last = weekStart(today());
  let best = 0;
  let cur = 0;
  while (ws <= last) {
    cur = workoutsInWeek(ws) >= t ? cur + 1 : 0;
    best = Math.max(best, cur);
    ws = addDays(ws, 7);
  }
  return best;
}

// najdłuższa seria kolejnych dni z treningiem
function bestTrainDays() {
  const days = [...new Set(S.workouts.map(w => w.date))].sort();
  let best = 0;
  let cur = 0;
  let prev = null;
  days.forEach(d => {
    cur = prev && addDays(prev, 1) === d ? cur + 1 : 1;
    best = Math.max(best, cur);
    prev = d;
  });
  return best;
}

function achVals() {
  let kg = 0;
  let vol = 0;
  let volT = 0;
  let drop = 0;
  let sets = 0;
  let early = 0;
  let late = 0;
  let wknd = 0;
  let exMax = 0;
  let setMax = 0;
  let reps = 0;
  let cN = 0;
  let km = 0;
  let kmMax = 0;
  let cMin = 0;
  const exIds = new Set();
  const months = new Set();

  S.workouts.forEach(w => {
    const v = volume(w);
    vol = Math.max(vol, v);
    volT += v;
    months.add((w.date || '').slice(0, 7));

    const dow = parseD(w.date).getDay();
    if (dow === 0 || dow === 6) {
      wknd++;
    }

    // ćwiczenia z wpisanymi seriami, serie w tym treningu, cardio w tym treningu
    const doneEx = w.ex.filter(e => e.sets.some(filled));
    exMax = Math.max(exMax, doneEx.length);
    setMax = Math.max(setMax, w.ex.reduce((s, e) => s + countSets(e.sets), 0));

    const cardioSets = w.ex
      .filter(e => isCardio(EXMAP[e.id]))
      .flatMap(e => e.sets.filter(filled));
    if (cardioSets.length) {
      cN++;
      const wKm = cardioSets.reduce((s, x) => s + (x.b || 0), 0);
      km += wKm;
      kmMax = Math.max(kmMax, wKm);
      cMin += cardioSets.reduce((s, x) => s + (x.a || 0), 0);
    }

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
          if ((s.b || 0) > reps) {
            reps = s.b;
          }
        });
    });
  });

  const st = stats();
  const prLists = Object.values(prTimeline().byW);
  const prCount = prLists.reduce((sum, list) => sum + list.length, 0);
  const prMax = Math.max(0, ...prLists.map(list => list.length));

  const p = S.profile;
  const profileFull = p.height && p.sex && p.born && p.activity && p.goalType ? 1 : 0;

  return {
    w: S.workouts.length,
    sets,
    kg,
    vol,
    volT,
    drop,
    early,
    late,
    wknd,
    exMax,
    setMax,
    reps,
    exN: exIds.size,
    mo: months.size,
    plans: S.plans.length,
    pr: prCount,
    prMax,
    wk: Math.max(weeklyStreak(), bestWeekStreak()),
    td: bestTrainDays(),
    st: bestWeighStreak(),
    cN,
    km: Math.round(km * 10) / 10,
    kmMax: Math.round(kmMax * 10) / 10,
    cMin: Math.round(cMin),
    wi: S.weights.length,
    ms: (S.measures || []).length,
    goal: st && st.pct != null
      ? Math.floor(st.pct)
      : 0,
    prog: st && st.prog != null && st.prog > 0
      ? Math.floor(st.prog * 10) / 10
      : 0,
    prof: profileFull,
    fav: S.fav.length,
    cust: (S.custom || []).length,
    share: ((S.share || {}).viewers || []).length,
  };
}

// stara nazwa (używana w innych miejscach)
const badgeVals = achVals;

// zdobyte = spełniony warunek ALBO już kiedyś zdobyte (np. seria „z rzędu” mogła się potem przerwać)
const badgeEarned = (b, v) => (v[b.k] || 0) >= b.g
  || !!(S.badges && S.badges[b.id]);

function badgeCount() {
  const v = achVals();
  const got = BADGES.filter(b => badgeEarned(b, v)).length;
  return `${got}/${BADGES.length}`;
}


/* ---------- poziomy użytkownika (XP) ---------- */

// poziomy bez nazw — po prostu numery od 1 do 30
const LEVEL_MAX = 30;

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
  const max = LEVEL_MAX;

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
    xp,
    cur,
    next,
    pct,
    // licznik w obrębie bieżącego poziomu: ile XP zebrane na tym poziomie i ile ten poziom wymaga
    inLvl: xp - cur,
    need: next ? next - cur : 0,
  };
}

function levelCardHTML() {
  const L = levelInfo();
  const sub = L.next
    ? `${fmtN(L.inLvl)} / ${fmtN(L.need)} XP · do poziomu ${L.lvl + 1}: ${fmtN(L.next - L.xp)} XP`
    : `najwyższy poziom! · łącznie ${fmtN(L.xp)} XP`;

  return `
    <button class="card level-card" type="button" id="level-card">
      <span class="lvl-badge num">${L.lvl}</span>
      <span class="grow">
        <span class="lvl-t"><b>Poziom ${L.lvl}</b> <span class="muted">z ${LEVEL_MAX}</span></span>
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

  const levels = Array.from({ length: LEVEL_MAX }, (_, i) => i + 1)
    .map(n => {
      const cls = n < L.lvl ? 'done' : n === L.lvl ? 'cur' : '';
      return `
        <div class="lvl-row ${cls}">
          <span class="lvl-badge sm num">${n}</span>
          <span class="grow">Poziom ${n}</span>
          <span class="small muted num">${n < LEVEL_MAX ? fmtN(levelXP(n + 1) - levelXP(n)) + ' XP' : 'ostatni'}</span>
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
        <span class="muted">${L.next ? `do poziomu ${L.lvl + 1}: ${fmtN(L.next - L.xp)} XP` : 'najwyższy poziom!'}</span>
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

// czy w „Partiach w tygodniu” liczyć serie, w których partia pracowała pomocniczo (po ½)
const mbarsHelp = () => !(S.prefs && S.prefs.mbarsHelp === false);

function muscleBarsHTML() {
  if (!S.workouts.length) {
    return '';
  }

  return `<section class="card" id="mbars">${muscleBarsInner()}</section>`;
}

function muscleBarsInner() {
  const withHelp = mbarsHelp();
  const data = muscleSets(7);
  const rows = Object.entries(data)
    .map(([m, o]) => ({
      m,
      v: withHelp ? muscleScore(o) : o.main,
    }))
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
    <div class="row">
      <h2>Partie w tygodniu</h2>
      <span class="muted small">serie, 7 dni</span>
    </div>
    <label class="pref-row mbars-help">
      <span class="grow">
        <span class="pref-l">Licz partie pomocnicze</span>
        <span class="small muted">np. triceps przy wyciskaniu (po ½ serii)</span>
      </span>
      <input type="checkbox" class="switch" role="switch" id="mbars-help" ${withHelp ? 'checked' : ''}>
    </label>
    <div class="mbars">${list}</div>`;
}

function wireMuscleBars(el) {
  $$('[data-mbar]', el).forEach(b => {
    b.onclick = () => {
      UI.mDays = 7;
      showMuscle(b.dataset.mbar);
    };
  });

  const sw = $('#mbars-help', el);
  if (sw) {
    sw.onchange = () => {
      S.prefs = Object.assign({}, S.prefs, { mbarsHelp: sw.checked });
      save();
      // przerysuj tylko tę kartę (bez skakania całego ekranu)
      el.innerHTML = muscleBarsInner();
      wireMuscleBars(el);
    };
  }
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
    ? `${fmtN(L.inLvl)} / ${fmtN(L.need)} XP`
    : `max · ${fmtN(L.xp)} XP`;

  // druga linijka paska: „Poziom N” ▬▬▬ XP — wszystko w jednym rzędzie
  lvlBtn.innerHTML = `
    <span class="tb-name">Poziom ${L.lvl}</span>
    <span class="tb-bar"><i style="width:${L.pct}%"></i></span>
    <span class="tb-xp num">${xpTxt}</span>`;
  lvlBtn.setAttribute('aria-label', `Poziom ${L.lvl} z ${LEVEL_MAX}, ${xpTxt}`);

  // nazwa ekranu = nagłówek bieżącego widoku (ten na samym ekranie jest ukryty)
  const h1 = document.querySelector(`#view-${UI.tab} .vhead h1`);
  const title = document.getElementById('tb-title');
  if (title) {
    title.textContent = h1 ? h1.textContent : '';

    // dzisiejsza data obok nazwy ekranu, np. „wt., 24 lis”
    const date = document.getElementById('tb-date');
    if (date) {
      date.textContent = new Date().toLocaleDateString('pl-PL', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      });
    }
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

  // kropka = nieprzeczytane powiadomienia (np. ktoś coś udostępnił)
  const unread = typeof unreadCount === 'function' ? unreadCount() : 0;
  userBtn.classList.toggle('dot', unread > 0);
  userBtn.setAttribute('aria-label', unread
    ? `Ustawienia i konto, ${unread} nowe powiadomienia`
    : 'Ustawienia i konto');
}

// długa nazwa (np. „Graf trenowanych partii mięśniowych”): zmniejszaj czcionkę, aż się zmieści
function fitTopbarTitle() {
  const title = document.getElementById('tb-title');
  const date = document.getElementById('tb-date');
  if (!title || !title.clientWidth) {
    return;
  }

  const fit = min => {
    let size = 22;
    title.style.fontSize = size + 'px';
    while (title.scrollWidth > title.clientWidth && size > min) {
      size--;
      title.style.fontSize = size + 'px';
    }
    return title.scrollWidth <= title.clientWidth;
  };

  // najpierw z datą; jeśli nazwa nie mieści się nawet w 17 px — chowamy datę i dopasowujemy jeszcze raz
  if (date) {
    date.hidden = false;
  }
  if (!fit(17) && date) {
    date.hidden = true;
    fit(14);
  }
}

// czcionka z nagłówków ładuje się chwilę po starcie i ma inną szerokość — dopasuj jeszcze raz
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(fitTopbarTitle);
}
window.addEventListener('resize', fitTopbarTitle);

// Zwijanie paska przy przewijaniu: w dół za 40 px → bez nazwy ekranu, z powrotem przy samej górze.
// Dwa różne progi (40 / 12 px), żeby pasek nie „mrugał” przy przewijaniu w okolicach jednego punktu.
let tbCompact = false;
let tbTicking = false;

function onTopbarScroll() {
  tbTicking = false;
  const y = window.scrollY;
  const bar = document.getElementById('topbar');
  if (!bar) {
    return;
  }

  if (!tbCompact && y > 40) {
    tbCompact = true;
    bar.classList.add('compact');
  } else if (tbCompact && y < 12) {
    tbCompact = false;
    bar.classList.remove('compact');
  }
}

window.addEventListener('scroll', () => {
  if (!tbTicking) {
    tbTicking = true;
    requestAnimationFrame(onTopbarScroll);
  }
}, { passive: true });

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

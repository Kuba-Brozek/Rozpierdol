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
    min: ws.reduce((sum, w) => sum + (durMin(w) || 0), 0),
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

  const tile = (k, v, s) => `
    <div class="ms-t">
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
  const timeTxt = c.min >= 60
    ? fmt(c.min / 60, 1) + ' h'
    : c.min + ' min';
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
      ${tile('Czas', timeTxt)}
      ${tile('Rekordy', c.prs ? '🏆 ' + c.prs : '0')}
      ${tile('Waga', weightTxt, c.wch == null ? 'za mało pomiarów' : 'kg w miesiącu')}
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


/* ---------- odznaki ---------- */

// k = który licznik z badgeVals(), g = ile trzeba, u = jednostka do paska postępu
const BADGES = [
  { id: 'w1', ic: '🎉', t: 'Pierwszy trening', d: 'Zapisz pierwszy trening', k: 'w', g: 1 },
  { id: 'w10', ic: '💪', t: '10 treningów', d: 'Zapisz 10 treningów', k: 'w', g: 10 },
  { id: 'w50', ic: '🦾', t: '50 treningów', d: 'Zapisz 50 treningów', k: 'w', g: 50 },
  { id: 'w100', ic: '🏛️', t: '100 treningów', d: 'Zapisz 100 treningów', k: 'w', g: 100 },
  { id: 'kg100', ic: '🏋️', t: 'Pierwsze 100 kg', d: 'Seria z ciężarem 100 kg lub więcej', k: 'kg', g: 100, u: ' kg' },
  { id: 'ton10', ic: '🚛', t: '10 ton', d: 'Objętość jednego treningu: 10 000 kg', k: 'vol', g: 10000, u: ' kg' },
  { id: 'pr10', ic: '🏆', t: '10 rekordów', d: 'Pobij 10 rekordów osobistych', k: 'pr', g: 10 },
  { id: 'pr50', ic: '👑', t: '50 rekordów', d: 'Pobij 50 rekordów osobistych', k: 'pr', g: 50 },
  { id: 'drop', ic: '↘️', t: 'Dropset', d: 'Zrób pierwszy dropset', k: 'drop', g: 1 },
  { id: 'wk4', ic: '📅', t: 'Plan na 4 tygodnie', d: 'Cel treningów na tydzień 4 tygodnie z rzędu', k: 'wk', g: 4 },
  { id: 's7', ic: '🔥', t: 'Tydzień ważenia', d: 'Waż się 7 dni z rzędu', k: 'st', g: 7 },
  { id: 's30', ic: '☄️', t: 'Miesiąc ważenia', d: 'Waż się 30 dni z rzędu', k: 'st', g: 30 },
  { id: 'm5', ic: '📏', t: 'Pod kontrolą', d: 'Zapisz 5 pomiarów ciała', k: 'ms', g: 5 },
  { id: 'goal', ic: '🎯', t: 'Cel osiągnięty', d: 'Osiągnij cel wagi z profilu', k: 'goal', g: 100, u: '%' },
];

function badgeVals() {
  let kg = 0;
  let vol = 0;
  let drop = 0;

  S.workouts.forEach(w => {
    vol = Math.max(vol, volume(w));

    w.ex.forEach(e => {
      if (isCardio(EXMAP[e.id])) {
        return;
      }
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
    kg,
    vol,
    drop,
    pr: prCount,
    wk: weeklyStreak(),
    st: bestWeighStreak(),
    ms: (S.measures || []).length,
    goal: st && st.pct != null
      ? Math.floor(st.pct)
      : 0,
  };
}

const badgeEarned = (b, v) => (v[b.k] || 0) >= b.g;

function badgeCount() {
  const v = badgeVals();
  const got = BADGES.filter(b => badgeEarned(b, v)).length;
  return `${got}/${BADGES.length}`;
}

function badgeCardHTML(b, v, got) {
  const ok = badgeEarned(b, v);
  const have = Math.min(v[b.k] || 0, b.g);
  const pct = Math.round(have / b.g * 100);
  const unit = b.u || '';

  const footer = ok
    ? `<span class="small good-t">✓ ${got[b.id] ? dayLabel(got[b.id]) : 'zdobyta'}</span>`
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
  const v = badgeVals();
  const got = S.badges || {};

  openSheet('🎖️ Odznaki', `
    <div class="badges">
      ${BADGES
        .map(b => badgeCardHTML(b, v, got))
        .join('')}
    </div>
    <button class="btn block" type="button" data-close>OK</button>`);
}

// Po zapisaniu treningu / wagi: nowe odznaki → gratulacje (gdy nie ma innego okna na ekranie)
let badgeTries = 0;

function checkBadges() {
  if (typeof EX_STATE !== 'undefined' && EX_STATE === 'loading') {
    setTimeout(checkBadges, 1500);
    return;
  }

  const v = badgeVals();
  const earned = BADGES.filter(b => badgeEarned(b, v));

  // pierwszy raz (konta sprzed odznak): zapisz to, co już zdobyte, bez wyskakującego okna
  if (!S.badges) {
    S.badges = {};
    earned.forEach(b => {
      S.badges[b.id] = today();
    });
    save();
    return;
  }

  const fresh = earned.filter(b => !S.badges[b.id]);
  if (!fresh.length) {
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
  save();

  if (navigator.vibrate) {
    navigator.vibrate([20, 60, 20]);
  }

  const title = fresh.length > 1 ? '🎖️ Nowe odznaki!' : '🎖️ Nowa odznaka!';
  const cards = fresh
    .map(b => `
      <div class="badge on wide">
        <span class="bi" aria-hidden="true">${b.ic}</span>
        <b>${b.t}</b>
        <span class="small muted">${b.d}</span>
      </div>`)
    .join('');

  openSheet(title, `
    <div class="badges">${cards}</div>
    <button class="btn primary block" type="button" data-close>Super</button>
    <button class="btn block" type="button" id="bd-all">Wszystkie odznaki</button>`,
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

/* ============ Kalendarz ============
   Miesiąc w kratkach: treningi, ważenia, pomiary ciała i zaplanowane treningi.
   Stuknięcie w dzień otwiera szczegóły; na dziś i przyszłe dni można zaplanować trening z planu.
   Zaplanowane treningi: S.planned = [{ id, d: 'RRRR-MM-DD', planId }] (synchronizują się z kontem).
   Plik ładuje się PRZED app.js — na górnym poziomie tylko definicje. */

const CAL_DOW = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'];

const planned = () => S.planned || [];
const planById = id => S.plans.find(p => p.id === id);

function calMonthStart(off) {
  const d = parseD(today());
  d.setDate(1);
  d.setMonth(d.getMonth() + off);
  return dstr(d);
}

// wszystko, co wydarzyło się w danym dniu
function dayInfo(d) {
  const workouts = S.workouts.filter(w => w.date === d);
  const weight = S.weights.find(x => x.d === d) || null;
  const measure = (S.measures || []).find(x => x.d === d) || null;
  const plans = planned()
    .filter(p => p.d === d)
    .map(p => Object.assign({}, p, {
      plan: planById(p.planId),
      // zaplanowany trening uznajemy za zrobiony, gdy tego dnia jest trening z tego planu
      done: workouts.some(w => w.planId === p.planId),
    }));
  return { workouts, weight, measure, plans };
}

function renderKalendarz() {
  const body = $('#kalendarz-body');
  const off = UI.calOff || 0;
  const first = calMonthStart(off);
  const fd = parseD(first);
  const y = fd.getFullYear();
  const m = fd.getMonth();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const lead = (fd.getDay() + 6) % 7; // ile pustych kratek przed 1. dniem (tydzień od poniedziałku)

  // kratki dni
  let cells = '';
  for (let i = 0; i < lead; i++) {
    cells += '<span class="cal-cell empty"></span>';
  }
  let trainDays = 0;
  let weighDays = 0;
  for (let n = 1; n <= daysInMonth; n++) {
    const d = addDays(first, n - 1);
    const info = dayInfo(d);
    if (info.workouts.length) {
      trainDays++;
    }
    if (info.weight) {
      weighDays++;
    }

    const cls = [
      'cal-cell',
      d === today() ? 'today' : '',
      d > today() ? 'future' : '',
      info.workouts.length ? 'trained' : '',
      info.plans.some(p => !p.done) ? 'planned' : '',
    ].filter(Boolean).join(' ');

    const dots = [
      info.workouts.length ? '<i class="dt-w"></i>' : '',
      info.weight ? '<i class="dt-k"></i>' : '',
      info.measure ? '<i class="dt-m"></i>' : '',
    ].join('');

    cells += `
      <button type="button" class="${cls}" data-day="${d}" aria-label="${dayLabel(d, { weekday: 'long', day: 'numeric', month: 'long' })}">
        <span class="cal-n">${n}</span>
        <span class="cal-dots">${dots}</span>
      </button>`;
  }

  // najbliższe zaplanowane treningi (od dziś)
  const upcoming = planned()
    .filter(p => p.d >= today())
    .sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : 0)
    .slice(0, 5)
    .map(p => {
      const plan = planById(p.planId);
      const when = p.d === today()
        ? 'dziś'
        : p.d === addDays(today(), 1)
          ? 'jutro'
          : dayLabel(p.d, { weekday: 'long', day: 'numeric', month: 'short' });
      return `
        <button class="li" type="button" data-day="${p.d}">
          <span class="nav-ic" aria-hidden="true">📋</span>
          <div class="grow">
            <div class="t">${esc(plan ? plan.name : 'Usunięty plan')}</div>
            <div class="s">${when}</div>
          </div>
          <span class="chev" aria-hidden="true">›</span>
        </button>`;
    })
    .join('');

  body.innerHTML = `
    <section class="card cal">
      <div class="row">
        <button class="icon-btn" type="button" data-cal="-1" aria-label="Poprzedni miesiąc">‹</button>
        <h2 class="cal-title">${MONTHS[m]} ${y}</h2>
        <button class="icon-btn" type="button" data-cal="1" aria-label="Następny miesiąc">›</button>
      </div>
      <div class="cal-grid">
        ${CAL_DOW.map(x => `<span class="cal-dow">${x}</span>`).join('')}
        ${cells}
      </div>
      <div class="cal-legend small muted">
        <span><i class="dt-w"></i>trening</span>
        <span><i class="dt-k"></i>ważenie</span>
        <span><i class="dt-m"></i>pomiar ciała</span>
        <span><i class="dt-p"></i>zaplanowany</span>
      </div>
      ${off !== 0 ? '<button class="link" type="button" data-cal="0">Wróć do dzisiaj</button>' : ''}
    </section>
    <div class="tiles">
      <div class="tile">
        <span class="k">Dni z treningiem</span>
        <span class="v">${trainDays}</span>
        <span class="d">w tym miesiącu</span>
      </div>
      <div class="tile">
        <span class="k">Ważenia</span>
        <span class="v">${weighDays}</span>
        <span class="d">z ${daysInMonth} dni</span>
      </div>
      <div class="tile">
        <span class="k">Zaplanowane</span>
        <span class="v">${planned().filter(p => p.d >= today()).length}</span>
        <span class="d">od dziś</span>
      </div>
    </div>
    <section class="view" style="gap:10px">
      <div class="row">
        <h3>Najbliższe plany</h3>
      </div>
      ${upcoming
        ? `<div class="list">${upcoming}</div>`
        : '<p class="muted small" style="margin:0">Nic nie zaplanowane. Stuknij dzień w kalendarzu, żeby zaplanować trening.</p>'}
    </section>`;

  $$('[data-cal]', body).forEach(b => {
    b.onclick = () => {
      const v = +b.dataset.cal;
      UI.calOff = v === 0 ? 0 : off + v;
      renderKalendarz();
    };
  });
  $$('[data-day]', body).forEach(b => {
    b.onclick = () => showDay(b.dataset.day);
  });
}

// szczegóły dnia: co było + planowanie
function showDay(d) {
  const info = dayInfo(d);
  const isPast = d < today();
  const isToday = d === today();

  const workouts = info.workouts.length
    ? `<div class="list">${info.workouts
      .map(w => `
        <button class="li" type="button" data-w="${w.id}">
          <span class="nav-ic" aria-hidden="true">🏋️</span>
          <div class="grow">
            <div class="t">${esc(w.planName || 'Trening')}</div>
            <div class="s">${w.ex.map(e => esc(exName(EXMAP[e.id]))).slice(0, 3).join(', ')}${w.ex.length > 3 ? ` +${w.ex.length - 3}` : ''}</div>
          </div>
          <span class="chev" aria-hidden="true">›</span>
        </button>`)
      .join('')}</div>`
    : '';

  const weight = info.weight
    ? `<button class="li" type="button" id="day-weight">
        <span class="nav-ic" aria-hidden="true">⚖️</span>
        <div class="grow"><div class="t">Waga</div></div>
        <div class="r num"><b>${fmt(info.weight.w, 2)}</b> kg</div>
      </button>`
    : '';

  const measure = info.measure
    ? `<button class="li" type="button" id="day-measure">
        <span class="nav-ic" aria-hidden="true">📏</span>
        <div class="grow"><div class="t">Pomiar ciała</div></div>
        <span class="chev" aria-hidden="true">›</span>
      </button>`
    : '';

  const plannedList = info.plans
    .map(p => `
      <div class="li">
        <span class="nav-ic" aria-hidden="true">${p.done ? '✅' : '📋'}</span>
        <div class="grow">
          <div class="t">${esc(p.plan ? p.plan.name : 'Usunięty plan')}</div>
          <div class="s">${p.done ? 'zrobione' : isPast ? 'nie zrobione' : 'zaplanowane'}</div>
        </div>
        ${isToday && !p.done && p.plan && !S.active ? `<button class="btn primary" type="button" data-go-plan="${p.planId}">Start</button>` : ''}
        <button class="icon-btn" type="button" data-unplan="${p.id}" aria-label="Usuń z kalendarza">✕</button>
      </div>`)
    .join('');

  // planowanie: tylko dziś i w przyszłości
  let planPart = '';
  if (!isPast) {
    planPart = S.plans.length
      ? `<h3 style="margin:0">Zaplanuj trening</h3>
        <div class="chips-wrap">
          ${S.plans
            .map(p => `<button class="btn" type="button" data-plan="${p.id}">+ ${esc(p.name)}</button>`)
            .join('')}
        </div>`
      : `<p class="muted small" style="margin:0">Żeby zaplanować trening, najpierw ułóż plan.</p>
        <button class="btn block" type="button" id="day-newplan">Ułóż plan</button>`;
  }

  const empty = !info.workouts.length && !info.weight && !info.measure && !info.plans.length;

  openSheet(dayLabel(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), `
    ${workouts}
    ${weight || measure ? `<div class="list">${weight}${measure}</div>` : ''}
    ${plannedList ? `<div class="list">${plannedList}</div>` : ''}
    ${empty ? `<p class="muted" style="margin:0">${isPast ? 'Tego dnia nic nie zapisano.' : 'Nic tu jeszcze nie ma.'}</p>` : ''}
    ${planPart}
    <button class="btn block" type="button" data-close>OK</button>`,
    b => {
      $$('[data-w]', b).forEach(x => {
        x.onclick = () => {
          showWorkout(x.dataset.w);
          SHEET_BACK = () => showDay(d);
        };
      });

      const wb = $('#day-weight', b);
      if (wb) {
        wb.onclick = () => editWeight(d);
      }

      const mb = $('#day-measure', b);
      if (mb) {
        mb.onclick = () => {
          closeSheet();
          setTab('cialo');
        };
      }

      $$('[data-plan]', b).forEach(x => {
        x.onclick = () => {
          S.planned = planned().concat({ id: 'pl_' + uid(), d, planId: x.dataset.plan });
          save();
          toast('Zaplanowano: ' + planById(x.dataset.plan).name);
          renderKalendarz();
          showDay(d);
        };
      });

      $$('[data-unplan]', b).forEach(x => {
        x.onclick = () => {
          S.planned = planned().filter(p => p.id !== x.dataset.unplan);
          save();
          renderKalendarz();
          showDay(d);
        };
      });

      $$('[data-go-plan]', b).forEach(x => {
        x.onclick = () => {
          closeSheet();
          startWorkout(planById(x.dataset.goPlan));
        };
      });

      const np = $('#day-newplan', b);
      if (np) {
        np.onclick = () => {
          closeSheet();
          setTab('plany');
          editPlan(null);
        };
      }
    });
}

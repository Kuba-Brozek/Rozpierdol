/* ============ Powiadomienia w apce (bez serwera) ============
   Przy otwarciu apki (i po powrocie do niej) sprawdzamy, co inni nam udostępniają, i porównujemy
   z tym, co było ostatnio. Różnice zamieniamy w powiadomienia:
     „X udostępnił(a) ci: plany, waga” / „X zmienił(a) zakres: …” / „X zabrał(a) ci dostęp”.
   Powiadomienia leżą w pamięci telefonu, osobno dla każdego konta. Nieprzeczytane = kropka na ikonie użytkownika.
   Prawdziwe powiadomienia push (przy zamkniętej apce) wymagałyby serwera (Cloud Functions, plan Blaze). */

const NOTIF_KEY = 'rozpierdol-powiadomienia';
const NOTIF_MAX = 50;
const NOTIF_EVERY = 60 * 1000; // przy powrocie do apki sprawdzaj najwyżej raz na minutę

let notifLastCheck = 0;
let notifChecking = false;

/* ---- pamięć: { [uid]: { snap: { ownerUid: { owner, what } }, list: [...] } } ---- */

function notifStore() {
  try {
    return JSON.parse(localStorage.getItem(NOTIF_KEY) || '{}');
  } catch (e) {
    return {};
  }
}

function notifMine() {
  if (typeof SY === 'undefined' || !SY.session) {
    return null;
  }
  const all = notifStore();
  return all[SY.session.uid] || { snap: null, list: [] };
}

function notifSave(mine) {
  if (typeof SY === 'undefined' || !SY.session) {
    return;
  }
  const all = notifStore();
  all[SY.session.uid] = mine;
  try {
    localStorage.setItem(NOTIF_KEY, JSON.stringify(all));
  } catch (e) {}
}

function unreadCount() {
  const mine = notifMine();
  return mine ? mine.list.filter(n => !n.read).length : 0;
}

/* ---- opis zakresu: „plany, ulubione, waga” ---- */

function whatText(w) {
  const parts = [
    w && w.plans ? 'plany' : '',
    w && w.fav ? 'ulubione ćwiczenia' : '',
    w && w.weights ? 'historię wagi' : '',
  ].filter(Boolean);
  return parts.join(', ') || 'nic';
}

const sameWhat = (a, b) => ['plans', 'fav', 'weights']
  .every(k => !!(a && a[k]) === !!(b && b[k]));

/* ---- sprawdzenie zmian ---- */

async function checkShareNotifs(force) {
  if (typeof SY === 'undefined' || !SY.session || !navigator.onLine || notifChecking) {
    return;
  }
  // cudze udostępnienia widać tylko z potwierdzonym e-mailem (reguły bazy) — bez tego nie pytamy
  if (SY.session.verified === false) {
    return;
  }
  if (!force && Date.now() - notifLastCheck < NOTIF_EVERY) {
    return;
  }
  notifLastCheck = Date.now();
  notifChecking = true;

  try {
    const list = await listSharedWithMe();
    const now = {};
    list.forEach(x => {
      now[x.uid] = {
        owner: x.owner || 'Ktoś',
        what: (x.data && x.data.what) || {},
      };
    });

    const mine = notifMine();

    // pierwszy raz na tym telefonie: zapamiętaj stan, bez powiadomień o tym, co już było
    if (!mine.snap) {
      mine.snap = now;
      notifSave(mine);
      return;
    }

    const fresh = [];
    const add = text => fresh.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      at: Date.now(),
      text,
      read: false,
    });

    Object.entries(now).forEach(([uid, cur]) => {
      const was = mine.snap[uid];
      if (!was) {
        add(`<b>${esc(cur.owner)}</b> udostępnia ci: ${whatText(cur.what)}.`);
      } else if (!sameWhat(was.what, cur.what)) {
        add(`<b>${esc(cur.owner)}</b> zmienia, co ci udostępnia. Teraz: ${whatText(cur.what)}.`);
      }
    });
    Object.entries(mine.snap).forEach(([uid, was]) => {
      if (!now[uid]) {
        add(`<b>${esc(was.owner)}</b> zabiera ci dostęp do swoich danych.`);
      }
    });

    mine.snap = now;
    mine.list = fresh.concat(mine.list).slice(0, NOTIF_MAX);
    notifSave(mine);

    if (fresh.length) {
      if (typeof updateTopbar === 'function') {
        updateTopbar();
      }
      showNotifPopup(fresh);
    }
  } catch (e) {
    // brak sieci / niepotwierdzony e-mail / stare reguły — spróbujemy następnym razem
  } finally {
    notifChecking = false;
  }
}

/* ---- wyświetlanie ---- */

function notifListHTML(list) {
  if (!list.length) {
    return '<p class="muted small" style="margin:0">Brak powiadomień.</p>';
  }
  return `
    <div class="list">
      ${list
        .map(n => `
          <div class="li notif${n.read ? '' : ' unread'}">
            <span class="nav-ic" aria-hidden="true">🤝</span>
            <div class="grow">
              <div class="t">${n.text}</div>
              <div class="s">${new Date(n.at).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
            </div>
          </div>`)
        .join('')}
    </div>`;
}

function markAllRead() {
  const mine = notifMine();
  if (!mine) {
    return;
  }
  mine.list.forEach(n => {
    n.read = true;
  });
  notifSave(mine);
  if (typeof updateTopbar === 'function') {
    updateTopbar();
  }
}

// okienko z nowymi powiadomieniami (gdy nic innego nie jest otwarte)
let notifTries = 0;
function showNotifPopup(fresh) {
  const busy = !$('#sheet').hidden
    || document.getElementById('lock')
    || document.getElementById('auth')
    || document.getElementById('policy')
    || document.getElementById('splash');
  if (busy) {
    if (notifTries++ < 60) {
      setTimeout(() => showNotifPopup(fresh), 1500);
    }
    return;
  }
  notifTries = 0;

  openSheet(fresh.length > 1 ? '🔔 Nowe powiadomienia' : '🔔 Nowe powiadomienie', `
    ${notifListHTML(fresh)}
    <button class="btn primary block" type="button" data-close>OK</button>
    <button class="btn block" type="button" id="nt-see">Zobacz udostępnione mi</button>`,
    b => {
      $('#nt-see', b).onclick = () => {
        closeSheet();
        setTab('wiecej');
        setTimeout(() => {
          const btn = document.getElementById('shared-load');
          const card = document.getElementById('share-card');
          if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
          if (btn) {
            btn.click();
          }
        }, 300);
      };
    });
  markAllRead();
}

// karta „Powiadomienia” w Ustawieniach
function renderNotifCard(card) {
  if (!card) {
    return;
  }
  const mine = notifMine();
  if (!mine) {
    card.remove();
    return;
  }

  card.innerHTML = `
    <div class="row">
      <h2>Powiadomienia</h2>
      ${mine.list.length ? '<button class="link" type="button" id="nt-clear">Wyczyść</button>' : ''}
    </div>
    <p class="muted small" style="margin:0">Gdy ktoś coś ci udostępni, zmieni zakres albo zabierze dostęp, zobaczysz to tutaj po otwarciu apki.</p>
    ${notifListHTML(mine.list.slice(0, 10))}`;

  const clear = $('#nt-clear', card);
  if (clear) {
    clear.onclick = () => {
      const m = notifMine();
      m.list = [];
      notifSave(m);
      renderNotifCard(card);
    };
  }

  // otwarcie Ustawień = przeczytane
  setTimeout(markAllRead, 800);
}

/* ---- kiedy sprawdzać ---- */

setTimeout(() => checkShareNotifs(true), 6000);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    checkShareNotifs(false);
  }
});

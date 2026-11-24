/* ============ Blokada apki: kod PIN i Face ID / Touch ID ============
   Ustawienia blokady leżą tylko w tym telefonie (localStorage), nie w chmurze: każdy telefon ma swój kod.
   Kod nie jest nigdzie zapisany wprost, tylko jego skrót PBKDF2 (150 000 rund, z losową solą).
   Face ID / Touch ID działa przez WebAuthn: telefon tworzy klucz dostępu i przy odblokowaniu prosi o twarz lub palec.
   Uwaga: to blokada ekranu przed wścibskimi oczami. Dane w pamięci telefonu nie są przez nią szyfrowane. */
const LOCK_KEY = 'rozpierdol-blokada';
const PIN_LEN = 4;
let LK = null;
try { LK = JSON.parse(localStorage.getItem(LOCK_KEY) || 'null'); } catch (e) {}
const lockOn = () => !!(LK && LK.hash);
// stan tej sesji (przetrwa przeładowanie strony, ale nie zamknięcie apki): kiedy odblokowano i kiedy apka poszła w tło
const SES_KEY = 'rozpierdol-blokada-sesja';
const sesGet = () => { try { return JSON.parse(sessionStorage.getItem(SES_KEY) || '{}'); } catch (e) { return {}; } };
const sesSet = o => { try { sessionStorage.setItem(SES_KEY, JSON.stringify(Object.assign(sesGet(), o))); } catch (e) {} };
const lockSave = () => { try { LK ? localStorage.setItem(LOCK_KEY, JSON.stringify(LK)) : localStorage.removeItem(LOCK_KEY); } catch (e) {} };
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const rnd = n => crypto.getRandomValues(new Uint8Array(n));

async function pinHash(pin, saltB64) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(saltB64), iterations: 150000 }, key, 256);
  return b64(bits);
}
async function setPin(pin) {
  const salt = b64(rnd(16));
  LK = Object.assign({ delay: 0 }, LK || {}, { salt, hash: await pinHash(pin, salt), fails: 0, until: 0 });
  lockSave();
}
async function checkPin(pin) { return !!LK && (await pinHash(pin, LK.salt)) === LK.hash; }
function lockOff() { LK = null; lockSave(); }

/* ---- Face ID / Touch ID ---- */
async function bioAvailable() {
  try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); }
  catch (e) { return false; }
}
async function bioEnroll() {
  bioBusy = true;
  try {
  const cred = await navigator.credentials.create({ publicKey: {
    challenge: rnd(32), rp: { name: 'Rozpierdol', id: location.hostname },
    // ta nazwa pokazuje się w okienku iPhone'a („Klucz dostępu… dla …”), więc ma mówić, do czego służy
    user: { id: rnd(16), name: 'Rozpierdol – blokada apki', displayName: 'Rozpierdol – blokada apki' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
    timeout: 60000, attestation: 'none',
  } });
  LK.bio = b64(cred.rawId); lockSave();
  } finally { bioBusy = false; bioEnded = Date.now(); }
}
// iPhone pozwala zapytać o Face ID tylko po stuknięciu w ekran (zabezpieczenie Safari),
// dlatego automatyczna próba przy otwarciu może się nie udać — wtedy zostaje duży przycisk.
let bioBusy = false, bioEnded = 0;
async function bioCheck() {
  if (!LK || !LK.bio || bioBusy) return false;
  bioBusy = true;
  try {
    const r = await navigator.credentials.get({ publicKey: {
      challenge: rnd(32), rpId: location.hostname, userVerification: 'required', timeout: 60000,
      allowCredentials: [{ type: 'public-key', id: unb64(LK.bio), transports: ['internal'] }],
    } });
    return !!r;
  } catch (e) { return false; }
  finally { bioBusy = false; bioEnded = Date.now(); }
}

/* ---- klawiatura PIN (ekran blokady i okna w ustawieniach) ---- */
const BIO_ICON = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M9 9.5v1M15 9.5v1M12 9.5v3.5h-1M9.5 15.5c1.4 1 3.6 1 5 0"/></svg>';
function pinPad(box, { onDone, bio }) {
  let v = '';
  box.innerHTML = `<div class="pin-dots" aria-hidden="true">${'<i></i>'.repeat(PIN_LEN)}</div>
    <p class="pin-msg" role="alert"></p>
    <div class="pin-keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button type="button" data-k="${n}">${n}</button>`).join('')}
      ${bio ? `<button type="button" class="pin-fn" data-bio aria-label="Odblokuj Face ID lub Touch ID">${BIO_ICON}</button>` : '<span></span>'}
      <button type="button" data-k="0">0</button>
      <button type="button" class="pin-fn" data-del aria-label="Usuń cyfrę">⌫</button></div>`;
  const dots = [...box.querySelectorAll('.pin-dots i')], msg = box.querySelector('.pin-msg');
  const paint = () => dots.forEach((d, i) => d.classList.toggle('on', i < v.length));
  let busy = false;
  const press = k => {
    if (busy) return;
    if (k === 'del') v = v.slice(0, -1); else if (v.length < PIN_LEN) v += k;
    paint();
    if (v.length === PIN_LEN) { busy = true; const pin = v; setTimeout(async () => { await onDone(pin); busy = false; }, 120); }
  };
  box.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.k) press(b.dataset.k); else if ('del' in b.dataset) press('del'); else if ('bio' in b.dataset && bio) bio();
  });
  const onKey = e => { if (!box.isConnected) return document.removeEventListener('keydown', onKey); if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('del'); };
  document.addEventListener('keydown', onKey);
  return {
    clear(text, bad) { v = ''; paint(); msg.textContent = text || ''; if (bad) { box.querySelector('.pin-dots').classList.remove('shake'); void box.offsetWidth; box.querySelector('.pin-dots').classList.add('shake'); } },
    disable(on) { box.querySelectorAll('[data-k],[data-del]').forEach(b => b.disabled = on); },
    msg(t) { msg.textContent = t; },
  };
}

/* ---- ekran blokady ---- */
let lockShown = false;
function showLock() {
  if (!lockOn() || lockShown) return;
  lockShown = true;
  sesSet({ unlocked: 0 });
  const el = document.createElement('div');
  el.id = 'lock'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Apka zablokowana');
  document.body.appendChild(el); document.body.style.overflow = 'hidden';
  const unlock = () => {
    LK.fails = 0; LK.until = 0; lockSave();
    sesSet({ unlocked: Date.now(), hiddenAt: 0 });
    el.classList.add('hide'); setTimeout(() => el.remove(), 250);
    lockShown = false; document.body.style.overflow = '';
  };
  // Gdy Face ID / Touch ID jest włączone, to ono jest domyślne: ekran z twarzą, od razu próba rozpoznania.
  // Kod pojawia się dopiero, gdy rozpoznanie się nie uda albo ktoś stuknie „Użyj kodu”.
  const main = () => LK.bio ? bioView() : pinView();
  const bioView = () => {
    el.innerHTML = `<div class="lock-inner">
      <div class="lock-logo">${typeof DUMBBELL_SVG !== 'undefined' ? DUMBBELL_SVG : ''}</div>
      <h1>Apka zablokowana</h1>
      <button class="lock-face" type="button" id="lock-bio" aria-label="Odblokuj Face ID">${BIO_ICON}</button>
      <p id="lock-bio-msg">Stuknij, żeby odblokować Face ID</p>
      <button class="link" type="button" id="lock-usepin">Użyj kodu</button></div>`;
    // tapped = próba po stuknięciu; nieudana przełącza na kod. Próba automatyczna (bez stuknięcia) iPhone może zablokować — wtedy czekamy na stuknięcie.
    const go = async tapped => {
      if (await bioCheck()) return unlock();
      if (tapped && el.isConnected) pinView('Nie udało się rozpoznać. Wpisz kod.');
    };
    el.querySelector('#lock-usepin').onclick = e => { e.stopPropagation(); pinView(); };
    el.querySelector('.lock-inner').onclick = e => { if (!e.target.closest('#lock-usepin')) go(true); };
    if (!document.hidden) setTimeout(() => go(false), 300);
  };
  const pinView = (hint) => {
    el.innerHTML = `<div class="lock-inner">
      <div class="lock-logo">${typeof DUMBBELL_SVG !== 'undefined' ? DUMBBELL_SVG : ''}</div>
      <h1>Wpisz kod</h1><div id="lock-pad"></div>
      ${LK.bio ? `<button class="lock-bio" type="button" id="lock-bio">${BIO_ICON}<span>Spróbuj Face ID</span></button>` : ''}
      <button class="link" type="button" id="lock-forgot">Nie pamiętam kodu</button></div>`;
    const pad = pinPad(el.querySelector('#lock-pad'), {
      onDone: async pin => {
        if (LK.until > Date.now()) { pad.clear(); return; }
        if (await checkPin(pin)) return unlock();
        LK.fails = (LK.fails || 0) + 1;
        // po 5 błędach rosnąca przerwa: 30 s, 1 min, 2 min… (najwyżej 15 min)
        if (LK.fails >= 5) LK.until = Date.now() + Math.min(900, 30 * 2 ** (LK.fails - 5)) * 1000;
        lockSave();
        pad.clear(LK.fails >= 5 ? '' : 'Zły kod', true);
        waitTick();
      },
    });
    if (hint) pad.msg(hint);
    const waitTick = () => {
      const left = (((LK && LK.until) || 0) - Date.now()) / 1000;
      if (left > 0) { pad.disable(true); pad.msg(`Za dużo prób. Spróbuj za ${left >= 60 ? Math.ceil(left / 60) + ' min' : Math.ceil(left) + ' s'}.`); setTimeout(waitTick, 1000); }
      else { pad.disable(false); if (LK && LK.fails >= 5) pad.msg(''); }
    };
    waitTick();
    el.querySelector('#lock-forgot').onclick = forgot;
    const bb = el.querySelector('#lock-bio');
    if (bb) bb.onclick = async () => { if (await bioCheck()) unlock(); else pad.msg('Nie udało się rozpoznać. Wpisz kod.'); };
  };
  // Zapomniany kod: z kontem — hasło do konta zdejmuje blokadę; bez konta — tylko usunięcie danych z telefonu
  const forgot = () => {
    const acc = typeof SY !== 'undefined' && SY.session;
    el.innerHTML = `<div class="lock-inner">
      <h1>Nie pamiętasz kodu?</h1>
      ${acc ? `<p>Wpisz hasło do konta <b>${esc(SY.session.email || '')}</b>. Blokada zostanie wyłączona, a dane zostaną.</p>
        <form id="lock-pw" class="lock-form"><input type="password" id="lock-pass" autocomplete="current-password" placeholder="Hasło do konta" required>
        <p class="pin-msg" id="lock-err" role="alert"></p><button class="btn primary block" type="submit">Wyłącz blokadę</button></form>`
      : `<p>Bez konta w chmurze kodu nie da się odzyskać. Możesz usunąć wszystkie dane z tego telefonu i zacząć od nowa.</p>
        <button class="btn danger block" type="button" id="lock-wipe">Usuń dane i blokadę</button>`}
      <button class="link" type="button" id="lock-back">‹ Wróć do kodu</button></div>`;
    el.querySelector('#lock-back').onclick = () => pinView();
    const f = el.querySelector('#lock-pw');
    if (f) f.onsubmit = async e => {
      e.preventDefault();
      const err = el.querySelector('#lock-err'), btn = f.querySelector('button'); err.textContent = '';
      if (!navigator.onLine) { err.textContent = 'Potrzebny jest internet.'; return; }
      btn.disabled = true; btn.textContent = 'Sprawdzam…';
      try { await reauth(el.querySelector('#lock-pass').value); lockOff(); unlock(); toast('Blokada wyłączona. Ustaw nowy kod w Ustawieniach.'); }
      catch (x) { err.textContent = x.message; btn.disabled = false; btn.textContent = 'Wyłącz blokadę'; }
    };
    const w = el.querySelector('#lock-wipe');
    if (w) w.onclick = () => {
      if (w.dataset.sure) {
        try { localStorage.removeItem(KEY); } catch (e) {}
        lockOff(); location.reload();
        return;
      }
      w.dataset.sure = '1'; w.textContent = 'Na pewno? Stuknij jeszcze raz — tego nie da się cofnąć';
    };
  };
  main();
}

/* ---- kiedy blokować: przy starcie i po powrocie do apki po ustawionym czasie ---- */
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  // okienko iPhone'a z kluczem dostępu (Face ID) na chwilę „chowa” apkę — to nie jest wyjście z apki,
  // więc w trakcie Face ID i przez 2 s po nim nie liczymy tego jako ukrycia (inaczej apka zablokowałaby się drugi raz)
  const byBio = bioBusy || Date.now() - bioEnded < 2000;
  if (document.hidden) { if (!byBio) { hiddenAt = Date.now(); sesSet({ hiddenAt }); } }
  else if (!byBio && lockOn() && hiddenAt && Date.now() - hiddenAt >= (LK.delay || 0) * 1000) { hiddenAt = 0; showLock(); }
  else if (!document.hidden && !lockShown) sesSet({ hiddenAt: 0 }); // wróciło szybko — apka zostaje odblokowana
});
// Przy starcie blokujemy, chyba że to tylko przeładowanie strony (np. po aktualizacji) w tej samej sesji,
// w której apka była już odblokowana i nie leżała w tle dłużej niż ustawiony czas.
if (lockOn()) {
  const s = sesGet();
  // samo przeładowanie też na chwilę „chowa” stronę, stąd co najmniej 5 s zapasu
  // (prawdziwe wyjście z apki blokuje dalej od razu — pilnuje tego obsługa visibilitychange powyżej)
  const fresh = s.unlocked && (!s.hiddenAt || Date.now() - s.hiddenAt < Math.max(5, LK.delay || 0) * 1000);
  if (!fresh) showLock();
}

/* ---- karta w Ustawieniach ---- */
const LOCK_DELAYS = [[0, 'Od razu'], [60, 'Po 1 min'], [300, 'Po 5 min'], [900, 'Po 15 min']];
function pinSheet(title, steps, finish) {
  // steps: lista podpowiedzi; każdy krok zbiera jeden kod, finish dostaje tablicę kodów i może zwrócić błąd (tekst)
  const codes = [];
  openSheet(title, `<p class="muted" id="ps-hint" style="margin:0;text-align:center">${steps[0]}</p><div id="ps-pad" class="pin-sheet"></div>`, b => {
    const pad = pinPad($('#ps-pad', b), {
      onDone: async pin => {
        codes.push(pin);
        if (codes.length < steps.length) { $('#ps-hint', b).textContent = steps[codes.length]; pad.clear(); return; }
        const err = await finish(codes);
        if (err) { codes.length = 0; $('#ps-hint', b).textContent = steps[0]; pad.clear(err, true); }
      },
    });
  });
}
function renderLockCard(card) {
  const on = lockOn();
  card.innerHTML = `<h2>Blokada apki</h2>
    <div class="pref-list">
      <label class="pref-row"><span class="pref-ic" aria-hidden="true">🔒</span>
        <span class="grow"><span class="pref-l">Kod blokady</span><span class="small muted">${PIN_LEN} cyfry przy każdym otwarciu apki</span></span>
        <input type="checkbox" class="switch" role="switch" id="lk-on" ${on ? 'checked' : ''}></label>
      <label class="pref-row" id="lk-bio-row" hidden><span class="pref-ic" aria-hidden="true">🙂</span>
        <span class="grow"><span class="pref-l">Face ID / Touch ID</span><span class="small muted">Odblokuj twarzą albo palcem</span></span>
        <input type="checkbox" class="switch" role="switch" id="lk-bio" ${on && LK.bio ? 'checked' : ''}></label>
    </div>
    ${on ? `<div class="field"><label for="lk-delay">Blokuj po wyjściu z apki</label><select id="lk-delay">${LOCK_DELAYS.map(([s, l]) => `<option value="${s}" ${(LK.delay || 0) === s ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <button class="btn block" type="button" id="lk-change">Zmień kod</button>` : ''}
    <p class="muted small" style="margin:0">Blokada chroni apkę przed wścibskimi oczami na tym telefonie. Każdy telefon ma swój kod. Jeśli zapomnisz kodu, zdejmiesz blokadę hasłem do konta.</p>`;
  if (on) bioAvailable().then(ok => { const r = $('#lk-bio-row', card); if (r) r.hidden = !ok; });
  const rerenderCard = () => renderLockCard(card);
  $('#lk-on', card).onchange = e => {
    e.target.checked = on; // stan zmieni się dopiero po wpisaniu kodu
    if (!on) pinSheet('Ustaw kod', ['Wpisz nowy kod', 'Wpisz kod jeszcze raz'], async ([a, b]) => {
      if (a !== b) return 'Kody się różnią. Spróbuj od nowa.';
      await setPin(a); closeSheet(); toast('Blokada włączona'); rerenderCard();
    });
    else pinSheet('Wyłącz blokadę', ['Wpisz obecny kod'], async ([a]) => {
      if (!await checkPin(a)) return 'Zły kod';
      lockOff(); closeSheet(); toast('Blokada wyłączona'); rerenderCard();
    });
  };
  const bio = $('#lk-bio', card);
  if (bio) bio.onchange = () => {
    if (!bio.checked) { delete LK.bio; lockSave(); toast('Face ID / Touch ID wyłączone'); return; }
    bio.checked = false; // włączy się dopiero po udanym zapisaniu
    // iPhone obsługuje Face ID w aplikacjach webowych przez „klucz dostępu” — uprzedzamy o jego okienkach
    openSheet('Face ID / Touch ID', `
      <p style="margin:0">Za chwilę iPhone pokaże swoje okienko z pytaniem o <b>zapisanie klucza dostępu</b> dla <b>${esc(location.hostname)}</b>. Stuknij <b>Kontynuuj</b> i potwierdź twarzą albo palcem.</p>
      <p class="muted small" style="margin:0">To normalne: tak działa Face ID w aplikacjach z przeglądarki. Klucz nie jest hasłem do niczego, służy tylko do odblokowania tej apki. Przy odblokowaniu iPhone też może najpierw pokazać krótkie okienko „Zaloguj się kluczem dostępu”.</p>
      <button class="btn primary block" type="button" id="bio-go">Dalej</button>
      <button class="btn block" type="button" data-close>Anuluj</button>`, b => {
      $('#bio-go', b).onclick = async () => {
        try { await bioEnroll(); closeSheet(); toast('Face ID / Touch ID włączone'); renderLockCard(card); }
        catch (e) { closeSheet(); toast('Nie udało się włączyć Face ID / Touch ID'); }
      };
    });
  };
  const dl = $('#lk-delay', card);
  if (dl) dl.onchange = () => { LK.delay = +dl.value; lockSave(); toast('Zapisano'); };
  const ch = $('#lk-change', card);
  if (ch) ch.onclick = () => pinSheet('Zmień kod', ['Wpisz obecny kod', 'Wpisz nowy kod', 'Wpisz nowy kod jeszcze raz'], async ([o, a, b]) => {
    if (!await checkPin(o)) return 'Zły obecny kod';
    if (a !== b) return 'Nowe kody się różnią. Spróbuj od nowa.';
    const keep = { delay: LK.delay, bio: LK.bio };
    await setPin(a); Object.assign(LK, keep); lockSave(); closeSheet(); toast('Kod zmieniony');
  });
}

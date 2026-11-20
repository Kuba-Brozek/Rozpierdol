'use strict';
/* ============ SYNCHRONIZACJA W CHMURZE (Firebase: Authentication + Firestore, przez REST, bez bibliotek) ============
   - logowanie e-mailem i hasłem; każde konto widzi tylko swój dokument (reguły bezpieczeństwa Firestore)
   - każda zmiana: po 2 s cała baza apki + aktualny plik Excel lecą do dokumentu backups/{uid}
   - bez internetu: zmiany czekają i wysyłają się, gdy sieć wróci
   - przy otwarciu apki: jeśli w chmurze jest coś nowszego (np. z drugiego telefonu), apka to pobiera */

const CFG = window.ROZ_CONFIG || {};
const FB_KEY = String(CFG.apiKey || '').trim();
const FB_PROJECT = String(CFG.projectId || '').trim();
const AUTH_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:';
const TOKEN_URL = 'https://securetoken.googleapis.com/v1/token?key=';
const SYNC_KEY = 'rozpierdol-sync';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const cloudReady = () => !!(FB_KEY && FB_PROJECT);
const docUrl = uid => `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(FB_PROJECT)}/databases/(default)/documents/backups/${encodeURIComponent(uid)}`;

let SY = { session: null, lastSyncAt: 0, lastRemoteAt: 0, dirty: false };
try { Object.assign(SY, JSON.parse(localStorage.getItem(SYNC_KEY) || '{}')); } catch (e) {}
if (SY.session && !SY.session.idToken) SY.session = null; // sesja ze starej wersji (Supabase)
SY.status = 'idle'; SY.error = '';
function sySave() {
  try { localStorage.setItem(SYNC_KEY, JSON.stringify({ session: SY.session, lastSyncAt: SY.lastSyncAt, lastRemoteAt: SY.lastRemoteAt, dirty: SY.dirty })); } catch (e) {}
}

/* ---- błędy po polsku ---- */
function fbError(status, j) {
  const raw = (j && j.error && (j.error.message || j.error.status)) || '';
  const map = [
    [/INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND/, 'Zły e-mail albo hasło.'],
    [/EMAIL_EXISTS/, 'To konto już istnieje. Zaloguj się.'],
    [/WEAK_PASSWORD/, 'Hasło musi mieć co najmniej 6 znaków.'],
    [/INVALID_EMAIL|MISSING_EMAIL/, 'Ten adres e-mail wygląda na niepoprawny.'],
    [/TOO_MANY_ATTEMPTS/, 'Za dużo prób. Odczekaj chwilę.'],
    [/USER_DISABLED/, 'To konto jest zablokowane.'],
    [/OPERATION_NOT_ALLOWED|PASSWORD_LOGIN_DISABLED/, 'W Firebase nie włączono logowania e-mailem i hasłem (Authentication → Sign-in method).'],
    [/API key not valid|API_KEY_INVALID/, 'Zły klucz API w config.js.'],
    [/database \(default\) does not exist/i,'W projekcie Firebase nie utworzono jeszcze bazy Firestore.'],
    [/PERMISSION_DENIED|Missing or insufficient permissions/i, 'Firestore odmówił dostępu. Sprawdź reguły bezpieczeństwa z instrukcji.'],
    [/TOKEN_EXPIRED|INVALID_ID_TOKEN|INVALID_REFRESH_TOKEN|UNAUTHENTICATED/, 'Sesja wygasła. Zaloguj się ponownie.'],
  ];
  for (const [re, txt] of map) if (re.test(raw)) return Object.assign(new Error(txt), { status, code: /TOKEN|UNAUTHENTICATED/.test(raw) ? 'auth' : undefined });
  return Object.assign(new Error(raw || ('Serwer odpowiedział błędem ' + status + '.')), { status });
}
async function call(url, opts) {
  let r;
  try { r = await fetch(url, opts); }
  catch (e) { throw Object.assign(new Error('Brak połączenia z serwerem.'), { code: 'net' }); }
  if (!r.ok && r.status !== 404) { let j = null; try { j = await r.json(); } catch (e) {} throw fbError(r.status, j); }
  return r;
}

/* ---- sesja ---- */
function setSession(j) {
  SY.session = {
    idToken: j.idToken || j.id_token, refresh: j.refreshToken || j.refresh_token,
    expiresAt: Date.now() + (+(j.expiresIn || j.expires_in) || 3600) * 1000,
    uid: j.localId || j.user_id || (SY.session && SY.session.uid), email: j.email || (SY.session && SY.session.email),
  };
  sySave();
}
async function idToken() {
  const s = SY.session; if (!s) return null;
  if (Date.now() < s.expiresAt - 60000) return s.idToken;
  let r;
  try {
    r = await fetch(TOKEN_URL + FB_KEY, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(s.refresh) });
  } catch (e) { return null; } // brak sieci
  if (!r.ok) {
    if (r.status >= 400 && r.status < 500) { SY.session = null; sySave(); toast('Sesja wygasła. Zaloguj się ponownie w Ustawieniach.'); }
    return null;
  }
  setSession(await r.json());
  return SY.session.idToken;
}
async function authed(url, opts = {}) {
  const t = await idToken();
  if (!t) throw Object.assign(new Error(SY.session ? 'Brak połączenia z serwerem.' : 'Zaloguj się ponownie.'), { code: SY.session ? 'net' : 'auth' });
  return call(url, Object.assign({}, opts, { headers: Object.assign({ Authorization: 'Bearer ' + t }, opts.headers || {}) }));
}

/* ---- konto ---- */
const authPost = (method, body) => call(AUTH_URL + method + '?key=' + FB_KEY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function cloudLogin(email, password) {
  const r = await authPost('signInWithPassword', { email, password, returnSecureToken: true });
  setSession(await r.json());
  await firstSyncAfterLogin();
}
async function cloudSignup(email, password) {
  const r = await authPost('signUp', { email, password, returnSecureToken: true });
  setSession(await r.json());
  await firstSyncAfterLogin();
  return 'in';
}
async function cloudResetPassword(email) {
  await authPost('sendOobCode', { requestType: 'PASSWORD_RESET', email });
}
async function cloudLogout() {
  SY.session = null; SY.lastRemoteAt = 0; SY.lastSyncAt = 0; SY.dirty = false; SY.status = 'idle'; sySave();
}

/* ---- dane (dokument backups/{uid}: json = cała baza apki, updatedAt, xlsx = plik Excel) ---- */
const plural = (n, one, few, many) => n + ' ' + (n === 1 ? one : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) ? few : many);
const hasLocalData = () => S.weights.length || S.workouts.length || S.plans.length || S.fav.length || (S.custom || []).length;
async function blobToB64(blob) {
  const u8 = new Uint8Array(await blob.arrayBuffer()); let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
async function pullRemote() {
  const r = await authed(docUrl(SY.session.uid));
  if (r.status === 404) {
    let j = null; try { j = await r.json(); } catch (e) {}
    if (j && j.error && /database \(default\) does not exist/i.test(j.error.message || '')) throw fbError(404, j);
    return null; // dokument jeszcze nie istnieje
  }
  const f = (await r.json()).fields || {};
  let data = null;
  try { data = JSON.parse(f.json && f.json.stringValue || 'null'); } catch (e) {}
  if (!data) return null;
  return { data, updatedAt: +(f.updatedAt && f.updatedAt.integerValue || 0), xlsx: f.xlsx && f.xlsx.bytesValue };
}
async function pushRemote() {
  const now = Date.now();
  const fields = { json: { stringValue: JSON.stringify(S) }, updatedAt: { integerValue: String(now) } };
  try { fields.xlsx = { bytesValue: await blobToB64(backupXlsx()) }; } catch (e) {}
  await authed(docUrl(SY.session.uid), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
  SY.lastRemoteAt = now;
}
function adoptRemote(data) {
  const keepActive = S.active;
  S = Object.assign({ profile: { height: null, goalLoss: null }, weights: [], workouts: [], active: null, custom: [], fav: [], plans: [] }, data);
  ['weights', 'workouts', 'custom', 'fav', 'plans'].forEach(k => { if (!Array.isArray(S[k])) S[k] = []; });
  if (!S.active && keepActive) S.active = keepActive;
  save(true); rebuildExMap(); UI.cw = newFilter();
  if ($('#sheet').hidden) rerender();
}

/* ---- pętla synchronizacji ---- */
let syncTimer = null, syncing = false, syncAgain = false, dirtySince = 0;
function syncSoon(delay = 2000) {
  if (!cloudReady() || !SY.session) return;
  if (!SY.dirty || !dirtySince) dirtySince = Date.now();
  SY.dirty = true; sySave();
  // wysyłka 2 s po ostatniej zmianie, ale najpóźniej 10 s po pierwszej niewysłanej (przy ciągłym wpisywaniu)
  const wait = Math.max(0, Math.min(delay, dirtySince + 10000 - Date.now()));
  clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, wait);
  updateSyncUI();
}
async function syncNow() {
  if (!cloudReady() || !SY.session) return;
  if (syncing) { syncAgain = true; return; }
  if (!navigator.onLine) { SY.status = 'offline'; updateSyncUI(); return; }
  syncing = true; SY.status = 'sync'; updateSyncUI();
  try {
    const remote = await pullRemote();
    const remoteNewer = remote && remote.updatedAt > SY.lastRemoteAt + 1000;
    if (remoteNewer && !SY.dirty) {
      adoptRemote(remote.data);            // ktoś zmienił dane na innym urządzeniu — pobierz
      SY.lastRemoteAt = remote.updatedAt;
    } else {
      if (remoteNewer && SY.dirty) {        // zmiany i tu, i tam — połącz, potem wyślij
        applyData(stateAsData(remote.data), false); save(true); rebuildExMap();
        if ($('#sheet').hidden) rerender();
      }
      if (SY.dirty || !remote) await pushRemote();
    }
    SY.dirty = false; dirtySince = 0; SY.lastSyncAt = Date.now(); SY.status = 'ok'; SY.error = '';
  } catch (e) {
    SY.status = e.code === 'net' ? 'offline' : 'error'; SY.error = e.message;
  } finally {
    syncing = false; sySave(); updateSyncUI();
    if (syncAgain) { syncAgain = false; syncSoon(500); }
  }
}
async function firstSyncAfterLogin() {
  const remote = await pullRemote();
  if (!remote) { SY.dirty = true; sySave(); await syncNow(); return; }
  if (!hasLocalData()) { adoptRemote(remote.data); SY.lastRemoteAt = remote.updatedAt; SY.lastSyncAt = Date.now(); SY.dirty = false; sySave(); return; }
  // Dane i w telefonie, i w chmurze — zapytaj
  const r = remote.data || {};
  const choice = await new Promise(res => openSheet('Dane w chmurze', `
    <p style="margin:0">Na koncie jest już kopia z <b>${new Date(remote.updatedAt).toLocaleString('pl-PL', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</b>:
      ${plural((r.weights || []).length, 'pomiar', 'pomiary', 'pomiarów')}, ${plural((r.workouts || []).length, 'trening', 'treningi', 'treningów')}, ${plural((r.plans || []).length, 'plan', 'plany', 'planów')}.</p>
    <p class="muted small" style="margin:0">W telefonie masz: ${plural(S.weights.length, 'pomiar', 'pomiary', 'pomiarów')}, ${plural(S.workouts.length, 'trening', 'treningi', 'treningów')}, ${plural(S.plans.length, 'plan', 'plany', 'planów')}.</p>
    <button class="btn primary block" type="button" data-c="merge">Połącz jedno z drugim</button>
    <button class="btn block" type="button" data-c="remote">Użyj tylko danych z chmury</button>
    <button class="btn block" type="button" data-c="local">Użyj tylko danych z telefonu</button>`, b => {
    b.addEventListener('click', e => { const c = e.target.closest('[data-c]'); if (c) { closeSheet(); res(c.dataset.c); } });
  }));
  if (choice === 'remote') { adoptRemote(r); SY.lastRemoteAt = remote.updatedAt; SY.dirty = false; SY.lastSyncAt = Date.now(); sySave(); updateSyncUI(); return; }
  if (choice === 'merge') { applyData(stateAsData(r), false); save(true); rebuildExMap(); }
  SY.lastRemoteAt = remote.updatedAt; SY.dirty = true; sySave();
  await syncNow();
  rerender();
}
async function downloadCloudFile() {
  try {
    const remote = await pullRemote();
    if (!remote || !remote.xlsx) { toast('W chmurze nie ma jeszcze pliku. Stuknij „Synchronizuj teraz”.'); return; }
    const bin = atob(remote.xlsx), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    shareOrDownload(`Rozpierdol-kopia-z-chmury-${today()}.xlsx`, new Blob([u8], { type: XLSX_MIME }));
  } catch (e) { toast(e.message); }
}

/* ---- interfejs: sekcja „Konto i chmura” w Ustawieniach ---- */
function syncStatusText() {
  if (!SY.session) return '';
  const t = SY.lastSyncAt ? new Date(SY.lastSyncAt).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;
  if (SY.status === 'sync') return '<span class="sync-dot busy"></span>Wysyłam…';
  if (SY.status === 'offline' || (SY.dirty && !navigator.onLine)) return '<span class="sync-dot warn"></span>Brak internetu. Zmiany wyślę, gdy połączenie wróci.';
  if (SY.status === 'error') return `<span class="sync-dot bad"></span>Błąd: ${esc(SY.error)}`;
  if (SY.dirty) return '<span class="sync-dot busy"></span>Czeka na wysłanie…';
  return `<span class="sync-dot ok"></span>${t ? 'Zsynchronizowano: ' + t : 'Połączono'}`;
}
function updateSyncUI() {
  const el = document.getElementById('sync-status'); if (el) el.innerHTML = syncStatusText();
}
function renderSyncCard(card) {
  if (!card) return;
  if (!cloudReady()) {
    card.innerHTML = `<h2>Konto i chmura</h2>
      <p class="muted small" style="margin:0">Synchronizacja nie jest jeszcze włączona. Trzeba wpisać dane projektu Firebase w pliku <b>config.js</b> (instrukcja w pliku FIREBASE.md). Do tego czasu dane są tylko na tym telefonie.</p>`;
    return;
  }
  if (!SY.session) {
    card.innerHTML = `<h2>Konto i chmura</h2>
      <p class="muted small" style="margin:0">Nie jesteś zalogowany, więc dane są tylko na tym telefonie. Po zalogowaniu każda zmiana sama zapisze się w chmurze, razem z plikiem Excel.</p>
      <button class="btn primary" type="button" id="sy-open">Zaloguj się lub załóż konto</button>`;
    card.querySelector('#sy-open').onclick = () => showAuthScreen();
    return;
  }
  card.innerHTML = `<h2>Konto i chmura</h2>
    <div class="row small"><span>Zalogowano jako</span><b style="overflow-wrap:anywhere;text-align:right">${esc(SY.session.email || '')}</b></div>
    <div class="small" id="sync-status" aria-live="polite">${syncStatusText()}</div>
    <div class="btns">
      <button class="btn" type="button" id="sy-now">Synchronizuj teraz</button>
      <button class="btn" type="button" id="sy-file">Pobierz plik z chmury</button>
    </div>
    <button class="link" type="button" id="sy-out" style="align-self:flex-start;color:var(--muted)">Wyloguj</button>`;
  card.querySelector('#sy-now').onclick = () => { SY.dirty = true; sySave(); syncNow(); };
  card.querySelector('#sy-file').onclick = downloadCloudFile;
  card.querySelector('#sy-out').onclick = async () => {
    if (!await confirmBox('Wylogować?', 'Dane zostaną na tym telefonie, ale nowe zmiany przestaną trafiać do chmury.', 'Wyloguj', false)) return;
    await cloudLogout(); toast('Wylogowano'); renderWiecej(); showAuthScreen();
  };
}


/* ---- ekran logowania (pełny ekran, w stylu ekranu startowego) ---- */
const SKIP_KEY = 'rozpierdol-bez-konta';
const authSkipped = () => { try { return localStorage.getItem(SKIP_KEY) === '1'; } catch (e) { return false; } };
const DUMBBELL_SVG = `<svg viewBox="60 140 392 232" width="96" height="57" aria-hidden="true">
  <rect x="150" y="236" width="212" height="40" rx="14" fill="#7d8796"/>
  <rect x="112" y="156" width="56" height="200" rx="20" fill="#fff"/><rect x="344" y="156" width="56" height="200" rx="20" fill="#fff"/>
  <rect x="72" y="196" width="48" height="120" rx="18" fill="#fff"/><rect x="392" y="196" width="48" height="120" rx="18" fill="#fff"/></svg>`;
function hideAuthScreen() {
  const a = document.getElementById('auth'); if (!a) return;
  a.classList.add('hide'); setTimeout(() => a.remove(), 300);
  document.body.style.overflow = '';
}
function showAuthScreen(mode = 'login') {
  if (!cloudReady()) return;
  let a = document.getElementById('auth');
  if (!a) { a = document.createElement('div'); a.id = 'auth'; a.setAttribute('role', 'dialog'); a.setAttribute('aria-modal', 'true'); a.setAttribute('aria-labelledby', 'auth-title'); document.body.appendChild(a); }
  document.body.style.overflow = 'hidden';
  const signup = mode === 'signup';
  a.innerHTML = `
    <div class="auth-inner">
      <div class="auth-brand">${DUMBBELL_SVG}<div class="auth-name">Rozpierdol</div></div>
      <h1 id="auth-title">${signup ? 'Załóż konto' : 'Zaloguj się'}</h1>
      <p class="auth-sub">${signup ? 'Dane będą zapisywać się w chmurze i zobaczysz je na każdym telefonie po zalogowaniu.' : 'Twoje pomiary, treningi i plany zapisują się w chmurze po każdej zmianie.'}</p>
      <form id="auth-form" autocomplete="on" novalidate>
        <label for="auth-email">E-mail</label>
        <input type="email" id="auth-email" autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false" required>
        <label for="auth-pass">Hasło${signup ? ' (min. 6 znaków)' : ''}</label>
        <div class="auth-pass">
          <input type="password" id="auth-pass" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="6" required>
          <button type="button" id="auth-eye" aria-label="Pokaż hasło">Pokaż</button>
        </div>
        <p class="auth-msg" id="auth-msg" aria-live="polite"></p>
        <button class="auth-btn" type="submit">${signup ? 'Załóż konto' : 'Zaloguj'}</button>
      </form>
      ${signup ? '' : '<button class="auth-link" type="button" id="auth-reset">Nie pamiętam hasła</button>'}
      <div class="auth-switch">${signup ? 'Masz już konto? <button type="button" class="auth-link strong" id="auth-mode">Zaloguj się</button>' : 'Nie masz konta? <button type="button" class="auth-link strong" id="auth-mode">Załóż konto</button>'}</div>
      <button class="auth-link dim" type="button" id="auth-skip">Używaj bez konta (dane tylko na tym telefonie)</button>
    </div>`;
  const $a = s => a.querySelector(s), msg = $a('#auth-msg');
  const busy = on => a.querySelectorAll('button, input').forEach(b => b.disabled = on);
  const say = (t, ok) => { msg.textContent = t; msg.classList.toggle('ok', !!ok); };
  $a('#auth-eye').onclick = () => { const p = $a('#auth-pass'), show = p.type === 'password'; p.type = show ? 'text' : 'password'; $a('#auth-eye').textContent = show ? 'Ukryj' : 'Pokaż'; };
  $a('#auth-mode').onclick = () => showAuthScreen(signup ? 'login' : 'signup');
  $a('#auth-skip').onclick = () => { try { localStorage.setItem(SKIP_KEY, '1'); } catch (e) {} hideAuthScreen(); toast('Możesz zalogować się później w Ustawieniach'); };
  const reset = $a('#auth-reset');
  if (reset) reset.onclick = async () => {
    const em = $a('#auth-email').value.trim();
    if (!em) { say('Wpisz najpierw swój e-mail, potem stuknij „Nie pamiętam hasła”.'); $a('#auth-email').focus(); return; }
    busy(true);
    try { await cloudResetPassword(em); say('Jeśli to konto istnieje, wysłałem na ten adres link do ustawienia nowego hasła.', true); }
    catch (err) { say(err.message); }
    busy(false);
  };
  $a('#auth-form').addEventListener('submit', async e => {
    e.preventDefault();
    const em = $a('#auth-email').value.trim(), pw = $a('#auth-pass').value;
    if (!em) { say('Wpisz e-mail.'); $a('#auth-email').focus(); return; }
    if (pw.length < 6) { say(signup ? 'Hasło musi mieć co najmniej 6 znaków.' : 'Wpisz hasło.'); $a('#auth-pass').focus(); return; }
    busy(true); say(signup ? 'Zakładam konto…' : 'Loguję…', true);
    try {
      if (signup) await cloudSignup(em, pw); else await cloudLogin(em, pw);
      try { localStorage.removeItem(SKIP_KEY); } catch (e2) {}
      hideAuthScreen(); toast(signup ? 'Konto założone' : 'Zalogowano');
      if (UI.tab === 'wiecej') renderWiecej();
    } catch (err) { say(err.message); busy(false); }
  });
}
/* ---- start ---- */
if (cloudReady() && SY.session) syncNow();
if (cloudReady() && !SY.session && !authSkipped()) showAuthScreen();
window.addEventListener('online', () => { if (SY.session) syncNow(); });
let lastVisiblePull = Date.now();
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !SY.session) return;
  if (SY.dirty || Date.now() - lastVisiblePull > 30000) { lastVisiblePull = Date.now(); syncNow(); }
});

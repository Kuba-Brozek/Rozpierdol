'use strict';
/* ============ SYNCHRONIZACJA W CHMURZE (Firebase: Authentication + Firestore, przez REST, bez bibliotek) ============
   - logowanie e-mailem i hasłem; każde konto widzi tylko swój dokument (reguły bezpieczeństwa Firestore)
   - każda zmiana: po 2 s dane lecą do backups/{uid} (bez treningów) i backups/{uid}/years/{rok} (treningi z roku)
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
  try { localStorage.setItem(SYNC_KEY, JSON.stringify({ session: SY.session, lastSyncAt: SY.lastSyncAt, lastRemoteAt: SY.lastRemoteAt, dirty: SY.dirty, sharedPublished: SY.sharedPublished, yearSeen: SY.yearSeen, splitBlocked: SY.splitBlocked, userTouched: SY.userTouched, userEmail: SY.userEmail })); } catch (e) {}
}

/* ---- błędy po polsku ---- */
function fbError(status, j) {
  const raw = (j && j.error && (j.error.message || j.error.status)) || '';
  const map = [
    [/INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND/, 'Zły e-mail albo hasło.'],
    [/EMAIL_EXISTS/, 'Na ten adres jest już założone konto.'],
    [/CREDENTIAL_TOO_OLD|requires-recent-login/i, 'Ze względów bezpieczeństwa zaloguj się ponownie i spróbuj jeszcze raz.'],
    [/INVALID_NEW_EMAIL/, 'Nowy adres e-mail wygląda na niepoprawny.'],
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
  const old = SY.session, uidNew = j.localId || j.user_id || (old && old.uid);
  SY.session = {
    createdAt: old && old.uid === uidNew ? old.createdAt : undefined, // data założenia konta (ms), z accounts:lookup
    verified: old && old.uid === uidNew ? old.verified : undefined,
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
  if (await isBlocked()) { await cloudLogout(); throw new Error('To konto zostało usunięte przez admina.'); }
  checkSpecialTheme(SY.session.email);
  fetchAccountCreated();
  await firstSyncAfterLogin();
}
async function cloudSignup(email, password) {
  const r = await authPost('signUp', { email, password, returnSecureToken: true });
  setSession(await r.json());
  SY.session.createdAt = Date.now(); sySave();
  checkSpecialTheme(SY.session.email);
  await firstSyncAfterLogin();
  return 'in';
}
/* ---- zarządzanie kontem: zmiana hasła / e-maila, usunięcie konta ----
   Firebase wymaga świeżego logowania przy tych operacjach, więc każda zaczyna się od podania obecnego hasła. */
async function reauth(password) {
  const r = await authPost('signInWithPassword', { email: SY.session.email, password, returnSecureToken: true });
  setSession(await r.json());
}
async function changePassword(oldPass, newPass) {
  await reauth(oldPass);
  const r = await authPost('update', { idToken: SY.session.idToken, password: newPass, returnSecureToken: true });
  setSession(await r.json()); // zmiana hasła wylogowuje pozostałe urządzenia
}
async function changeEmail(password, newEmail) {
  await reauth(password);
  // link trafia na NOWY adres; e-mail zmieni się dopiero po jego kliknięciu
  await authPost('sendOobCode', { requestType: 'VERIFY_AND_CHANGE_EMAIL', idToken: SY.session.idToken, newEmail });
}
async function deleteAccount(password) {
  await reauth(password);
  const uid = SY.session.uid;
  const soft = async p => { try { await p; } catch (e) { if (e.status !== 403) throw e; } };
  // dokumenty roczne: znane lata + lista z serwera
  const years = new Set([...Object.keys(SY.yearSeen || {}), ...S.workouts.map(wYear)]);
  await soft((async () => {
    const r = await authed(docUrl(uid) + '/years?pageSize=300');
    if (r.status !== 404) ((await r.json()).documents || []).forEach(d => years.add(d.name.split('/').pop()));
  })());
  for (const y of years) await soft(authed(yearUrl(uid, y), { method: 'DELETE' }));
  await authed(docUrl(uid), { method: 'DELETE' });
  await soft(authed(sharedUrl(uid), { method: 'DELETE' }));
  await soft(authed(usersUrl(uid), { method: 'DELETE' }));
  await authPost('delete', { idToken: SY.session.idToken });
  await cloudLogout();
}
async function cloudResetPassword(email) {
  await authPost('sendOobCode', { requestType: 'PASSWORD_RESET', email });
}
async function cloudLogout() {
  SY.session = null; SY.lastRemoteAt = 0; SY.lastSyncAt = 0; SY.dirty = false; SY.sharedPublished = undefined; SY.yearSeen = {}; SY.splitBlocked = false; SY.userTouched = 0; SY.userEmail = ''; SY.status = 'idle'; sySave();
  checkSpecialTheme(null);
}

/* ---- dane (dokument backups/{uid}: json = cała baza apki, updatedAt, xlsx = plik Excel) ---- */
const hasLocalData = () => S.weights.length || S.workouts.length || S.plans.length || S.fav.length || (S.custom || []).length || (S.measures || []).length;
async function blobToB64(blob) {
  const u8 = new Uint8Array(await blob.arrayBuffer()); let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
/* Format 2 (rozdzielony):
   - backups/{uid}: json = cała baza apki BEZ historii treningów, w niej wy = {rok: skrót treningów z roku}; fmt = 2; updatedAt
   - backups/{uid}/years/{rok}: json = treningi z danego roku
   Żaden dokument nie rośnie bez końca (limit Firestore: 1 MB na dokument), a wysyłane są tylko zmienione lata.
   Format 1 (stary): wszystko w jednym json. Nadal go czytamy; przy zapisie przechodzi na format 2.
   Gdy reguły Firestore nie pozwalają jeszcze na dokumenty roczne (403), apka zapisuje dalej format 1. */
const yearUrl = (uid, y) => docUrl(uid) + '/years/' + encodeURIComponent(y);
const wYear = w => /^\d{4}/.test(w.date || '') ? w.date.slice(0, 4) : '0000';
function hashStr(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36) + s.length.toString(36); }
function workoutsByYear(list) { const m = {}; list.forEach(w => (m[wYear(w)] = m[wYear(w)] || []).push(w)); return m; }
const yearHash = list => hashStr(JSON.stringify([...(list || [])].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
function setYear(y, list) { S.workouts = S.workouts.filter(w => wYear(w) !== y).concat(list); S.workouts.sort((a, b) => a.start - b.start); }
async function pullYear(y) {
  const r = await authed(yearUrl(SY.session.uid, y));
  if (r.status === 404) return [];
  const f = (await r.json()).fields || {};
  try { const a = JSON.parse(f.json && f.json.stringValue || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
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
  const fmt2 = +(f.fmt && f.fmt.integerValue || 0) === 2, years = fmt2 ? (data.wy || {}) : null;
  if (fmt2) { data = Object.assign({}, data); delete data.wy; }
  return { data, updatedAt: +(f.updatedAt && f.updatedAt.integerValue || 0), fmt2, years };
}
// Pełne dane z chmury, z treningami ze wszystkich lat (pierwsze logowanie)
async function pullFull() {
  const remote = await pullRemote(); if (!remote) return null;
  if (remote.fmt2) {
    const ws = []; for (const y of Object.keys(remote.years)) ws.push(...await pullYear(y));
    remote.data.workouts = ws.sort((a, b) => a.start - b.start);
    SY.yearSeen = Object.assign({}, remote.years);
  }
  return remote;
}
async function pushRemote(remoteYears) {
  const now = Date.now(), uid = SY.session.uid, by = workoutsByYear(S.workouts), years = {};
  Object.keys(by).forEach(y => years[y] = yearHash(by[y]));
  // rok, z którego usunięto wszystkie treningi, zapisujemy jako pusty
  Object.keys(remoteYears || {}).forEach(y => { if (!years[y]) { by[y] = []; years[y] = yearHash([]); } });
  let split = true;
  try {
    for (const y of Object.keys(years)) {
      if (remoteYears && remoteYears[y] === years[y]) continue; // ten rok się nie zmienił
      await authed(yearUrl(uid, y), { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { json: { stringValue: JSON.stringify(by[y]) }, updatedAt: { integerValue: String(now) } } }) });
    }
    SY.splitBlocked = false;
  } catch (e) {
    if (e.status !== 403) throw e;
    split = false; SY.splitBlocked = true; // stare reguły Firestore — zostań przy formacie 1
  }
  let fields;
  if (split) {
    const main = Object.assign({}, S); delete main.workouts; main.wy = years;
    fields = { json: { stringValue: JSON.stringify(main) }, fmt: { integerValue: '2' }, updatedAt: { integerValue: String(now) } };
  } else fields = { json: { stringValue: JSON.stringify(S) }, updatedAt: { integerValue: String(now) } };
  await authed(docUrl(uid), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
  SY.lastRemoteAt = now;
  if (split) SY.yearSeen = years;
  // Udostępniany wycinek (osobny dokument) — błąd tutaj nie psuje kopii zapasowej
  try { await pushShared(); SY.shareErr = ''; } catch (e) { SY.shareErr = e.message; }
}

/* ---- UDOSTĘPNIANIE: wybrane dane do podglądu dla wskazanych osób ----
   Dokument shared/{uid}: owner, viewers (lista e-maili), json (tylko zaznaczone: plany / ulubione / waga).
   Czytać go może tylko właściciel i osoby z listy viewers, które potwierdziły swój e-mail (reguły Firestore). */
const sharedUrl = uid => `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(FB_PROJECT)}/databases/(default)/documents/shared/${encodeURIComponent(uid)}`;
const normEmail = s => String(s || '').trim().toLowerCase();
function shareSettings() {
  S.share = Object.assign({ viewers: [], plans: true, fav: true, weights: true }, S.share || {});
  return S.share;
}
function sharedPayload() {
  const sh = shareSettings(), d = { what: { plans: !!sh.plans, fav: !!sh.fav, weights: !!sh.weights } };
  if (sh.plans) d.plans = S.plans;
  if (sh.fav) d.fav = S.fav;
  if (sh.weights) { d.weights = S.weights; d.profile = { height: S.profile.height, goalLoss: S.profile.goalLoss }; }
  // własne ćwiczenia użyte w planach/ulubionych — żeby u oglądającego miały nazwy
  const ids = new Set([...(sh.plans ? S.plans.flatMap(p => p.ex.map(e => e.id)) : []), ...(sh.fav ? S.fav : [])]);
  d.custom = (S.custom || []).filter(c => ids.has(c.id));
  return d;
}
async function pushShared() {
  const sh = shareSettings(), uid = SY.session.uid;
  if (!sh.viewers.length || !(sh.plans || sh.fav || sh.weights)) {
    // nic nie udostępniam — usuń dokument (brak dokumentu = brak dostępu dla kogokolwiek), ale tylko jeśli istniał
    if (SY.sharedPublished === false) return;
    await authed(sharedUrl(uid), { method: 'DELETE' });
    SY.sharedPublished = false; sySave();
    return;
  }
  const fields = {
    owner: { stringValue: SY.session.email || '' },
    viewers: { arrayValue: { values: sh.viewers.map(v => ({ stringValue: v })) } },
    json: { stringValue: JSON.stringify(sharedPayload()) },
    updatedAt: { integerValue: String(Date.now()) },
  };
  await authed(sharedUrl(uid), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
  SY.sharedPublished = true; sySave();
}
async function listSharedWithMe() {
  const email = normEmail(SY.session.email);
  const r = await authed(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(FB_PROJECT)}/databases/(default)/documents:runQuery`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'shared' }], where: { fieldFilter: { field: { fieldPath: 'viewers' }, op: 'ARRAY_CONTAINS', value: { stringValue: email } } } } }),
  });
  const rows = await r.json();
  return (Array.isArray(rows) ? rows : []).filter(x => x.document).map(x => {
    const f = x.document.fields || {}; let data = {};
    try { data = JSON.parse(f.json && f.json.stringValue || '{}'); } catch (e) {}
    return { uid: x.document.name.split('/').pop(), owner: f.owner && f.owner.stringValue, updatedAt: +(f.updatedAt && f.updatedAt.integerValue || 0), data };
  }).filter(x => x.uid !== SY.session.uid);
}
// Weryfikacja e-maila (potrzebna osobie, która ogląda cudze dane)
// Data założenia konta — do faktu „dbasz o siebie od …”; pobierana raz i zapamiętywana w sesji
// Raz przy starcie: data założenia konta, aktualny e-mail (mógł się zmienić linkiem) i czy jest potwierdzony
let accountChecked = false;
async function fetchAccountCreated() {
  if (!cloudReady() || !SY.session || accountChecked || !navigator.onLine) return;
  try {
    const t = await idToken(); if (!t) return;
    const j = await (await authPost('lookup', { idToken: t })).json();
    const u = j.users && j.users[0]; if (!u || !SY.session) return;
    accountChecked = true;
    const hadDate = !!SY.session.createdAt;
    if (+u.createdAt) SY.session.createdAt = +u.createdAt;
    if (u.email && u.email !== SY.session.email) { SY.session.email = u.email; checkSpecialTheme(u.email); }
    SY.session.verified = !!u.emailVerified;
    sySave();
    if (await checkBlocked()) return;
    if (!hadDate) touchUser(true);
    if (!hadDate && UI.tab === 'dieta' && $('#sheet').hidden) renderDieta();
    if (UI.tab === 'wiecej' && $('#sheet').hidden) renderWiecej();
  } catch (e) { /* bez tych danych apka działa normalnie */ }
}
async function emailVerified() {
  const t = await idToken(); if (!t) throw Object.assign(new Error('Brak połączenia z serwerem.'), { code: 'net' });
  const r = await authPost('lookup', { idToken: t });
  const j = await r.json();
  return !!(j.users && j.users[0] && j.users[0].emailVerified);
}
async function sendVerifyEmail() {
  const t = await idToken(); if (!t) throw Object.assign(new Error('Brak połączenia z serwerem.'), { code: 'net' });
  await authPost('sendOobCode', { requestType: 'VERIFY_EMAIL', idToken: t });
}
async function refreshTokenNow() { if (SY.session) { SY.session.expiresAt = 0; await idToken(); } }
function adoptRemote(data) {
  const keepActive = S.active;
  S = Object.assign({ profile: { height: null, goalLoss: null }, weights: [], workouts: [], active: null, custom: [], fav: [], plans: [], measures: [] }, data);
  ['weights', 'workouts', 'custom', 'fav', 'plans', 'measures'].forEach(k => { if (!Array.isArray(S[k])) S[k] = []; });
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
    if (!remote) await pushRemote(null);
    else {
      const remoteNewer = remote.updatedAt > SY.lastRemoteAt + 1000;
      let main = remote.data;
      if (!remote.fmt2 && remoteNewer && SY.yearSeen && Object.keys(SY.yearSeen).length) {
        // stary format zapisany przez starszą wersję apki już po przejściu na nowy:
        // dołącz treningi z dokumentów rocznych, żeby żaden nie zginął
        const extra = []; for (const y of Object.keys(SY.yearSeen)) extra.push(...await pullYear(y));
        const ids = new Set((main.workouts || []).map(w => w.id));
        main = Object.assign({}, main, { workouts: [...(main.workouts || []), ...extra.filter(w => !ids.has(w.id))] });
      }
      // 1) dane poza treningami (w starym formacie: wszystko)
      if (remoteNewer && !SY.dirty) {         // ktoś zmienił dane na innym urządzeniu — pobierz
        adoptRemote(remote.fmt2 ? Object.assign({}, main, { workouts: S.workouts }) : main);
        SY.lastRemoteAt = remote.updatedAt;
      } else if (remoteNewer && SY.dirty) {   // zmiany i tu, i tam — połącz, potem wyślij
        applyData(stateAsData(main), false); save(true); rebuildExMap();
        if ($('#sheet').hidden) rerender();
      }
      // 2) treningi: pobierz tylko lata zmienione gdzie indziej
      let differs = false;
      if (remote.fmt2) {
        SY.yearSeen = SY.yearSeen || {};
        let changed = false;
        for (const y of Object.keys(remote.years)) {
          const rh = remote.years[y];
          if (rh === SY.yearSeen[y]) continue;                                            // bez zmian od ostatniej synchronizacji
          if (rh === yearHash(workoutsByYear(S.workouts)[y])) { SY.yearSeen[y] = rh; continue; } // to samo co w telefonie
          const list = await pullYear(y);
          if (SY.dirty) applyData({ workouts: list }, false); else setYear(y, list);
          SY.yearSeen[y] = rh; changed = true;
        }
        if (changed) { save(true); rebuildExMap(); if ($('#sheet').hidden) rerender(); }
        const local = workoutsByYear(S.workouts);
        differs = [...new Set([...Object.keys(local), ...Object.keys(remote.years)])].some(y => yearHash(local[y]) !== remote.years[y]);
      }
      // 3) wysyłka (także jednorazowe przejście ze starego formatu na nowy)
      if (SY.dirty || differs || (!remote.fmt2 && !SY.splitBlocked)) await pushRemote(remote.fmt2 ? remote.years : null);
    }
    SY.dirty = false; dirtySince = 0; SY.lastSyncAt = Date.now(); SY.status = 'ok'; SY.error = '';
    touchUser();
  } catch (e) {
    SY.status = e.code === 'net' ? 'offline' : 'error'; SY.error = e.message;
    if (e.status === 403) setTimeout(checkBlocked, 0); // odmowa zapisu: może admin zablokował konto
  } finally {
    syncing = false; sySave(); updateSyncUI();
    if (syncAgain) { syncAgain = false; syncSoon(500); }
  }
}
async function firstSyncAfterLogin() {
  SY.yearSeen = {};
  const remote = await pullFull();
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
  // plik nie leży już w chmurze (zajmował miejsce w dokumencie) — po synchronizacji budujemy go z aktualnych danych
  toast('Synchronizuję…');
  await syncNow();
  if (SY.status === 'error' || SY.status === 'offline') { toast('Nie udało się zsynchronizować: ' + (SY.error || 'brak internetu') + '. Plik będzie z danych w telefonie.'); }
  shareOrDownload(`Rozpierdol-kopia-${today()}.xlsx`, backupXlsx());
}

/* ---- SUGESTIE ----
   Kolekcja suggestions/{auto-id}: text, uid, email, createdAt.
   Każde zalogowane konto może tylko DODAĆ sugestię; czytać i usuwać może wyłącznie admin (reguła Firestore). */
const sugUrl = id => `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(FB_PROJECT)}/databases/(default)/documents/suggestions${id ? '/' + encodeURIComponent(id) : ''}`;
const SUG_MAX = 2000;
async function sendSuggestion(text) {
  const fields = { text: { stringValue: text }, uid: { stringValue: SY.session.uid }, email: { stringValue: SY.session.email || '' }, createdAt: { integerValue: String(Date.now()) } };
  await authed(sugUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
}
async function listSuggestions() {
  const out = []; let page = '';
  do {
    const r = await authed(sugUrl() + '?pageSize=300' + (page ? '&pageToken=' + encodeURIComponent(page) : ''));
    if (r.status === 404) break;
    const j = await r.json();
    (j.documents || []).forEach(d => { const f = d.fields || {}; out.push({ id: d.name.split('/').pop(), text: f.text && f.text.stringValue || '', email: f.email && f.email.stringValue || '', at: +(f.createdAt && f.createdAt.integerValue || 0) }); });
    page = j.nextPageToken || '';
  } while (page);
  return out.sort((a, b) => b.at - a.at);
}
// Ekran „Sugestie” (w Ustawieniach): formularz rysowany w podanym kontenerze
function renderSuggest(b) {
  if (!cloudReady() || !SY.session) {
    b.innerHTML = `<p style="margin:0">Żeby wysłać sugestię, zaloguj się w Ustawieniach → Konto i chmura.</p>`;
    return;
  }
  b.innerHTML = `
    <p class="muted small" style="margin:0">Co dodać, co poprawić, co cię wkurza? Sugestię przeczyta tylko autor apki. Dołączy się do niej twój e-mail (${esc(SY.session.email || '')}), żeby mógł odpisać.</p>
    <textarea class="sug-text" id="sug-t" maxlength="${SUG_MAX}" placeholder="Np. przydałby się timer przerwy między seriami"></textarea>
    <div class="row small"><span class="muted" id="sug-n">0 / ${SUG_MAX}</span><span class="small" id="sug-err" style="color:var(--bad)" role="alert"></span></div>
    <button class="btn primary block" type="button" id="sug-send">Wyślij sugestię</button>`;
  {
    const t = $('#sug-t', b), n = $('#sug-n', b), err = $('#sug-err', b), btn = $('#sug-send', b);
    t.addEventListener('input', () => { n.textContent = `${t.value.length} / ${SUG_MAX}`; err.textContent = ''; });
    btn.onclick = async () => {
      const v = t.value.trim();
      if (v.length < 3) { err.textContent = 'Napisz coś więcej.'; return; }
      let last = 0; try { last = +localStorage.getItem('rozpierdol-sugestia') || 0; } catch (e) {}
      if (Date.now() - last < 30000) { err.textContent = 'Odczekaj chwilę przed kolejną sugestią.'; return; }
      btn.disabled = true; btn.textContent = 'Wysyłam…';
      try {
        await sendSuggestion(v);
        try { localStorage.setItem('rozpierdol-sugestia', String(Date.now())); } catch (e) {}
        b.innerHTML = '<p class="big-note">Dzięki! 💡</p><p class="muted" style="margin:0;text-align:center">Sugestia wysłana. Autor apki ją przeczyta.</p><button class="btn block" type="button" id="sug-more">Napisz kolejną</button>';
        $('#sug-more', b).onclick = () => renderSuggest(b);
      } catch (e) {
        err.textContent = /odmówił dostępu/i.test(e.message) ? 'Serwer jeszcze nie przyjmuje sugestii (brak reguł w Firebase).' : e.message;
        btn.disabled = false; btn.textContent = 'Wyślij sugestię';
      }
    };
  }
}
// Ekran „Sugestie użytkowników” (tylko admin): lista z możliwością usuwania
async function renderSuggestAdmin(b) {
  b.innerHTML = '<p class="muted small" style="margin:0">Wczytuję…</p>';
  let list;
  try { list = await listSuggestions(); }
  catch (e) {
    b.innerHTML = `<p class="small" style="margin:0;color:var(--bad)">${esc(e.message)}</p>
      <p class="muted small" style="margin:0">Odczyt działa tylko z konta admina z <b>potwierdzonym</b> e-mailem i po wklejeniu reguł z FIREBASE.md.</p>`;
    return;
  }
  const when = at => at ? new Date(at).toLocaleString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  b.innerHTML = list.length ? `
    <div class="row small"><span class="muted">${plural(list.length, 'sugestia', 'sugestie', 'sugestii')}, od najnowszych</span><button class="link" type="button" id="sug-reload">Odśwież</button></div>
    <div class="list">${list.map(s => `<div class="li sug-item">
      <div class="row small"><span class="muted">${esc(s.email || 'bez e-maila')} · ${when(s.at)}</span><button class="icon-btn" type="button" data-sdel="${esc(s.id)}" aria-label="Usuń sugestię">✕</button></div>
      <div class="txt">${esc(s.text)}</div></div>`).join('')}</div>`
    : '<p class="muted" style="margin:0">Na razie nikt nic nie napisał.</p><button class="link" type="button" id="sug-reload">Odśwież</button>';
  const rl = $('#sug-reload', b); if (rl) rl.onclick = () => renderSuggestAdmin(b);
  $$('[data-sdel]', b).forEach(d => d.onclick = async () => {
    if (!await confirmBox('Usunąć sugestię?', 'Zniknie na zawsze.', 'Usuń', true)) { openSec('sugadmin'); return; }
    try { await authed(sugUrl(d.dataset.sdel), { method: 'DELETE' }); toast('Usunięto'); } catch (x) { toast(x.message); }
    openSec('sugadmin');
  });
}

/* ---- REJESTR KONT I PANEL ADMINA ----
   users/{uid}: e-mail, data założenia, ostatnia aktywność i liczby wpisów — każde konto zapisuje swój wpis (najwyżej co 6 h).
   blocked/{uid}: konto usunięte przez admina. Reguły Firestore nie pozwalają mu nic zapisać, a apka je wylogowuje.
   Konta logowania (Firebase Authentication) z poziomu apki usunąć się nie da — to wymaga klucza serwerowego,
   którego w publicznej apce być nie może. Admin kasuje więc wszystkie dane i blokuje konto, a sam login usuwa w konsoli. */
const FS_BASE = () => `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(FB_PROJECT)}/databases/(default)/documents/`;
const usersUrl = uid => FS_BASE() + 'users' + (uid ? '/' + encodeURIComponent(uid) : '');
const blockedUrl = uid => FS_BASE() + 'blocked' + (uid ? '/' + encodeURIComponent(uid) : '');
const fNum = (f, k) => +(f[k] && (f[k].integerValue || f[k].doubleValue) || 0);
const fStr = (f, k) => (f[k] && f[k].stringValue) || '';
async function listDocs(url, mask) {
  const out = []; let page = '';
  do {
    const r = await authed(url + '?pageSize=300' + (mask || []).map(m => '&mask.fieldPaths=' + encodeURIComponent(m)).join('') + (page ? '&pageToken=' + encodeURIComponent(page) : ''));
    if (r.status === 404) break;
    const j = await r.json();
    (j.documents || []).forEach(d => out.push({ id: d.name.split('/').pop(), f: d.fields || {} }));
    page = j.nextPageToken || '';
  } while (page);
  return out;
}
async function touchUser(force) {
  const s = SY.session; if (!s) return;
  if (!force && SY.userTouched && Date.now() - SY.userTouched < 6 * 3600e3 && SY.userEmail === s.email) return;
  let ver = '';
  try { if (window.caches) ver = ((await caches.keys()).find(n => /^rozpierdol-(?!img)/.test(n)) || '').replace('rozpierdol-', ''); } catch (e) {}
  const fields = {
    email: { stringValue: s.email || '' }, createdAt: { integerValue: String(s.createdAt || 0) }, lastSeen: { integerValue: String(Date.now()) },
    weights: { integerValue: String(S.weights.length) }, workouts: { integerValue: String(S.workouts.length) }, plans: { integerValue: String(S.plans.length) },
    // same numery lat z treningami (bez treści) — żeby przy usuwaniu konta wiadomo było, które dokumenty roczne skasować
    years: { arrayValue: { values: [...new Set([...Object.keys(SY.yearSeen || {}), ...S.workouts.map(wYear)])].map(y => ({ stringValue: y })) } },
    standalone: { booleanValue: navigator.standalone === true || matchMedia('(display-mode: standalone)').matches }, ver: { stringValue: ver },
  };
  try {
    await authed(usersUrl(s.uid), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
    SY.userTouched = Date.now(); SY.userEmail = s.email; sySave();
  } catch (e) { /* stare reguły Firestore albo brak sieci — spróbujemy przy kolejnej synchronizacji */ }
}
// Czy admin zablokował to konto? Jeśli tak — wyloguj (dane w telefonie zostają).
async function isBlocked() {
  if (!SY.session) return false;
  try { return (await authed(blockedUrl(SY.session.uid))).status !== 404; }
  catch (e) { return false; } // brak sieci albo stare reguły (403) — nie blokujemy
}
async function checkBlocked() {
  if (!await isBlocked()) return false;
  await cloudLogout();
  openSheet('Konto usunięte', `<p style="margin:0">Admin usunął to konto z chmury i wylogował je. Dane zapisane w tym telefonie zostały.</p>
    <p class="muted small" style="margin:0">Jeśli to pomyłka, napisz do autora apki.</p><button class="btn block" type="button" data-close>OK</button>`);
  rerender();
  return true;
}
// Usuwa z chmury wszystko, co należy do konta, i blokuje je (tylko admin)
async function adminDeleteUser(uid, email, knownYears) {
  const soft = async p => { try { await p; } catch (e) { if (e.status !== 403 && e.status !== 404) throw e; } };
  // blokada najpierw: od tej chwili telefon tej osoby nie odtworzy danych kolejną synchronizacją
  await authed(blockedUrl(uid), { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { email: { stringValue: email || '' }, at: { integerValue: String(Date.now()) } } }) });
  // admin nie może czytać danych kont (także listy lat), więc kasuje lata z rejestru i na wszelki wypadek każdy rok od 2020
  // (usunięcie nieistniejącego dokumentu niczego nie psuje)
  const years = new Set(knownYears || []), now = new Date().getFullYear();
  for (let y = 2020; y <= now + 1; y++) years.add(String(y));
  years.add('0000');
  for (const y of years) await soft(authed(yearUrl(uid, y), { method: 'DELETE' }));
  await soft(authed(docUrl(uid), { method: 'DELETE' }));
  await soft(authed(sharedUrl(uid), { method: 'DELETE' }));
  await soft(authed(usersUrl(uid), { method: 'DELETE' }));
}
async function renderAdmin(b) {
  b.innerHTML = '<p class="muted small" style="margin:0">Wczytuję…</p>';
  let users, blocked;
  try {
    [users, blocked] = await Promise.all([listDocs(usersUrl()), listDocs(blockedUrl())]);
  } catch (e) {
    b.innerHTML = `<p class="small" style="margin:0;color:var(--bad)">${esc(e.message)}</p>
      <p class="muted small" style="margin:0">Panel działa tylko z konta admina z <b>potwierdzonym</b> e-mailem i po wklejeniu nowych reguł z FIREBASE.md.</p>`;
    return;
  }
  const blockedIds = new Set(blocked.map(x => x.id));
  const map = {};
  users.forEach(u => map[u.id] = { uid: u.id, email: fStr(u.f, 'email'), created: fNum(u.f, 'createdAt'), seen: fNum(u.f, 'lastSeen'),
    weights: fNum(u.f, 'weights'), workouts: fNum(u.f, 'workouts'), plans: fNum(u.f, 'plans'), app: !!(u.f.standalone && u.f.standalone.booleanValue), ver: fStr(u.f, 'ver'),
    years: ((u.f.years && u.f.years.arrayValue && u.f.years.arrayValue.values) || []).map(v => v.stringValue) });
  const list = Object.values(map).filter(u => !blockedIds.has(u.uid)).sort((a, b2) => b2.seen - a.seen);
  const when = at => at ? new Date(at).toLocaleString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–';
  const day = at => at ? new Date(at).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' }) : '–';
  const me = SY.session && SY.session.uid;
  b.innerHTML = `
    <div class="row small"><span class="muted">${plural(list.length, 'konto', 'konta', 'kont')} (konto pojawia się po otwarciu nowej wersji apki)</span><button class="link" type="button" id="adm-reload">Odśwież</button></div>
    <div class="list">${list.map(u => `<div class="li sug-item">
      <div class="row"><b style="overflow-wrap:anywhere">${u.email ? esc(u.email) : '<span class="muted">e-mail nieznany</span>'}${u.uid === me ? ' <span class="muted small">(ty)</span>' : ''}</b>
        ${u.uid === me ? '' : `<button class="btn danger" type="button" style="padding:6px 12px;min-height:0" data-udel="${esc(u.uid)}">Usuń</button>`}</div>
      <div class="muted small">Konto od ${day(u.created)} · ostatnio ${when(u.seen)}<br>
        ${plural(u.weights, 'pomiar', 'pomiary', 'pomiarów')} wagi, ${plural(u.workouts, 'trening', 'treningi', 'treningów')}, ${plural(u.plans, 'plan', 'plany', 'planów')}<br>
        ${u.app ? 'Apka na ekranie początkowym' : 'W przeglądarce'}${u.ver ? ' · wersja ' + esc(u.ver) : ''}</div>
    </div>`).join('') || '<p class="muted" style="margin:0">Brak kont.</p>'}</div>
    ${blocked.length ? `<h3 style="margin:8px 0 0">Usunięte i zablokowane</h3>
    <div class="list">${blocked.map(x => `<div class="li"><span class="grow small">${esc(fStr(x.f, 'email') || x.id)}<br><span class="muted">${when(fNum(x.f, 'at'))}</span></span>
      <button class="link" type="button" data-unblock="${esc(x.id)}">Odblokuj</button></div>`).join('')}</div>` : ''}
    <p class="muted small" style="margin:0">„Usuń” kasuje z chmury wszystkie dane konta i blokuje je: apka tej osoby wyloguje się przy następnym uruchomieniu. Dane w jej telefonie zostają. Sam login (e-mail i hasło) usuniesz w konsoli Firebase → Authentication → Users.</p>`;
  $('#adm-reload', b).onclick = () => renderAdmin(b);
  $$('[data-udel]', b).forEach(d => d.onclick = async () => {
    const u = map[d.dataset.udel];
    if (!await confirmBox('Usunąć konto?', `Wszystkie dane <b>${esc(u.email || u.uid)}</b> znikną z chmury (waga, treningi, plany, udostępnienia), a konto zostanie zablokowane. Tego nie da się cofnąć.`, 'Usuń', true)) { openSec('admin'); return; }
    toast('Usuwam…');
    try { await adminDeleteUser(u.uid, u.email, u.years); toast('Usunięto konto'); } catch (x) { toast(x.message); }
    openSec('admin');
  });
  $$('[data-unblock]', b).forEach(d => d.onclick = async () => {
    if (!await confirmBox('Odblokować konto?', 'Ta osoba znów będzie mogła się zalogować i zapisywać dane. Usunięte dane nie wrócą.', 'Odblokuj')) { openSec('admin'); return; }
    try { await authed(blockedUrl(d.dataset.unblock), { method: 'DELETE' }); toast('Odblokowano'); } catch (x) { toast(x.message); }
    openSec('admin');
  });
}

/* ---- interfejs: okna zarządzania kontem ---- */
const passField = (id, label, auto) => `<div class="field"><label for="${id}">${label}</label>
  <input type="password" id="${id}" autocomplete="${auto}" minlength="6" required></div>`;
// wspólny formularz: walidacja, blokada przycisku na czas wysyłki, błąd pod formularzem
function accountForm(title, html, submitLabel, danger, run) {
  openSheet(title, `<form id="ac-form" class="view" style="gap:12px" autocomplete="on">${html}
    <p class="small" id="ac-err" style="margin:0;color:var(--bad)" role="alert"></p>
    <button class="btn ${danger ? 'danger' : 'primary'} block" type="submit">${submitLabel}</button></form>`, b => {
    const f = $('#ac-form', b), err = $('#ac-err', b), btn = f.querySelector('[type=submit]');
    f.addEventListener('submit', async e => {
      e.preventDefault(); err.textContent = '';
      if (!navigator.onLine) { err.textContent = 'Brak internetu.'; return; }
      btn.disabled = true; const t = btn.textContent; btn.textContent = 'Chwila…';
      try { await run(f, err); } catch (x) { err.textContent = x.message; }
      finally { if (btn.isConnected) { btn.disabled = false; btn.textContent = t; } }
    });
  });
}
function showChangePassword() {
  accountForm('Zmień hasło', `
    ${passField('ac-old', 'Obecne hasło', 'current-password')}
    ${passField('ac-new', 'Nowe hasło (min. 6 znaków)', 'new-password')}
    ${passField('ac-new2', 'Powtórz nowe hasło', 'new-password')}
    <p class="muted small" style="margin:0">Po zmianie hasła inne telefony zalogowane na to konto trzeba będzie zalogować ponownie.</p>`, 'Zmień hasło', false, async (f, err) => {
    const o = f.querySelector('#ac-old').value, n = f.querySelector('#ac-new').value, n2 = f.querySelector('#ac-new2').value;
    if (n.length < 6) { err.textContent = 'Nowe hasło musi mieć co najmniej 6 znaków.'; return; }
    if (n !== n2) { err.textContent = 'Nowe hasła się różnią.'; return; }
    if (n === o) { err.textContent = 'Nowe hasło jest takie samo jak obecne.'; return; }
    await changePassword(o, n);
    closeSheet(); toast('Hasło zmienione'); renderWiecej();
  });
}
function showChangeEmail() {
  accountForm('Zmień adres e-mail', `
    <p class="muted small" style="margin:0">Obecny adres: <b>${esc(SY.session.email || '')}</b>. Na nowy adres przyjdzie link. Adres zmieni się dopiero po jego kliknięciu.</p>
    <div class="field"><label for="ac-mail">Nowy adres e-mail</label><input type="email" id="ac-mail" inputmode="email" autocapitalize="off" spellcheck="false" autocomplete="email" required></div>
    ${passField('ac-pw', 'Obecne hasło', 'current-password')}
    <p class="muted small" style="margin:0">Osoby, którym coś udostępniasz, nadal cię zobaczą. Jeśli ktoś udostępnia coś tobie, musi dopisać u siebie nowy adres.</p>`, 'Wyślij link', false, async (f, err) => {
    const m = normEmail(f.querySelector('#ac-mail').value);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m)) { err.textContent = 'Wpisz poprawny e-mail.'; return; }
    if (m === normEmail(SY.session.email)) { err.textContent = 'To twój obecny adres.'; return; }
    await changeEmail(f.querySelector('#ac-pw').value, m);
    closeSheet(); toast('Wysłano link na ' + m + '. Kliknij go, żeby zmienić adres.');
  });
}
function showDeleteAccount() {
  accountForm('Usuń konto', `
    <p style="margin:0">Konto <b>${esc(SY.session.email || '')}</b> i wszystkie twoje dane w chmurze zostaną <b>trwale usunięte</b>: waga, treningi, plany, pomiary i udostępnienia. Tego nie da się cofnąć.</p>
    <p class="muted small" style="margin:0">Jeśli chcesz zachować kopię, najpierw stuknij „Pobierz kopię Excel”.</p>
    <label class="share-opt"><input type="checkbox" id="ac-local" checked><span>Usuń też dane z tego telefonu</span></label>
    ${passField('ac-pw', 'Hasło (potwierdzenie)', 'current-password')}`, 'Usuń konto na zawsze', true, async f => {
    const local = f.querySelector('#ac-local').checked;
    await deleteAccount(f.querySelector('#ac-pw').value);
    if (local) { S = { profile: { height: null, goalLoss: null }, weights: [], workouts: [], active: null, custom: [], fav: [], plans: [], measures: [] }; save(true); rebuildExMap(); UI.cw = newFilter(); }
    closeSheet(); toast('Konto usunięte'); setTab('wiecej');
  });
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
      <p class="muted small" style="margin:0">Nie jesteś zalogowany, więc dane są tylko na tym telefonie. Po zalogowaniu każda zmiana sama zapisze się w chmurze.</p>
      <button class="btn primary" type="button" id="sy-open">Zaloguj się lub załóż konto</button>`;
    card.querySelector('#sy-open').onclick = () => showAuthScreen();
    return;
  }
  card.innerHTML = `<h2>Konto i chmura</h2>
    <div class="row small"><span>Zalogowano jako</span><b style="overflow-wrap:anywhere;text-align:right">${esc(SY.session.email || '')}</b></div>
    <div class="small" id="sync-status" aria-live="polite">${syncStatusText()}</div>
    ${SY.splitBlocked ? '<p class="small" style="margin:0;color:var(--bad)">Treningi zapisują się jeszcze w starym formacie (jeden dokument). Wklej w Firebase nowe reguły z instrukcji FIREBASE.md, a apka sama przejdzie na podział po latach.</p>' : ''}
    <div class="btns">
      <button class="btn" type="button" id="sy-now">Synchronizuj teraz</button>
      <button class="btn" type="button" id="sy-file">Pobierz kopię Excel</button>
    </div>
    <hr class="sep">
    <h3 style="margin:0">Konto</h3>
    <div class="row small"><span>E-mail</span><span>${SY.session.verified === true ? '<span class="pill good">potwierdzony</span>' : SY.session.verified === false ? '<button class="link" type="button" id="ac-verify">Potwierdź e-mail</button>' : ''}</span></div>
    ${SY.session.createdAt ? `<div class="row small"><span>Konto założone</span><b>${new Date(SY.session.createdAt).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' })}</b></div>` : ''}
    <div class="list">
      <button class="li" type="button" id="ac-pass"><span class="grow"><span class="t">Zmień hasło</span></span><span class="chev" aria-hidden="true">›</span></button>
      <button class="li" type="button" id="ac-email"><span class="grow"><span class="t">Zmień adres e-mail</span></span><span class="chev" aria-hidden="true">›</span></button>
      <button class="li" type="button" id="sy-out"><span class="grow"><span class="t">Wyloguj</span></span><span class="chev" aria-hidden="true">›</span></button>
      <button class="li" type="button" id="ac-del"><span class="grow"><span class="t" style="color:var(--bad)">Usuń konto</span></span><span class="chev" aria-hidden="true">›</span></button>
    </div>`;
  card.querySelector('#ac-pass').onclick = showChangePassword;
  card.querySelector('#ac-email').onclick = showChangeEmail;
  card.querySelector('#ac-del').onclick = showDeleteAccount;
  const av = card.querySelector('#ac-verify');
  if (av) av.onclick = async () => { try { await sendVerifyEmail(); toast('Wysłano link na ' + SY.session.email + '. Sprawdź też spam.'); } catch (e) { toast(e.message); } };
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

/* ---- interfejs: sekcja „Udostępnianie” w Ustawieniach ---- */
function renderShareCard(card) {
  if (!card) return;
  if (!cloudReady() || !SY.session) { card.remove(); return; }
  const sh = shareSettings();
  const chk = (k, label) => `<label class="share-opt"><input type="checkbox" data-what="${k}" ${sh[k] ? 'checked' : ''}><span>${label}</span></label>`;
  card.innerHTML = `
    <h2>Udostępnianie</h2>
    <p class="muted small" style="margin:0">Osoby z listy po zalogowaniu zobaczą zaznaczone rzeczy, tylko do podglądu. Treningi i reszta danych zostają prywatne. Usunięcie osoby z listy od razu zabiera jej dostęp.</p>
    <div class="share-opts">${chk('plans', 'Plany treningowe')}${chk('fav', 'Ulubione ćwiczenia')}${chk('weights', 'Historia wagi')}</div>
    <div class="list" id="share-viewers">${sh.viewers.length ? sh.viewers.map(v => `
      <div class="li"><div class="grow"><div class="t" style="font-weight:500">${esc(v)}</div></div>
        <button class="icon-btn" type="button" data-unshare="${esc(v)}" aria-label="Zabierz dostęp ${esc(v)}">✕</button></div>`).join('')
      : '<div class="li"><span class="muted small">Nikt jeszcze nie ma dostępu.</span></div>'}</div>
    <form id="share-add" class="add-weight" style="grid-template-columns:minmax(0,1fr) auto" autocomplete="off">
      <div class="field"><label for="share-email">E-mail osoby (jej konto w apce)</label><input type="email" id="share-email" inputmode="email" autocapitalize="off" spellcheck="false" placeholder="np. ona@gmail.com"></div>
      <button class="btn primary" type="submit">Udostępnij</button>
    </form>
    ${SY.shareErr ? `<p class="small" style="margin:0;color:var(--bad)">Nie udało się zapisać udostępnienia: ${esc(SY.shareErr)}</p>` : ''}
    <hr class="sep">
    <h2>Udostępnione mi</h2>
    <div id="shared-me" class="view" style="gap:10px"><button class="btn" type="button" id="shared-load">Pokaż, co inni mi udostępnili</button></div>`;
  const changed = msg => { save(); toast(msg); renderShareCard(card); };
  card.querySelectorAll('[data-what]').forEach(c => c.onchange = () => { sh[c.dataset.what] = c.checked; changed('Zapisano. Zmiana trafi do chmury za chwilę'); });
  card.querySelectorAll('[data-unshare]').forEach(b => b.onclick = async () => {
    if (!await confirmBox('Zabrać dostęp?', `${esc(b.dataset.unshare)} przestanie widzieć twoje udostępnione dane.`, 'Zabierz dostęp', true)) return;
    sh.viewers = sh.viewers.filter(v => v !== b.dataset.unshare); changed('Dostęp zabrany');
  });
  card.querySelector('#share-add').addEventListener('submit', e => {
    e.preventDefault();
    const v = normEmail(card.querySelector('#share-email').value);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { toast('Wpisz poprawny e-mail'); return; }
    if (v === normEmail(SY.session.email)) { toast('To twój własny e-mail'); return; }
    if (sh.viewers.includes(v)) { toast('Ta osoba już ma dostęp'); return; }
    if (sh.viewers.length >= 20) { toast('Maksymalnie 20 osób'); return; }
    sh.viewers.push(v); changed('Udostępniono: ' + v);
  });
  card.querySelector('#shared-load').onclick = () => loadSharedWithMe(card.querySelector('#shared-me'));
}

async function loadSharedWithMe(box) {
  box.innerHTML = '<p class="muted small" style="margin:0">Sprawdzam…</p>';
  try {
    if (!await emailVerified()) {
      box.innerHTML = `<p class="small" style="margin:0">Żeby oglądać cudze dane, potwierdź najpierw swój e-mail <b>${esc(SY.session.email)}</b>. To chroni przed podszyciem się pod ciebie.</p>
        <div class="btns"><button class="btn primary" type="button" id="ver-send">Wyślij link potwierdzający</button><button class="btn" type="button" id="ver-check">Już potwierdziłem</button></div>
        <p class="muted small" id="ver-msg" style="margin:0"></p>`;
      box.querySelector('#ver-send').onclick = async () => {
        try { await sendVerifyEmail(); box.querySelector('#ver-msg').textContent = 'Wysłane. Otwórz maila od Firebase, kliknij link, wróć tu i stuknij „Już potwierdziłem”. Sprawdź też spam.'; }
        catch (e) { box.querySelector('#ver-msg').textContent = e.message; }
      };
      box.querySelector('#ver-check').onclick = async () => { await refreshTokenNow(); loadSharedWithMe(box); };
      return;
    }
    const list = await listSharedWithMe();
    if (!list.length) { box.innerHTML = '<p class="muted small" style="margin:0">Nikt jeszcze niczego ci nie udostępnił. Poproś tę osobę, żeby w swoich Ustawieniach → Udostępnianie dopisała twój e-mail.</p><button class="btn" type="button" id="shared-load">Sprawdź ponownie</button>'; box.querySelector('#shared-load').onclick = () => loadSharedWithMe(box); return; }
    box.innerHTML = `<div class="list">${list.map((x, i) => {
      const w = x.data.what || {};
      const parts = [w.weights && 'waga', w.plans && plural((x.data.plans || []).length, 'plan', 'plany', 'planów'), w.fav && plural((x.data.fav || []).length, 'ulubione', 'ulubione', 'ulubionych')].filter(Boolean).join(' · ');
      return `<button class="li" type="button" data-sh="${i}"><div class="grow"><div class="t">${esc(x.owner || 'Użytkownik')}</div><div class="s">${parts}</div></div><span class="chev" aria-hidden="true">›</span></button>`;
    }).join('')}</div>`;
    box.querySelectorAll('[data-sh]').forEach(b => b.onclick = () => showShared(list[+b.dataset.sh]));
  } catch (e) {
    const rulesHint = /odmówił dostępu|PERMISSION/i.test(e.message) ? ' Możliwe, że w Firebase brakuje nowych reguł udostępniania (instrukcja w FIREBASE.md).' : '';
    box.innerHTML = `<p class="small" style="margin:0;color:var(--bad)">${esc(e.message)}${rulesHint}</p><button class="btn" type="button" id="shared-load">Spróbuj ponownie</button>`;
    box.querySelector('#shared-load').onclick = () => loadSharedWithMe(box);
  }
}

function showShared(x) {
  const d = x.data || {}, w = d.what || {};
  // nazwy własnych ćwiczeń tej osoby
  const other = {}; (d.custom || []).forEach(c => other[c.id] = Object.assign({ own: true, img: [], ins: [], s: [] }, c));
  const exOf = id => EXMAP[id] || other[id];
  const ws = (d.weights || []).slice().sort((a, b) => a.d < b.d ? -1 : 1);
  let weightHTML = '';
  if (w.weights) {
    if (ws.length) {
      const start = ws[0].w, cur = ws[ws.length - 1].w, h = d.profile && d.profile.height, goal = d.profile && d.profile.goalLoss;
      const lost = start - cur, bmi = h ? cur / (h * h) : null;
      weightHTML = `<section class="card">
        <div class="hero-nums">
          <div><h3>Aktualna waga</h3><div class="big">${fmt(cur, 1)}<small>kg</small></div></div>
          <div class="lost"><h3>Od startu</h3><div class="big ${lost > 0 ? 'down' : lost < 0 ? 'up' : ''}">${lost > 0 ? '−' : lost < 0 ? '+' : ''}${fmt(Math.abs(lost), 1)}<small>kg</small></div></div>
        </div>
        <div class="muted small">${ws.length} pomiarów · ${dayLabel(ws[0].d)} – ${dayLabel(ws[ws.length - 1].d)}${bmi ? ' · BMI ' + fmt(bmi, 1) : ''}${goal ? ' · cel −' + fmt(goal, 1) + ' kg (' + fmt(lost / goal * 100, 0) + '%)' : ''}</div>
        <div class="chart">${chartSVG(ws, 0)}</div>
      </section>`;
    } else weightHTML = '<p class="muted small" style="margin:0">Brak pomiarów wagi.</p>';
  }
  const plansHTML = w.plans ? `<h3>Plany treningowe</h3>${(d.plans || []).length ? `<div class="list">${d.plans.map((p, i) => `
      <div class="li" style="align-items:flex-start">
        <div class="grow"><div class="t">${esc(p.name)}</div>
          <div class="s">${p.ex.map(e => `${esc(exName(exOf(e.id)))} <span class="num">×${e.sets}</span>`).join(' · ')}</div></div>
        <button class="btn" type="button" data-copy="${i}" style="padding:8px 12px;font-size:14px;flex:none">Skopiuj</button>
      </div>`).join('')}</div>` : '<p class="muted small" style="margin:0">Brak planów.</p>'}` : '';
  const favHTML = w.fav ? `<h3>Ulubione ćwiczenia</h3>${(d.fav || []).length ? `<div class="list">${d.fav.map(id => { const e = exOf(id); return `
      <div class="li li-row"><div class="li-main" style="cursor:default">${thumbHTML(e)}<div class="grow"><div class="t">${esc(exName(e))}</div><div class="s">${e ? [...(e.m || []).map(m => MUSCLE[m] || m), EQUIP[e.e] || ''].filter(Boolean).join(' · ') : ''}</div></div></div>${EXMAP[id] ? starBtn(id) : ''}</div>`; }).join('')}</div>` : '<p class="muted small" style="margin:0">Brak ulubionych.</p>'}` : '';
  openSheet(x.owner || 'Udostępnione', `
    <p class="muted small" style="margin:0">Podgląd danych udostępnionych przez tę osobę${x.updatedAt ? ' · stan z ' + new Date(x.updatedAt).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}. Gwiazdką dodasz ćwiczenie do swoich ulubionych.</p>
    ${weightHTML}${plansHTML}${favHTML}`, b => {
    requestAnimationFrame(() => fitHero(b));
    b.addEventListener('click', e => {
      const c = e.target.closest('[data-copy]');
      if (c) {
        const p = d.plans[+c.dataset.copy];
        (d.custom || []).forEach(cu => { if (p.ex.some(x => x.id === cu.id) && !S.custom.some(m => m.id === cu.id)) S.custom.push(cu); });
        const base = p.name + ' (od ' + String(x.owner || '').split('@')[0] + ')';
        S.plans.push({ id: 'p_' + uid(), name: base, ex: p.ex.map(x => ({ id: x.id, sets: x.sets })) });
        save(); rebuildExMap(); toast('Skopiowano plan „' + base + '” do twoich planów'); c.disabled = true; c.textContent = 'Skopiowano';
        return;
      }
      const f = e.target.closest('[data-fav]');
      if (f) { const on = toggleFav(f.dataset.fav); f.outerHTML = starBtn(f.dataset.fav); toast(on ? 'Dodano do twoich ulubionych' : 'Usunięto z twoich ulubionych'); }
    });
  });
}

/* ---- start ---- */
if (cloudReady() && SY.session) syncNow();
checkSpecialTheme(SY.session && SY.session.email);
fetchAccountCreated();
if (cloudReady() && !SY.session && !authSkipped()) showAuthScreen();
window.addEventListener('online', () => { if (SY.session) syncNow(); });
let lastVisiblePull = Date.now();
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !SY.session) return;
  if (SY.dirty || Date.now() - lastVisiblePull > 30000) { lastVisiblePull = Date.now(); syncNow(); }
});

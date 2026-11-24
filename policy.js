/* ============ Polityka prywatności: wersje i akceptacja ============
   Przy każdej zmianie zasad przetwarzania danych:
     1) podbij POLICY_VERSION,
     2) dopisz do POLICY_CHANGES, co się zmieniło (pokazujemy to w oknie akceptacji),
     3) popraw tekst w rodoBodyHTML().
   Każdy użytkownik musi zaakceptować aktualną wersję: przy zakładaniu konta (pole wyboru w formularzu)
   albo w oknie, które pojawia się po aktualizacji. Akceptacja (wersja + czas) zapisuje się w S.policy
   — synchronizuje się z kontem — oraz w pamięci telefonu (żeby nie znikła przy logowaniu na innym koncie danych).
   Plik ładuje się PRZED app.js — na górnym poziomie tylko definicje. */

const POLICY_VERSION = 2;
const POLICY_DATE = '2026-11-24';
const POLICY_LOCAL_KEY = 'rozpierdol-polityka';

// co się zmieniło w kolejnych wersjach (najnowsze na końcu)
const POLICY_CHANGES = {
  1: [
    'Pierwsza spisana wersja zasad: jakie dane zbiera apka, gdzie leżą, kto ma do nich dostęp i jakie masz prawa.',
    'Zapisujemy też, kiedy i którą wersję zasad zaakceptowałeś.',
  ],
  2: [
    'W profilu możesz podać <b>imię i nazwisko</b> (oba pola są opcjonalne). Służą tylko do powitania w Ustawieniach i nie trafiają do udostępniania.',
  ],
};

// treść zasad przetwarzania danych (ta sama w Ustawieniach, przy zakładaniu konta i w oknie akceptacji)
function rodoBodyHTML() {
  return `
    <p class="small muted" style="margin:0">Wersja ${POLICY_VERSION} z ${dayLabel(POLICY_DATE, { day: 'numeric', month: 'long', year: 'numeric' })}</p>
    <h3>Kto przetwarza dane</h3>
    <p>Apkę prowadzi jej autor, osoba prywatna, na własny i znajomych użytek. Kontakt: przez „Sugestie” w Ustawieniach.</p>
    <h3>Jakie dane</h3>
    <ul>
      <li><b>Konto:</b> adres e-mail i hasło. Hasło trzyma Google (Firebase Authentication) w postaci zaszyfrowanej. Autor apki go nie zna.</li>
      <li><b>To, co wpisujesz:</b> waga, pomiary ciała, treningi, plany, zaplanowane treningi, ulubione i własne ćwiczenia oraz profil: imię i nazwisko (opcjonalnie, tylko do powitania w apce), wzrost, płeć, rok urodzenia, aktywność i cel.</li>
      <li><b>Sugestie:</b> treść i twój e-mail, żeby dało się odpisać.</li>
      <li><b>Lista kont:</b> e-mail, data założenia konta, kiedy ostatnio otwarto apkę i ile jest wpisów (sama liczba, bez treści). Autor używa jej do porządków, np. usuwania nieużywanych kont.</li>
      <li><b>Akceptacja zasad:</b> która wersja tych zasad i kiedy została zaakceptowana.</li>
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
    <h3>Zmiany zasad</h3>
    <p>Gdy te zasady się zmienią, apka pokaże, co się zmieniło, i poprosi o ponowną akceptację.</p>`;
}

/* ---- czy aktualna wersja jest zaakceptowana ---- */

function localPolicyVersion() {
  try {
    return +localStorage.getItem(POLICY_LOCAL_KEY) || 0;
  } catch (e) {
    return 0;
  }
}

function policyAccepted() {
  const synced = (S.policy && S.policy.v) || 0;
  return Math.max(synced, localPolicyVersion()) >= POLICY_VERSION;
}

function acceptPolicy() {
  S.policy = {
    v: POLICY_VERSION,
    at: Date.now(),
  };
  save();
  try {
    localStorage.setItem(POLICY_LOCAL_KEY, String(POLICY_VERSION));
  } catch (e) {}

  // od razu zaktualizuj wpis na liście kont (wersja i data akceptacji)
  if (typeof touchUser === 'function' && typeof SY !== 'undefined' && SY.session) {
    touchUser(true);
  }
}

// pełna treść w oknie (np. z formularza zakładania konta)
function showPolicyText() {
  openSheet('Polityka prywatności', `
    <div class="rodo">${rodoBodyHTML()}</div>
    <button class="btn block" type="button" data-close>Zamknij</button>`);
}

/* ---- okno akceptacji (po aktualizacji zasad albo przy pierwszym użyciu) ---- */

let policyTries = 0;

function checkPolicy() {
  if (policyAccepted()) {
    // akceptacja tylko w pamięci telefonu (np. sprzed logowania) — przepisz ją do danych konta
    if (!(S.policy && S.policy.v >= POLICY_VERSION)) {
      acceptPolicy();
    }
    return;
  }
  if (document.getElementById('policy')) {
    return;
  }

  // poczekaj, aż zniknie ekran startowy, blokada i ekran logowania (tam jest własne pole wyboru)
  const busy = document.getElementById('splash')
    || document.getElementById('lock')
    || document.getElementById('auth');
  if (busy) {
    if (policyTries++ < 200) {
      setTimeout(checkPolicy, 1000);
    }
    return;
  }

  const had = (S.policy && S.policy.v) || localPolicyVersion();
  const changes = Object.keys(POLICY_CHANGES)
    .map(Number)
    .filter(v => v > had && v <= POLICY_VERSION)
    .flatMap(v => POLICY_CHANGES[v]);

  const el = document.createElement('div');
  el.id = 'policy';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'policy-title');
  document.body.appendChild(el);
  document.body.style.overflow = 'hidden';

  const main = () => {
    el.innerHTML = `
      <div class="policy-inner">
        <span class="policy-ic" aria-hidden="true">🛡️</span>
        <h1 id="policy-title">${had ? 'Zmieniła się polityka prywatności' : 'Polityka prywatności'}</h1>
        <p class="muted">${had
          ? 'Żeby dalej korzystać z apki, zaakceptuj nową wersję zasad przetwarzania danych.'
          : 'Zanim zaczniesz, zapoznaj się z zasadami przetwarzania twoich danych i je zaakceptuj.'}</p>
        ${changes.length ? `
          <div class="card policy-changes">
            <b>Co się zmieniło</b>
            <ul>${changes.map(c => `<li>${c}</li>`).join('')}</ul>
          </div>` : ''}
        <details class="card policy-full">
          <summary>Przeczytaj całe zasady</summary>
          <div class="rodo">${rodoBodyHTML()}</div>
        </details>
        <button class="btn primary block" type="button" id="policy-ok">Akceptuję</button>
        <button class="btn block" type="button" id="policy-no">Nie akceptuję</button>
      </div>`;

    el.querySelector('#policy-ok').onclick = () => {
      acceptPolicy();
      el.classList.add('hide');
      setTimeout(() => el.remove(), 250);
      document.body.style.overflow = '';
      toast('Dzięki! Zasady zaakceptowane');
    };
    el.querySelector('#policy-no').onclick = refuse;
  };

  // bez akceptacji nie da się korzystać z apki — mówimy wprost, co można zrobić
  const refuse = () => {
    el.innerHTML = `
      <div class="policy-inner">
        <span class="policy-ic" aria-hidden="true">🤷</span>
        <h1>Bez akceptacji ani rusz</h1>
        <p class="muted">Apka przetwarza dane opisane w zasadach (np. wagę i treningi), więc bez ich akceptacji nie możesz z niej korzystać.</p>
        <p class="muted">Jeśli nie chcesz, żeby twoje dane były przechowywane, wróć, zaakceptuj zasady i usuń konto albo dane w Ustawieniach. Możesz też napisać do autora przez „Sugestie”.</p>
        <button class="btn primary block" type="button" id="policy-back">Wróć</button>
      </div>`;
    el.querySelector('#policy-back').onclick = main;
  };

  main();
}

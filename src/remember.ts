// "Ricordami": cosa si conserva nel browser. Funzioni pure con i due depositi passati dall'esterno (localStorage = resta sul
// dispositivo, sessionStorage = dura quanto la scheda), così si provano in Node. La password non si salva mai.
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number; // come il vero Storage: serve a elencare le chiavi
  key(index: number): string | null;
}
export interface Stores {
  local: StorageLike;
  session: StorageLike;
}
export interface Profile {
  nome: string;
  cognome: string;
  email: string;
  ricordami: boolean;
}

const TOKEN = (room: string) => `board:token:${room}`;
const PROFILE = "board:profile";

/** Esegue `f` ignorando gli errori (storage bloccato, modalità privata): il login funziona lo stesso, senza memoria. */
function quiet<T>(f: () => T, fallback: T): T {
  try {
    return f();
  } catch {
    return fallback;
  }
}

/** Toglie da un deposito i token di tutte le board (le altre chiavi non si toccano). */
function removeAllTokens(st: StorageLike): void {
  quiet(() => {
    const keys: string[] = [];
    for (let i = 0; i < st.length; i++) {
      const k = st.key(i);
      if (k && k.startsWith("board:token:")) keys.push(k);
    }
    for (const k of keys) st.removeItem(k);
  }, undefined);
}

/**
 * Salva l'accesso dopo un login riuscito. Con "ricordami" token e profilo restano sul dispositivo; senza, il token vale per la scheda,
 * il profilo si cancella e anche gli accessi ricordati prima (di qualsiasi board) spariscono dal dispositivo.
 */
export function saveLogin(s: Stores, room: string, token: string, p: Profile): void {
  const keep = p.ricordami;
  if (!keep) removeAllTokens(s.local);
  quiet(() => (keep ? s.local : s.session).setItem(TOKEN(room), token), undefined);
  quiet(() => (keep ? s.session : s.local).removeItem(TOKEN(room)), undefined);
  if (keep) quiet(() => s.local.setItem(PROFILE, JSON.stringify({ nome: p.nome, cognome: p.cognome, email: p.email, ricordami: true })), undefined);
  else quiet(() => s.local.removeItem(PROFILE), undefined);
}

/** Token salvato per la board: prima quello della scheda, poi quello ricordato sul dispositivo. */
export function readToken(s: Stores, room: string): string | null {
  return quiet(() => s.session.getItem(TOKEN(room)), null) ?? quiet(() => s.local.getItem(TOKEN(room)), null);
}

/**
 * Toglie l'accesso a una board. Con `forgetProfile` ("Esci") toglie invece gli accessi di TUTTE le board (dalla scheda e dal dispositivo)
 * e anche nome, cognome ed email ricordati: su un computer condiviso la persona dopo non deve trovarsi dentro con l'accesso della precedente.
 */
export function clearAccess(s: Stores, room: string, forgetProfile: boolean): void {
  quiet(() => s.session.removeItem(TOKEN(room)), undefined);
  quiet(() => s.local.removeItem(TOKEN(room)), undefined);
  if (forgetProfile) {
    removeAllTokens(s.session);
    removeAllTokens(s.local);
    quiet(() => s.local.removeItem(PROFILE), undefined);
  }
}

export function loadProfile(s: Stores): Profile {
  const empty: Profile = { nome: "", cognome: "", email: "", ricordami: false };
  const raw = quiet(() => s.local.getItem(PROFILE), null);
  if (!raw) return empty;
  try {
    const j = JSON.parse(raw);
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    if (typeof j?.nome !== "string" && typeof j?.email !== "string") return empty;
    return { nome: str(j.nome), cognome: str(j.cognome), email: str(j.email), ricordami: j.ricordami === true };
  } catch {
    return empty;
  }
}

/** Testo per l'utente a partire dal motivo di rifiuto del server. */
export function reasonText(motivo: string | undefined): string {
  if (motivo === "scaduto") return "Il tuo accesso è scaduto: accedi di nuovo.";
  if (motivo === "altra board") return "Questo accesso non è per questa board: accedi di nuovo.";
  if (motivo === "non valido") return "L'accesso non è valido: accedi di nuovo.";
  return "Accedi per entrare nella board.";
}

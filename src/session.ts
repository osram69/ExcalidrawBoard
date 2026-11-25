// L'accesso arriva in due modi: dal link firmato del trainer (?t=…, tolto subito dall'indirizzo e tenuto nella sessione del browser)
// oppure dal login con la password di sessione (token ottenuto da /auth/login, ricordato o no secondo "ricordami").
// Qui si legge solo per mostrare nome e ruolo: i permessi veri li controlla il server.
import { clearAccess, loadProfile, readToken, saveLogin, type Profile, type Stores } from "./remember";

export interface BoardSession {
  room: string;
  token: string;
  name: string;
  uid?: string;
  email?: string;
  role: "editor" | "participant" | "viewer";
  exp: number;
}

/** I due depositi del browser; se non sono disponibili (privato, bloccati) le operazioni diventano innocue. */
function stores(): Stores {
  const none = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined, length: 0, key: () => null };
  const pick = (f: () => Storage) => {
    try {
      return f();
    } catch {
      return none;
    }
  };
  return { local: pick(() => localStorage), session: pick(() => sessionStorage) };
}

export function roomFromPath(): string | null {
  const m = /^\/b\/([A-Za-z0-9_-]{1,64})\/?$/.exec(location.pathname);
  return m ? m[1] : null;
}

function decode(token: string): { room: string; name: string; uid?: string; email?: string; role: "editor" | "participant" | "viewer"; exp: number } | null {
  try {
    const body = token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(escape(atob(body))); // UTF-8 (nomi con accenti)
    const p = JSON.parse(json);
    return p && typeof p.room === "string" ? p : null;
  } catch {
    return null;
  }
}

function toSession(room: string, token: string): BoardSession | null {
  const p = decode(token);
  if (!p || p.room !== room || !(p.exp > Date.now())) return null;
  return {
    room, token, name: p.name || "Ospite", uid: typeof p.uid === "string" ? p.uid : undefined, email: typeof p.email === "string" ? p.email : undefined,
    role: p.role === "viewer" ? "viewer" : p.role === "participant" ? "participant" : "editor", exp: p.exp,
  };
}

/** Accesso già presente (link del trainer o login ricordato), oppure `null`. */
export function loadSession(room: string): BoardSession | null {
  const url = new URL(location.href);
  const fromUrl = url.searchParams.get("t");
  let token = fromUrl;
  if (fromUrl) {
    try {
      sessionStorage.setItem(`board:token:${room}`, fromUrl);
    } catch {
      /* sessionStorage non disponibile: vale solo il token nell'indirizzo */
    }
    url.searchParams.delete("t");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  } else {
    token = readToken(stores(), room);
  }
  return token ? toSession(room, token) : null;
}

/** Dopo un login riuscito: salva il token (e il profilo, se "ricordami") e restituisce la sessione. */
export function acceptLogin(room: string, token: string, profile: Profile): BoardSession | null {
  saveLogin(stores(), room, token, profile);
  return toSession(room, token);
}

/** Toglie l'accesso a questa board; con `forget` ("Esci") anche nome, cognome ed email ricordati. */
export function dropSession(room: string, forget: boolean): void {
  clearAccess(stores(), room, forget);
}

export const savedProfile = (): Profile => loadProfile(stores());

/** Identificativo stabile di questo browser, per attribuire ciò che si disegna. */
export function browserId(): string {
  try {
    let id = localStorage.getItem("board:uid");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("board:uid", id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

const COLORS = ["#e8321e", "#ff6a45", "#177a4b", "#a9760a", "#5e1220", "#2563eb", "#7c3aed", "#0d9488"];
export const colorFor = (name: string) => COLORS[[...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length];

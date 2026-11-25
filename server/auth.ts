// Accesso alle board: il sito Cube Academy (o lo script `npm run token`) emette un token firmato con BOARD_SECRET.
// Il token dice QUALE board, CHI è l'utente e COSA può fare ("editor" modifica, "viewer" guarda). Il server lo verifica
// a ogni connessione WebSocket e a ogni upload: nessun account da gestire qui.
import crypto from "node:crypto";

export type Role = "editor" | "viewer" | "participant"; // editor = tutto (trainer); participant = crea e modifica solo i propri oggetti; viewer = sola lettura
export interface TokenPayload {
  room: string; // identificativo della board
  name: string; // nome mostrato accanto al cursore
  uid?: string; // identificativo stabile dell'utente (es. il nome utente sul sito): serve ad attribuire ciò che disegna
  email?: string; // dichiarata al login con password di sessione (non verificata): identifica, non autentica
  role: Role;
  exp: number; // scadenza, ms epoch
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const mac = (secret: string, body: string) => crypto.createHmac("sha256", secret).update(`board:${body}`).digest("base64url");

export const ROOM_ID = /^[a-zA-Z0-9_-]{1,64}$/;

export function signToken(p: TokenPayload, secret: string): string {
  const body = b64(JSON.stringify(p));
  return `${body}.${mac(secret, body)}`;
}

/** Firma, formato e campi del token, senza guardare scadenza né board. `null` se qualcosa non va. */
function readSigned(token: string | null | undefined, secret: string): TokenPayload | null {
  const [body, sig, extra] = String(token || "").split(".");
  if (!body || !sig || extra !== undefined) return null;
  const good = mac(secret, body);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as TokenPayload;
    if (!p || typeof p !== "object" || typeof p.room !== "string" || !ROOM_ID.test(p.room) || !["editor", "viewer", "participant"].includes(p.role)) return null;
    if (typeof p.exp !== "number" || !Number.isFinite(p.exp)) return null;
    const uid = typeof p.uid === "string" && /^[\w.@-]{1,64}$/.test(p.uid) ? p.uid : undefined;
    const email = normalizeEmail(p.email);
    return { room: p.room, name: String(p.name || "Ospite").slice(0, 60), uid, ...(email ? { email } : {}), role: p.role, exp: p.exp };
  } catch {
    return null;
  }
}

export function verifyToken(token: string | null | undefined, secret: string): TokenPayload | null {
  const p = readSigned(token, secret);
  return p && p.exp > Date.now() ? p : null;
}

export type TokenCheck = { ok: true; payload: TokenPayload } | { ok: false; motivo: "scaduto" | "altra board" | "non valido" };

/** Come `verifyToken`, ma per la board `room` e con il motivo del rifiuto (serve a guidare l'utente: login di nuovo, link sbagliato…). */
export function inspectToken(token: string | null | undefined, room: string, secret: string, now = Date.now()): TokenCheck {
  const p = readSigned(token, secret);
  if (!p) return { ok: false, motivo: "non valido" };
  if (p.room !== room) return { ok: false, motivo: "altra board" };
  if (!(p.exp > now)) return { ok: false, motivo: "scaduto" };
  return { ok: true, payload: p };
}

/** Indirizzo http(s) completo (per esempio il login del trainer sul sito, `TRAINER_LOGIN_URL`); altrimenti `null`. */
export function parseHttpUrl(raw: string | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:" ? v : null;
  } catch {
    return null;
  }
}

/** Email normalizzata (minuscola, senza spazi) se plausibile e non più lunga di 120 caratteri; altrimenti `null`. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  return e.length <= 120 && /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@.]{2,}$/.test(e) ? e : null;
}

/**
 * Identificativo stabile di una persona a partire dalla mail, senza mostrare la mail agli altri (finisce in cursori e proprietà degli oggetti).
 * È un HMAC con il segreto del server: senza di esso nessuno può calcolare l'identificativo di una mail nota e scoprire chi c'è nella board.
 */
export function personalUid(email: string, secret: string): string {
  return `u-${crypto.createHmac("sha256", secret).update(`uid:${email}`).digest("hex").slice(0, 20)}`;
}

// Accesso degli allievi con la password della sessione: impronta della password, dati per board, limite di tentativi.
// La password non si conserva mai in chiaro; la mail dichiarata identifica la persona ma non la autentica.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { normalizeEmail, ROOM_ID } from "./auth.ts";

export interface RoomAccess {
  passwordHash: string; // "scrypt$<sale>$<impronta>"
  until: number | null; // fine della sessione, ms epoch; null = nessuna fine
}

const KEYLEN = 32;
const b64 = (b: Buffer) => b.toString("base64url");

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  return `scrypt$${b64(salt)}$${b64(crypto.scryptSync(pw, salt, KEYLEN))}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [kind, salt, hash, extra] = String(stored ?? "").split("$");
  if (kind !== "scrypt" || !salt || !hash || extra !== undefined) return false;
  try {
    const expected = Buffer.from(hash, "base64url");
    if (!expected.length) return false;
    const got = crypto.scryptSync(String(pw ?? ""), Buffer.from(salt, "base64url"), expected.length);
    return crypto.timingSafeEqual(got, expected);
  } catch {
    return false;
  }
}

/** Password di sessione valida da impostare: da 8 a 200 caratteri. */
export const passwordOk = (pw: unknown): pw is string => typeof pw === "string" && pw.length >= 8 && pw.length <= 200;

const FILE = "access.json";

export function readAccess(dir: string): RoomAccess | null {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, FILE), "utf8"));
    if (typeof j?.passwordHash !== "string" || !j.passwordHash.startsWith("scrypt$")) return null;
    if (j.until !== null && !(typeof j.until === "number" && Number.isFinite(j.until))) return null;
    return { passwordHash: j.passwordHash, until: j.until };
  } catch {
    return null;
  }
}

export function writeAccess(dir: string, a: RoomAccess): void {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `${FILE}.${process.pid}.part`);
  fs.writeFileSync(tmp, JSON.stringify(a), { mode: 0o600 });
  fs.renameSync(tmp, path.join(dir, FILE));
}

/** Dopo `max` errori entro `windowMs` per la stessa chiave, `blocked` è vero fino allo scadere della finestra. */
export class AttemptLimiter {
  private hits = new Map<string, { n: number; t: number }>();
  constructor(private max = 10, private windowMs = 10 * 60_000, private now: () => number = Date.now) {}

  blocked(key: string): boolean {
    const h = this.hits.get(key);
    return !!h && this.now() - h.t < this.windowMs && h.n >= this.max;
  }

  fail(key: string): void {
    const h = this.hits.get(key);
    if (h && this.now() - h.t < this.windowMs) h.n++;
    else this.hits.set(key, { n: 1, t: this.now() });
    if (this.hits.size > 5000) this.hits.clear();
  }

  clear(key: string): void {
    this.hits.delete(key);
  }
}

/** Scadenza dell'accesso: ore normali oppure, con "ricordami", giorni; mai oltre la fine della sessione. */
export function sessionExp(now: number, until: number | null, ricordami: boolean, hours: number, days: number): number {
  const base = ricordami ? now + days * 86_400_000 : now + hours * 3_600_000;
  return until === null ? base : Math.min(base, until);
}

export type LoginBody = { ok: true; room: string; name: string; email: string; password: string; ricordami: boolean } | { ok: false; status: 400; motivo: string };

const bad = (motivo: string): LoginBody => ({ ok: false, status: 400, motivo });

/** Controlla e pulisce i dati del modulo di login. */
export function parseLoginBody(raw: unknown): LoginBody {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return bad("Dati non validi.");
  const b = raw as Record<string, unknown>;
  if (typeof b.room !== "string" || !ROOM_ID.test(b.room)) return bad("Board non valida.");
  const part = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const nome = part(b.nome);
  const cognome = part(b.cognome);
  if (!nome || nome.length > 40) return bad("Inserisci il nome (massimo 40 caratteri).");
  if (!cognome || cognome.length > 40) return bad("Inserisci il cognome (massimo 40 caratteri).");
  const email = normalizeEmail(b.email);
  if (!email) return bad("Inserisci un indirizzo email valido.");
  if (typeof b.password !== "string" || !b.password || b.password.length > 200) return bad("Inserisci la password della sessione.");
  return { ok: true, room: b.room, name: `${nome} ${cognome}`, email, password: b.password, ricordami: b.ricordami === true };
}

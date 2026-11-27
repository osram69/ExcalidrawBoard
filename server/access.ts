// Accesso degli allievi con la password della sessione: impronta della password, dati per board, limite di tentativi.
// Per il login conta solo l'impronta. La password della sessione si conserva anche leggibile (campo `password`, file 0600) perché il
// trainer deve poterla rivedere e comunicare agli allievi; la rilegge solo l'editor della board (GET /auth/access).
// Nome e cognome dichiarati identificano la persona ma non la autenticano.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { ROOM_ID } from "./auth.ts";

export interface RoomAccess {
  passwordHash: string; // "scrypt$<sale>$<impronta>"
  until: number | null; // fine della sessione, ms epoch; null = nessuna fine
  password?: string; // la password in chiaro, per mostrarla al trainer; assente nelle board create prima di questa funzione
}

const KEYLEN = 32;
const b64 = (b: Buffer) => b.toString("base64url");

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  return `scrypt$${b64(salt)}$${b64(crypto.scryptSync(pw, salt, KEYLEN))}`;
}

const scryptAsync = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

/** Verifica asincrona: lo scrypt gira nel pool di thread e non blocca il ciclo degli eventi (le board di tutti sono sullo stesso). */
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [kind, salt, hash, extra] = String(stored ?? "").split("$");
  if (kind !== "scrypt" || !salt || !hash || extra !== undefined) return false;
  try {
    const expected = Buffer.from(hash, "base64url");
    if (!expected.length) return false;
    const got = await scryptAsync(String(pw ?? ""), Buffer.from(salt, "base64url"), expected.length);
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
    return typeof j.password === "string" ? { passwordHash: j.passwordHash, until: j.until, password: j.password } : { passwordHash: j.passwordHash, until: j.until };
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
  constructor(private max = 10, private windowMs = 10 * 60_000, private now: () => number = Date.now, private maxKeys = 5000) {}

  get size(): number {
    return this.hits.size;
  }

  blocked(key: string): boolean {
    const h = this.hits.get(key);
    return !!h && this.now() - h.t < this.windowMs && h.n >= this.max;
  }

  fail(key: string): void {
    const h = this.hits.get(key);
    if (h && this.now() - h.t < this.windowMs) h.n++;
    else this.hits.set(key, { n: 1, t: this.now() });
    if (this.hits.size > this.maxKeys) this.evict();
  }

  /** Toglie un tentativo (per i tentativi contati prima della verifica e poi risultati giusti). */
  refund(key: string): void {
    const h = this.hits.get(key);
    if (!h) return;
    if (--h.n <= 0) this.hits.delete(key);
  }

  clear(key: string): void {
    this.hits.delete(key);
  }

  /**
   * Troppe chiavi: via prima quelle scadute, poi quelle non ancora bloccate (le più vecchie per prime) e solo in ultimo i blocchi.
   * Mai tutto insieme: inondare di chiavi inutili non deve azzerare un blocco attivo.
   */
  private evict(): void {
    const now = this.now();
    for (const [k, h] of this.hits) if (now - h.t >= this.windowMs) this.hits.delete(k);
    for (const [k, h] of this.hits) {
      if (this.hits.size <= this.maxKeys) return;
      if (h.n < this.max) this.hits.delete(k);
    }
    for (const k of this.hits.keys()) {
      if (this.hits.size <= this.maxKeys) return;
      this.hits.delete(k);
    }
  }
}

/** Al massimo `max` verifiche della password in corso insieme: le altre ricevono "occupato" invece di accumularsi. */
export class ConcurrencyGate {
  private active = 0;
  constructor(private max: number) {}

  tryEnter(): boolean {
    if (this.active >= this.max) return false;
    this.active++;
    return true;
  }

  leave(): void {
    if (this.active > 0) this.active--;
  }
}

/** Chiave per i limiti: IPv4 invariato, IPv4-mappato ridotto, IPv6 ridotto al prefisso /64 (chi ha una rete /64 ha miliardi di indirizzi). */
export function normalizeIp(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  if (!ip.includes(":")) return ip;
  const [head, tail = ""] = ip.split("::");
  const a = head ? head.split(":") : [];
  const b = ip.includes("::") && tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill("0"), ...b] : a;
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return ip;
  return `v6:${groups.slice(0, 4).map((g) => g.toLowerCase().padStart(4, "0")).join(":")}`;
}

/** Scadenza dell'accesso: ore normali oppure, con "ricordami", giorni; mai oltre la fine della sessione. */
export function sessionExp(now: number, until: number | null, ricordami: boolean, hours: number, days: number): number {
  const base = ricordami ? now + days * 86_400_000 : now + hours * 3_600_000;
  return until === null ? base : Math.min(base, until);
}

export type LoginBody = { ok: true; room: string; name: string; password: string; ricordami: boolean } | { ok: false; status: 400; motivo: string };

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
  // l'email non si chiede più: un eventuale campo `email` inviato da un client vecchio viene ignorato
  if (typeof b.password !== "string" || !b.password || b.password.length > 200) return bad("Inserisci la password della sessione.");
  return { ok: true, room: b.room, name: `${nome} ${cognome}`, password: b.password, ricordami: b.ricordami === true };
}

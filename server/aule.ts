// Gestione delle aule dal backend del sito: elenco, creazione, attivazione/disattivazione, eliminazione.
// Un'aula è una board con la sua cartella in data/rooms/<nome>/; le stanze di lavoro (parent.json) appartengono all'aula e non si elencano da sole.
import fs from "node:fs";
import path from "node:path";
import { ROOM_ID } from "./auth.ts";
import { dropCourse, getCourse } from "./course.ts";
import { readCourse, readParent } from "./course-data.ts";
import { hashPassword, passwordOk, readAccess, writeAccess, type RoomAccess } from "./access.ts";
import { dropRoom, loadedRoom, roomDir } from "./rooms.ts";

export interface AulaInfo {
  name: string;
  configured: boolean; // ha una password di sessione
  password: string | null;
  until: number | null;
  active: boolean; // si può entrare con la password: configurata e senza fine, oppure con fine futura
  online: number; // persone collegate adesso (aula e stanze)
  stanze: number; // stanze di lavoro create
  updatedAt: number; // ultima modifica sul disco, ms epoch
}

export type Result<T = object> = ({ ok: true } & T) | { ok: false; status: number; motivo: string };
const bad = (status: number, motivo: string) => ({ ok: false as const, status, motivo });

const isActive = (a: RoomAccess | null, now: number) => !!a && (a.until === null || a.until > now);

/** Aule su disco (le cartelle senza `parent.json`), ordinate per nome. */
export function listAule(dataDir: string, now = Date.now()): AulaInfo[] {
  const base = path.join(dataDir, "rooms");
  let names: string[] = [];
  try {
    names = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory() && ROOM_ID.test(d.name)).map((d) => d.name);
  } catch {
    return [];
  }
  const out: AulaInfo[] = [];
  for (const name of names) {
    const dir = path.join(base, name);
    if (readParent(dir)) continue;
    const access = readAccess(dir);
    const ids = [name, ...readCourse(dir).rounds.flatMap((r) => r.rooms.map((x) => x.id))];
    let updatedAt = 0;
    for (const f of ["scene.json", "access.json", "course.json"]) {
      try {
        updatedAt = Math.max(updatedAt, fs.statSync(path.join(dir, f)).mtimeMs);
      } catch {
        /* file assente */
      }
    }
    if (!updatedAt) updatedAt = fs.statSync(dir).mtimeMs;
    out.push({
      name,
      configured: !!access,
      password: access?.password ?? null,
      until: access?.until ?? null,
      active: isActive(access, now),
      online: ids.reduce((n, id) => n + (loadedRoom(id)?.peers.size ?? 0), 0),
      stanze: readCourse(dir).rounds.reduce((n, r) => n + r.rooms.length, 0),
      updatedAt,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const untilOk = (v: unknown): v is number | null => v === null || (typeof v === "number" && Number.isFinite(v) && v > 0);

export function createAula(dataDir: string, raw: unknown): Result<{ name: string }> {
  const b = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!ROOM_ID.test(name)) return bad(400, "Il nome può avere solo lettere, numeri, - e _ (massimo 64 caratteri).");
  if (!passwordOk(b.password)) return bad(400, "La password deve avere da 8 a 200 caratteri.");
  if (b.until !== undefined && !untilOk(b.until)) return bad(400, "Data di fine non valida.");
  const dir = roomDir(dataDir, name);
  if (fs.existsSync(dir)) return bad(409, "Esiste già una board con questo nome.");
  writeAccess(dir, { passwordHash: hashPassword(b.password), until: (b.until as number | null | undefined) ?? null, password: b.password });
  return { ok: true, name };
}

/** Chiude i collegamenti di allievi e ospiti (non dei trainer) in aula e stanze: dopo la disattivazione non devono restare dentro. */
function kickParticipants(dataDir: string, secret: string, aula: string): void {
  for (const id of getCourse(dataDir, secret, aula).boardIds()) {
    const r = loadedRoom(id);
    if (r) for (const p of r.peers) if (p.role !== "editor") p.ws.close(4001, "scaduto");
  }
}

export function updateAula(dataDir: string, secret: string, name: string, raw: unknown, now = Date.now()): Result<{ until: number | null; active: boolean }> {
  if (!ROOM_ID.test(name) || !fs.existsSync(roomDir(dataDir, name)) || readParent(roomDir(dataDir, name))) return bad(404, "Aula non trovata.");
  const b = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  if (b.password !== undefined && !passwordOk(b.password)) return bad(400, "La password deve avere da 8 a 200 caratteri.");
  if (b.until !== undefined && !untilOk(b.until)) return bad(400, "Data di fine non valida.");
  if (b.password === undefined && b.until === undefined) return bad(400, "Indica la password e/o la data di fine.");
  const dir = roomDir(dataDir, name);
  const existing = readAccess(dir);
  if (!existing && b.password === undefined) return bad(400, "Questa aula non ha ancora una password: impostala prima.");
  const until = b.until !== undefined ? (b.until as number | null) : (existing?.until ?? null);
  const plain = b.password !== undefined ? (b.password as string) : existing?.password;
  const next: RoomAccess = { passwordHash: b.password !== undefined ? hashPassword(b.password as string) : existing!.passwordHash, until };
  if (plain !== undefined) next.password = plain;
  writeAccess(dir, next);
  const active = isActive(next, now);
  if (!active) kickParticipants(dataDir, secret, name);
  return { ok: true, until, active };
}

/** Elimina l'aula con le sue stanze di lavoro. Irreversibile. */
export function deleteAula(dataDir: string, name: string): Result<{ removed: number }> {
  if (!ROOM_ID.test(name) || !fs.existsSync(roomDir(dataDir, name)) || readParent(roomDir(dataDir, name))) return bad(404, "Aula non trovata.");
  const base = path.join(dataDir, "rooms");
  const ids = new Set<string>([name]);
  for (const r of readCourse(roomDir(dataDir, name)).rounds) for (const x of r.rooms) if (ROOM_ID.test(x.id)) ids.add(x.id);
  try {
    for (const d of fs.readdirSync(base, { withFileTypes: true })) if (d.isDirectory() && ROOM_ID.test(d.name) && readParent(path.join(base, d.name))?.aula === name) ids.add(d.name);
  } catch {
    /* cartella non leggibile: si elimina quello che si conosce */
  }
  for (const id of ids) dropRoom(id);
  dropCourse(dataDir, name);
  let removed = 0;
  for (const id of ids) {
    const dir = roomDir(dataDir, id);
    if (path.dirname(dir) !== base) continue; // mai fuori da data/rooms
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      removed++;
    } catch (e) {
      console.error(`Eliminazione di ${id} non riuscita:`, e);
    }
  }
  return removed ? { ok: true, removed } : bad(500, "Non sono riuscito a eliminare i dati dell'aula.");
}

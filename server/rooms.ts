// Una "stanza" = una board aperta: tiene in memoria elementi e immagini, li salva su disco e li ritrasmette ai partecipanti.
// Formato su disco: data/rooms/<board>/scene.json (elementi) e files/<id>.json (immagini).
import fs from "node:fs";
import path from "node:path";
import type { WebSocket } from "ws";
import type { Role } from "./auth.ts";
import type { Course } from "./course.ts";
import { RoomTimer } from "./timer.ts";
import { RoomVotes } from "./votes.ts";

export interface El {
  id: string;
  version: number;
  versionNonce: number;
  [k: string]: unknown;
}
export interface BinFile {
  id: string;
  mimeType: string;
  dataURL: string;
  created: number;
}
export interface Peer {
  id: string;
  ws: WebSocket;
  name: string;
  role: Role;
  color: string;
  key: string; // identità per la proprietà degli oggetti: id utente del token, altrimenti il nome
  exp: number; // scadenza del token con cui è entrato: serve a emettere i token di spostamento senza allungarla
  email?: string;
}

const ID = /^[\w-]{1,100}$/;
// id che sono chiavi di prototipo: passano la regex ma romperebbero chi usa gli id come chiavi di oggetti (client compreso)
const RESERVED_IDS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_EL_JSON = 2 * 1024 * 1024; // un singolo elemento (i disegni a mano libera hanno molti punti)
export const MAX_FILE = 10 * 1024 * 1024; // una singola immagine (dataURL)
const IMG = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/; // niente SVG: nessun contenuto attivo

export const roomDir = (dataDir: string, room: string) => path.join(dataDir, "rooms", room);

// tipi ammessi (niente embeddable/iframe: contenuti esterni) e campi indispensabili: un elemento malformato manderebbe in errore la lavagna a tutti
const TYPES = new Set(["rectangle", "diamond", "ellipse", "arrow", "line", "freedraw", "text", "image", "frame"]);
const wellFormed = (e: El) =>
  TYPES.has(e.type as string) &&
  ["x", "y", "width", "height", "angle", "opacity", "strokeWidth"].every((k) => e[k] === undefined || Number.isFinite(e[k])) &&
  ["x", "y", "width", "height"].every((k) => Number.isFinite(e[k])) &&
  ["strokeColor", "backgroundColor"].every((k) => typeof e[k] === "string" && (e[k] as string).length <= 60);

/** Un elemento remoto vince se ha versione più alta (a parità, come fa Excalidraw, il nonce più basso). */
const wins = (a: El, b: El | undefined) => !b || a.version > b.version || (a.version === b.version && a.versionNonce < b.versionNonce);

export class Room {
  readonly els = new Map<string, El>();
  readonly files = new Map<string, BinFile>();
  readonly peers = new Set<Peer>();
  timer = new RoomTimer(); // nelle board di un corso è il timer comune del corso (assegnato al collegamento)
  course: Course | null = null;
  readonly votes: RoomVotes;
  private saveTimer: NodeJS.Timeout | null = null;
  private dirtyFiles = new Set<string>();
  private idle: NodeJS.Timeout | null = null;
  private disposed = false;

  constructor(readonly id: string, private dir: string, private onEmpty: () => void) {
    // votabili: solo note adesive esistenti (customData.kind === "nota"), non cancellate
    this.votes = new RoomVotes(path.join(dir, "votes.json"), (id) => {
      const e = this.els.get(id);
      return !!e && !e.isDeleted && (e.customData as { kind?: string } | undefined)?.kind === "nota";
    });
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, "scene.json"), "utf8"));
      for (const e of j.elements || []) if (e && typeof e.id === "string" && !RESERVED_IDS.has(e.id) && wellFormed(e)) this.els.set(e.id, e);
    } catch {
      /* board nuova */
    }
    try {
      for (const f of fs.readdirSync(path.join(dir, "files"))) {
        const b = JSON.parse(fs.readFileSync(path.join(dir, "files", f), "utf8")) as BinFile;
        if (b && ID.test(b.id) && IMG.test(b.dataURL)) this.files.set(b.id, b);
      }
    } catch {
      /* nessuna immagine */
    }
  }

  /**
   * Applica gli elementi ricevuti da `peer`. Proprietà degli oggetti (come Miro): il server marca ogni elemento nuovo con il
   * proprietario (`customData.owner`, mai preso dal client). Un "participant" non può cambiare né cancellare oggetti altrui
   * (né quelli senza proprietario, cioè preesistenti); l'"editor" (trainer) può tutto e il proprietario resta quello originale.
   * Restituisce { accepted: da ritrasmettere agli altri, denied: copie del server degli elementi respinti }.
   */
  applyElements(list: unknown, peer: Pick<Peer, "key" | "role">): { accepted: El[]; denied: El[] } {
    const accepted: El[] = [];
    const denied: El[] = [];
    if (!Array.isArray(list)) return { accepted, denied };
    for (const e of list.slice(0, 5000) as El[]) {
      if (!e || typeof e.id !== "string" || !ID.test(e.id) || RESERVED_IDS.has(e.id) || !Number.isFinite(e.version) || !Number.isFinite(e.versionNonce)) continue;
      if (!wellFormed(e) || JSON.stringify(e).length > MAX_EL_JSON) continue;
      const old = this.els.get(e.id);
      const oldOwner = (old?.customData as { owner?: string } | undefined)?.owner;
      if (old && peer.role === "participant" && oldOwner !== peer.key) {
        denied.push(old);
        continue;
      }
      if (!wins(e, old)) continue;
      const cd = e.customData && typeof e.customData === "object" ? (e.customData as Record<string, unknown>) : {};
      e.customData = { ...cd, owner: oldOwner ?? peer.key };
      this.els.set(e.id, e);
      accepted.push(e);
    }
    if (accepted.length) this.scheduleSave();
    return { accepted, denied };
  }

  applyFiles(list: unknown): BinFile[] {
    const accepted: BinFile[] = [];
    if (!Array.isArray(list)) return accepted;
    for (const f of list.slice(0, 20) as BinFile[]) {
      if (!f || typeof f.id !== "string" || !ID.test(f.id) || typeof f.dataURL !== "string" || f.dataURL.length > MAX_FILE) continue;
      if (!IMG.test(f.dataURL) || this.files.has(f.id)) continue;
      const b: BinFile = { id: f.id, mimeType: String(f.mimeType || "").slice(0, 40), dataURL: f.dataURL, created: Number(f.created) || Date.now() };
      this.files.set(b.id, b);
      this.dirtyFiles.add(b.id);
      accepted.push(b);
    }
    if (accepted.length) this.scheduleSave();
    return accepted;
  }

  private scheduleSave() {
    this.saveTimer ??= setTimeout(() => this.flush(), 1000);
  }

  flush() {
    if (this.disposed) return; // eliminata: i collegamenti che si chiudono non devono riscrivere la cartella
    this.votes.flush();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    try {
      fs.mkdirSync(path.join(this.dir, "files"), { recursive: true });
      const tmp = path.join(this.dir, `scene.json.${process.pid}.part`);
      fs.writeFileSync(tmp, JSON.stringify({ elements: [...this.els.values()] }));
      fs.renameSync(tmp, path.join(this.dir, "scene.json"));
      for (const id of this.dirtyFiles) fs.writeFileSync(path.join(this.dir, "files", `${id}.json`), JSON.stringify(this.files.get(id)));
      this.dirtyFiles.clear();
    } catch (e) {
      console.error(`Salvataggio di ${this.id} non riuscito:`, e);
    }
  }

  /** Come `flush`, ma senza bloccare il server e segnalando i fallimenti (serve a chi crea molte board insieme). */
  async flushAsync(): Promise<void> {
    if (this.disposed) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.votes.flush();
    await fs.promises.mkdir(path.join(this.dir, "files"), { recursive: true });
    const tmp = path.join(this.dir, `scene.json.${process.pid}.part`);
    await fs.promises.writeFile(tmp, JSON.stringify({ elements: [...this.els.values()] }));
    await fs.promises.rename(tmp, path.join(this.dir, "scene.json"));
    for (const id of [...this.dirtyFiles]) {
      await fs.promises.writeFile(path.join(this.dir, "files", `${id}.json`), JSON.stringify(this.files.get(id)));
      this.dirtyFiles.delete(id);
    }
  }

  /** Se non c'è nessuno collegato, la board esce dalla memoria dopo `ms` (un minuto di solito). Le board create e mai raggiunte non restano in memoria. */
  release(ms = 60_000) {
    if (this.peers.size) return;
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => !this.peers.size && this.onEmpty(), ms);
    this.idle.unref();
  }

  /** La board viene eliminata: niente più salvataggi e collegamenti chiusi (codice 4003). */
  dispose() {
    this.disposed = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.idle) clearTimeout(this.idle);
    this.saveTimer = this.idle = null;
    this.dirtyFiles.clear();
    this.votes.cancel();
    for (const p of [...this.peers]) p.ws.close(4003, "eliminata");
    this.peers.clear();
  }

  broadcast(msg: unknown, except?: Peer) {
    const s = JSON.stringify(msg);
    for (const p of this.peers) if (p !== except && p.ws.readyState === 1) p.ws.send(s);
  }

  join(p: Peer) {
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
    this.peers.add(p);
  }

  leave(p: Peer) {
    this.peers.delete(p);
    this.broadcast({ t: "leave", id: p.id });
    if (!this.peers.size) {
      this.flush();
      this.release();
    }
  }
}

const rooms = new Map<string, Room>();
export function getRoom(dataDir: string, id: string): Room {
  let r = rooms.get(id);
  if (!r) {
    r = new Room(id, roomDir(dataDir, id), () => rooms.delete(id));
    rooms.set(id, r);
  }
  return r;
}
/** La board se è in memoria (cioè se c'è qualcuno collegato o l'ultimo se n'è andato da poco). */
export const loadedRoom = (id: string): Room | undefined => rooms.get(id);
export const openRooms = () => rooms.size;
/** Toglie la board dalla memoria senza salvarla (prima di cancellarne la cartella). */
export function dropRoom(id: string) {
  const r = rooms.get(id);
  if (!r) return;
  r.dispose();
  rooms.delete(id);
}
export function closeAllRooms() {
  for (const r of rooms.values()) r.flush();
}

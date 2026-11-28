// Il corso: un'aula e i suoi turni di stanze. Tiene in memoria lo stato (letto da `course.json`), il timer comune, la presenza dei collegati
// e le regole su chi può entrare in quale stanza. Ogni board ha un corso: l'aula (o una board qualsiasi) è il corso di se stessa.
import fs from "node:fs";
import path from "node:path";
import { signToken, type Role } from "./auth.ts";
import { courseStatus, readCourse, readParent, writeCourse, type CourseData, type Member, type Round } from "./course-data.ts";
import { loadedRoom, roomDir, type Room } from "./rooms.ts";
import { RoomTimer } from "./timer.ts";

const UID = /^[\w.@-]{1,64}$/;

/**
 * Token per aprire `room`: stessi nome, identificativo, email, ruolo e scadenza di quello che la persona ha già, firmato dal server.
 * Non può allungare l'accesso né cambiare ruolo. La chiave `n:Nome` (accessi senza identificativo) non è un identificativo valido e si omette.
 */
export function gotoToken(p: { name: string; key: string; role: Role; exp: number; email?: string }, room: string, secret: string): string {
  return signToken({ room, name: p.name, uid: UID.test(p.key) ? p.key : undefined, ...(p.email ? { email: p.email } : {}), role: p.role, exp: p.exp }, secret);
}

export interface PresencePerson {
  key: string;
  name: string;
  role: Role;
}
export interface PresenceRound {
  round: number;
  rooms: { n: number; id: string; members: Member[] }[];
}
export interface Presence {
  rooms: Record<string, PresencePerson[]>;
  current: PresenceRound | null; // turno aperto
  history: PresenceRound[]; // turni chiusi (il trainer può riaprirne le stanze)
}
export interface Where {
  aula: string;
  round: number | null;
  n: number | null;
}

export class Course {
  data: CourseData;
  readonly timer = new RoomTimer();
  /** Il file del corso esiste ma non si legge: non si creano altre stanze (si rischierebbe di sovrascrivere il lavoro dei turni precedenti). */
  readonly corrupt: boolean;
  creating = false; // una creazione di stanze è in corso

  constructor(readonly aula: string, readonly dataDir: string, readonly secret: string) {
    this.corrupt = courseStatus(this.dir) === "corrupt";
    if (this.corrupt) {
      console.error(`course.json dell'aula ${aula} danneggiato: ne conservo una copia in course.json.bad`);
      try {
        fs.copyFileSync(path.join(this.dir, "course.json"), path.join(this.dir, "course.json.bad"));
      } catch {
        /* non si può copiare (per esempio non è un file): il blocco resta */
      }
    }
    this.data = readCourse(this.dir);
  }

  /** Scrive il nuovo stato su disco e solo dopo lo adotta in memoria: se la scrittura fallisce, memoria e disco restano coerenti. */
  commit(next: CourseData): void {
    writeCourse(this.dir, next);
    this.data = next;
  }

  get dir(): string {
    return roomDir(this.dataDir, this.aula);
  }

  /** L'aula e tutte le stanze di tutti i turni. */
  boardIds(): string[] {
    return [this.aula, ...this.data.rounds.flatMap((r) => r.rooms.map((x) => x.id))];
  }

  /** Le board del corso che sono in memoria. */
  loaded(): Room[] {
    return this.boardIds().flatMap((id) => {
      const r = loadedRoom(id);
      return r ? [r] : [];
    });
  }

  broadcast(msg: unknown): void {
    for (const r of this.loaded()) r.broadcast(msg);
  }

  /** Chi c'è in ogni board e il turno aperto. Solo chiave, nome e ruolo: mai la mail. */
  presence(): Presence {
    const rooms: Record<string, PresencePerson[]> = {};
    for (const r of this.loaded()) rooms[r.id] = [...r.peers].map((p) => ({ key: p.key, name: p.name, role: p.role }));
    const view = (r: Round): PresenceRound => ({ round: r.round, rooms: r.rooms.map((x) => ({ n: x.n, id: x.id, members: x.members })) });
    const open = this.data.rounds.find((r) => r.open);
    return { rooms, current: open ? view(open) : null, history: this.data.rounds.filter((r) => !r.open).map(view) };
  }

  /** Manda l'elenco dei collegati ai trainer di tutte le board del corso (gli allievi non lo ricevono). */
  pushPresence(): void {
    const msg = JSON.stringify({ t: "presence", ...this.presence() });
    for (const r of this.loaded()) for (const p of r.peers) if (p.role === "editor" && p.ws.readyState === 1) p.ws.send(msg);
  }

  private find(room: string): { round: Round; n: number; members: Member[] } | null {
    for (const round of this.data.rounds) {
      const info = round.rooms.find((x) => x.id === room);
      if (info) return { round, n: info.n, members: info.members };
    }
    return null;
  }

  /**
   * Può collegarsi a `room`? L'aula sì; una stanza solo se è del corso e, per chi non è trainer, se la persona ne è membro in un turno
   * ancora aperto. I trainer possono riaprire anche le stanze dei turni chiusi.
   */
  canEnter(room: string, peer: { key: string; role: Role }): boolean {
    if (room === this.aula) return true;
    const f = this.find(room);
    if (!f) return false;
    if (peer.role === "editor") return true;
    return f.round.open && f.members.some((m) => m.key === peer.key);
  }

  whereIs(room: string): Where {
    const f = room === this.aula ? null : this.find(room);
    return { aula: this.aula, round: f ? f.round.round : null, n: f ? f.n : null };
  }
}

const courses = new Map<string, Course>();

/** Dimentica il corso in memoria (l'aula è stata eliminata). */
export function dropCourse(dataDir: string, aula: string): void {
  courses.delete(`${dataDir}|${aula}`);
}

/** Il corso della board: quello dell'aula se è una stanza (`parent.json`), altrimenti il corso della board stessa. */
export function getCourse(dataDir: string, secret: string, boardId: string): Course {
  const aula = readParent(roomDir(dataDir, boardId))?.aula ?? boardId;
  const key = `${dataDir}|${aula}`;
  let c = courses.get(key);
  if (!c) {
    c = new Course(aula, dataDir, secret);
    courses.set(key, c);
  }
  return c;
}

// Azioni sulle stanze dal vivo, richieste dal trainer: crea, sposta, visita, chiudi. Ogni azione controlla il ruolo sul server.
//   rooms-create { rooms, assign: { <chiave>: <n> } }   dall'aula
import { MAX_AULA, roomId, validateAssign } from "./assign.ts";
import { gotoToken, type Course } from "./course.ts";
import { assignedRoom, openRound, writeCourse, writeParent, type RoomInfo } from "./course-data.ts";
import { getRoom, roomDir, type Peer, type Room } from "./rooms.ts";

const COPY_CHUNK = 1000; // elementi per volta nella copia (il server ne accetta al massimo 5000 per messaggio)
const FILES_CHUNK = 20;

const sendTo = (peer: Peer, msg: unknown) => {
  if (peer.ws.readyState === 1) peer.ws.send(JSON.stringify(msg));
};
const error = (peer: Peer, motivo: string) => sendTo(peer, { t: "rooms-error", motivo });

/** Dice al client di aprire un'altra board, con un token firmato dal server (stessa persona, ruolo e scadenza). */
export function goto(course: Course, peer: Peer, room: string): void {
  sendTo(peer, { t: "goto", room, token: gotoToken(peer, room, course.secret) });
}

/** Instrada i messaggi `rooms-*`; restituisce `true` se il messaggio era di questo gruppo (anche se scartato). */
export function handleRoomsMessage(r: Room, peer: Peer, msg: Record<string, unknown>): boolean {
  if (typeof msg.t !== "string" || !msg.t.startsWith("rooms-")) return false;
  const course = r.course;
  if (peer.role !== "editor" || !course) return true; // solo i trainer; per gli altri è come se non esistesse
  try {
    if (msg.t === "rooms-create") createRooms(r, course, peer, msg);
  } catch (e) {
    console.error("Azione sulle stanze non riuscita:", e);
    error(peer, "Qualcosa è andato storto sul server: riprova.");
  }
  return true;
}

function createRooms(r: Room, course: Course, peer: Peer, msg: Record<string, unknown>): void {
  if (r.id !== course.aula) return error(peer, "Le stanze si creano dall'aula.");
  if (openRound(course.data)) return error(peer, "C'è già un turno di stanze aperto: chiudilo prima di crearne un altro.");
  if (course.aula.length > MAX_AULA) return error(peer, `Il nome dell'aula supera i ${MAX_AULA} caratteri: con questo nome non si possono creare stanze.`);
  const aulaPeers = [...r.peers].filter((p) => p.role !== "editor");
  const v = validateAssign(msg.rooms, msg.assign, new Set(aulaPeers.map((p) => p.key)));
  if (!v.ok) return error(peer, v.motivo);

  const round = course.data.round + 1;
  const els = [...r.els.values()].filter((e) => !e.isDeleted);
  const files = [...r.files.values()];
  const rooms: RoomInfo[] = [];
  for (let n = 1; n <= v.rooms; n++) {
    const id = roomId(course.aula, round, n);
    const room = getRoom(course.dataDir, id);
    room.course = course;
    room.timer = course.timer;
    // copia dell'aula: i nuovi oggetti risultano del trainer che crea (lo imposta applyElements), come con `seed`
    for (let i = 0; i < els.length; i += COPY_CHUNK) room.applyElements(structuredClone(els.slice(i, i + COPY_CHUNK)), { key: peer.key, role: "editor" });
    for (let i = 0; i < files.length; i += FILES_CHUNK) room.applyFiles(files.slice(i, i + FILES_CHUNK));
    writeParent(roomDir(course.dataDir, id), { aula: course.aula, round, n });
    room.flush();
    const members = [...v.assign].filter(([, x]) => x === n).map(([key]) => ({ key, name: aulaPeers.find((p) => p.key === key)!.name }));
    rooms.push({ n, id, members });
  }
  course.data.round = round;
  course.data.rounds.push({ round, open: true, createdAt: Date.now(), rooms });
  writeCourse(course.dir, course.data);

  for (const p of aulaPeers) {
    const n = v.assign.get(p.key);
    if (n) goto(course, p, roomId(course.aula, round, n));
  }
  course.pushPresence();
}

/** Chi si collega all'aula con un'assegnazione in un turno aperto va subito nella sua stanza (ricarica, rientro dal link, caduta di rete). */
export function routeReturning(r: Room, peer: Peer): void {
  const course = r.course;
  if (!course || r.id !== course.aula || peer.role === "editor") return;
  const a = assignedRoom(course.data, peer.key);
  if (a) goto(course, peer, a.id);
}

// Azioni sulle stanze dal vivo, richieste dal trainer: crea, sposta, visita, chiudi. Ogni azione controlla il ruolo sul server.
//   rooms-create { rooms, assign: { <chiave>: <n> } }   dall'aula
//   rooms-move   { key, n }                             sposta un partecipante nel turno aperto
//   rooms-visit  { room }                               il trainer apre l'aula o una stanza (anche di turni chiusi)
//   rooms-close                                         chiude il turno aperto: tutti tornano in aula
import fs from "node:fs";
import { MAX_AULA, roomId, validateAssign } from "./assign.ts";
import { gotoToken, type Course } from "./course.ts";
import { assignedRoom, openRound, writeParent, type CourseData, type RoomInfo } from "./course-data.ts";
import { getRoom, loadedRoom, roomDir, type Peer, type Room } from "./rooms.ts";

const COPY_CHUNK = 1000; // elementi per volta nella copia (il server ne accetta al massimo 5000 per messaggio)
const FILES_CHUNK = 20;
/** Cede il turno al resto del server: una copia grande non deve bloccare le altre board. */
const tick = () => new Promise<void>((r) => setImmediate(r));

const sendTo = (peer: Peer, msg: unknown) => {
  if (peer.ws.readyState === 1) peer.ws.send(JSON.stringify(msg));
};
const error = (peer: Peer, motivo: string) => sendTo(peer, { t: "rooms-error", motivo });

/** Dice al client di aprire un'altra board, con un token firmato dal server (stessa persona, ruolo e scadenza). */
export function goto(course: Course, peer: Peer, room: string): void {
  sendTo(peer, { t: "goto", room, token: gotoToken(peer, room, course.secret) });
}

function failed(course: Course, peer: Peer, e: unknown): void {
  console.error("Azione sulle stanze non riuscita:", e);
  error(peer, "Qualcosa è andato storto sul server: riprova.");
  course.pushPresence(); // il trainer rivede lo stato vero (memoria e disco non devono dare risposte diverse)
}

/** Instrada i messaggi `rooms-*`; restituisce `true` se il messaggio era di questo gruppo (anche se scartato). */
export function handleRoomsMessage(r: Room, peer: Peer, msg: Record<string, unknown>): boolean {
  if (typeof msg.t !== "string" || !msg.t.startsWith("rooms-")) return false;
  const course = r.course;
  if (peer.role !== "editor" || !course) return true; // solo i trainer; per gli altri è come se non esistesse
  try {
    if (msg.t === "rooms-create") createRooms(r, course, peer, msg).catch((e) => failed(course, peer, e));
    else if (msg.t === "rooms-move") moveMember(course, peer, msg);
    else if (msg.t === "rooms-visit") visit(course, peer, msg);
    else if (msg.t === "rooms-close") closeRooms(course, peer);
  } catch (e) {
    failed(course, peer, e);
  }
  return true;
}

async function createRooms(r: Room, course: Course, peer: Peer, msg: Record<string, unknown>): Promise<void> {
  if (r.id !== course.aula) return error(peer, "Le stanze si creano dall'aula.");
  if (course.corrupt) {
    return error(peer, "Il file delle stanze di questo corso (course.json) è danneggiato: non creo altre stanze per non perdere quelle esistenti. Ne ho conservato una copia (course.json.bad).");
  }
  if (course.creating) return error(peer, "Sto già creando le stanze: attendi un momento.");
  if (openRound(course.data)) return error(peer, "C'è già un turno di stanze aperto: chiudilo prima di crearne un altro.");
  if (course.aula.length > MAX_AULA) return error(peer, `Il nome dell'aula supera i ${MAX_AULA} caratteri: con questo nome non si possono creare stanze.`);
  const aulaPeers = [...r.peers].filter((p) => p.role !== "editor");
  const v = validateAssign(msg.rooms, msg.assign, new Set(aulaPeers.map((p) => p.key)));
  if (!v.ok) return error(peer, v.motivo);

  course.creating = true;
  try {
    // un turno libero: nessuna delle board di destinazione deve esistere già (su disco o in memoria), altrimenti si fonderebbe il lavoro di qualcun altro
    const free = (rd: number) => !Array.from({ length: v.rooms }, (_, i) => roomId(course.aula, rd, i + 1)).some((id) => loadedRoom(id) || fs.existsSync(roomDir(course.dataDir, id)));
    let round = course.data.round + 1;
    while (!free(round) && round < course.data.round + 100) round++;
    if (!free(round)) return error(peer, "Non trovo un turno libero per le nuove stanze.");

    const els = [...r.els.values()].filter((e) => !e.isDeleted);
    const used = new Set(els.filter((e) => e.type === "image" && typeof e.fileId === "string").map((e) => e.fileId as string));
    const files = [...r.files.values()].filter((f) => used.has(f.id)); // solo le immagini ancora usate
    const rooms: RoomInfo[] = [];
    for (let n = 1; n <= v.rooms; n++) {
      const id = roomId(course.aula, round, n);
      const room = getRoom(course.dataDir, id);
      room.course = course;
      room.timer = course.timer;
      // copia dell'aula: i nuovi oggetti risultano del trainer che crea (lo imposta applyElements), come con `seed`
      for (let i = 0; i < els.length; i += COPY_CHUNK) {
        room.applyElements(structuredClone(els.slice(i, i + COPY_CHUNK)), { key: peer.key, role: "editor" });
        await tick();
      }
      for (let i = 0; i < files.length; i += FILES_CHUNK) room.applyFiles(files.slice(i, i + FILES_CHUNK));
      writeParent(roomDir(course.dataDir, id), { aula: course.aula, round, n });
      await room.flushAsync(); // non blocca il server e, se il disco fallisce, si ferma qui senza spostare nessuno
      room.release(); // una stanza che nessuno raggiunge non resta in memoria
      const members = [...v.assign].filter(([, x]) => x === n).map(([key]) => ({ key, name: aulaPeers.find((p) => p.key === key)!.name }));
      rooms.push({ n, id, members });
    }
    course.commit({ round, rounds: [...course.data.rounds, { round, open: true, createdAt: Date.now(), rooms }] });
    console.log(`Stanze create: aula ${course.aula}, turno ${round}, ${v.rooms} stanze, ${v.assign.size} persone assegnate`);
    for (const p of aulaPeers) {
      const n = v.assign.get(p.key);
      if (n) goto(course, p, roomId(course.aula, round, n));
    }
    course.pushPresence();
  } finally {
    course.creating = false;
  }
}

const connectedAnywhere = (course: Course, key: string): Peer[] => course.loaded().flatMap((rm) => [...rm.peers]).filter((p) => p.key === key && p.role !== "editor");

/** Sposta un partecipante collegato in un'altra stanza del turno aperto (anche chi era rimasto in aula). */
function moveMember(course: Course, peer: Peer, msg: Record<string, unknown>): void {
  const round = openRound(course.data);
  if (!round) return error(peer, "Non c'è nessun turno di stanze aperto.");
  const target = typeof msg.n === "number" && Number.isInteger(msg.n) ? round.rooms.find((x) => x.n === msg.n) : undefined;
  if (!target) return error(peer, "Stanza non valida.");
  const people = typeof msg.key === "string" ? connectedAnywhere(course, msg.key) : [];
  if (!people.length) return error(peer, "Il partecipante non è collegato.");
  const key = people[0].key;
  const name = people[0].name;
  // prima su disco, poi in memoria: se la scrittura fallisce lo stato non cambia
  const next: CourseData = {
    round: course.data.round,
    rounds: course.data.rounds.map((rd) =>
      rd !== round ? rd : { ...rd, rooms: rd.rooms.map((room) => ({ ...room, members: [...room.members.filter((m) => m.key !== key), ...(room.n === target.n ? [{ key, name }] : [])] })) },
    ),
  };
  course.commit(next);
  for (const p of people) goto(course, p, target.id);
  course.pushPresence();
}

/** Il trainer apre l'aula o una stanza del corso (anche di un turno chiuso): riceve un token da trainer per quella board. */
function visit(course: Course, peer: Peer, msg: Record<string, unknown>): void {
  const room = msg.room;
  if (typeof room !== "string" || !course.boardIds().includes(room)) return error(peer, "Stanza non valida.");
  goto(course, peer, room);
}

/** Chiude il turno aperto: tutti quelli che sono nelle sue stanze tornano in aula; le board restano salvate. */
function closeRooms(course: Course, peer: Peer): void {
  const round = openRound(course.data);
  if (!round) return error(peer, "Non c'è nessun turno di stanze aperto.");
  course.commit({ round: course.data.round, rounds: course.data.rounds.map((rd) => (rd === round ? { ...rd, open: false } : rd)) });
  for (const info of round.rooms) {
    const rm = loadedRoom(info.id);
    if (!rm) continue;
    rm.flush();
    for (const p of [...rm.peers]) goto(course, p, course.aula);
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

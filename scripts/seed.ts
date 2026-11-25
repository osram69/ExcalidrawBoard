// Classi di lavoro: prepara una board per gruppo con lo stesso materiale e stampa i link.
//   npm run seed -- <corso> <gruppi> <immagine | board:ID> [--server URL] [--base URL] [--ore N] [--trainer "Nome"] [--allievi file]
// Si collega alle board come "editor", come farebbe un browser: funziona con il server acceso, anche in remoto.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WebSocket } from "ws";
import { signToken, type Role } from "../server/auth.ts";
import { assignStudents, buildImageScene, groupRoom, imageInfo, parseArgs, type SeedArgs, type Student } from "./seed-lib.ts";

const MAX_DATAURL = 10 * 1024 * 1024; // stesso limite per immagine del server
const MAX_ELS_PER_MESSAGE = 1000; // ben sotto il limite di 5000 del server
const MAX_CHUNK = 4 * 1024 * 1024; // un messaggio di elementi non supera ~4 MB (il server accetta fino a 16 MB)

export interface BoardConn {
  els: any[];
  files: any[];
  received: any[]; // messaggi arrivati dopo il collegamento (es. "deny")
  send(msg: unknown): void;
  close(): Promise<void>;
}

const FILES_TIMEOUT_MS = 60_000; // attesa massima delle immagini di una board

/**
 * Si collega a una board e attende lo stato iniziale: gli elementi e le immagini (che arrivano dopo, un messaggio ciascuna).
 * Con `waitFiles` attende anche che sia arrivata l'immagine di ogni elemento immagine, senza fermarsi a un tempo fisso:
 * su un collegamento lento un'immagine da 10 MB impiega ben più di `settleMs`. Se non arrivano entro 60 secondi, errore.
 */
export function connectBoard(server: string, room: string, token: string, settleMs = 400, waitFiles = false): Promise<BoardConn> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${server.replace(/^http/, "ws")}/connect/${encodeURIComponent(room)}?t=${encodeURIComponent(token)}`);
    const conn: BoardConn = {
      els: [],
      files: [],
      received: [],
      send: (m) => ws.send(JSON.stringify(m)),
      close: () =>
        new Promise<void>((res) => {
          if (ws.readyState === WebSocket.CLOSED) return res();
          ws.once("close", () => res());
          ws.close();
        }),
    };
    let ready = false;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let deadline: NodeJS.Timeout | undefined;
    let needed: string[] = [];
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(deadline);
      reject(err);
    };
    const missing = () => needed.filter((id) => !conn.files.some((f) => f.id === id));
    const settle = () => {
      clearTimeout(timer);
      if (missing().length) return; // si aspetta ancora qualche immagine
      timer = setTimeout(() => {
        settled = true;
        clearTimeout(deadline);
        resolve(conn);
      }, settleMs);
    };
    ws.on("unexpected-response", (_req, res) => {
      fail(new Error(`Il server ha rifiutato il collegamento alla board ${room} (HTTP ${res.statusCode}): link non valido o BOARD_SECRET diverso da quello del server.`));
      ws.terminate();
    });
    ws.on("error", (e: any) => fail(new Error(`Non riesco a collegarmi al server ${server} (${e?.code ?? e?.message ?? "errore di rete"}).`)));
    ws.on("close", () => fail(new Error(`Il collegamento al server ${server} si è chiuso prima del tempo.`)));
    ws.on("message", (data) => {
      let m: any;
      try {
        m = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!ready) {
        if (m.t !== "init") return;
        ready = true;
        conn.els = m.els;
        if (waitFiles) needed = [...new Set<string>(m.els.filter((e: any) => !e.isDeleted && e.type === "image" && e.fileId).map((e: any) => e.fileId))];
        deadline = setTimeout(() => {
          fail(new Error(`Le immagini della board ${room} non sono arrivate entro ${FILES_TIMEOUT_MS / 1000} secondi (mancano: ${missing().join(", ")}).`));
          ws.terminate();
        }, FILES_TIMEOUT_MS);
        settle();
      } else if (!settled && m.t === "files") {
        conn.files.push(...m.files);
        clearTimeout(timer);
        settle();
      } else conn.received.push(m);
    });
  });
}

function secretFor(env: NodeJS.ProcessEnv): string {
  if (env.BOARD_SECRET) return env.BOARD_SECRET;
  try {
    const m = fs.readFileSync(".env", "utf8").match(/^\s*BOARD_SECRET\s*=\s*(.*?)\s*$/m);
    if (m && m[1]) return m[1].replace(/^["']|["']$/g, "");
  } catch {
    /* nessun file .env */
  }
  return "dev-secret-solo-per-prove";
}

/** Divide gli elementi in gruppi che stanno comodamente in un messaggio: per dimensione e per numero (il server ne accetta al massimo 5000 per messaggio e scarta il resto). */
function chunkBySize(els: any[]): any[][] {
  const out: any[][] = [];
  let cur: any[] = [];
  let size = 0;
  for (const e of els) {
    const n = JSON.stringify(e).length;
    if (cur.length && (size + n > MAX_CHUNK || cur.length >= MAX_ELS_PER_MESSAGE)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(e);
    size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

interface Material {
  els: any[];
  files: any[];
  descr: string;
}

function readFileOrFail(p: string, what: string): Buffer {
  try {
    return fs.readFileSync(p);
  } catch {
    throw new Error(`Non trovo ${what}: ${p}`);
  }
}

async function loadMaterial(args: SeedArgs, readSource: (room: string) => Promise<BoardConn>): Promise<Material> {
  if (args.materiale.tipo === "board") {
    const id = args.materiale.id;
    for (let g = 1; g <= args.gruppi; g++) {
      if (groupRoom(args.corso, g) === id) throw new Error(`La board di origine ${id} coincide con una delle board di destinazione: scegli un altro nome per il corso.`);
    }
    const src = await readSource(id); // sola lettura
    await src.close();
    const els = src.els.filter((e) => !e.isDeleted);
    if (!els.length) throw new Error(`La board ${id} è vuota o non esiste.`);
    return { els, files: src.files, descr: `board ${id}` };
  }
  const p = args.materiale.percorso;
  const buf = readFileOrFail(p, "il file dell'immagine");
  const info = imageInfo(buf);
  if (!info) throw new Error(`${p} non è un'immagine riconosciuta (sono ammessi PNG, JPEG, WebP e GIF).`);
  const dataURL = `data:${info.mime};base64,${buf.toString("base64")}`;
  if (dataURL.length > MAX_DATAURL) throw new Error(`L'immagine è troppo grande (massimo circa 7 MB di file): riducila e riprova.`);
  return { ...buildImageScene(info, dataURL), descr: `immagine ${path.basename(p)}` };
}

export async function main(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  out: (line: string) => void = console.log,
  connect: typeof connectBoard = connectBoard,
): Promise<number> {
  const args = parseArgs(argv);
  if ("errore" in args) {
    out(args.errore);
    return 1;
  }
  try {
    await seed(args, secretFor(env), out, connect);
    return 0;
  } catch (e) {
    out(`Errore: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

async function seed(args: SeedArgs, secret: string, out: (line: string) => void, connect: typeof connectBoard): Promise<void> {
  // 1. tutta la validazione prima di toccare il server
  let students: Student[] | undefined;
  if (args.allievi !== undefined) {
    const r = assignStudents(readFileOrFail(args.allievi, "il file degli allievi").toString("utf8").split(/\r?\n/), args.gruppi);
    if ("errore" in r) throw new Error(r.errore);
    students = r.ok;
  }
  const exp = Date.now() + args.ore * 3600e3;
  const material = await loadMaterial(args, (room) =>
    connect(args.server, room, signToken({ room, name: args.trainer, uid: "trainer", role: "viewer", exp }, secret), 400, true), // aspetta anche le immagini
  );
  const link = (room: string, name: string, uid: string, role: Role) => `${args.base}/b/${room}?t=${signToken({ room, name, uid, role, exp }, secret)}`;

  /** Imposta password di sessione e data di fine della board (il server conserva solo l'impronta della password). */
  async function applyAccess(room: string): Promise<void> {
    const editor = signToken({ room, name: args.trainer, uid: "trainer", role: "editor", exp }, secret);
    const r = await fetch(`${args.server}/auth/access?room=${encodeURIComponent(room)}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${editor}`, "Content-Type": "application/json" },
      body: JSON.stringify({ password: args.password, until: args.fino ?? null }),
    }).catch(() => null);
    if (!r) throw new Error(`Non riesco a collegarmi al server ${args.server} per impostare la password.`);
    if (r.ok) return;
    const motivo = ((await r.json().catch(() => null)) as { motivo?: string } | null)?.motivo ?? `HTTP ${r.status}`;
    throw new Error(
      r.status === 401 ? `Il server ha rifiutato la password di ${room} (${motivo}): BOARD_SECRET diverso da quello del server?` : `Password non impostata per ${room}: ${motivo}`,
    );
  }

  // 2. una board per gruppo
  const skipped = new Set<number>();
  const done: string[] = [];
  try {
    for (let g = 1; g <= args.gruppi; g++) {
      const room = groupRoom(args.corso, g);
      const conn = await connect(args.server, room, signToken({ room, name: args.trainer, uid: "trainer", role: "editor", exp }, secret));
      try {
        if (conn.els.length > 0) skipped.add(g);
        else {
          for (const f of material.files) conn.send({ t: "files", files: [f] }); // un'immagine per messaggio (limite del server)
          for (const chunk of chunkBySize(material.els)) conn.send({ t: "els", els: chunk });
        }
      } finally {
        await conn.close();
      }
      if (!skipped.has(g)) {
        // verifica: la board deve contenere ogni elemento (per id) e, aspettandole, ogni immagine
        const check = await connect(args.server, room, signToken({ room, name: args.trainer, uid: "trainer", role: "viewer", exp }, secret), 0, true);
        const have = new Set(check.els.map((e) => e.id));
        const lacking = material.els.filter((e) => !have.has(e.id)).length;
        await check.close();
        if (lacking) {
          throw new Error(`La board ${room} non ha ricevuto tutto il materiale (mancano ${lacking} elementi su ${material.els.length}). Può essere rimasta a metà: usa un altro nome per il corso.`);
        }
      }
      if (args.password !== undefined) await applyAccess(room); // anche sulle board già piene: rilanciare serve a cambiare la password
      done.push(room);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(done.length ? `${msg}
Board già preparate prima dell'errore: ${done.join(", ")} (rilanciando il comando vengono saltate).` : msg);
  }

  // 3. elenco dei link
  out(`Classe "${args.corso}": ${args.gruppi} gruppi, materiale: ${material.descr}`);
  for (let g = 1; g <= args.gruppi; g++) {
    const room = groupRoom(args.corso, g);
    out("");
    out(`Gruppo ${g} — ${room}${skipped.has(g) ? " (saltata: ha già del contenuto)" : ""}`);
    out(`  Trainer: ${link(room, args.trainer, "trainer", "editor")}`);
    if (args.password !== undefined) {
      out(`  Allievi (accesso con password della sessione${args.fino ? `, fino al ${new Date(args.fino).toLocaleDateString("it-IT")}` : ""}): ${args.base}/b/${room}`);
    }
    if (students) {
      for (const s of students.filter((s) => s.group === g)) out(`  ${s.name} (link personale): ${link(room, s.name, s.uid, "participant")}`);
    } else if (args.password === undefined) {
      out(`  Allievi (link di gruppo, condividono identità e puntini): ${link(room, `Gruppo ${g}`, `g${g}`, "participant")}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}

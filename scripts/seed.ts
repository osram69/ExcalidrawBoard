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
const MAX_CHUNK = 4 * 1024 * 1024; // un messaggio di elementi non supera ~4 MB (il server accetta fino a 16 MB)

export interface BoardConn {
  els: any[];
  files: any[];
  received: any[]; // messaggi arrivati dopo il collegamento (es. "deny")
  send(msg: unknown): void;
  close(): Promise<void>;
}

/** Si collega a una board e attende lo stato iniziale (elementi e, entro `settleMs`, le immagini). */
export function connectBoard(server: string, room: string, token: string, settleMs = 400): Promise<BoardConn> {
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
    const settle = () => {
      timer = setTimeout(() => {
        settled = true;
        resolve(conn);
      }, settleMs);
    };
    ws.on("unexpected-response", (_req, res) => {
      reject(new Error(`Il server ha rifiutato il collegamento alla board ${room} (HTTP ${res.statusCode}): link non valido o BOARD_SECRET diverso da quello del server.`));
      ws.terminate();
    });
    ws.on("error", (e: any) => {
      if (!settled) reject(new Error(`Non riesco a collegarmi al server ${server} (${e?.code ?? e?.message ?? "errore di rete"}).`));
    });
    ws.on("close", () => {
      if (!settled) reject(new Error(`Il collegamento al server ${server} si è chiuso prima del tempo.`));
    });
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

/** Divide gli elementi in gruppi che stanno comodamente in un messaggio. */
function chunkBySize(els: any[]): any[][] {
  const out: any[][] = [];
  let cur: any[] = [];
  let size = 0;
  for (const e of els) {
    const n = JSON.stringify(e).length;
    if (cur.length && size + n > MAX_CHUNK) {
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

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env, out: (line: string) => void = console.log): Promise<number> {
  const args = parseArgs(argv);
  if ("errore" in args) {
    out(args.errore);
    return 1;
  }
  try {
    await seed(args, secretFor(env), out);
    return 0;
  } catch (e) {
    out(`Errore: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

async function seed(args: SeedArgs, secret: string, out: (line: string) => void): Promise<void> {
  // 1. tutta la validazione prima di toccare il server
  let students: Student[] | undefined;
  if (args.allievi !== undefined) {
    const r = assignStudents(readFileOrFail(args.allievi, "il file degli allievi").toString("utf8").split(/\r?\n/), args.gruppi);
    if ("errore" in r) throw new Error(r.errore);
    students = r.ok;
  }
  const exp = Date.now() + args.ore * 3600e3;
  const material = await loadMaterial(args, (room) =>
    connectBoard(args.server, room, signToken({ room, name: args.trainer, uid: "trainer", role: "viewer", exp }, secret)),
  );
  const link = (room: string, name: string, uid: string, role: Role) => `${args.base}/b/${room}?t=${signToken({ room, name, uid, role, exp }, secret)}`;

  // 2. una board per gruppo
  const skipped = new Set<number>();
  for (let g = 1; g <= args.gruppi; g++) {
    const room = groupRoom(args.corso, g);
    const conn = await connectBoard(args.server, room, signToken({ room, name: args.trainer, uid: "trainer", role: "editor", exp }, secret));
    try {
      if (conn.els.length > 0) {
        skipped.add(g);
        continue;
      }
      for (const f of material.files) conn.send({ t: "files", files: [f] }); // un'immagine per messaggio (limite del server)
      for (const chunk of chunkBySize(material.els)) conn.send({ t: "els", els: chunk });
    } finally {
      await conn.close();
    }
    const check = await connectBoard(args.server, room, signToken({ room, name: args.trainer, uid: "trainer", role: "viewer", exp }, secret), 0);
    const got = check.els.length;
    await check.close();
    if (got < material.els.length) throw new Error(`La board ${room} non ha ricevuto tutto il materiale (${got} di ${material.els.length} elementi).`);
  }

  // 3. elenco dei link
  out(`Classe "${args.corso}": ${args.gruppi} gruppi, materiale: ${material.descr}`);
  for (let g = 1; g <= args.gruppi; g++) {
    const room = groupRoom(args.corso, g);
    out("");
    out(`Gruppo ${g} — ${room}${skipped.has(g) ? " (saltata: ha già del contenuto)" : ""}`);
    out(`  Trainer: ${link(room, args.trainer, "trainer", "editor")}`);
    if (students) {
      for (const s of students.filter((s) => s.group === g)) out(`  ${s.name}: ${link(room, s.name, s.uid, "participant")}`);
    } else {
      out(`  Allievi (link di gruppo, condividono identità e puntini): ${link(room, `Gruppo ${g}`, `g${g}`, "participant")}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}

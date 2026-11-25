// Parti pure del comando `npm run seed` (classi di lavoro): argomenti, allievi, immagini. Nessun accesso a rete o disco.
import crypto from "node:crypto";

export interface SeedArgs {
  corso: string;
  gruppi: number;
  materiale: { tipo: "immagine"; percorso: string } | { tipo: "board"; id: string };
  server: string;
  base: string;
  ore: number;
  trainer: string;
  allievi?: string;
}

const NOME_BOARD = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_CORSO = 60; // lascia posto a "-g12"
export const MAX_GRUPPI = 12;

export function groupRoom(corso: string, n: number): string {
  return `${corso}-g${n}`;
}

const USO = 'Uso: npm run seed -- <corso> <gruppi> <immagine | board:ID> [--server URL] [--base URL] [--ore N] [--trainer "Nome"] [--allievi file]';

/** Legge gli argomenti: tre posizionali (corso, gruppi, materiale) e le opzioni con valore. */
export function parseArgs(argv: string[]): SeedArgs | { errore: string } {
  const pos: string[] = [];
  const opt: Record<string, string> = {};
  const NOTE = ["--server", "--base", "--ore", "--trainer", "--allievi"];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      if (!NOTE.includes(a)) return { errore: `Opzione sconosciuta: ${a}\n${USO}` };
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) return { errore: `Manca il valore di ${a}\n${USO}` };
      opt[a] = v;
    } else pos.push(a);
  }
  if (pos.length !== 3) return { errore: `Servono tre argomenti: corso, gruppi e materiale.\n${USO}` };
  const [corso, gruppiTxt, mat] = pos;
  if (!/^[A-Za-z0-9_-]+$/.test(corso) || corso.length > MAX_CORSO) {
    return { errore: `Nome del corso non valido: usa lettere, numeri, - e _ (massimo ${MAX_CORSO} caratteri).` };
  }
  const gruppi = /^\d+$/.test(gruppiTxt) ? Number(gruppiTxt) : NaN;
  if (!(gruppi >= 1 && gruppi <= MAX_GRUPPI)) return { errore: `Il numero di gruppi deve essere un intero da 1 a ${MAX_GRUPPI}.` };
  let materiale: SeedArgs["materiale"];
  if (mat.startsWith("board:")) {
    const id = mat.slice("board:".length);
    if (!NOME_BOARD.test(id)) return { errore: "Dopo board: serve il nome di una board (lettere, numeri, - e _)." };
    materiale = { tipo: "board", id };
  } else materiale = { tipo: "immagine", percorso: mat };
  const ore = opt["--ore"] === undefined ? 12 : Number(opt["--ore"]);
  if (!Number.isFinite(ore) || ore <= 0) return { errore: "--ore deve essere un numero maggiore di zero." };
  const server = (opt["--server"] ?? "http://localhost:3030").replace(/\/+$/, "");
  return {
    corso, gruppi, materiale, server,
    base: (opt["--base"] ?? server).replace(/\/+$/, ""),
    ore,
    trainer: opt["--trainer"] ?? "Trainer",
    ...(opt["--allievi"] !== undefined ? { allievi: opt["--allievi"] } : {}),
  };
}

export interface Student {
  name: string;
  uid: string;
  group: number;
}

const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "allievo";

/** Un allievo per riga: "Nome" o "Nome;gruppo". Senza gruppo, va al gruppo meno numeroso (a parità, il più basso). */
export function assignStudents(lines: string[], gruppi: number): { ok: Student[] } | { errore: string } {
  const rows: { name: string; group?: number }[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const cut = line.lastIndexOf(";");
    const name = (cut >= 0 ? line.slice(0, cut) : line).trim();
    if (!name) return { errore: `Riga senza nome: "${line}"` };
    if (cut < 0) {
      rows.push({ name });
      continue;
    }
    const g = line.slice(cut + 1).trim();
    const n = /^\d+$/.test(g) ? Number(g) : NaN;
    if (!(n >= 1 && n <= gruppi)) return { errore: `Gruppo non valido per ${name}: "${g}" (i gruppi vanno da 1 a ${gruppi}).` };
    rows.push({ name, group: n });
  }
  const counts = Array<number>(gruppi + 1).fill(0);
  for (const r of rows) if (r.group) counts[r.group]++;
  const used = new Set<string>();
  const ok = rows.map((r): Student => {
    let group = r.group;
    if (!group) {
      group = 1;
      for (let g = 2; g <= gruppi; g++) if (counts[g] < counts[group]) group = g;
      counts[group]++;
    }
    const base = slug(r.name);
    let uid = base;
    for (let i = 2; used.has(uid); i++) uid = `${base}-${i}`;
    used.add(uid);
    return { name: r.name, uid, group };
  });
  return { ok };
}

export interface ImageInfo {
  mime: string;
  width: number;
  height: number;
}

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** Tipo e dimensioni dall'intestazione del file (PNG, JPEG, WebP, GIF); `null` se non è un'immagine riconosciuta o è troncata. */
export function imageInfo(buf: Buffer): ImageInfo | null {
  const done = (mime: string, width: number, height: number): ImageInfo | null => (width > 0 && height > 0 ? { mime, width, height } : null);
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a && buf.toString("latin1", 12, 16) === "IHDR") {
    return done("image/png", buf.readUInt32BE(16), buf.readUInt32BE(20));
  }
  if (buf.length >= 10 && /^GIF8[79]a$/.test(buf.toString("latin1", 0, 6))) return done("image/gif", buf.readUInt16LE(6), buf.readUInt16LE(8));
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let p = 2;
    while (p + 4 <= buf.length) {
      if (buf[p] !== 0xff) return null;
      const m = buf[p + 1];
      if (m === 0xff) {
        p++;
        continue;
      }
      if (SOF.has(m)) return p + 9 <= buf.length ? done("image/jpeg", buf.readUInt16BE(p + 7), buf.readUInt16BE(p + 5)) : null;
      if (m === 0xd9 || m === 0xda) return null; // fine dei dati senza aver trovato le dimensioni
      if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) p += 2;
      else p += 2 + buf.readUInt16BE(p + 2);
    }
    return null;
  }
  if (buf.length >= 25 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") {
    const kind = buf.toString("latin1", 12, 16);
    if (kind === "VP8X" && buf.length >= 30) return done("image/webp", buf.readUIntLE(24, 3) + 1, buf.readUIntLE(27, 3) + 1);
    if (kind === "VP8L" && buf[20] === 0x2f) {
      const b = buf.readUInt32LE(21);
      return done("image/webp", (b & 0x3fff) + 1, ((b >>> 14) & 0x3fff) + 1);
    }
    if (kind === "VP8 " && buf.length >= 30 && buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) {
      return done("image/webp", buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff);
    }
  }
  return null;
}

const MAX_W = 1400;
const MAX_H = 1000;

/** Elemento immagine bloccato, centrato su (0, 0), ridotto per stare in 1400x1000 (mai ingrandito), con il suo file. */
export function buildImageScene(info: ImageInfo, dataURL: string): { els: any[]; files: any[] } {
  if (!(Number.isFinite(info.width) && Number.isFinite(info.height) && info.width > 0 && info.height > 0)) {
    throw new Error("Dimensioni dell'immagine non valide");
  }
  const k = Math.min(1, MAX_W / info.width, MAX_H / info.height);
  const width = Math.max(1, Math.round(info.width * k));
  const height = Math.max(1, Math.round(info.height * k));
  const fileId = crypto.randomUUID();
  const el = {
    type: "image", id: crypto.randomUUID(), x: -width / 2, y: -height / 2, width, height, angle: 0,
    strokeColor: "transparent", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 1, strokeStyle: "solid", roughness: 0,
    opacity: 100, groupIds: [], frameId: null, roundness: null, seed: crypto.randomInt(1, 2 ** 31), version: 1,
    versionNonce: crypto.randomInt(1, 2 ** 31), isDeleted: false, boundElements: null, updated: Date.now(), link: null, locked: true,
    status: "saved", fileId, scale: [1, 1], customData: { kind: "foto" },
  };
  return { els: [el], files: [{ id: fileId, mimeType: info.mime, dataURL, created: Date.now() }] };
}

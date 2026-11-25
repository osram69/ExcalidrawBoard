// Test di integrazione di `npm run seed`: avvia il vero server su una porta libera con una cartella dati temporanea.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { signToken, type Role } from "../server/auth.ts";
import { connectBoard, main } from "./seed.ts";

const SECRET = "test-secret";
let server: ChildProcess;
let url: string;
let dataDir: string;
let work: string;

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = net.createServer().listen(0, () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "seed-data-"));
  work = fs.mkdtempSync(path.join(os.tmpdir(), "seed-work-"));
  const port = await freePort();
  url = `http://localhost:${port}`;
  server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, BOARD_SECRET: SECRET, NODE_ENV: "" },
    stdio: "ignore",
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${url}/health`)).ok) return;
    } catch {
      /* non ancora pronto */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("il server di prova non è partito");
});

after(() => {
  server?.kill();
});

const env = { BOARD_SECRET: SECRET } as NodeJS.ProcessEnv;
const token = (room: string, role: Role, uid = "u") => signToken({ room, name: uid, uid, role, exp: Date.now() + 3600e3 }, SECRET);

function pngFile(name: string, w = 300, h = 200, extra = 0) {
  const b = Buffer.alloc(33 + extra);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  const p = path.join(work, name);
  fs.writeFileSync(p, b);
  return p;
}

async function run(args: string[]) {
  const out: string[] = [];
  const code = await main([...args, "--server", url], env, (l) => out.push(l));
  return { code, text: out.join("\n") };
}

const roomDirs = () => (fs.existsSync(path.join(dataDir, "rooms")) ? fs.readdirSync(path.join(dataDir, "rooms")) : []);

test("immagine su 3 gruppi con 5 allievi: board create, link giusti, immagine bloccata", async () => {
  const allievi = path.join(work, "allievi.txt");
  fs.writeFileSync(allievi, "Anna\nMarco\nGiulia\nLuca\nSara\n");
  const { code, text } = await run(["corso1", "3", pngFile("uml.png"), "--allievi", allievi]);
  assert.equal(code, 0, text);
  for (const g of [1, 2, 3]) assert.ok(text.includes(`corso1-g${g}`), `manca il gruppo ${g}`);
  assert.equal((text.match(/Trainer: http/g) ?? []).length, 3);
  for (const n of ["Anna", "Marco", "Giulia", "Luca", "Sara"]) assert.match(text, new RegExp(`${n}: http`));
  const v = await connectBoard(url, "corso1-g1", token("corso1-g1", "viewer"));
  assert.equal(v.els.length, 1);
  assert.equal(v.els[0].type, "image");
  assert.equal(v.els[0].locked, true);
  assert.equal(v.files.length, 1);
  assert.equal(v.files[0].id, v.els[0].fileId);
  await v.close();
});

test("secondo lancio con lo stesso corso: board saltate, contenuto invariato", async () => {
  const { code, text } = await run(["corso1", "3", pngFile("uml2.png")]);
  assert.equal(code, 0, text);
  assert.equal((text.match(/saltata/g) ?? []).length, 3);
  const v = await connectBoard(url, "corso1-g2", token("corso1-g2", "viewer"));
  assert.equal(v.els.length, 1, "l'immagine non deve raddoppiare");
  await v.close();
});

test("un allievo (participant) non può spostare il materiale", async () => {
  const room = "corso1-g1";
  const before = (await connectBoard(url, room, token(room, "viewer"))).els[0];
  const p = await connectBoard(url, room, token(room, "participant", "anna"));
  p.send({ t: "els", els: [{ ...before, x: before.x + 500, version: before.version + 1, versionNonce: 1 }] });
  await new Promise((r) => setTimeout(r, 400));
  assert.ok(p.received.some((m) => m.t === "deny"), "il server doveva respingere la modifica");
  await p.close();
  const after = (await connectBoard(url, room, token(room, "viewer"))).els[0];
  assert.equal(after.x, before.x);
});

test("errori di validazione: nessuna board creata", async () => {
  const dirsBefore = roomDirs().length;
  const testo = path.join(work, "nota.txt");
  fs.writeFileSync(testo, "non sono un'immagine");
  const grande = pngFile("grande.png", 300, 200, 11 * 1024 * 1024);
  const badStudents = path.join(work, "cattivi.txt");
  fs.writeFileSync(badStudents, "Anna;9\n");
  const casi: string[][] = [
    ["corso2", "2", path.join(work, "non-esiste.png")],
    ["corso2", "2", testo],
    ["corso2", "2", grande],
    ["corso2", "2", pngFile("ok.png"), "--allievi", badStudents],
    ["corso2", "2", pngFile("ok2.png"), "--allievi", path.join(work, "manca.txt")],
    ["corso2", "0", pngFile("ok3.png")],
  ];
  for (const argv of casi) {
    const { code, text } = await run(argv);
    assert.equal(code, 1, `${argv.join(" ")} -> ${text}`);
    assert.ok(text.length > 0);
    assert.ok(!text.includes("at "), "niente stack trace");
  }
  assert.equal(roomDirs().length, dirsBefore, "non doveva nascere nessuna board");
});

test("server spento: errore chiaro che nomina il server", async () => {
  const out: string[] = [];
  const dead = `http://localhost:${await freePort()}`;
  const code = await main(["corso3", "2", pngFile("ok4.png"), "--server", dead], env, (l) => out.push(l));
  assert.equal(code, 1);
  assert.ok(out.join("\n").includes(dead), out.join("\n"));
});

test("senza elenco allievi: un link di gruppo con l'avviso", async () => {
  const { code, text } = await run(["corso4", "2", pngFile("ok5.png")]);
  assert.equal(code, 0, text);
  assert.equal((text.match(/Allievi \(link di gruppo/g) ?? []).length, 2);
});

test("board già con contenuto (anche una sola nota) viene saltata", async () => {
  const room = "corso5-g2";
  const c = await connectBoard(url, room, token(room, "editor", "trainer"));
  c.send({ t: "els", els: [{ id: "n1", type: "rectangle", x: 0, y: 0, width: 50, height: 50, version: 1, versionNonce: 1, strokeColor: "#000", backgroundColor: "#fff" }] });
  await c.close();
  const { code, text } = await run(["corso5", "2", pngFile("ok6.png")]);
  assert.equal(code, 0, text);
  assert.equal((text.match(/saltata/g) ?? []).length, 1);
  const g1 = await connectBoard(url, "corso5-g1", token("corso5-g1", "viewer"));
  const g2 = await connectBoard(url, room, token(room, "viewer"));
  assert.equal(g1.els.length, 1);
  assert.deepEqual(g2.els.map((e: any) => e.id), ["n1"]);
  await g1.close();
  await g2.close();
});

const rect = (id: string, extra: Record<string, unknown> = {}) => ({
  id, type: "rectangle", x: 10, y: 20, width: 100, height: 50, version: 1, versionNonce: 7, strokeColor: "#000", backgroundColor: "#fff", ...extra,
});

test("materiale da una board già preparata: copiata in ogni gruppo, origine invariata, allievi senza modifiche", async () => {
  const src = "lezione1";
  const t = await connectBoard(url, src, token(src, "editor", "trainer"));
  t.send({ t: "files", files: [{ id: "f1", mimeType: "image/png", dataURL: "data:image/png;base64,AAAA", created: 1 }] });
  t.send({ t: "els", els: [rect("a1"), rect("a2", { type: "image", fileId: "f1", status: "saved" }), rect("a3", { isDeleted: true })] });
  await t.close();
  const { code, text } = await run(["corso6", "2", `board:${src}`]);
  assert.equal(code, 0, text);
  assert.ok(text.includes("board lezione1"));
  for (const g of [1, 2]) {
    const room = `corso6-g${g}`;
    const v = await connectBoard(url, room, token(room, "viewer"));
    assert.deepEqual(v.els.map((e: any) => e.id).sort(), ["a1", "a2"], "gli elementi cancellati non si copiano");
    assert.deepEqual(v.files.map((f: any) => f.id), ["f1"]);
    await v.close();
  }
  const orig = await connectBoard(url, src, token(src, "viewer"));
  assert.equal(orig.els.length, 3, "la board d'origine non deve cambiare");
  await orig.close();
  const room = "corso6-g1";
  const p = await connectBoard(url, room, token(room, "participant", "anna"));
  const e = p.els.find((x: any) => x.id === "a1");
  p.send({ t: "els", els: [{ ...e, x: e.x + 300, version: e.version + 1, versionNonce: 1 }] });
  await new Promise((r) => setTimeout(r, 400));
  assert.ok(p.received.some((m) => m.t === "deny"), "gli oggetti copiati sono del trainer");
  await p.close();
});

test("board di origine vuota o inesistente: errore chiaro, nessuna board del corso", async () => {
  const { code, text } = await run(["corso7", "2", "board:non-esiste-affatto"]);
  assert.equal(code, 1);
  assert.match(text, /vuota o non esiste/);
  assert.equal(roomDirs().filter((d) => d.startsWith("corso7-")).length, 0);
});

test("board di origine che coincide con una destinazione: errore", async () => {
  const { code, text } = await run(["corso8", "2", "board:corso8-g1"]);
  assert.equal(code, 1);
  assert.match(text, /coincide/);
  assert.equal(roomDirs().filter((d) => d.startsWith("corso8-")).length, 0);
});

test("errore a metà: si dice quali board erano già state preparate", async () => {
  const out: string[] = [];
  const flaky: typeof connectBoard = (s, r, t, ms) => (r.endsWith("-g2") ? Promise.reject(new Error("rete caduta")) : connectBoard(s, r, t, ms));
  const code = await main(["corso9", "3", pngFile("ok9.png"), "--server", url], env, (l) => out.push(l), flaky);
  const text = out.join("\n");
  assert.equal(code, 1);
  assert.ok(text.includes("rete caduta"), text);
  assert.ok(text.includes("corso9-g1") && /già preparate/.test(text), text);
  assert.ok(!text.includes("corso9-g3"), "il gruppo 3 non è stato toccato");
});

/** Proxy TCP che rallenta le risposte del server (~2 MB/s): simula un server remoto. */
function slowProxy(targetPort: number): Promise<{ port: number; close(): void }> {
  return new Promise((resolve) => {
    const sockets = new Set<net.Socket>();
    const srv = net.createServer((client) => {
      const up = net.connect(targetPort, "127.0.0.1");
      sockets.add(client);
      sockets.add(up);
      client.pipe(up);
      let queue = Buffer.alloc(0);
      let upClosed = false;
      const end = () => {
        clearInterval(timer);
        client.destroy();
        up.destroy();
      };
      const timer = setInterval(() => {
        if (queue.length) {
          client.write(queue.subarray(0, 32768));
          queue = queue.subarray(32768);
        } else if (upClosed) end();
      }, 15);
      up.on("data", (d: Buffer) => (queue = Buffer.concat([queue, d])));
      up.on("close", () => (upClosed = true));
      client.on("close", end);
      client.on("error", () => {});
      up.on("error", () => {});
    }).listen(0, () => resolve({ port: (srv.address() as net.AddressInfo).port, close: () => { for (const s of sockets) s.destroy(); srv.close(); } }));
  });
}

test("copia di una board con un'immagine grande su un collegamento lento: arriva anche il file", async () => {
  const src = "lenta1";
  const big = "data:image/png;base64," + "A".repeat(3 * 1024 * 1024);
  const t = await connectBoard(url, src, token(src, "editor", "trainer"));
  t.send({ t: "files", files: [{ id: "big1", mimeType: "image/png", dataURL: big, created: 1 }] });
  t.send({ t: "els", els: [rect("img1", { type: "image", fileId: "big1", status: "saved" })] });
  await t.close();
  const proxy = await slowProxy(Number(new URL(url).port));
  try {
    const out: string[] = [];
    const code = await main(["corso10", "2", `board:${src}`, "--server", `http://localhost:${proxy.port}`], env, (l) => out.push(l));
    assert.equal(code, 0, out.join("\n"));
  } finally {
    proxy.close();
  }
  for (const g of [1, 2]) {
    const room = `corso10-g${g}`;
    const v = await connectBoard(url, room, token(room, "viewer"), 1500);
    assert.equal(v.els.length, 1);
    assert.deepEqual(v.files.map((f: any) => f.id), ["big1"], `${room}: manca il file dell'immagine`);
    await v.close();
  }
});

test("copia di una board con più di 5000 elementi: arrivano tutti", async () => {
  const src = "grande2";
  const t = await connectBoard(url, src, token(src, "editor", "trainer"));
  for (let i = 0; i < 6; i++) t.send({ t: "els", els: Array.from({ length: 1000 }, (_, k) => rect(`e${i}-${k}`)) });
  await new Promise((r) => setTimeout(r, 500));
  await t.close();
  const { code, text } = await run(["corso11", "1", `board:${src}`]);
  assert.equal(code, 0, text);
  const v = await connectBoard(url, "corso11-g1", token("corso11-g1", "viewer"));
  assert.equal(v.els.length, 6000);
  await v.close();
});

test("segreto sbagliato: errore chiaro che nomina BOARD_SECRET, nessuna board creata", async () => {
  const out: string[] = [];
  const code = await main(["corso12", "2", pngFile("ok12.png"), "--server", url], { BOARD_SECRET: "un-altro-segreto" } as NodeJS.ProcessEnv, (l) => out.push(l));
  assert.equal(code, 1);
  assert.match(out.join("\n"), /BOARD_SECRET/);
  assert.equal(roomDirs().filter((d) => d.startsWith("corso12-")).length, 0);
});

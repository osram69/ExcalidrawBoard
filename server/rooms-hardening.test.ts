// Test di robustezza di aula e stanze (dalla revisione): board già esistenti, file corrotti, client che non obbediscono, carico.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { elem, gotoOf, pause, peopleIn, startFixture, type Fixture } from "./rooms-fixture.ts";
import { connect, type Client } from "./test-client.ts";

let fx: Fixture;
before(async () => {
  fx = await startFixture();
});
after(() => fx?.stop());

const close = async (...cs: { close(): Promise<void> }[]) => {
  for (const c of cs) await c.close();
};
const roomsDir = () => path.join(fx.srv.dataDir, "rooms");

test("crea stanze: non si appropria di una board che esiste già con quel nome, ma passa al turno libero", async () => {
  // una board qualsiasi, già esistente, chiamata come la prima stanza del primo turno
  const foreign = await connect(fx.srv.url, "h1-r1-s1", fx.trainer("h1-r1-s1"));
  foreign.send({ t: "els", els: [elem("estraneo")] });
  await pause();
  await foreign.close();
  await pause();
  const { t, kids } = await fx.aulaConAllievi("h1", ["anna"]);
  t.send({ t: "rooms-create", rooms: 2, assign: { anna: 1 } });
  const g = await gotoOf(kids[0]);
  assert.equal(g.room, "h1-r2-s1", "il turno 1 è occupato: si usa il turno libero successivo");
  const again = await connect(fx.srv.url, "h1-r1-s1", fx.trainer("h1-r1-s1"));
  assert.deepEqual(again.init.els.map((e: any) => e.id), ["estraneo"], "la board esistente non cambia");
  assert.deepEqual(again.init.course.round, null, "e non è diventata una stanza di nessun corso");
  await close(t, again, ...kids);
});

test("crea stanze: con course.json danneggiato non si creano stanze e si conserva una copia", async () => {
  fs.mkdirSync(path.join(roomsDir(), "h2"), { recursive: true });
  fs.writeFileSync(path.join(roomsDir(), "h2", "course.json"), "{rotto");
  const { t, kids } = await fx.aulaConAllievi("h2", ["anna"]);
  t.send({ t: "rooms-create", rooms: 2, assign: { anna: 1 } });
  assert.match((await t.waitFor((m) => m.t === "rooms-error")).motivo, /danneggiat/i);
  assert.deepEqual(fx.roomsOnDisk().filter((d) => d.startsWith("h2-r")), []);
  assert.equal(fs.existsSync(path.join(roomsDir(), "h2", "course.json.bad")), true, "copia del file danneggiato");
  assert.equal(kids[0].msgs.some((m) => m.t === "goto"), false);
  await close(t, ...kids);
});

test("dopo la chiusura un client che ignora goto viene scollegato e le sue modifiche non vengono salvate", async () => {
  const aula = "h3";
  const { t, kids } = await fx.aulaConAllievi(aula, ["anna"]);
  t.send({ t: "rooms-create", rooms: 2, assign: { anna: 1 } });
  const g = await gotoOf(kids[0]);
  const inRoom = await connect(fx.srv.url, g.room, g.token); // finge di aver obbedito...
  const stale = inRoom; // ...e poi di restare lì anche dopo la chiusura
  t.send({ t: "rooms-close" });
  await stale.waitFor((m) => m.t === "goto");
  stale.send({ t: "els", els: [elem("dopo-la-chiusura")] });
  const closed = await stale.closed;
  assert.equal(closed.code, 4002);
  const before = t.msgs.length;
  t.send({ t: "rooms-visit", room: g.room });
  const v = await t.waitFor((m) => m.t === "goto" && t.msgs.indexOf(m) >= before);
  const visit = await connect(fx.srv.url, v.room, v.token);
  assert.equal(visit.init.els.some((e: any) => e.id === "dopo-la-chiusura"), false, "la modifica non doveva essere accettata");
  await close(t, visit, ...kids);
});

test("dopo lo spostamento la vecchia connessione non può più scrivere nella vecchia stanza", async () => {
  const aula = "h4";
  const { t, kids } = await fx.aulaConAllievi(aula, ["anna", "bruno"]);
  t.send({ t: "rooms-create", rooms: 2, assign: { anna: 1, bruno: 2 } });
  const ga = await gotoOf(kids[0]);
  const old = await connect(fx.srv.url, ga.room, ga.token);
  const roomMate = await connect(fx.srv.url, ga.room, fx.trainer(ga.room));
  t.send({ t: "rooms-move", key: "anna", n: 2 });
  await old.waitFor((m) => m.t === "goto");
  old.send({ t: "els", els: [elem("vecchia-stanza")] });
  assert.equal((await old.closed).code, 4002);
  await pause();
  assert.equal(roomMate.msgs.some((m) => m.t === "els" && m.els.some((e: any) => e.id === "vecchia-stanza")), false);
  await close(t, roomMate, ...kids);
});

test("crea stanze: si copiano solo le immagini usate da elementi non cancellati", async () => {
  const aula = "h5";
  const t = await connect(fx.srv.url, aula, fx.trainer(aula));
  for (const id of ["f1", "f2", "f3"]) t.send({ t: "files", files: [{ id, mimeType: "image/png", dataURL: "data:image/png;base64,AAAA", created: 1 }] });
  t.send({ t: "els", els: [elem("usata", { type: "image", fileId: "f1", status: "saved" }), elem("cancellata", { type: "image", fileId: "f2", status: "saved", isDeleted: true })] });
  await pause(500);
  const s = await connect(fx.srv.url, aula, fx.student(aula, "anna"));
  await t.waitFor((m) => m.t === "presence" && peopleIn(m, aula).includes("anna"));
  t.send({ t: "rooms-create", rooms: 2, assign: { anna: 1 } });
  const g = await gotoOf(s);
  const inRoom = await connect(fx.srv.url, g.room, g.token);
  await pause(600);
  const ids = inRoom.msgs.filter((m) => m.t === "files").flatMap((m) => m.files.map((f: any) => f.id));
  assert.deepEqual(ids, ["f1"]);
  await close(t, s, inRoom);
});

test("crea stanze con un'aula grande: il server resta reattivo e le stanze nascono complete", async () => {
  const aula = "h6";
  const t = await connect(fx.srv.url, aula, fx.trainer(aula));
  const big = "data:image/png;base64," + "A".repeat(600 * 1024);
  for (let i = 0; i < 5; i++) t.send({ t: "files", files: [{ id: `f${i}`, mimeType: "image/png", dataURL: big, created: 1 }] });
  for (let i = 0; i < 6; i++) t.send({ t: "els", els: Array.from({ length: 1000 }, (_, k) => elem(`g${i}-${k}`)) });
  t.send({ t: "els", els: Array.from({ length: 5 }, (_, i) => elem(`img${i}`, { type: "image", fileId: `f${i}`, status: "saved" })) });
  await pause(1500);
  const s = await connect(fx.srv.url, aula, fx.student(aula, "anna"));
  await t.waitFor((m) => m.t === "presence" && peopleIn(m, aula).includes("anna"));
  t.send({ t: "rooms-create", rooms: 6, assign: { anna: 1 } });
  let worst = 0;
  const watch = (async () => {
    for (let i = 0; i < 15; i++) {
      const t0 = Date.now();
      await fetch(`${fx.srv.url}/health`);
      worst = Math.max(worst, Date.now() - t0);
      await pause(40);
    }
  })();
  const g = await gotoOf(s);
  await watch;
  assert.ok(worst < 400, `il server ha risposto a /health dopo ${worst} ms durante la copia`);
  assert.deepEqual(fx.roomsOnDisk().filter((d) => d.startsWith("h6-r1-")).sort(), ["h6-r1-s1", "h6-r1-s2", "h6-r1-s3", "h6-r1-s4", "h6-r1-s5", "h6-r1-s6"]);
  const inRoom = await connect(fx.srv.url, g.room, g.token);
  await pause(800);
  assert.equal(inRoom.init.els.length, 6005);
  await close(t, s, inRoom);
});

test("due richieste di creazione insieme: nasce un solo turno", async () => {
  const aula = "h7";
  const { t, kids } = await fx.aulaConAllievi(aula, ["anna"]);
  t.send({ t: "rooms-create", rooms: 2, assign: { anna: 1 } });
  t.send({ t: "rooms-create", rooms: 2, assign: { anna: 2 } });
  await gotoOf(kids[0]);
  await t.waitFor((m) => m.t === "rooms-error");
  await pause(300);
  assert.deepEqual(fx.roomsOnDisk().filter((d) => d.startsWith("h7-r")).sort(), ["h7-r1-s1", "h7-r1-s2"]);
  await close(t, ...kids);
});

test("/auth/aula: da una stanza all'aula, null per l'aula e per board sconosciute o non valide", async () => {
  const [s1] = fx.seedCourse("h8", { 1: ["anna"] });
  const get = async (room: string) => (await (await fetch(`${fx.srv.url}/auth/aula?room=${encodeURIComponent(room)}`)).json()) as { aula: string | null };
  assert.deepEqual(await get(s1), { aula: "h8" });
  assert.deepEqual(await get("h8"), { aula: null });
  assert.deepEqual(await get("non-esiste"), { aula: null });
  assert.deepEqual(await get("../x"), { aula: null });
  assert.equal((await fetch(`${fx.srv.url}/auth/aula?room=h8`, { method: "POST" })).status, 405);
});

void (null as unknown as Client);

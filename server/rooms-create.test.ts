// Test di integrazione: crea stanze, spostamento degli allievi, rientro e accesso alle stanze.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { inspectToken } from "./auth.ts";
import { elem, gotoOf, pause, peopleIn, SECRET, startFixture, type Fixture } from "./rooms-fixture.ts";
import { connect } from "./test-client.ts";

let fx: Fixture;
before(async () => {
  fx = await startFixture();
});
after(() => fx?.stop());

const close = async (...cs: { close(): Promise<void> }[]) => {
  for (const c of cs) await c.close();
};

test("crea stanze: gli assegnati ricevono goto con un token verificabile e trovano la copia dell'aula, del trainer", async () => {
  const aula = "cr1";
  const exp = Date.now() + 7200e3;
  const { t, kids } = await fx.aulaConAllievi(aula, ["anna", "bruno"], exp);
  t.send({ t: "rooms-create", rooms: 2, assign: { anna: 1, bruno: 2 } });
  const ga = await gotoOf(kids[0]);
  const gb = await gotoOf(kids[1]);
  assert.equal(ga.room, "cr1-r1-s1");
  assert.equal(gb.room, "cr1-r1-s2");
  const c = inspectToken(ga.token, ga.room, SECRET);
  assert.equal(c.ok, true);
  if (c.ok) assert.deepEqual({ name: c.payload.name, uid: c.payload.uid, role: c.payload.role, exp: c.payload.exp }, { name: "Anna", uid: "anna", role: "participant", exp });
  const inRoom = await connect(fx.srv.url, ga.room, ga.token);
  assert.deepEqual(inRoom.init.els.map((e: any) => e.id), ["e1"], "gli elementi cancellati non si copiano");
  assert.equal(inRoom.init.els[0].customData.owner, "trainer", "la copia è del trainer");
  assert.deepEqual(inRoom.init.course, { aula, round: 1, n: 1 });
  inRoom.send({ t: "els", els: [{ ...inRoom.init.els[0], x: 500, version: 2, versionNonce: 2 }] });
  await inRoom.waitFor((m) => m.t === "deny");
  const p = await t.waitFor((m) => m.t === "presence" && m.current?.round === 1);
  assert.deepEqual(p.current.rooms.map((r: any) => [r.n, r.members.map((x: any) => x.key)]), [[1, ["anna"]], [2, ["bruno"]]]);
  await close(t, inRoom, ...kids);
});

test("crea stanze: allievi e trainer di una stanza non possono crearle", async () => {
  const aula = "cr2";
  const { t, kids } = await fx.aulaConAllievi(aula, ["anna"]);
  kids[0].send({ t: "rooms-create", rooms: 2, assign: { anna: 1 } });
  await pause();
  assert.equal(kids[0].msgs.some((m) => m.t === "goto" || m.t === "rooms-error"), false);
  assert.equal(fs.existsSync(path.join(fx.srv.dataDir, "rooms", aula, "course.json")), false);
  assert.deepEqual(fx.roomsOnDisk().filter((d) => d.startsWith(`${aula}-r`)), []);
  const [s1] = fx.seedCourse("cr2b", { 1: ["anna"] });
  const tr = await connect(fx.srv.url, s1, fx.trainer(s1));
  tr.send({ t: "rooms-create", rooms: 2, assign: { anna: 1 } });
  assert.match((await tr.waitFor((m) => m.t === "rooms-error")).motivo, /aula/i);
  await close(t, tr, ...kids);
});

test("crea stanze: dati non validi danno un errore chiaro e non creano nulla", async () => {
  const aula = "cr3";
  const { t, kids } = await fx.aulaConAllievi(aula, ["anna"]);
  const evil: Record<string, number> = {};
  Object.defineProperty(evil, "__proto__", { value: 1, enumerable: true });
  const bad: unknown[][] = [
    [1, { anna: 1 }], [13, { anna: 1 }], [2.5, { anna: 1 }], ["3", { anna: 1 }],
    [2, { sconosciuto: 1 }], [2, { anna: 3 }], [2, { anna: 0 }], [2, {}], [2, null], [2, evil],
  ];
  for (const [rooms, assign] of bad) {
    t.msgs.length = 0;
    t.send({ t: "rooms-create", rooms, assign });
    const e = await t.waitFor((m) => m.t === "rooms-error");
    assert.ok(e.motivo.length > 0, JSON.stringify([rooms, assign]));
  }
  assert.equal(kids[0].msgs.some((m) => m.t === "goto"), false);
  assert.deepEqual(fx.roomsOnDisk().filter((d) => d.startsWith(`${aula}-r`)), []);
  const lunga = "a".repeat(51);
  const t2 = await connect(fx.srv.url, lunga, fx.trainer(lunga));
  const s2 = await connect(fx.srv.url, lunga, fx.student(lunga, "anna"));
  await t2.waitFor((m) => m.t === "presence" && peopleIn(m, lunga).includes("anna"));
  t2.send({ t: "rooms-create", rooms: 2, assign: { anna: 1 } });
  assert.match((await t2.waitFor((m) => m.t === "rooms-error")).motivo, /50/);
  await close(t, t2, s2, ...kids);
});

test("crea stanze: con un turno già aperto non se ne crea un altro", async () => {
  const aula = "cr4";
  const { t, kids } = await fx.aulaConAllievi(aula, ["anna"]);
  t.send({ t: "rooms-create", rooms: 2, assign: { anna: 1 } });
  await gotoOf(kids[0]);
  t.msgs.length = 0;
  t.send({ t: "rooms-create", rooms: 2, assign: { anna: 2 } });
  assert.match((await t.waitFor((m) => m.t === "rooms-error")).motivo, /aperto/i);
  assert.deepEqual(fx.roomsOnDisk().filter((d) => d.startsWith(`${aula}-r`)).sort(), [`${aula}-r1-s1`, `${aula}-r1-s2`]);
  await close(t, ...kids);
});

test("rientro: chi ricarica l'aula torna nella sua stanza; chi non è assegnato o entra dopo resta in aula", async () => {
  const aula = "cr5";
  const { t, kids } = await fx.aulaConAllievi(aula, ["anna", "bruno"]);
  t.send({ t: "rooms-create", rooms: 2, assign: { anna: 1 } });
  await gotoOf(kids[0]);
  await kids[0].close();
  const again = await connect(fx.srv.url, aula, fx.student(aula, "anna"));
  assert.equal((await gotoOf(again)).room, "cr5-r1-s1");
  assert.equal(kids[1].msgs.some((m) => m.t === "goto"), false, "bruno non è assegnato");
  const late = await connect(fx.srv.url, aula, fx.student(aula, "tardi"));
  await pause();
  assert.equal(late.msgs.some((m) => m.t === "goto"), false, "chi entra dopo resta in aula");
  await close(t, again, late, kids[1]);
});

test("accesso alle stanze: solo gli assegnati; il token di un'altra stanza non entra; /auth/check lo dice", async () => {
  const aula = "cr6";
  const { t, kids } = await fx.aulaConAllievi(aula, ["anna", "bruno"]);
  t.send({ t: "rooms-create", rooms: 2, assign: { anna: 1, bruno: 2 } });
  await gotoOf(kids[0]);
  await assert.rejects(connect(fx.srv.url, "cr6-r1-s1", fx.student("cr6-r1-s1", "bruno")), /403/, "bruno non è nella stanza 1");
  await assert.rejects(connect(fx.srv.url, "cr6-r1-s1", fx.student("cr6-r1-s2", "anna")), /403/, "token di un'altra board");
  const ok = await connect(fx.srv.url, "cr6-r1-s1", fx.student("cr6-r1-s1", "anna"));
  await ok.close();
  const check = (token: string) => fetch(`${fx.srv.url}/auth/check?room=cr6-r1-s1`, { headers: { Authorization: `Bearer ${token}` } });
  const r = await check(fx.student("cr6-r1-s1", "bruno"));
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { ok: false, motivo: "stanza chiusa", aula });
  assert.equal((await check(fx.student("cr6-r1-s1", "anna"))).status, 200);
  await close(t, ...kids);
});

test("crea stanze: un'aula grande (6000 elementi e un'immagine) si copia per intero", async () => {
  const aula = "cr7";
  const t = await connect(fx.srv.url, aula, fx.trainer(aula));
  t.send({ t: "files", files: [{ id: "f1", mimeType: "image/png", dataURL: "data:image/png;base64,AAAA", created: 1 }] });
  for (let i = 0; i < 6; i++) t.send({ t: "els", els: Array.from({ length: 1000 }, (_, k) => elem(`g${i}-${k}`)) });
  t.send({ t: "els", els: [elem("img", { type: "image", fileId: "f1", status: "saved" })] });
  await pause(800);
  const s = await connect(fx.srv.url, aula, fx.student(aula, "anna"));
  await t.waitFor((m) => m.t === "presence" && peopleIn(m, aula).includes("anna"));
  t.send({ t: "rooms-create", rooms: 2, assign: { anna: 1 } });
  const g = await gotoOf(s);
  const inRoom = await connect(fx.srv.url, g.room, g.token);
  await pause(800);
  assert.equal(inRoom.init.els.length, 6001);
  assert.ok(inRoom.msgs.some((m) => m.t === "files" && m.files.some((f: any) => f.id === "f1")), "manca l'immagine");
  await close(t, s, inRoom);
});

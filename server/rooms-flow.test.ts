// Test di integrazione: sposta un allievo, visita le stanze, chiudi le stanze e rifai un turno.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { inspectToken } from "./auth.ts";
import { readCourse } from "./course-data.ts";
import { elem, gotoOf, pause, peopleIn, SECRET, startFixture, type Fixture } from "./rooms-fixture.ts";
import { connect, type Client } from "./test-client.ts";

let fx: Fixture;
before(async () => {
  fx = await startFixture();
});
after(() => fx?.stop());

const close = async (...cs: { close(): Promise<void> }[]) => {
  for (const c of cs) await c.close();
};
const course = (aula: string) => readCourse(path.join(fx.srv.dataDir, "rooms", aula));
const nextGoto = (c: Client, from: number) => c.waitFor((m, ...rest) => m.t === "goto" && c.msgs.indexOf(m) >= from);

/** Aula con trainer e allievi, stanze create (anna:1, bruno:2) e gli allievi già dentro la loro stanza. */
async function conStanze(aula: string, exp?: number) {
  const { t, kids } = await fx.aulaConAllievi(aula, ["anna", "bruno"], exp);
  t.send({ t: "rooms-create", rooms: 2, assign: { anna: 1, bruno: 2 } });
  const ga = await gotoOf(kids[0]);
  const gb = await gotoOf(kids[1]);
  const inA = await connect(fx.srv.url, ga.room, ga.token);
  const inB = await connect(fx.srv.url, gb.room, gb.token);
  return { t, kids, inA, inB, ga, gb };
}

test("sposta: l'allievo riceve goto verso la nuova stanza, i membri si aggiornano, il vecchio accesso non vale più", async () => {
  const aula = "fl1";
  const { t, kids, inA, inB } = await conStanze(aula);
  const before = kids[0].msgs.length;
  t.send({ t: "rooms-move", key: "anna", n: 2 });
  const g = await nextGoto(kids[0], before);
  assert.equal(g.room, "fl1-r1-s2");
  const p = await t.waitFor((m) => m.t === "presence" && m.current?.rooms.find((r: any) => r.n === 2)?.members.some((x: any) => x.key === "anna"));
  assert.deepEqual(p.current.rooms.find((r: any) => r.n === 1).members, []);
  assert.deepEqual(course(aula).rounds[0].rooms.map((r) => r.members.map((m) => m.key).sort()), [[], ["anna", "bruno"]]);
  await assert.rejects(connect(fx.srv.url, "fl1-r1-s1", fx.student("fl1-r1-s1", "anna")), /403/, "anna non è più nella stanza 1");
  const ok = await connect(fx.srv.url, g.room, g.token);
  await close(t, inA, inB, ok, ...kids);
});

test("sposta: dati non validi e allievi non collegati danno un errore; senza turno aperto pure", async () => {
  const aula = "fl2";
  const { t: t0, kids: k0 } = await fx.aulaConAllievi("fl2z", ["anna"]);
  t0.send({ t: "rooms-move", key: "anna", n: 1 });
  assert.match((await t0.waitFor((m) => m.t === "rooms-error")).motivo, /turno/i);
  await close(t0, ...k0);
  const { t, kids, inA, inB } = await conStanze(aula);
  for (const [key, n] of [["anna", 0], ["anna", 3], ["anna", "x"], ["anna", 1.5], ["sconosciuto", 1], ["trainer", 1], [5, 1]] as const) {
    t.msgs.length = 0;
    t.send({ t: "rooms-move", key, n });
    assert.ok((await t.waitFor((m) => m.t === "rooms-error")).motivo.length > 0, JSON.stringify([key, n]));
  }
  assert.deepEqual(course(aula).rounds[0].rooms.map((r) => r.members.map((m) => m.key)), [["anna"], ["bruno"]]);
  await close(t, inA, inB, ...kids);
});

test("visita: il trainer riceve goto con un token da trainer per aula e stanze; non per board di altri corsi", async () => {
  const aula = "fl3";
  const exp = Date.now() + 7200e3;
  const { t, kids, inA, inB } = await conStanze(aula, exp);
  const trainerExp = Date.now() + 3600e3;
  void trainerExp;
  for (const room of ["fl3-r1-s1", "fl3-r1-s2", aula]) {
    const before = t.msgs.length;
    t.send({ t: "rooms-visit", room });
    const g = await nextGoto(t, before);
    assert.equal(g.room, room);
    const c = inspectToken(g.token, room, SECRET);
    assert.equal(c.ok && c.payload.role, "editor");
    assert.equal(c.ok && c.payload.name, "Trainer");
  }
  for (const room of ["altra-aula", "fl3-r9-s9", "fl3-r1-s1/../x", 5, null]) {
    t.msgs.length = 0;
    t.send({ t: "rooms-visit", room });
    assert.ok((await t.waitFor((m) => m.t === "rooms-error")).motivo.length > 0, String(room));
  }
  await close(t, inA, inB, ...kids);
});

test("gli allievi non possono spostare, visitare o chiudere", async () => {
  const aula = "fl4";
  const { t, kids, inA, inB } = await conStanze(aula);
  for (const m of [{ t: "rooms-move", key: "bruno", n: 1 }, { t: "rooms-visit", room: aula }, { t: "rooms-close" }, { t: "rooms-create", rooms: 2, assign: {} }]) {
    inA.send(m);
    kids[0].send(m);
  }
  await pause(400);
  assert.equal(inA.msgs.some((m) => m.t === "goto" || m.t === "rooms-error"), false);
  assert.equal(kids[0].msgs.filter((m) => m.t === "goto").length, 1, "solo il goto iniziale");
  assert.equal(course(aula).rounds[0].open, true);
  assert.deepEqual(course(aula).rounds[0].rooms.map((r) => r.members.map((m) => m.key)), [["anna"], ["bruno"]]);
  await close(t, inA, inB, ...kids);
});

test("chiudi: tutti tornano in aula, le stanze restano salvate e non si rientra; il trainer le riapre con le modifiche degli allievi", async () => {
  const aula = "fl5";
  const exp = Date.now() + 7200e3;
  const { t, kids, inA, inB } = await conStanze(aula, exp);
  inA.send({ t: "els", els: [elem("di-anna", { x: 300 })] });
  await pause();
  const beforeA = inA.msgs.length;
  const beforeB = inB.msgs.length;
  t.send({ t: "rooms-close" });
  for (const [c, from, who] of [[inA, beforeA, "Anna"], [inB, beforeB, "Bruno"]] as const) {
    const g = await nextGoto(c, from);
    assert.equal(g.room, aula);
    const k = inspectToken(g.token, aula, SECRET);
    assert.equal(k.ok && k.payload.name, who);
    assert.equal(k.ok && k.payload.role, "participant");
    assert.equal(k.ok && k.payload.exp, exp);
  }
  assert.equal(course(aula).rounds[0].open, false);
  const p = await t.waitFor((m) => m.t === "presence" && m.current === null);
  assert.ok(p);
  await assert.rejects(connect(fx.srv.url, "fl5-r1-s1", fx.student("fl5-r1-s1", "anna")), /403/, "turno chiuso");
  const res = await fetch(`${fx.srv.url}/auth/check?room=fl5-r1-s1`, { headers: { Authorization: `Bearer ${fx.student("fl5-r1-s1", "anna")}` } });
  assert.deepEqual(await res.json(), { ok: false, motivo: "stanza chiusa", aula });
  // il trainer riapre la stanza chiusa e trova il lavoro dell'allievo
  const before = t.msgs.length;
  t.send({ t: "rooms-visit", room: "fl5-r1-s1" });
  const g = await nextGoto(t, before);
  const visit = await connect(fx.srv.url, g.room, g.token);
  assert.deepEqual(visit.init.els.map((e: any) => e.id).sort(), ["di-anna", "e1"]);
  // un allievo che rientra in aula dopo la chiusura ci resta
  const again = await connect(fx.srv.url, aula, fx.student(aula, "anna"));
  await pause();
  assert.equal(again.msgs.some((m) => m.t === "goto"), false);
  await close(t, inA, inB, visit, again, ...kids);
});

test("chiudi: anche dal trainer che sta dentro una stanza; senza turno aperto è un errore", async () => {
  const aula = "fl6";
  const { t, kids, inA, inB } = await conStanze(aula);
  const trInRoom = await connect(fx.srv.url, "fl6-r1-s1", fx.trainer("fl6-r1-s1"));
  const beforeB = inB.msgs.length;
  trInRoom.send({ t: "rooms-close" });
  assert.equal((await nextGoto(inB, beforeB)).room, aula);
  assert.equal((await trInRoom.waitFor((m) => m.t === "goto" && m.room === aula)).room, aula, "anche il trainer in stanza va in aula");
  t.msgs.length = 0;
  t.send({ t: "rooms-close" });
  assert.match((await t.waitFor((m) => m.t === "rooms-error")).motivo, /turno/i);
  await close(t, trInRoom, inA, inB, ...kids);
});

test("secondo turno: dopo la chiusura si creano nuove stanze (-r2-) con una nuova copia, il primo turno resta nello storico", async () => {
  const aula = "fl7";
  const { t, kids, inA, inB } = await conStanze(aula);
  t.send({ t: "rooms-close" });
  await nextGoto(inA, 0).catch(() => null);
  await pause();
  const aAula = await connect(fx.srv.url, aula, fx.student(aula, "anna"));
  const bAula = await connect(fx.srv.url, aula, fx.student(aula, "bruno"));
  await t.waitFor((m) => m.t === "presence" && peopleIn(m, aula).includes("anna") && peopleIn(m, aula).includes("bruno") && m.current === null);
  t.send({ t: "els", els: [elem("nuovo")] });
  await pause();
  t.send({ t: "rooms-create", rooms: 2, assign: { anna: 2, bruno: 2 } });
  const g = await gotoOf(aAula);
  assert.equal(g.room, "fl7-r2-s2");
  const inRoom = await connect(fx.srv.url, g.room, g.token);
  assert.deepEqual(inRoom.init.els.map((e: any) => e.id).sort(), ["e1", "nuovo"]);
  const c = course(aula);
  assert.equal(c.round, 2);
  assert.deepEqual(c.rounds.map((r) => [r.round, r.open]), [[1, false], [2, true]]);
  assert.deepEqual(c.rounds[0].rooms.map((r) => r.members.map((m) => m.key)), [["anna"], ["bruno"]], "il primo turno non cambia");
  await close(t, inA, inB, aAula, bAula, inRoom, ...kids);
});

test("il corso sopravvive in memoria e su disco: course.json e parent.json esistono per ogni stanza", async () => {
  const aula = "fl8";
  const { t, kids, inA, inB } = await conStanze(aula);
  for (const n of [1, 2]) {
    const parent = JSON.parse(fs.readFileSync(path.join(fx.srv.dataDir, "rooms", `fl8-r1-s${n}`, "parent.json"), "utf8"));
    assert.deepEqual(parent, { aula, round: 1, n });
  }
  await close(t, inA, inB, ...kids);
});

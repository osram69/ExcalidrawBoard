import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { inspectToken, type Role } from "./auth.ts";
import { Course, getCourse, gotoToken } from "./course.ts";
import { writeCourse, writeParent, type CourseData } from "./course-data.ts";
import { getRoom, roomDir, type Peer } from "./rooms.ts";

const SECRET = "chiave-di-prova";
const NOW = 1_800_000_000_000;

function setup(aula: string) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "course-test-"));
  const data: CourseData = {
    round: 2,
    rounds: [
      { round: 1, open: false, createdAt: 1, rooms: [{ n: 1, id: `${aula}-r1-s1`, members: [{ key: "anna", name: "Anna" }] }] },
      { round: 2, open: true, createdAt: 2, rooms: [{ n: 1, id: `${aula}-r2-s1`, members: [{ key: "marco", name: "Marco" }] }, { n: 2, id: `${aula}-r2-s2`, members: [{ key: "giulia", name: "Giulia" }] }] },
    ],
  };
  writeCourse(roomDir(dataDir, aula), data);
  for (const r of data.rounds) for (const room of r.rooms) writeParent(roomDir(dataDir, room.id), { aula, round: r.round, n: room.n });
  return { dataDir, course: getCourse(dataDir, SECRET, aula) };
}

const peer = (key: string, role: Role, got: any[] = []): Peer =>
  ({ id: `id-${key}`, name: key.toUpperCase(), role, key, color: "#000", exp: NOW + 3600e3, email: `${key}@esempio.it`, ws: { readyState: 1, send: (s: string) => got.push(JSON.parse(s)) } }) as unknown as Peer;

test("gotoToken: stessa persona, ruolo e scadenza, solo per la stanza di destinazione", () => {
  const t = gotoToken({ name: "Anna Rossi", key: "u-1234", role: "participant", exp: NOW + 3600e3, email: "anna@esempio.it" }, "aula-r1-s1", SECRET);
  const c = inspectToken(t, "aula-r1-s1", SECRET, NOW);
  assert.equal(c.ok, true);
  if (!c.ok) return;
  assert.deepEqual(c.payload, { room: "aula-r1-s1", name: "Anna Rossi", uid: "u-1234", email: "anna@esempio.it", role: "participant", exp: NOW + 3600e3 });
  assert.deepEqual(inspectToken(t, "aula-r1-s2", SECRET, NOW), { ok: false, motivo: "altra board" });
});

test("gotoToken: mai più lungo di quello di partenza, mai un ruolo diverso", () => {
  for (const role of ["participant", "viewer", "editor"] as Role[]) {
    const exp = NOW + 5000;
    const c = inspectToken(gotoToken({ name: "X", key: "x", role, exp }, "b", SECRET), "b", SECRET, NOW);
    assert.equal(c.ok && c.payload.role, role);
    assert.equal(c.ok && c.payload.exp, exp);
  }
});

test("gotoToken: una chiave 'n:Nome' (senza uid) non diventa uid", () => {
  const c = inspectToken(gotoToken({ name: "Anna Rossi", key: "n:Anna Rossi", role: "participant", exp: NOW + 1000 }, "b", SECRET), "b", SECRET, NOW);
  assert.equal(c.ok, true);
  if (c.ok) assert.equal(c.payload.uid, undefined);
});

test("getCourse: una stanza risolve al corso della sua aula (stessa istanza), un'aula a se stessa", () => {
  const { dataDir, course } = setup("aula-a");
  assert.equal(getCourse(dataDir, SECRET, "aula-a"), course);
  assert.equal(getCourse(dataDir, SECRET, "aula-a-r2-s1"), course);
  assert.equal(course.aula, "aula-a");
  const lone = getCourse(dataDir, SECRET, "altra-board");
  assert.notEqual(lone, course);
  assert.equal(lone.aula, "altra-board");
  assert.deepEqual(lone.data, { round: 0, rounds: [] });
});

test("canEnter: aula sempre; stanza del turno aperto solo ai membri; turni chiusi e altri corsi no; il trainer sempre nel proprio corso", () => {
  const { course } = setup("aula-b");
  assert.equal(course.canEnter("aula-b", { key: "chiunque", role: "participant" }), true);
  assert.equal(course.canEnter("aula-b-r2-s1", { key: "marco", role: "participant" }), true);
  assert.equal(course.canEnter("aula-b-r2-s1", { key: "giulia", role: "participant" }), false, "stanza di un altro");
  assert.equal(course.canEnter("aula-b-r2-s2", { key: "giulia", role: "viewer" }), true);
  assert.equal(course.canEnter("aula-b-r1-s1", { key: "anna", role: "participant" }), false, "turno chiuso");
  assert.equal(course.canEnter("aula-b-r1-s1", { key: "trainer", role: "editor" }), true, "il trainer riapre i turni chiusi");
  assert.equal(course.canEnter("aula-b-r2-s2", { key: "trainer", role: "editor" }), true);
  assert.equal(course.canEnter("altra-aula-r1-s1", { key: "trainer", role: "editor" }), false, "board non del corso");
  assert.equal(course.canEnter("aula-b-r9-s9", { key: "trainer", role: "editor" }), false, "stanza che non esiste");
});

test("whereIs: aula, stanza e board sconosciuta", () => {
  const { course } = setup("aula-c");
  assert.deepEqual(course.whereIs("aula-c"), { aula: "aula-c", round: null, n: null });
  assert.deepEqual(course.whereIs("aula-c-r2-s2"), { aula: "aula-c", round: 2, n: 2 });
  assert.deepEqual(course.whereIs("boh"), { aula: "aula-c", round: null, n: null });
});

test("presence: chi c'è in ogni board (solo chiave, nome e ruolo) e il turno aperto; nessuna email", () => {
  const { dataDir, course } = setup("aula-d");
  getRoom(dataDir, "aula-d").join(peer("trainer", "editor"));
  getRoom(dataDir, "aula-d").join(peer("sara", "participant"));
  getRoom(dataDir, "aula-d-r2-s1").join(peer("marco", "participant"));
  const p = course.presence();
  assert.deepEqual(p.rooms["aula-d"].map((x) => x.key).sort(), ["sara", "trainer"]);
  assert.deepEqual(p.rooms["aula-d-r2-s1"], [{ key: "marco", name: "MARCO", role: "participant" }]);
  assert.equal(p.current?.round, 2);
  assert.deepEqual(p.current?.rooms.map((r) => r.n), [1, 2]);
  assert.deepEqual(p.history.map((h) => [h.round, h.rooms.map((r) => [r.n, r.id])]), [[1, [[1, "aula-d-r1-s1"]]]], "i turni chiusi finiscono nello storico");
  assert.ok(!JSON.stringify(p).includes("@"), "nessuna email");
});

test("pushPresence: la ricevono solo i trainer di qualsiasi board del corso", () => {
  const { dataDir, course } = setup("aula-e");
  const tGot: any[] = [], t2Got: any[] = [], sGot: any[] = [];
  getRoom(dataDir, "aula-e").join(peer("trainer", "editor", tGot));
  getRoom(dataDir, "aula-e").join(peer("sara", "participant", sGot));
  getRoom(dataDir, "aula-e-r2-s2").join(peer("collega", "editor", t2Got));
  course.pushPresence();
  assert.equal(tGot.length, 1);
  assert.equal(tGot[0].t, "presence");
  assert.equal(t2Got.length, 1);
  assert.equal(sGot.length, 0);
});

test("Course: timer comune e broadcast a tutte le board caricate del corso", () => {
  const { dataDir, course } = setup("aula-f");
  const a: any[] = [], b: any[] = [];
  getRoom(dataDir, "aula-f").join(peer("x", "participant", a));
  getRoom(dataDir, "aula-f-r2-s1").join(peer("y", "participant", b));
  course.broadcast({ t: "prova" });
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.ok(course instanceof Course);
  assert.equal(course.timer.state.status, "idle");
});

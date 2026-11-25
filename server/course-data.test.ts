import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { assignedRoom, openRound, readCourse, readParent, writeCourse, writeParent, type CourseData } from "./course-data.ts";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "course-"));
const sample = (): CourseData => ({
  round: 2,
  rounds: [
    { round: 1, open: false, createdAt: 1, rooms: [{ n: 1, id: "a-r1-s1", members: [{ key: "u1", name: "Anna" }] }] },
    { round: 2, open: true, createdAt: 2, rooms: [{ n: 1, id: "a-r2-s1", members: [{ key: "u2", name: "Marco" }] }, { n: 2, id: "a-r2-s2", members: [{ key: "u3", name: "Giulia" }] }] },
  ],
});

test("readCourse: cartella vuota o file corrotto danno un corso vuoto", () => {
  const d = tmp();
  assert.deepEqual(readCourse(d), { round: 0, rounds: [] });
  fs.writeFileSync(path.join(d, "course.json"), "{non json");
  assert.deepEqual(readCourse(d), { round: 0, rounds: [] });
  fs.writeFileSync(path.join(d, "course.json"), JSON.stringify({ round: "x", rounds: [{ boh: 1 }] }));
  assert.deepEqual(readCourse(d), { round: 0, rounds: [] });
});

test("writeCourse/readCourse: giro completo, anche in cartelle da creare, senza file temporanei rimasti", () => {
  const d = path.join(tmp(), "nuova", "aula");
  writeCourse(d, sample());
  assert.deepEqual(readCourse(d), sample());
  assert.deepEqual(fs.readdirSync(d), ["course.json"]);
});

test("openRound e assignedRoom: solo il turno aperto conta", () => {
  const c = sample();
  assert.equal(openRound(c)?.round, 2);
  assert.equal(assignedRoom(c, "u2")?.id, "a-r2-s1");
  assert.equal(assignedRoom(c, "u3")?.id, "a-r2-s2");
  assert.equal(assignedRoom(c, "u1"), null, "u1 era nel turno 1, ormai chiuso");
  assert.equal(assignedRoom(c, "sconosciuto"), null);
  assert.equal(assignedRoom(c, "__proto__"), null);
  c.rounds[1].open = false;
  assert.equal(openRound(c), null);
  assert.equal(assignedRoom(c, "u2"), null);
  assert.equal(openRound({ round: 0, rounds: [] }), null);
});

test("readParent/writeParent: giro completo, null se manca o è malformato", () => {
  const d = tmp();
  assert.equal(readParent(d), null);
  writeParent(d, { aula: "isaqb-dic26", round: 2, n: 3 });
  assert.deepEqual(readParent(d), { aula: "isaqb-dic26", round: 2, n: 3 });
  for (const bad of ["{non json", JSON.stringify({ aula: 5, round: 1, n: 1 }), JSON.stringify({ aula: "a b", round: 1, n: 1 }), JSON.stringify({ aula: "a", round: 0, n: 1 }), JSON.stringify({ aula: "a", round: 1, n: 1.5 })]) {
    fs.writeFileSync(path.join(d, "parent.json"), bad);
    assert.equal(readParent(d), null, bad);
  }
});

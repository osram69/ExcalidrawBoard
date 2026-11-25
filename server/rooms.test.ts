// Test di integrazione di aula e stanze dal vivo (vero server, client WebSocket di prova).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { connect, tokenFor } from "./test-client.ts";
import { startServer, type TestServer } from "./test-server.ts";

const SECRET = "chiave-di-prova";
let srv: TestServer;

before(async () => {
  srv = await startServer({ BOARD_SECRET: SECRET });
});
after(() => srv?.stop());

const trainer = (room: string) => tokenFor(SECRET, room, "editor", "trainer", "Trainer");
const student = (room: string, uid: string, name = uid, exp?: number) => tokenFor(SECRET, room, "participant", uid, name, exp);
const peopleIn = (p: any, room: string) => (p.rooms[room] ?? []).map((x: any) => x.key).sort();

test("presenza: il trainer vede chi entra e chi esce; gli allievi non ricevono l'elenco", async () => {
  const aula = "pres1";
  const t = await connect(srv.url, aula, trainer(aula));
  assert.deepEqual(t.init.course, { aula, round: null, n: null });
  const a = await connect(srv.url, aula, student(aula, "anna", "Anna Rossi"));
  const p1 = await t.waitFor((m) => m.t === "presence" && peopleIn(m, aula).includes("anna"));
  assert.deepEqual(p1.rooms[aula].find((x: any) => x.key === "anna"), { key: "anna", name: "Anna Rossi", role: "participant" });
  assert.equal(p1.current, null);
  const m = await connect(srv.url, aula, student(aula, "marco"));
  await t.waitFor((x) => x.t === "presence" && peopleIn(x, aula).includes("marco"));
  await a.close();
  await t.waitFor((x) => x.t === "presence" && !peopleIn(x, aula).includes("anna") && peopleIn(x, aula).includes("marco"));
  assert.equal(m.msgs.some((x) => x.t === "presence"), false, "gli allievi non vedono l'elenco");
  assert.equal(JSON.stringify(t.msgs.filter((x) => x.t === "presence")).includes("@"), false, "nessuna email");
  await m.close();
  await t.close();
});

test("presenza: nessuna presenza per chi non è collegato all'aula e un corso non influenza un altro", async () => {
  const t1 = await connect(srv.url, "pres2", trainer("pres2"));
  const t2 = await connect(srv.url, "pres3", trainer("pres3"));
  const s = await connect(srv.url, "pres2", student("pres2", "luca"));
  await t1.waitFor((x) => x.t === "presence" && peopleIn(x, "pres2").includes("luca"));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(t2.msgs.filter((x) => x.t === "presence").every((x) => !peopleIn(x, "pres3").includes("luca")), true);
  await s.close();
  await t1.close();
  await t2.close();
});

// --- timer unico per corso ---
import { writeCourse, writeParent } from "./course-data.ts";
import { roomDir } from "./rooms.ts";

/** Prepara su disco un corso con un turno aperto, come lo lascerebbe "Crea stanze" (da fare prima del primo collegamento). */
function seedCourse(aula: string, members: Record<number, string[]>, open = true) {
  const rooms = Object.entries(members).map(([n, keys]) => ({ n: Number(n), id: `${aula}-r1-s${n}`, members: keys.map((key) => ({ key, name: key })) }));
  writeCourse(roomDir(srv.dataDir, aula), { round: 1, rounds: [{ round: 1, open, createdAt: 1, rooms }] });
  for (const r of rooms) writeParent(roomDir(srv.dataDir, r.id), { aula, round: 1, n: r.n });
  return rooms.map((r) => r.id);
}

test("timer: avviato dall'aula arriva alle stanze e viceversa; chi entra dopo trova lo stato", async () => {
  const aula = "tim1";
  const [s1, s2] = seedCourse(aula, { 1: ["anna"], 2: ["bruno"] });
  const t = await connect(srv.url, aula, trainer(aula));
  const sara = await connect(srv.url, aula, student(aula, "sara"));
  const anna = await connect(srv.url, s1, student(s1, "anna"));
  const bruno = await connect(srv.url, s2, student(s2, "bruno"));
  t.send({ t: "timer", action: "start", seconds: 60 });
  for (const c of [t, sara, anna, bruno]) {
    const m = await c.waitFor((x) => x.t === "timer");
    assert.equal(m.state.status, "running");
  }
  // il trainer, da una stanza, ferma tutto
  const t2 = await connect(srv.url, s1, trainer(s1));
  t2.send({ t: "timer", action: "reset" });
  for (const c of [t, sara, anna, bruno]) await c.waitFor((x) => x.t === "timer" && x.state.status === "idle");
  t.send({ t: "timer", action: "start", seconds: 120 });
  await bruno.waitFor((x) => x.t === "timer" && x.state.status === "running" && x.state.durationMs === 120_000);
  const late = await connect(srv.url, aula, student(aula, "tardi"));
  assert.equal(late.init.timer.state.status, "running");
  assert.equal(late.init.timer.state.durationMs, 120_000);
  for (const c of [t, t2, sara, anna, bruno, late]) await c.close();
});

test("timer: un allievo non lo controlla e un altro corso non lo riceve", async () => {
  const aula = "tim2";
  const [s1] = seedCourse(aula, { 1: ["anna"] });
  const t = await connect(srv.url, aula, trainer(aula));
  const anna = await connect(srv.url, s1, student(s1, "anna"));
  const altro = await connect(srv.url, "tim3", trainer("tim3"));
  anna.send({ t: "timer", action: "start", seconds: 60 });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(t.msgs.some((x) => x.t === "timer"), false);
  t.send({ t: "timer", action: "start", seconds: 60 });
  await anna.waitFor((x) => x.t === "timer");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(altro.msgs.some((x) => x.t === "timer"), false, "un altro corso non riceve il timer");
  for (const c of [t, anna, altro]) await c.close();
});

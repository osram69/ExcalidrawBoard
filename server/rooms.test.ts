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

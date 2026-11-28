// Gestione delle aule dal backend: firma, elenco, creazione, attivazione/disattivazione, eliminazione.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { WebSocket } from "ws";
import { signAdminCall, signToken, verifyAdminCall } from "./auth.ts";
import { startServer, type TestServer } from "./test-server.ts";

const SECRET = "chiave-di-prova";
let srv: TestServer;

before(async () => {
  srv = await startServer({ BOARD_SECRET: SECRET });
});
after(() => srv?.stop());

const call = (method: string, target: string, body?: unknown, sig = signAdminCall(SECRET, method, target)) =>
  fetch(`${srv.url}${target}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sig}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const list = async (): Promise<any[]> => ((await (await call("GET", "/auth/aule")).json()) as any).aule;
const login = (room: string, password = "dicembre-2026") =>
  fetch(`${srv.url}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ room, nome: "Anna", cognome: "Rossi", password }) });

test("firma: serve quella giusta, legata a metodo e indirizzo, e vale un minuto", async () => {
  assert.equal((await fetch(`${srv.url}/auth/aule`)).status, 401, "senza firma");
  assert.equal((await call("GET", "/auth/aule", undefined, "123.abc")).status, 401, "firma inventata");
  assert.equal((await call("GET", "/auth/aule", undefined, signAdminCall("altra-chiave", "GET", "/auth/aule"))).status, 401, "altra chiave");
  assert.equal((await call("DELETE", "/auth/aule?room=x", undefined, signAdminCall(SECRET, "GET", "/auth/aule?room=x"))).status, 401, "firma di un altro metodo");
  assert.equal((await call("DELETE", "/auth/aule?room=x", undefined, signAdminCall(SECRET, "DELETE", "/auth/aule?room=y"))).status, 401, "firma di un'altra aula");
  assert.equal((await call("GET", "/auth/aule", undefined, signAdminCall(SECRET, "GET", "/auth/aule", Date.now() - 120_000))).status, 401, "scaduta");
  assert.equal(verifyAdminCall(signAdminCall(SECRET, "get", "/x"), SECRET, "GET", "/x"), true);
  // il token di una board (anche editor) non è una firma di gestione
  const tok = signToken({ room: "aula", name: "T", uid: "t", role: "editor", exp: Date.now() + 3600e3 }, SECRET);
  assert.equal((await call("GET", "/auth/aule", undefined, tok)).status, 401);
});

test("crea, elenca, rifiuta nomi doppi o non validi", async () => {
  assert.equal((await call("POST", "/auth/aule", { name: "corso-a", password: "dicembre-2026" })).status, 200);
  assert.equal((await call("POST", "/auth/aule", { name: "corso-a", password: "dicembre-2026" })).status, 409);
  assert.equal((await call("POST", "/auth/aule", { name: "../fuori", password: "dicembre-2026" })).status, 400);
  assert.equal((await call("POST", "/auth/aule", { name: "senza-pw", password: "corta" })).status, 400);
  assert.equal((await call("POST", "/auth/aule", { name: "data-no", password: "dicembre-2026", until: "domani" })).status, 400);
  const a = (await list()).find((x) => x.name === "corso-a");
  assert.deepEqual([a.configured, a.active, a.until, a.password, a.online, a.stanze], [true, true, null, "dicembre-2026", 0, 0]);
  assert.equal((await login("corso-a")).status, 200, "la password creata funziona");
});

test("un'aula con la sola cartella (aperta dal trainer, senza password) compare come non configurata e non attiva", async () => {
  fs.mkdirSync(path.join(srv.dataDir, "rooms", "vuota"), { recursive: true });
  const a = (await list()).find((x) => x.name === "vuota");
  assert.deepEqual([a.configured, a.active, a.password], [false, false, null]);
  assert.equal((await call("PATCH", "/auth/aule?room=vuota", { until: null })).status, 400, "senza password non si attiva");
  assert.equal((await call("PATCH", "/auth/aule?room=vuota", { password: "dicembre-2026" })).status, 200);
  assert.equal((await list()).find((x) => x.name === "vuota").active, true);
});

test("disattiva e riattiva: il login si ferma e riparte, e gli allievi collegati vengono scollegati ma non i trainer", async () => {
  const room = "corso-b";
  await call("POST", "/auth/aule", { name: room, password: "dicembre-2026" });
  const open = async (role: "participant" | "editor") => {
    const t = signToken({ room, name: role, uid: role, role, exp: Date.now() + 3600e3 }, SECRET);
    const ws = new WebSocket(`${srv.url.replace("http", "ws")}/connect/${room}?t=${t}`);
    await new Promise((r, j) => (ws.once("open", r), ws.once("error", j)));
    return ws;
  };
  const allievo = await open("participant");
  const trainer = await open("editor");
  const closed = new Promise<number>((r) => allievo.once("close", (code) => r(code)));
  assert.equal((await call("PATCH", `/auth/aule?room=${room}`, { until: Date.now() - 1000 })).status, 200);
  assert.equal(await closed, 4001, "l'allievo viene scollegato come per una sessione scaduta");
  assert.equal(trainer.readyState, WebSocket.OPEN, "il trainer resta");
  trainer.close();
  assert.equal((await list()).find((x) => x.name === room).active, false);
  assert.equal((await login(room)).status, 403, "con la sessione terminata non si entra");
  assert.equal((await call("PATCH", `/auth/aule?room=${room}`, { until: null })).status, 200);
  assert.equal((await login(room)).status, 200, "riattivata");
  assert.equal((await call("PATCH", "/auth/aule?room=non-esiste", { until: null })).status, 404);
  assert.equal((await call("PATCH", `/auth/aule?room=${room}`, {})).status, 400);
});

test("elimina l'aula con le sue stanze, anche se qualcuno è collegato, e non tocca le altre", async () => {
  await call("POST", "/auth/aule", { name: "corso-c", password: "dicembre-2026" });
  await call("POST", "/auth/aule", { name: "corso-d", password: "dicembre-2026" });
  const rooms = path.join(srv.dataDir, "rooms");
  // una stanza di lavoro di corso-c, come la crea "Stanze"
  fs.mkdirSync(path.join(rooms, "corso-c-t1-s1"), { recursive: true });
  fs.writeFileSync(path.join(rooms, "corso-c-t1-s1", "parent.json"), JSON.stringify({ aula: "corso-c", round: 1, n: 1 }));
  assert.ok(!(await list()).some((x) => x.name === "corso-c-t1-s1"), "le stanze non sono aule");
  const t = signToken({ room: "corso-c", name: "T", uid: "t", role: "editor", exp: Date.now() + 3600e3 }, SECRET);
  const ws = new WebSocket(`${srv.url.replace("http", "ws")}/connect/corso-c?t=${t}`);
  await new Promise((r, j) => (ws.once("open", r), ws.once("error", j)));
  const closed = new Promise<number>((r) => ws.once("close", (code) => r(code)));
  assert.equal((await call("DELETE", "/auth/aule?room=corso-c")).status, 200);
  assert.equal(await closed, 4003);
  await new Promise((r) => setTimeout(r, 1500)); // un salvataggio in ritardo non deve ricreare la cartella
  assert.ok(!fs.existsSync(path.join(rooms, "corso-c")));
  assert.ok(!fs.existsSync(path.join(rooms, "corso-c-t1-s1")));
  assert.ok(fs.existsSync(path.join(rooms, "corso-d")));
  assert.equal((await login("corso-c")).status, 401);
  assert.equal((await call("DELETE", "/auth/aule?room=corso-c")).status, 404);
  assert.equal((await call("DELETE", "/auth/aule?room=corso-c-t1-s1")).status, 404, "una stanza non si elimina da sola");
  assert.equal((await call("DELETE", "/auth/aule?room=..")).status, 404);
});

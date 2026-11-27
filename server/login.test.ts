// Test di integrazione dell'accesso con password di sessione: /auth/login, /auth/access, /auth/check e la scadenza.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { WebSocket } from "ws";
import { inspectToken, personalUid, signToken, type TokenPayload } from "./auth.ts";
import { startServer, type TestServer } from "./test-server.ts";

const SECRET = "chiave-di-prova";
let srv: TestServer;

before(async () => {
  srv = await startServer({ BOARD_SECRET: SECRET, LOGIN_TOKEN_HOURS: "12", LOGIN_REMEMBER_DAYS: "7" });
});
after(() => srv?.stop());

const tok = (room: string, role: TokenPayload["role"] = "editor", o: Partial<TokenPayload> = {}) =>
  signToken({ room, name: "Trainer", uid: "trainer", role, exp: Date.now() + 3600e3, ...o }, SECRET);
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${srv.url}${url}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const setAccess = (room: string, body: unknown, token: string | undefined = tok(room)) =>
  fetch(`${srv.url}/auth/access?room=${encodeURIComponent(room)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
const login = (room: string, o: Record<string, unknown> = {}) =>
  post("/auth/login", { room, nome: "Anna", cognome: "Rossi", email: "Anna.Rossi@Esempio.it", password: "dicembre-2026", ...o });
const check = (room: string, token?: string) => fetch(`${srv.url}/auth/check?room=${encodeURIComponent(room)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

test("/auth/access: solo il trainer (editor) della stessa board imposta la password", async () => {
  const room = "acc1";
  assert.equal((await setAccess(room, { password: "dicembre-2026" })).status, 200);
  assert.equal((await setAccess(room, { password: "dicembre-2026" }, tok(room, "participant"))).status, 403);
  assert.equal((await setAccess(room, { password: "dicembre-2026" }, tok(room, "viewer"))).status, 403);
  assert.equal((await setAccess(room, { password: "dicembre-2026" }, tok("altra"))).status, 401);
  assert.equal((await setAccess(room, { password: "dicembre-2026" }, tok(room, "editor", { exp: Date.now() - 1000 }))).status, 401);
  assert.equal((await setAccess(room, { password: "dicembre-2026" }, "")).status, 401);
  assert.equal((await setAccess(room, { password: "corta" })).status, 400);
  assert.equal((await setAccess(room, {})).status, 400);
  assert.equal((await setAccess(room, { until: "domani" })).status, 400);
  assert.equal((await setAccess("nuova-senza-password", { until: Date.now() + 1000 })).status, 400, "senza password esistente serve la password");
  assert.equal((await fetch(`${srv.url}/auth/access?room=${room}`, { method: "DELETE" })).status, 405);
  assert.equal((await setAccess(room, { password: "a".repeat(10_000) })).status, 413);
});

test("/auth/access: la password resta salvata (anche in chiaro, per rivederla) e aggiornare solo la data la conserva", async () => {
  const room = "acc2";
  assert.equal((await setAccess(room, { password: "dicembre-2026", until: null })).status, 200);
  const file = path.join(srv.dataDir, "rooms", room, "access.json");
  const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(onDisk.password, "dicembre-2026");
  assert.ok(String(onDisk.passwordHash).startsWith("scrypt$"), "il login usa comunque l'impronta");
  assert.equal((await setAccess(room, { until: Date.now() + 3600e3 })).status, 200);
  assert.equal((await login(room)).status, 200, "la password deve restare valida");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).password, "dicembre-2026", "cambiando solo la data la password resta");
});

test("GET /auth/access: solo il trainer rilegge password e fine sessione", async () => {
  const room = "acc3";
  const get = (token?: string) => fetch(`${srv.url}/auth/access?room=${room}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const empty: any = await (await get(tok(room))).json();
  assert.deepEqual([empty.configured, empty.password, empty.until], [false, null, null]);
  const until = Date.now() + 3600e3;
  await setAccess(room, { password: "dicembre-2026", until });
  const j: any = await (await get(tok(room))).json();
  assert.deepEqual([j.ok, j.configured, j.password, j.until], [true, true, "dicembre-2026", until]);
  assert.equal((await get()).status, 401);
  assert.equal((await get(tok(room, "participant"))).status, 403);
  assert.equal((await get(tok(room, "viewer"))).status, 403);
  assert.equal((await get(tok("altra"))).status, 401);
  assert.equal((await get(tok(room))).headers.get("cache-control"), "no-store");
});

test("/auth/login: token personale con nome, mail e uid derivato", async () => {
  const room = "log1";
  await setAccess(room, { password: "dicembre-2026" });
  const r = await login(room);
  assert.equal(r.status, 200);
  const j: any = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.name, "Anna Rossi");
  const c = inspectToken(j.token, room, SECRET);
  assert.equal(c.ok, true);
  if (!c.ok) return;
  assert.equal(c.payload.role, "participant");
  assert.equal(c.payload.email, "anna.rossi@esempio.it");
  assert.equal(c.payload.uid, personalUid("anna.rossi@esempio.it", SECRET));
  assert.ok(Math.abs(c.payload.exp - (Date.now() + 12 * 3600e3)) < 10_000);
  assert.equal(j.exp, c.payload.exp);
});

test("/auth/login: ricordami allunga l'accesso, la data di fine lo limita", async () => {
  const room = "log2";
  await setAccess(room, { password: "dicembre-2026" });
  const long: any = await (await login(room, { ricordami: true })).json();
  assert.ok(Math.abs(long.exp - (Date.now() + 7 * 86400e3)) < 10_000);
  const until = Date.now() + 2 * 3600e3;
  await setAccess(room, { until });
  assert.equal(((await (await login(room)).json()) as any).exp, until);
  assert.equal(((await (await login(room, { ricordami: true })).json()) as any).exp, until);
});

test("/auth/login: password sbagliata e accesso non attivo danno lo stesso errore", async () => {
  const room = "log3";
  await setAccess(room, { password: "dicembre-2026" });
  const wrong = await login(room, { password: "sbagliata-123" });
  const none = await login("board-senza-accesso");
  for (const r of [wrong, none]) {
    assert.equal(r.status, 401);
    assert.equal(((await r.json()) as any).ok, false);
  }
  assert.equal(((await (await login(room, { password: "x" })).json()) as any).motivo, ((await (await login("board-senza-accesso")).json()) as any).motivo);
});

test("/auth/login: dopo la fine della sessione entra nessuno (e la password sbagliata resta 401)", async () => {
  const room = "log4";
  await setAccess(room, { password: "dicembre-2026", until: Date.now() - 1000 });
  const ended = await login(room);
  assert.equal(ended.status, 403);
  assert.match(((await ended.json()) as any).motivo, /terminata/i);
  assert.equal((await login(room, { password: "sbagliata-123" })).status, 401);
});

test("/auth/login: dati non validi, corpo non JSON o troppo grande, metodo sbagliato", async () => {
  const room = "log5";
  await setAccess(room, { password: "dicembre-2026" });
  for (const o of [{ nome: "" }, { cognome: "" }, { email: "no" }, { password: "" }, { room: "con spazi" }]) {
    assert.equal((await login(room, o)).status, 400, JSON.stringify(o));
  }
  assert.equal((await post("/auth/login", "non json")).status, 400);
  assert.equal((await post("/auth/login", { room, nome: "A".repeat(10_000) })).status, 413);
  assert.equal((await fetch(`${srv.url}/auth/login`)).status, 405);
});

test("/auth/login: dopo 10 password errate arriva 429, anche con la password giusta; le altre board no", async () => {
  const room = "log6";
  await setAccess(room, { password: "dicembre-2026" });
  await setAccess("log6-altra", { password: "dicembre-2026" });
  for (let i = 0; i < 10; i++) assert.equal((await login(room, { password: `sbagliata-${i}` })).status, 401);
  const blocked = await login(room);
  assert.equal(blocked.status, 429);
  assert.match(((await blocked.json()) as any).motivo, /troppi tentativi/i);
  assert.equal((await login("log6-altra")).status, 200);
});

test("il token ottenuto con il login è accettato dal WebSocket e porta nome e uid personali", async () => {
  const room = "log7";
  await setAccess(room, { password: "dicembre-2026" });
  const j: any = await (await login(room)).json();
  const ws = new WebSocket(`${srv.url.replace("http", "ws")}/connect/${room}?t=${encodeURIComponent(j.token)}`);
  const init: any = await new Promise((resolve, reject) => {
    ws.on("message", (d) => {
      const m = JSON.parse(d.toString());
      if (m.t === "init") resolve(m);
    });
    ws.on("error", reject);
    setTimeout(() => reject(new Error("niente init")), 4000);
  });
  assert.equal(init.me.name, "Anna Rossi");
  assert.equal(init.me.role, "participant");
  assert.equal(init.me.key, personalUid("anna.rossi@esempio.it", SECRET));
  ws.close();
});

test("/auth/check: valido, scaduto, altra board, firma sbagliata, senza token", async () => {
  const room = "chk1";
  const ok = await check(room, tok(room, "participant"));
  assert.equal(ok.status, 200);
  const j: any = await ok.json();
  assert.deepEqual({ ok: j.ok, role: j.role, name: j.name }, { ok: true, role: "participant", name: "Trainer" });
  const cases: [Promise<Response>, string][] = [
    [check(room, tok(room, "participant", { exp: Date.now() - 1000 })), "scaduto"],
    [check("altra", tok(room)), "altra board"],
    [check(room, tok(room) + "x"), "non valido"],
    [check(room), "non valido"],
    [check("board con spazi", tok(room)), "non valido"],
  ];
  for (const [p, motivo] of cases) {
    const r = await p;
    assert.equal(r.status, 401, motivo);
    assert.deepEqual(await r.json(), { ok: false, motivo });
  }
  assert.equal((await fetch(`${srv.url}/auth/check?room=${room}&t=${encodeURIComponent(tok(room))}`)).status, 401, "il token nell'indirizzo non vale");
});

test("il server chiude il collegamento con codice 4001 alla scadenza del token", async () => {
  const room = "scad1";
  const ws = new WebSocket(`${srv.url.replace("http", "ws")}/connect/${room}?t=${encodeURIComponent(tok(room, "participant", { exp: Date.now() + 1500 }))}`);
  const closed = await new Promise<{ code: number; reason: string; ms: number }>((resolve, reject) => {
    const t0 = Date.now();
    ws.on("close", (code, reason) => resolve({ code, reason: reason.toString(), ms: Date.now() - t0 }));
    ws.on("error", reject);
    setTimeout(() => reject(new Error("il server non ha chiuso il collegamento")), 6000);
  });
  assert.equal(closed.code, 4001);
  assert.equal(closed.reason, "scaduto");
  assert.ok(closed.ms >= 1000 && closed.ms < 4000, `chiuso dopo ${closed.ms} ms`);
});

test("un token valido a lungo non viene chiuso", async () => {
  const room = "scad2";
  const ws = new WebSocket(`${srv.url.replace("http", "ws")}/connect/${room}?t=${encodeURIComponent(tok(room))}`);
  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => resolve());
    ws.on("error", reject);
  });
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(ws.readyState, WebSocket.OPEN);
  ws.close();
});

const loginAs = (room: string, email: string, password: string) => login(room, { email, password });

test("una classe dietro la stessa rete: 10 allievi sbagliano una volta, l'undicesimo con la password giusta entra", async () => {
  const room = "nat1";
  await setAccess(room, { password: "dicembre-2026" });
  for (let i = 0; i < 10; i++) assert.equal((await loginAs(room, `allievo${i}@esempio.it`, "sbagliata-123")).status, 401);
  assert.equal((await loginAs(room, "undicesimo@esempio.it", "dicembre-2026")).status, 200);
});

test("lo stesso indirizzo email dopo 10 errori è bloccato, un'altra mail no", async () => {
  const room = "nat2";
  await setAccess(room, { password: "dicembre-2026" });
  for (let i = 0; i < 10; i++) assert.equal((await loginAs(room, "bersaglio@esempio.it", `sbagliata-${i}`)).status, 401);
  assert.equal((await loginAs(room, "bersaglio@esempio.it", "dicembre-2026")).status, 429);
  assert.equal((await loginAs(room, "altra@esempio.it", "dicembre-2026")).status, 200);
});

test("board senza accesso configurato: sempre 401, mai 429 (nessun contatore da riempire)", async () => {
  for (let i = 0; i < 15; i++) assert.equal((await loginAs("mai-configurata", `x${i}@esempio.it`, "qualsiasi-123")).status, 401);
});

test("mentre arrivano molti login il server resta reattivo (la verifica non blocca il ciclo degli eventi)", async () => {
  const room = "carico1";
  await setAccess(room, { password: "dicembre-2026" });
  const flood = Array.from({ length: 12 }, (_, i) => loginAs(room, `carico${i}@esempio.it`, "sbagliata-123"));
  let worst = 0;
  for (let i = 0; i < 6; i++) {
    const t0 = Date.now();
    await fetch(`${srv.url}/health`);
    worst = Math.max(worst, Date.now() - t0);
    await new Promise((r) => setTimeout(r, 40));
  }
  const res = await Promise.all(flood);
  assert.ok(res.every((r) => [401, 429, 503].includes(r.status)), res.map((r) => r.status).join(","));
  assert.ok(worst < 250, `il server ha risposto a /health dopo ${worst} ms`);
});

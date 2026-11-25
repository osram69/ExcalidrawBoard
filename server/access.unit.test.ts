import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AttemptLimiter, ConcurrencyGate, hashPassword, normalizeIp, parseLoginBody, passwordOk, readAccess, sessionExp, verifyPassword, writeAccess } from "./access.ts";

test("hashPassword/verifyPassword: giro completo, sale diverso, nessun testo in chiaro", async () => {
  const h = hashPassword("dicembre-2026");
  assert.match(h, /^scrypt\$[\w-]+\$[\w-]+$/);
  assert.ok(!h.includes("dicembre"));
  assert.equal(await verifyPassword("dicembre-2026", h), true);
  assert.equal(await verifyPassword("Dicembre-2026", h), false);
  assert.equal(await verifyPassword("", h), false);
  assert.notEqual(hashPassword("dicembre-2026"), h);
});

test("verifyPassword: valori memorizzati malformati valgono sempre falso", async () => {
  for (const bad of ["", "x", "scrypt$", "scrypt$a", "md5$a$b", "scrypt$", undefined as any, null as any]) assert.equal(await verifyPassword("qualsiasi", bad), false, String(bad));
});

test("passwordOk: da 8 a 200 caratteri", () => {
  assert.equal(passwordOk("1234567"), false);
  assert.equal(passwordOk("12345678"), true);
  assert.equal(passwordOk("a".repeat(200)), true);
  assert.equal(passwordOk("a".repeat(201)), false);
  assert.equal(passwordOk(12345678), false);
  assert.equal(passwordOk(undefined), false);
});

test("readAccess/writeAccess: scrittura atomica, lettura, file mancante o corrotto", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "access-"));
  assert.equal(readAccess(dir), null);
  const a = { passwordHash: hashPassword("dicembre-2026"), until: 1893456000000 };
  writeAccess(path.join(dir, "sotto", "cartella"), a); // crea le cartelle
  assert.deepEqual(readAccess(path.join(dir, "sotto", "cartella")), a);
  assert.ok(!fs.readFileSync(path.join(dir, "sotto", "cartella", "access.json"), "utf8").includes("dicembre-2026"));
  writeAccess(dir, { passwordHash: a.passwordHash, until: null });
  assert.equal(readAccess(dir)?.until, null);
  fs.writeFileSync(path.join(dir, "access.json"), "{non json");
  assert.equal(readAccess(dir), null);
  fs.writeFileSync(path.join(dir, "access.json"), JSON.stringify({ passwordHash: 5, until: "domani" }));
  assert.equal(readAccess(dir), null);
});

test("AttemptLimiter: 10 errori in 10 minuti bloccano, poi si sblocca; le chiavi sono indipendenti", () => {
  let t = 1_000_000;
  const l = new AttemptLimiter(10, 600_000, () => t);
  for (let i = 0; i < 9; i++) l.fail("a");
  assert.equal(l.blocked("a"), false);
  l.fail("a");
  assert.equal(l.blocked("a"), true);
  assert.equal(l.blocked("b"), false);
  t += 599_000;
  assert.equal(l.blocked("a"), true);
  t += 2_000;
  assert.equal(l.blocked("a"), false);
  for (let i = 0; i < 10; i++) l.fail("c");
  l.clear("c");
  assert.equal(l.blocked("c"), false);
});

test("sessionExp: durata normale, ricordami, tetto della data di fine", () => {
  const now = 1_800_000_000_000;
  assert.equal(sessionExp(now, null, false, 12, 7), now + 12 * 3600e3);
  assert.equal(sessionExp(now, null, true, 12, 7), now + 7 * 86400e3);
  assert.equal(sessionExp(now, now + 3600e3, false, 12, 7), now + 3600e3);
  assert.equal(sessionExp(now, now + 3 * 86400e3, true, 12, 7), now + 3 * 86400e3);
  assert.equal(sessionExp(now, now + 30 * 86400e3, true, 12, 7), now + 7 * 86400e3);
});

test("parseLoginBody: dati validi puliti, errori con messaggio", () => {
  const ok: any = parseLoginBody({ room: "corso-g1", nome: "  Anna ", cognome: " Rossi", email: " Anna.Rossi@Esempio.it ", password: "dicembre-2026", ricordami: true });
  assert.equal(ok.ok, true);
  assert.deepEqual({ ...ok }, { ok: true, room: "corso-g1", name: "Anna Rossi", email: "anna.rossi@esempio.it", password: "dicembre-2026", ricordami: true });
  assert.equal((parseLoginBody({ room: "corso-g1", nome: "A", cognome: "B", email: "a@esempio.it", password: "x" }) as any).ricordami, false);
  assert.equal((parseLoginBody({ room: "corso-g1", nome: "A", cognome: "B", email: "a@esempio.it", password: "x", ricordami: "si" }) as any).ricordami, false);
  const base = { room: "corso-g1", nome: "Anna", cognome: "Rossi", email: "a@esempio.it", password: "dicembre-2026" };
  for (const bad of [
    null, "testo", [], {}, { ...base, room: "board con spazi" }, { ...base, room: 5 }, { ...base, nome: "" }, { ...base, nome: "   " }, { ...base, cognome: "" },
    { ...base, nome: "a".repeat(41) }, { ...base, cognome: "a".repeat(41) }, { ...base, email: "anna" }, { ...base, email: 3 }, { ...base, password: "" }, { ...base, password: "a".repeat(201) }, { ...base, password: 12 },
  ]) {
    const r: any = parseLoginBody(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal(r.status, 400);
    assert.ok(typeof r.motivo === "string" && r.motivo.length > 0);
  }
});

test("AttemptLimiter: refund toglie un tentativo (un accesso riuscito non pesa)", () => {
  const l = new AttemptLimiter(3, 600_000, () => 1);
  l.fail("a");
  l.fail("a");
  l.fail("a");
  assert.equal(l.blocked("a"), true);
  l.refund("a");
  assert.equal(l.blocked("a"), false);
  l.refund("a");
  l.refund("a");
  l.refund("a"); // mai sotto zero
  assert.equal(l.size, 0);
});

test("AttemptLimiter: con troppe chiavi si eliminano prima le scadute; un blocco ancora attivo non si perde", () => {
  let t = 1_000_000;
  const l = new AttemptLimiter(10, 600_000, () => t, 100);
  for (let i = 0; i < 100; i++) l.fail("vecchia-" + i);
  t += 700_000; // le vecchie sono scadute
  for (let i = 0; i < 10; i++) l.fail("vittima");
  for (let i = 0; i < 90; i++) l.fail("recente-" + i);
  assert.equal(l.blocked("vittima"), true);
  for (let i = 0; i < 50; i++) l.fail("altra-" + i); // oltre il tetto: via le scadute, non tutto
  assert.equal(l.blocked("vittima"), true, "il blocco attivo non deve sparire");
  assert.ok(l.size <= 150, "dimensione " + l.size);
});

test("normalizeIp: IPv4 invariato, IPv4-mappato ridotto, IPv6 ridotto al prefisso /64", () => {
  assert.equal(normalizeIp("203.0.113.7"), "203.0.113.7");
  assert.equal(normalizeIp("::ffff:203.0.113.7"), "203.0.113.7");
  assert.equal(normalizeIp("2001:db8:1:2:aaaa:bbbb:cccc:dddd"), normalizeIp("2001:db8:1:2::1"));
  assert.equal(normalizeIp("2001:db8:1:2:aaaa:bbbb:cccc:dddd"), "v6:2001:0db8:0001:0002");
  assert.notEqual(normalizeIp("2001:db8:1:2::1"), normalizeIp("2001:db8:1:3::1"));
  assert.equal(normalizeIp("::1"), "v6:0000:0000:0000:0000");
  assert.equal(normalizeIp("?"), "?");
});

test("ConcurrencyGate: al massimo N in corso, poi si libera", () => {
  const g = new ConcurrencyGate(2);
  assert.equal(g.tryEnter(), true);
  assert.equal(g.tryEnter(), true);
  assert.equal(g.tryEnter(), false);
  g.leave();
  assert.equal(g.tryEnter(), true);
  g.leave();
  g.leave();
  g.leave(); // mai sotto zero
  assert.equal(g.tryEnter(), true);
});

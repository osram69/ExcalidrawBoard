import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectToken, parseLoginUrl, signToken, verifyToken, type TokenPayload } from "./auth.ts";

const SECRET = "chiave-di-prova";
const NOW = 1_800_000_000_000;
const payload = (o: Partial<TokenPayload> = {}): TokenPayload => ({ room: "isaqb-dic26-g1", name: "Anna Rossi", uid: "anna.rossi", role: "participant", exp: NOW + 3600e3, ...o });
const tok = (o: Partial<TokenPayload> = {}) => signToken(payload(o), SECRET);

// Vettore di prova del documento per il backend (docs/accesso-cube-academy.md): se cambia, va aggiornato anche il documento.
test("vettore di prova: segreto, payload e token attesi", () => {
  const p: TokenPayload = { room: "isaqb-dic26-g1", name: "Anna Rossi", uid: "anna.rossi", role: "participant", exp: 1893456000000 };
  assert.equal(
    signToken(p, SECRET),
    "eyJyb29tIjoiaXNhcWItZGljMjYtZzEiLCJuYW1lIjoiQW5uYSBSb3NzaSIsInVpZCI6ImFubmEucm9zc2kiLCJyb2xlIjoicGFydGljaXBhbnQiLCJleHAiOjE4OTM0NTYwMDAwMDB9.e6S18FHm4oRBhVag60cUHNny6l_WMirIcfwp7Ac97l8",
  );
});

test("inspectToken: token valido", () => {
  const r = inspectToken(tok(), "isaqb-dic26-g1", SECRET, NOW);
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.payload, { room: "isaqb-dic26-g1", name: "Anna Rossi", uid: "anna.rossi", role: "participant", exp: NOW + 3600e3 });
});

test("inspectToken: scaduto, altra board, non valido", () => {
  assert.deepEqual(inspectToken(tok({ exp: NOW - 1 }), "isaqb-dic26-g1", SECRET, NOW), { ok: false, motivo: "scaduto" });
  assert.deepEqual(inspectToken(tok({ exp: NOW }), "isaqb-dic26-g1", SECRET, NOW), { ok: false, motivo: "scaduto" });
  assert.deepEqual(inspectToken(tok(), "isaqb-dic26-g2", SECRET, NOW), { ok: false, motivo: "altra board" });
  const [body, sig] = tok().split(".");
  const forged = Buffer.from(JSON.stringify({ ...payload(), role: "editor" })).toString("base64url");
  for (const bad of [`${forged}.${sig}`, `${body}.AAAA`, "", "x", "a.b.c", `${body}`, undefined, null]) {
    assert.deepEqual(inspectToken(bad as string, "isaqb-dic26-g1", SECRET, NOW), { ok: false, motivo: "non valido" }, String(bad));
  }
  assert.deepEqual(inspectToken(tok(), "isaqb-dic26-g1", "altro-segreto", NOW), { ok: false, motivo: "non valido" });
});

test("inspectToken: campi non validi nel token firmato", () => {
  for (const o of [{ role: "boss" as any }, { exp: "domani" as any }, { room: "board con spazi" }]) {
    assert.equal(inspectToken(tok(o), String(o.room ?? "isaqb-dic26-g1"), SECRET, NOW).ok, false, JSON.stringify(o));
  }
});

test("verifyToken: valido finché non scade (ora reale)", () => {
  const future = signToken(payload({ exp: Date.now() + 60_000 }), SECRET);
  assert.equal(verifyToken(future, SECRET)?.name, "Anna Rossi");
  assert.equal(verifyToken(signToken(payload({ exp: Date.now() - 1 }), SECRET), SECRET), null);
  assert.equal(verifyToken(future, "altro"), null);
});

test("parseLoginUrl: solo indirizzi http(s) completi", () => {
  assert.equal(parseLoginUrl(undefined), null);
  assert.equal(parseLoginUrl(""), null);
  assert.equal(parseLoginUrl("   "), null);
  assert.equal(parseLoginUrl("cubeacademy.eu/materiali/board"), null);
  assert.equal(parseLoginUrl("ftp://x.org"), null);
  assert.equal(parseLoginUrl("javascript:alert(1)"), null);
  assert.equal(parseLoginUrl("  https://cubeacademy.eu/materiali/board  "), "https://cubeacademy.eu/materiali/board");
  assert.equal(parseLoginUrl("http://localhost:4000/login?x=1"), "http://localhost:4000/login?x=1");
});

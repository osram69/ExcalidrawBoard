import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { inspectToken, normalizeEmail, personalUid, signToken, verifyToken, type TokenPayload } from "./auth.ts";

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

test("normalizeEmail: minuscola, senza spazi, solo indirizzi plausibili", () => {
  assert.equal(normalizeEmail("  Anna.Rossi@Esempio.IT "), "anna.rossi@esempio.it");
  for (const bad of ["", "anna", "anna@", "@esempio.it", "anna@esempio", "a b@esempio.it", "anna@@esempio.it", 42, null, undefined, "a".repeat(120) + "@esempio.it"]) {
    assert.equal(normalizeEmail(bad), null, String(bad));
  }
});

test("personalUid: stabile, valido per il server, senza mostrare la mail e non calcolabile senza il segreto", () => {
  const a = personalUid("anna.rossi@esempio.it", SECRET);
  assert.equal(a, personalUid("anna.rossi@esempio.it", SECRET));
  assert.notEqual(a, personalUid("marco.bianchi@esempio.it", SECRET));
  assert.notEqual(a, personalUid("anna.rossi@esempio.it", "altro-segreto"));
  assert.match(a, /^u-[0-9a-f]{20}$/);
  assert.ok(!a.includes("anna"));
  // l'impronta semplice (SHA-256 della mail), che chiunque potrebbe calcolare, NON deve coincidere
  assert.notEqual(a, "u-" + createHash("sha256").update("anna.rossi@esempio.it").digest("hex").slice(0, 20));
});

test("l'email firmata nel token viene letta; un'email non valida viene scartata", () => {
  const withMail = inspectToken(signToken({ ...payload(), email: "anna@esempio.it" }, SECRET), "isaqb-dic26-g1", SECRET, NOW);
  assert.equal(withMail.ok && withMail.payload.email, "anna@esempio.it");
  const bad = inspectToken(signToken({ ...payload(), email: "non-una-mail" }, SECRET), "isaqb-dic26-g1", SECRET, NOW);
  assert.equal(bad.ok && "email" in bad.payload, false);
});

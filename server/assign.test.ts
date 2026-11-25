import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_ASSIGN, MAX_AULA, randomAssign, roomId, validateAssign } from "./assign.ts";

const allowed = (...k: string[]) => new Set(k);

test("roomId: <aula>-r<turno>-s<n>", () => {
  assert.equal(roomId("isaqb-dic26", 2, 3), "isaqb-dic26-r2-s3");
  assert.equal(MAX_AULA, 50);
  // il nome più lungo ammesso per l'aula resta entro i 64 caratteri di una board
  assert.ok(roomId("a".repeat(MAX_AULA), 99, 12).length <= 64);
});

test("validateAssign: assegnazione valida", () => {
  const r = validateAssign(3, { u1: 1, u2: 3, u3: 2 }, allowed("u1", "u2", "u3"));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.rooms, 3);
  assert.deepEqual([...r.assign.entries()], [["u1", 1], ["u2", 3], ["u3", 2]]);
});

test("validateAssign: numero di stanze non valido", () => {
  for (const rooms of [1, 13, 0, -2, 2.5, "3", null, undefined, NaN]) {
    const r = validateAssign(rooms, { u1: 1 }, allowed("u1"));
    assert.equal(r.ok, false, String(rooms));
    if (!r.ok) assert.ok(r.motivo.length > 0);
  }
});

test("validateAssign: chiavi e valori non validi", () => {
  const ok = allowed("u1", "u2");
  for (const assign of [
    { u1: 1, sconosciuto: 2 }, // non collegato
    { u1: 0 }, { u1: 4 }, { u1: "1" }, { u1: 1.5 }, { u1: null }, { u1: [1] },
    null, [], "testo", 5, undefined,
    {}, // nessuna persona
  ]) {
    const r = validateAssign(3, assign, ok);
    assert.equal(r.ok, false, JSON.stringify(assign));
    if (!r.ok) assert.ok(r.motivo.length > 0);
  }
});

test("validateAssign: __proto__ come chiave è una chiave come le altre (rifiutata se non collegata, accettata senza danni se collegata)", () => {
  const evil = JSON.parse('{"__proto__": 1}');
  assert.equal(validateAssign(2, evil, allowed("u1")).ok, false);
  const r = validateAssign(2, evil, allowed("__proto__"));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.assign.get("__proto__"), 1);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("validateAssign: al massimo 200 assegnazioni", () => {
  const keys = Array.from({ length: MAX_ASSIGN + 1 }, (_, i) => `u${i}`);
  const assign = Object.fromEntries(keys.map((k) => [k, 1]));
  assert.equal(validateAssign(2, assign, new Set(keys)).ok, false);
  const fewer = Object.fromEntries(keys.slice(0, MAX_ASSIGN).map((k) => [k, 1]));
  assert.equal(validateAssign(2, fewer, new Set(keys)).ok, true);
});

test("randomAssign: distribuzione equilibrata, completa e deterministica con un generatore fisso", () => {
  const keys = ["a", "b", "c", "d", "e", "f", "g"];
  const r = randomAssign(keys, 3, () => 0.3);
  assert.deepEqual(Object.keys(r).sort(), keys);
  const counts = [0, 0, 0, 0];
  for (const k of keys) {
    assert.ok(r[k] >= 1 && r[k] <= 3, `${k}: ${r[k]}`);
    counts[r[k]]++;
  }
  assert.deepEqual(counts.slice(1).sort(), [2, 2, 3]);
  assert.deepEqual(randomAssign(keys, 3, () => 0.3), r);
  const other = randomAssign(keys, 3, () => 0.9);
  assert.deepEqual(Object.keys(other).sort(), keys);
});

test("randomAssign: più stanze che persone, e chiave __proto__", () => {
  const r = randomAssign(["a", "b"], 5, () => 0.5);
  assert.equal(Object.keys(r).length, 2);
  const p = randomAssign(["__proto__", "x"], 2, () => 0.5);
  assert.ok(Object.keys(p).includes("__proto__"));
  assert.equal(Object.getPrototypeOf(p), null);
  assert.equal(Object.keys(randomAssign([], 3)).length, 0);
});

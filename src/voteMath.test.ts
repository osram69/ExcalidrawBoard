import assert from "node:assert/strict";
import { test } from "node:test";
import { countOf } from "./voteMath.ts";

test("countOf legge solo proprietà proprie: '__proto__' e simili valgono 0", () => {
  const rec: Record<string, number> = { n1: 2 };
  assert.equal(countOf(rec, "n1"), 2);
  assert.equal(countOf(rec, "altro"), 0);
  for (const k of ["__proto__", "constructor", "toString", "hasOwnProperty"]) assert.equal(countOf(rec, k), 0, k);
});

test("countOf con una chiave '__proto__' propria (da JSON) la legge", () => {
  const rec = JSON.parse('{"__proto__": 3}') as Record<string, number>;
  assert.equal(countOf(rec, "__proto__"), 3);
});

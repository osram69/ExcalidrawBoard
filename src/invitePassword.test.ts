import assert from "node:assert/strict";
import { test } from "node:test";
import { generatePassword } from "./invitePassword.ts";

test("la password generata ha 8 caratteri con maiuscola, minuscola, cifra e simbolo, senza caratteri ambigui", () => {
  for (let i = 0; i < 500; i++) {
    const p = generatePassword();
    assert.equal(p.length, 8);
    assert.match(p, /[A-Z]/);
    assert.match(p, /[a-z]/);
    assert.match(p, /[0-9]/);
    assert.match(p, /[!@#$%&*?]/);
    assert.doesNotMatch(p, /[IlO01]/);
  }
});

test("due password generate sono diverse", () => {
  const set = new Set(Array.from({ length: 50 }, () => generatePassword()));
  assert.equal(set.size, 50);
});

test("la lunghezza è rispettata", () => {
  assert.equal(generatePassword(12).length, 12);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldReturnToLogin } from "./expiry.ts";

test("si torna al login se il server chiude con 4001", () => {
  assert.equal(shouldReturnToLogin(4001, Date.now() + 3600e3, Date.now()), true);
});

test("si torna al login anche se la scadenza è passata (computer in standby, rete caduta: il browser vede 1006, non 4001)", () => {
  const now = 1_800_000_000_000;
  assert.equal(shouldReturnToLogin(1006, now - 1, now), true);
  assert.equal(shouldReturnToLogin(1006, now, now), true);
});

test("altrimenti si riprova a collegarsi", () => {
  const now = 1_800_000_000_000;
  assert.equal(shouldReturnToLogin(1006, now + 1000, now), false);
  assert.equal(shouldReturnToLogin(1000, now + 1000, now), false);
});

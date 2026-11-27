import assert from "node:assert/strict";
import { test } from "node:test";
import { isLoginSession, type BoardSession } from "./session.ts";

const s = (uid?: string): BoardSession => ({ room: "aula", token: "t", name: "Anna Rossi", uid, role: "participant", exp: Date.now() + 1000 });

test("isLoginSession: vero solo per l'identificativo personale generato dal login (u- + 20 cifre esadecimali)", () => {
  assert.equal(isLoginSession(s("u-0123456789abcdef0123")), true);
  assert.equal(isLoginSession(s("trainer")), false, "link del trainer");
  assert.equal(isLoginSession(s("anna-rossi")), false, "link personale di seed");
  assert.equal(isLoginSession(s("u-0123456789abcdef012")), false, "troppo corto");
  assert.equal(isLoginSession(s("u-0123456789ABCDEF0123")), false, "solo minuscole");
  assert.equal(isLoginSession(s(undefined)), false);
});

// /auth/config: l'indirizzo del login del trainer sul sito (TRAINER_LOGIN_URL), solo se valido.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHttpUrl } from "./auth.ts";
import { startServer } from "./test-server.ts";

test("parseHttpUrl: solo indirizzi http(s) completi", () => {
  assert.equal(parseHttpUrl(undefined), null);
  assert.equal(parseHttpUrl(""), null);
  assert.equal(parseHttpUrl("   "), null);
  assert.equal(parseHttpUrl("cubeacademy.eu/materiali/board"), null);
  assert.equal(parseHttpUrl("ftp://x.org"), null);
  assert.equal(parseHttpUrl("javascript:alert(1)"), null);
  assert.equal(parseHttpUrl("  https://cubeacademy.eu/materiali/board  "), "https://cubeacademy.eu/materiali/board");
  assert.equal(parseHttpUrl("http://localhost:4000/login?x=1"), "http://localhost:4000/login?x=1");
});

const config = async (env: Record<string, string>) => {
  const srv = await startServer({ BOARD_SECRET: "chiave-di-prova", ...env });
  try {
    const r = await fetch(`${srv.url}/auth/config`);
    return { status: r.status, cache: r.headers.get("cache-control") ?? "", body: (await r.json()) as { trainerLoginUrl: string | null }, post: (await fetch(`${srv.url}/auth/config`, { method: "POST" })).status };
  } finally {
    srv.stop();
  }
};

test("/auth/config: indirizzo configurato, non valido o assente", async () => {
  const ok = await config({ TRAINER_LOGIN_URL: "https://cubeacademy.eu/materiali/board" });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { trainerLoginUrl: "https://cubeacademy.eu/materiali/board" });
  assert.match(ok.cache, /no-store/);
  assert.equal(ok.post, 405);
  assert.deepEqual((await config({ TRAINER_LOGIN_URL: "cubeacademy.eu" })).body, { trainerLoginUrl: null });
  assert.deepEqual((await config({})).body, { trainerLoginUrl: null });
});

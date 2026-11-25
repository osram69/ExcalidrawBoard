import assert from "node:assert/strict";
import { test } from "node:test";
import { trainerLoginRedirect, validBoardName } from "./trainerLogin.ts";

test("validBoardName: solo lettere, numeri, - e _ (1-64)", () => {
  for (const ok of ["a", "isaqb-dic26", "Lezione_1", "x".repeat(64)]) assert.equal(validBoardName(ok), true, ok);
  for (const bad of ["", "a b", "a/b", "../x", "x".repeat(65), "à", "a?b", "<s>"]) assert.equal(validBoardName(bad), false, bad);
});

test("trainerLoginRedirect: indirizzo del sito con la board e il ritorno alla board", () => {
  const u = new URL(trainerLoginRedirect("https://cubeacademy.eu/materiali/board", "lezione1", "https://board.cubeacademy.eu"));
  assert.equal(u.origin + u.pathname, "https://cubeacademy.eu/materiali/board");
  assert.equal(u.searchParams.get("room"), "lezione1");
  assert.equal(u.searchParams.get("return"), "https://board.cubeacademy.eu/b/lezione1");
});

test("trainerLoginRedirect: conserva i parametri già presenti e codifica il ritorno", () => {
  const u = new URL(trainerLoginRedirect("https://cubeacademy.eu/materiali/board?lang=it", "aula-1", "http://localhost:5173"));
  assert.equal(u.searchParams.get("lang"), "it");
  assert.equal(u.searchParams.get("return"), "http://localhost:5173/b/aula-1");
});

test("trainerLoginRedirect: nome di board non valido o indirizzo non valido: errore", () => {
  assert.throws(() => trainerLoginRedirect("https://cubeacademy.eu/materiali/board", "a/b", "https://b.example.org"), /board/i);
  assert.throws(() => trainerLoginRedirect("non un indirizzo", "ok", "https://b.example.org"), /indirizzo/i);
  assert.throws(() => trainerLoginRedirect("ftp://x.org", "ok", "https://b.example.org"), /indirizzo/i);
});

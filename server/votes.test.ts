import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { RoomVotes } from "./votes.ts";

function make(notes: string[] = ["n1", "n2"]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "votes-test-"));
  const file = path.join(dir, "votes.json");
  const votable = new Set(notes);
  const votes = new RoomVotes(file, (id) => votable.has(id));
  return { votes, votable, file };
}

test("votazione chiusa di default: nessun voto", () => {
  const { votes } = make();
  assert.equal(votes.vote("u1", "n1", 1), false);
  assert.deepEqual(votes.publicState(), { open: false, perPerson: 5, totals: {} });
});

test("con budget 3 passano tre voti anche sulla stessa nota, il quarto no", () => {
  const { votes } = make();
  votes.control("open", 3);
  assert.equal(votes.vote("u1", "n1", 1), true);
  assert.equal(votes.vote("u1", "n1", 1), true);
  assert.equal(votes.vote("u1", "n2", 1), true);
  assert.equal(votes.vote("u1", "n2", 1), false);
  assert.deepEqual(votes.publicState().totals, { n1: 2, n2: 1 });
  assert.deepEqual(votes.mine("u1"), { mine: { n1: 2, n2: 1 }, left: 0 });
});

test("l'ultimo puntino non può essere speso due volte (due clic rapidi)", () => {
  const { votes } = make();
  votes.control("open", 1);
  const results = [votes.vote("u1", "n1", 1), votes.vote("u1", "n1", 1)];
  assert.deepEqual(results, [true, false]);
  assert.equal(votes.mine("u1").left, 0);
});

test("ogni persona ha il suo budget", () => {
  const { votes } = make();
  votes.control("open", 1);
  assert.equal(votes.vote("u1", "n1", 1), true);
  assert.equal(votes.vote("u2", "n1", 1), true);
  assert.deepEqual(votes.publicState().totals, { n1: 2 });
});

test("togliere un voto: solo se ce n'è uno su quella nota", () => {
  const { votes } = make();
  votes.control("open", 3);
  assert.equal(votes.vote("u1", "n1", -1), false);
  votes.vote("u1", "n1", 1);
  assert.equal(votes.vote("u1", "n1", -1), true);
  assert.deepEqual(votes.publicState().totals, {});
  assert.equal(votes.mine("u1").left, 3);
});

test("delta non valido è rifiutato", () => {
  const { votes } = make();
  votes.control("open", 3);
  for (const bad of [5, 0, "1", null, undefined, NaN, 1.5]) assert.equal(votes.vote("u1", "n1", bad), false, `delta=${String(bad)}`);
});

test("id non votabile o non stringa è rifiutato", () => {
  const { votes } = make();
  votes.control("open", 3);
  assert.equal(votes.vote("u1", "altro", 1), false);
  assert.equal(votes.vote("u1", 42, 1), false);
  assert.equal(votes.vote("u1", undefined, 1), false);
});

test("nota cancellata: i suoi voti spariscono dai totali e il puntino torna", () => {
  const { votes, votable } = make();
  votes.control("open", 3);
  votes.vote("u1", "n1", 1);
  votes.vote("u1", "n2", 1);
  votable.delete("n1");
  assert.deepEqual(votes.publicState().totals, { n2: 1 });
  assert.equal(votes.mine("u1").left, 2);
  assert.deepEqual(votes.mine("u1").mine, { n2: 1 });
});

test("id '__proto__' non inquina gli oggetti", () => {
  const { votes } = make(["__proto__"]);
  votes.control("open", 3);
  assert.equal(votes.vote("u1", "__proto__", 1), true);
  const totals = votes.publicState().totals;
  assert.equal(Object.getPrototypeOf(totals), Object.prototype);
  assert.equal(Object.keys(totals).length, 1);
  assert.equal(totals["__proto__"], 1);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(votes.mine("__proto__").left, 3); // anche la chiave utente '__proto__' è innocua
  assert.equal(votes.vote("__proto__", "__proto__", 1), true);
  assert.equal(votes.mine("__proto__").left, 2);
});

test("close rifiuta nuovi voti e conserva i totali; reset li cancella", () => {
  const { votes } = make();
  votes.control("open", 3);
  votes.vote("u1", "n1", 1);
  assert.equal(votes.control("close"), true);
  assert.equal(votes.vote("u1", "n1", 1), false);
  assert.equal(votes.vote("u1", "n1", -1), false);
  assert.deepEqual(votes.publicState(), { open: false, perPerson: 3, totals: { n1: 1 } });
  assert.equal(votes.control("reset"), true);
  assert.deepEqual(votes.publicState().totals, {});
  assert.equal(votes.publicState().perPerson, 3);
});

test("budget non valido è rifiutato e il valore resta", () => {
  const { votes } = make();
  for (const bad of [0, 21, 2.5, "5", -1, NaN]) {
    assert.equal(votes.control("open", bad), false, `perPerson=${String(bad)}`);
  }
  assert.deepEqual(votes.publicState(), { open: false, perPerson: 5, totals: {} });
});

test("open senza perPerson mantiene il budget; azioni sconosciute rifiutate", () => {
  const { votes } = make();
  assert.equal(votes.control("open"), true);
  assert.equal(votes.publicState().perPerson, 5);
  assert.equal(votes.control("boh"), false);
  assert.equal(votes.control(7 as unknown), false);
});

test("abbassare il budget sotto quanto già speso: residuo zero, non negativo", () => {
  const { votes } = make();
  votes.control("open", 5);
  for (let i = 0; i < 4; i++) votes.vote("u1", "n1", 1);
  votes.control("open", 2);
  assert.equal(votes.mine("u1").left, 0);
  assert.equal(votes.vote("u1", "n2", 1), false);
});

test("lo stato sopravvive a un riavvio (stesso file)", () => {
  const { votes, votable, file } = make();
  votes.control("open", 4);
  votes.vote("u1", "n1", 1);
  votes.vote("u2", "n1", 1);
  votes.flush();
  const again = new RoomVotes(file, (id) => votable.has(id));
  assert.deepEqual(again.publicState(), { open: true, perPerson: 4, totals: { n1: 2 } });
  assert.deepEqual(again.mine("u1"), { mine: { n1: 1 }, left: 3 });
});

test("file di stato corrotto: si riparte da zero senza errori", () => {
  const { file, votable } = make();
  fs.writeFileSync(file, "{non json");
  const votes = new RoomVotes(file, (id) => votable.has(id));
  assert.deepEqual(votes.publicState(), { open: false, perPerson: 5, totals: {} });
});

test("prune: i voti su una nota non più votabile spariscono per sempre (niente budget raddoppiato con elimina e annulla)", () => {
  const { votes, votable } = make();
  votes.control("open", 3);
  for (let i = 0; i < 3; i++) votes.vote("u1", "n1", 1);
  votable.delete("n1"); // nota cancellata
  assert.equal(votes.prune(), true);
  for (let i = 0; i < 3; i++) assert.equal(votes.vote("u1", "n2", 1), true);
  votable.add("n1"); // annulla: la nota torna
  assert.deepEqual(votes.publicState().totals, { n2: 3 });
  assert.deepEqual(votes.mine("u1"), { mine: { n2: 3 }, left: 0 });
});

test("prune: false se non c'è nulla da togliere", () => {
  const { votes } = make();
  votes.control("open", 3);
  votes.vote("u1", "n1", 1);
  assert.equal(votes.prune(), false);
  assert.deepEqual(votes.publicState().totals, { n1: 1 });
});

test("il salvataggio è rimandato: nessuna scrittura per ogni voto, flush() scrive", () => {
  const { votes, file } = make();
  votes.control("open", 3);
  for (let i = 0; i < 3; i++) votes.vote("u1", "n1", 1);
  assert.equal(fs.existsSync(file), false, "scritto subito: ogni voto farebbe una scrittura sincrona");
  votes.flush();
  assert.equal(fs.existsSync(file), true);
});

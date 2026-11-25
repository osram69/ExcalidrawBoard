import assert from "node:assert/strict";
import { test } from "node:test";
import { closedAula, gotoUrl, saveGotoToken } from "./goto.ts";
import type { StorageLike } from "./remember.ts";
import { placeLabel, type PresenceInfo } from "./roomsLogic.ts";

const fake = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
  };
};

test("gotoUrl: solo nomi di board validi", () => {
  assert.equal(gotoUrl("isaqb-dic26-r1-s2"), "/b/isaqb-dic26-r1-s2");
  for (const bad of ["", "a/b", "../x", "a b", "a?b=1", "x".repeat(65), "<script>"]) assert.throws(() => gotoUrl(bad), /board/i, bad);
});

test("saveGotoToken: il token resta nella scheda e si toglie quello ricordato per la stessa board", () => {
  const s = { local: fake(), session: fake() };
  s.local.setItem("board:token:stanza", "VECCHIO");
  s.local.setItem("board:token:altra", "RESTA");
  saveGotoToken(s, "stanza", "NUOVO");
  assert.equal(s.session.getItem("board:token:stanza"), "NUOVO");
  assert.equal(s.local.getItem("board:token:stanza"), null);
  assert.equal(s.local.getItem("board:token:altra"), "RESTA");
  assert.throws(() => saveGotoToken(s, "../x", "T"), /board/i);
  assert.equal(s.session.getItem("board:token:../x"), null);
});

test("closedAula: l'aula a cui tornare solo se il server dice 'stanza chiusa' con un nome valido", () => {
  assert.equal(closedAula({ ok: false, motivo: "stanza chiusa", aula: "isaqb-dic26" }), "isaqb-dic26");
  for (const bad of [null, undefined, {}, { motivo: "scaduto", aula: "x" }, { motivo: "stanza chiusa" }, { motivo: "stanza chiusa", aula: "../x" }, { motivo: "stanza chiusa", aula: 5 }, "testo"]) {
    assert.equal(closedAula(bad), null, JSON.stringify(bad));
  }
});

const presence: PresenceInfo = {
  rooms: {},
  current: { round: 2, rooms: [{ n: 1, id: "a-r2-s1", members: [] }, { n: 2, id: "a-r2-s2", members: [] }] },
  history: [{ round: 1, rooms: [{ n: 1, id: "a-r1-s1", members: [] }] }],
};

test("placeLabel: aula, stanza del turno aperto, stanza di un turno passato, board sconosciuta", () => {
  assert.equal(placeLabel("a", "a", presence), "Aula");
  assert.equal(placeLabel("a-r2-s2", "a", presence), "Stanza 2");
  assert.equal(placeLabel("a-r1-s1", "a", presence), "Stanza 1 (turno 1)");
  assert.equal(placeLabel("boh", "a", presence), "boh");
  assert.equal(placeLabel("a", "a", null), "Aula");
});

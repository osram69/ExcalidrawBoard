import assert from "node:assert/strict";
import { test } from "node:test";
import { clearAccess, loadProfile, readToken, reasonText, saveLogin, type StorageLike } from "./remember.ts";

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
const stores = () => ({ local: fake(), session: fake() });
const profile = (o = {}) => ({ nome: "Anna", cognome: "Rossi", ricordami: true, ...o });

test("con ricordami: token e profilo restano sul dispositivo (localStorage), non nella sessione", () => {
  const s = stores();
  saveLogin(s, "corso-g1", "TOKEN", profile());
  assert.equal(s.local.getItem("board:token:corso-g1"), "TOKEN");
  assert.equal(s.session.getItem("board:token:corso-g1"), null);
  assert.deepEqual(loadProfile(s), profile());
  assert.equal(readToken(s, "corso-g1"), "TOKEN");
});

test("senza ricordami: token solo nella sessione, nessun profilo, e quanto ricordato prima viene cancellato", () => {
  const s = stores();
  saveLogin(s, "corso-g1", "VECCHIO", profile());
  saveLogin(s, "corso-g1", "NUOVO", profile({ ricordami: false }));
  assert.equal(s.session.getItem("board:token:corso-g1"), "NUOVO");
  assert.equal(s.local.getItem("board:token:corso-g1"), null);
  assert.deepEqual(loadProfile(s), { nome: "", cognome: "", ricordami: false });
});

test("il token di una board non tocca quello di un'altra", () => {
  const s = stores();
  saveLogin(s, "corso-g1", "T1", profile());
  saveLogin(s, "corso-g2", "T2", profile());
  assert.equal(readToken(s, "corso-g1"), "T1");
  assert.equal(readToken(s, "corso-g2"), "T2");
  assert.equal(readToken(s, "corso-g3"), null);
});

test("readToken: prima la sessione, poi il dispositivo", () => {
  const s = stores();
  s.local.setItem("board:token:r", "LOCALE");
  assert.equal(readToken(s, "r"), "LOCALE");
  s.session.setItem("board:token:r", "SESSIONE");
  assert.equal(readToken(s, "r"), "SESSIONE");
});

test("clearAccess: toglie i token; il profilo solo se richiesto (Esci)", () => {
  const s = stores();
  saveLogin(s, "r", "T", profile());
  s.session.setItem("board:token:r", "S");
  clearAccess(s, "r", false);
  assert.equal(readToken(s, "r"), null);
  assert.equal(loadProfile(s).nome, "Anna");
  clearAccess(s, "r", true);
  assert.deepEqual(loadProfile(s), { nome: "", cognome: "", ricordami: false });
});

test("loadProfile: valori mancanti, corrotti o di tipo sbagliato", () => {
  const s = stores();
  const empty = { nome: "", cognome: "", ricordami: false };
  assert.deepEqual(loadProfile(s), empty);
  s.local.setItem("board:profile", "{non json");
  assert.deepEqual(loadProfile(s), empty);
  s.local.setItem("board:profile", JSON.stringify({ nome: 5, cognome: null, ricordami: "si" }));
  assert.deepEqual(loadProfile(s), empty);
  s.local.setItem("board:profile", JSON.stringify({ nome: "Anna", cognome: "Rossi", email: "vecchia@b.it", ricordami: true, altro: 1 }));
  assert.deepEqual(loadProfile(s), { nome: "Anna", cognome: "Rossi", ricordami: true }); // il campo email di un profilo salvato prima viene scartato
});

test("storage non disponibile (privato, bloccato): nessuna eccezione", () => {
  const fail = () => { throw new Error("bloccato"); };
  const boom: StorageLike = { getItem: fail, setItem: fail, removeItem: fail, key: fail, get length(): number { return fail(); } };
  const s = { local: boom, session: boom };
  assert.doesNotThrow(() => saveLogin(s, "r", "T", profile()));
  assert.doesNotThrow(() => clearAccess(s, "r", true));
  assert.equal(readToken(s, "r"), null);
  assert.equal(loadProfile(s).nome, "");
});

test("reasonText: messaggio per ogni motivo del server", () => {
  assert.match(reasonText("scaduto"), /scadut/i);
  assert.match(reasonText("altra board"), /altra board|non è per questa/i);
  assert.match(reasonText("non valido"), /non (è )?valid/i);
  assert.ok(reasonText("qualcosa di nuovo").length > 0);
  assert.ok(reasonText(undefined).length > 0);
});

test("Esci (clearAccess con forget) toglie i token di TUTTE le board, dalla sessione e dal dispositivo", () => {
  const s = stores();
  saveLogin(s, "g1", "T1", profile());
  saveLogin(s, "g2", "T2", profile());
  s.session.setItem("board:token:g3", "T3");
  s.local.setItem("altra-chiave", "resta");
  clearAccess(s, "g1", true);
  for (const r of ["g1", "g2", "g3"]) assert.equal(readToken(s, r), null, r);
  assert.equal(s.local.getItem("altra-chiave"), "resta", "le chiavi che non sono token non si toccano");
  assert.equal(loadProfile(s).nome, "");
});

test("clearAccess senza forget tocca solo la board indicata", () => {
  const s = stores();
  saveLogin(s, "g1", "T1", profile());
  saveLogin(s, "g2", "T2", profile());
  clearAccess(s, "g1", false);
  assert.equal(readToken(s, "g1"), null);
  assert.equal(readToken(s, "g2"), "T2");
});

test("un login senza ricordami cancella gli accessi ricordati sul dispositivo per le altre board", () => {
  const s = stores();
  saveLogin(s, "g1", "T1", profile());
  saveLogin(s, "g2", "T2", profile({ ricordami: false }));
  assert.equal(readToken(s, "g1"), null, "il token ricordato della board g1 non deve restare sul dispositivo");
  assert.equal(readToken(s, "g2"), "T2");
  assert.equal(s.local.getItem("board:token:g1"), null);
});

test("un login con ricordami non tocca gli altri accessi ricordati", () => {
  const s = stores();
  saveLogin(s, "g1", "T1", profile());
  saveLogin(s, "g2", "T2", profile());
  assert.equal(readToken(s, "g1"), "T1");
  assert.equal(readToken(s, "g2"), "T2");
});

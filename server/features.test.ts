import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Role } from "./auth.ts";
import { featureSnapshot, handleFeatureMessage, onElementsChanged } from "./features.ts";
import { Room, type Peer } from "./rooms.ts";

/** Stanza con una cartella temporanea e peer finti che registrano ciò che ricevono. */
function setup(roles: Role[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "board-test-"));
  const room = new Room("prova", dir, () => {});
  const peers = roles.map((role, i) => {
    const got: any[] = [];
    const peer = { id: `p${i}`, name: `Utente ${i}`, role, color: "#000", key: `u${i}`, ws: { readyState: 1, send: (s: string) => got.push(JSON.parse(s)) } } as unknown as Peer;
    room.join(peer);
    return { peer, got };
  });
  return { room, peers };
}

test("un editor avvia il timer e tutti, mittente compreso, ricevono lo stato", () => {
  const { room, peers } = setup(["editor", "participant", "viewer"]);
  assert.equal(handleFeatureMessage(room, peers[0].peer, { t: "timer", action: "start", seconds: 60 }), true);
  for (const { got } of peers) {
    assert.equal(got.length, 1);
    assert.equal(got[0].t, "timer");
    assert.equal(got[0].state.status, "running");
    assert.equal(typeof got[0].now, "number");
  }
});

test("participant e viewer non controllano il timer", () => {
  const { room, peers } = setup(["editor", "participant", "viewer"]);
  for (const i of [1, 2]) {
    assert.equal(handleFeatureMessage(room, peers[i].peer, { t: "timer", action: "start", seconds: 60 }), true);
  }
  assert.equal(room.timer.state.status, "idle");
  assert.equal(peers.every(({ got }) => got.length === 0), true);
});

test("durata non valida: nessun broadcast e timer fermo", () => {
  const { room, peers } = setup(["editor", "participant"]);
  handleFeatureMessage(room, peers[0].peer, { t: "timer", action: "start", seconds: "abc" });
  assert.equal(room.timer.state.status, "idle");
  assert.equal(peers.every(({ got }) => got.length === 0), true);
});

test("i messaggi non di questa funzione non sono gestiti", () => {
  const { room, peers } = setup(["editor"]);
  assert.equal(handleFeatureMessage(room, peers[0].peer, { t: "els", els: [] }), false);
  assert.equal(handleFeatureMessage(room, peers[0].peer, null), false);
  assert.equal(handleFeatureMessage(room, peers[0].peer, "timer"), false);
});

test("featureSnapshot include il timer corrente", () => {
  const { room, peers } = setup(["editor"]);
  handleFeatureMessage(room, peers[0].peer, { t: "timer", action: "start", seconds: 120 });
  const snap = featureSnapshot(room, peers[0].peer);
  assert.equal(snap.timer.state.status, "running");
  assert.equal(typeof snap.timer.now, "number");
});

const addNote = (room: Room, id: string) => room.els.set(id, { id, version: 1, versionNonce: 1, type: "rectangle", customData: { kind: "nota" } } as any);

test("votazione: l'editor apre, i peer ricevono lo stato e ciascuno i propri voti", () => {
  const { room, peers } = setup(["editor", "participant"]);
  handleFeatureMessage(room, peers[0].peer, { t: "vote-ctl", action: "open", perPerson: 3 });
  for (const { got } of peers) {
    assert.equal(got.filter((m) => m.t === "votes").length, 1);
    assert.equal(got.find((m) => m.t === "votes").open, true);
    assert.deepEqual(got.find((m) => m.t === "my-votes"), { t: "my-votes", mine: {}, left: 3 });
  }
});

test("votazione: un participant vota, tutti vedono i totali, solo lui riceve my-votes", () => {
  const { room, peers } = setup(["editor", "participant"]);
  addNote(room, "n1");
  handleFeatureMessage(room, peers[0].peer, { t: "vote-ctl", action: "open", perPerson: 3 });
  peers.forEach(({ got }) => (got.length = 0));
  assert.equal(handleFeatureMessage(room, peers[1].peer, { t: "vote", id: "n1", delta: 1 }), true);
  for (const { got } of peers) assert.deepEqual(got.find((m) => m.t === "votes").totals, { n1: 1 });
  assert.deepEqual(peers[1].got.find((m) => m.t === "my-votes"), { t: "my-votes", mine: { n1: 1 }, left: 2 });
  assert.equal(peers[0].got.some((m) => m.t === "my-votes"), false);
});

test("votazione: anche l'editor può votare", () => {
  const { room, peers } = setup(["editor"]);
  addNote(room, "n1");
  handleFeatureMessage(room, peers[0].peer, { t: "vote-ctl", action: "open" });
  handleFeatureMessage(room, peers[0].peer, { t: "vote", id: "n1", delta: 1 });
  assert.deepEqual(room.votes.publicState().totals, { n1: 1 });
});

test("votazione: participant e viewer non la controllano", () => {
  const { room, peers } = setup(["editor", "participant", "viewer"]);
  for (const i of [1, 2]) handleFeatureMessage(room, peers[i].peer, { t: "vote-ctl", action: "open" });
  assert.equal(room.votes.publicState().open, false);
  assert.equal(peers.every(({ got }) => got.length === 0), true);
});

test("votazione: un viewer non vota", () => {
  const { room, peers } = setup(["editor", "viewer"]);
  addNote(room, "n1");
  handleFeatureMessage(room, peers[0].peer, { t: "vote-ctl", action: "open" });
  peers.forEach(({ got }) => (got.length = 0));
  assert.equal(handleFeatureMessage(room, peers[1].peer, { t: "vote", id: "n1", delta: 1 }), true);
  assert.deepEqual(room.votes.publicState().totals, {});
  assert.equal(peers.every(({ got }) => got.length === 0), true);
});

test("votazione: messaggi malformati ignorati senza eccezioni", () => {
  const { room, peers } = setup(["editor", "participant"]);
  addNote(room, "n1");
  handleFeatureMessage(room, peers[0].peer, { t: "vote-ctl", action: "open" });
  peers.forEach(({ got }) => (got.length = 0));
  for (const m of [{ t: "vote", id: 42, delta: 1 }, { t: "vote", id: "n1", delta: 5 }, { t: "vote" }, { t: "vote-ctl", action: "open", perPerson: 999 }]) {
    assert.doesNotThrow(() => handleFeatureMessage(room, peers[1].peer, m));
    assert.doesNotThrow(() => handleFeatureMessage(room, peers[0].peer, m));
  }
  assert.equal(peers.every(({ got }) => got.length === 0), true);
});

test("featureSnapshot include voti e voti miei", () => {
  const { room, peers } = setup(["editor", "participant"]);
  addNote(room, "n1");
  handleFeatureMessage(room, peers[0].peer, { t: "vote-ctl", action: "open", perPerson: 4 });
  handleFeatureMessage(room, peers[1].peer, { t: "vote", id: "n1", delta: 1 });
  const snap = featureSnapshot(room, peers[1].peer) as any;
  assert.deepEqual(snap.votes, { open: true, perPerson: 4, totals: { n1: 1 } });
  assert.deepEqual(snap.myVotes, { mine: { n1: 1 }, left: 3 });
});

test("nota cancellata: onElementsChanged ritrasmette totali e puntini residui", () => {
  const { room, peers } = setup(["editor", "participant"]);
  addNote(room, "n1");
  handleFeatureMessage(room, peers[0].peer, { t: "vote-ctl", action: "open", perPerson: 3 });
  for (let i = 0; i < 3; i++) handleFeatureMessage(room, peers[1].peer, { t: "vote", id: "n1", delta: 1 });
  peers.forEach(({ got }) => (got.length = 0));
  (room.els.get("n1") as any).isDeleted = true;
  onElementsChanged(room);
  for (const { got } of peers) assert.deepEqual(got.find((m) => m.t === "votes").totals, {});
  assert.deepEqual(peers[1].got.find((m) => m.t === "my-votes"), { t: "my-votes", mine: {}, left: 3 });
  peers.forEach(({ got }) => (got.length = 0));
  onElementsChanged(room); // nulla è cambiato: nessun messaggio
  assert.equal(peers.every(({ got }) => got.length === 0), true);
});

test("elimina e annulla non raddoppia il budget (end to end)", () => {
  const { room, peers } = setup(["editor", "participant"]);
  addNote(room, "A");
  addNote(room, "B");
  handleFeatureMessage(room, peers[0].peer, { t: "vote-ctl", action: "open", perPerson: 3 });
  for (let i = 0; i < 3; i++) handleFeatureMessage(room, peers[1].peer, { t: "vote", id: "A", delta: 1 });
  (room.els.get("A") as any).isDeleted = true;
  onElementsChanged(room);
  for (let i = 0; i < 3; i++) handleFeatureMessage(room, peers[1].peer, { t: "vote", id: "B", delta: 1 });
  (room.els.get("A") as any).isDeleted = false;
  onElementsChanged(room);
  assert.deepEqual(room.votes.publicState().totals, { B: 3 });
  assert.equal(room.votes.mine("u1").left, 0);
});

test("un voto aggiorna my-votes in tutte le schede con la stessa chiave utente", () => {
  const { room, peers } = setup(["editor", "participant", "participant"]);
  (peers[2].peer as any).key = "u1"; // stessa persona su un secondo dispositivo
  addNote(room, "n1");
  handleFeatureMessage(room, peers[0].peer, { t: "vote-ctl", action: "open", perPerson: 3 });
  peers.forEach(({ got }) => (got.length = 0));
  handleFeatureMessage(room, peers[1].peer, { t: "vote", id: "n1", delta: 1 });
  for (const i of [1, 2]) assert.deepEqual(peers[i].got.find((m) => m.t === "my-votes"), { t: "my-votes", mine: { n1: 1 }, left: 2 });
  assert.equal(peers[0].got.some((m) => m.t === "my-votes"), false);
});

test("id elemento che sono chiavi di prototipo vengono rifiutati dal server", () => {
  const { room } = setup(["participant"]);
  const el = (id: string) => ({ id, version: 1, versionNonce: 1, type: "rectangle", x: 0, y: 0, width: 10, height: 10, strokeColor: "#000", backgroundColor: "#fff" });
  const { accepted } = room.applyElements([el("__proto__"), el("constructor"), el("prototype"), el("ok-1")], { key: "u0", role: "participant" });
  assert.deepEqual(accepted.map((e) => e.id), ["ok-1"]);
});

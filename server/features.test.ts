import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Role } from "./auth.ts";
import { handleFeatureMessage, featureSnapshot } from "./features.ts";
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

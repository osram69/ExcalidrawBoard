import assert from "node:assert/strict";
import { test } from "node:test";
import { LIBRARY, registerLibrary } from "./library.ts";

// tipi di elemento che il server accetta (server/rooms.ts, TYPES)
const ALLOWED = new Set(["rectangle", "diamond", "ellipse", "arrow", "line", "freedraw", "text", "image", "frame"]);
const CATEGORIES = ["UML ·", "Relazione ·", "C4 ·", "Infrastruttura ·", "Servizi ·", "arc42 ·"];

const EXPECTED_UML = ["componente", "interfaccia-fornita", "interfaccia-richiesta", "porta", "classe", "interfaccia-stereotipo", "package", "nota", "attore", "caso-uso", "lifeline", "stato", "stato-iniziale", "stato-finale", "decisione", "fork-join"];
const EXPECTED_OTHER = {
  c4: ["persona", "sistema", "sistema-esterno", "container", "componente"],
  infra: ["nodo", "ambiente-esecuzione", "container-docker", "cloud", "database", "coda", "cache", "storage-file", "api-gateway", "load-balancer", "browser", "mobile"],
  svc: ["microservizio", "servizio-esterno", "event-bus", "job-batch"],
  arc: ["blocco-scatola-nera", "blocco-scatola-bianca", "stakeholder", "scenario-qualita", "rischio", "concetto-trasversale"],
};
const EXPECTED_REL = ["dipendenza", "realizzazione", "generalizzazione", "associazione", "aggregazione", "composizione"];

test("id unici e con prefisso lib-", () => {
  const ids = LIBRARY.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => id.startsWith("lib-")));
});

test("ogni nome inizia con una categoria nota", () => {
  for (const e of LIBRARY) assert.ok(CATEGORIES.some((c) => e.name.startsWith(c)), e.name);
});

test("skeleton ben formati: tipi ammessi, colori corti, coordinate finite, non vuoti", () => {
  for (const e of LIBRARY) {
    assert.ok(e.skeleton.length > 0, `${e.id} vuoto`);
    for (const s of e.skeleton) {
      assert.ok(ALLOWED.has(s.type), `${e.id}: tipo non ammesso ${s.type}`);
      for (const k of ["strokeColor", "backgroundColor"]) if (s[k] !== undefined) assert.ok(typeof s[k] === "string" && s[k].length <= 60, `${e.id}: ${k}`);
      assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y), `${e.id}: x/y`);
      for (const k of ["width", "height"]) if (s[k] !== undefined) assert.ok(Number.isFinite(s[k]), `${e.id}: ${k}`);
      for (const p of s.points ?? []) assert.ok(p.every(Number.isFinite), `${e.id}: points`);
    }
  }
});

test("le forme composte condividono un groupId, quelle semplici no", () => {
  for (const e of LIBRARY) {
    if (e.skeleton.length === 1) continue;
    const g = e.skeleton[0].groupIds?.[0];
    assert.ok(g, `${e.id}: manca groupIds`);
    assert.ok(e.skeleton.every((s) => s.groupIds?.[0] === g), `${e.id}: groupId diversi`);
  }
});

test("forme di tutte le categorie presenti", () => {
  const ids = new Set(LIBRARY.map((e) => e.id));
  for (const n of EXPECTED_UML) assert.ok(ids.has(`lib-uml-${n}`), `lib-uml-${n}`);
  for (const n of EXPECTED_REL) assert.ok(ids.has(`lib-rel-${n}`), `lib-rel-${n}`);
  for (const [cat, list] of Object.entries(EXPECTED_OTHER)) for (const n of list) assert.ok(ids.has(`lib-${cat}-${n}`), `lib-${cat}-${n}`);
});

test("relazioni UML: punte e tratteggio previsti", () => {
  const rel = (n: string) => LIBRARY.find((e) => e.id === `lib-rel-${n}`)!.skeleton[0];
  assert.equal(rel("dipendenza").strokeStyle, "dashed");
  assert.equal(rel("realizzazione").strokeStyle, "dashed");
  assert.equal(rel("realizzazione").endArrowhead, "triangle_outline");
  assert.equal(rel("generalizzazione").endArrowhead, "triangle_outline");
  assert.equal(rel("aggregazione").startArrowhead, "diamond_outline");
  assert.equal(rel("composizione").startArrowhead, "diamond");
});

test("registerLibrary sostituisce solo le proprie voci e mantiene quelle di altre librerie", async () => {
  let call: any;
  const api = { updateLibrary: async (o: any) => (call = o) };
  await registerLibrary(api, (s) => s.map((e) => ({ ...e, converted: true })));
  assert.equal(call.merge, false);
  const current = [{ id: "altra-1" }, { id: "lib-uml-componente" }, { id: "altra-2" }];
  const next = await call.libraryItems(current);
  assert.deepEqual(next.slice(0, 2).map((i: any) => i.id), ["altra-1", "altra-2"]);
  assert.equal(next.length, 2 + LIBRARY.length);
  assert.ok(next.slice(2).every((i: any) => i.id.startsWith("lib-") && i.name && i.elements.every((e: any) => e.converted)));
});

test("la libreria completa ha almeno 40 forme", () => {
  assert.ok(LIBRARY.length >= 40, `${LIBRARY.length}`);
});

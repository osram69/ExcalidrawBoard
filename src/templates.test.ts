import assert from "node:assert/strict";
import { test } from "node:test";
import { instantiate, TEMPLATES } from "./templates.ts";

// tipi di elemento che il server accetta (server/rooms.ts, TYPES)
const ALLOWED = new Set(["rectangle", "diamond", "ellipse", "arrow", "line", "freedraw", "text", "image", "frame"]);

const texts = (sk: any[]) => sk.map((e) => `${e.text ?? ""} ${e.label?.text ?? ""}`).join("\n");

test("esistono esattamente i cinque template previsti", () => {
  assert.deepEqual(TEMPLATES.map((t) => t.id), ["retro", "matrice", "c4-contesto", "adr", "requisiti"]);
});

for (const t of TEMPLATES) {
  test(`${t.id}: skeleton ben formato`, () => {
    const sk = t.build();
    const ids = sk.map((e) => e.id).filter(Boolean);
    assert.equal(new Set(ids).size, ids.length, "id duplicati");
    for (const e of sk) {
      assert.ok(ALLOWED.has(e.type), `tipo non ammesso: ${e.type}`);
      for (const k of ["strokeColor", "backgroundColor"]) if (e[k] !== undefined) assert.ok(typeof e[k] === "string" && e[k].length <= 60, `${k} non valido`);
      assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y), "x/y non finiti");
      for (const k of ["width", "height"]) if (e[k] !== undefined) assert.ok(Number.isFinite(e[k]), `${k} non finito`);
    }
    const frames = sk.filter((e) => e.type === "frame");
    assert.equal(frames.length, 1);
    assert.equal(frames[0].name, t.name);
    for (const c of frames[0].children) assert.ok(ids.includes(c), `figlio inesistente: ${c}`);
    for (const e of sk.filter((e) => e.type === "arrow")) {
      assert.ok(ids.includes(e.start?.id) && ids.includes(e.end?.id), "freccia agganciata a un id inesistente");
    }
  });

  test(`${t.id}: instantiate rinomina gli id e mantiene i riferimenti`, () => {
    const a = instantiate(t);
    const b = instantiate(t);
    const idsA = new Set(a.map((e) => e.id).filter(Boolean));
    const idsB = b.map((e) => e.id).filter(Boolean);
    assert.equal(idsB.some((id: string) => idsA.has(id)), false, "id condivisi tra due inserimenti");
    const frame = a.find((e) => e.type === "frame");
    for (const c of frame.children) assert.ok(idsA.has(c), `figlio inesistente dopo il rinomino: ${c}`);
    for (const e of a.filter((e) => e.type === "arrow")) assert.ok(idsA.has(e.start.id) && idsA.has(e.end.id));
  });
}

test("retro: colonne Start / Stop / Continue", () => {
  const s = texts(TEMPLATES.find((t) => t.id === "retro")!.build());
  for (const w of ["Start", "Stop", "Continue"]) assert.ok(s.includes(w), w);
});

test("matrice: assi Impatto e Sforzo", () => {
  const s = texts(TEMPLATES.find((t) => t.id === "matrice")!.build());
  assert.ok(s.includes("Impatto") && s.includes("Sforzo"));
});

test("c4-contesto: almeno due frecce", () => {
  const sk = TEMPLATES.find((t) => t.id === "c4-contesto")!.build();
  assert.ok(sk.filter((e) => e.type === "arrow").length >= 2);
});

test("adr: sezioni Contesto, Decisione, Alternative, Conseguenze", () => {
  const s = texts(TEMPLATES.find((t) => t.id === "adr")!.build());
  for (const w of ["Contesto", "Decisione", "Alternative", "Conseguenze"]) assert.ok(s.includes(w), w);
});

test("requisiti: colonne Funzionali, Qualità, Vincoli", () => {
  const s = texts(TEMPLATES.find((t) => t.id === "requisiti")!.build());
  for (const w of ["Funzionali", "Qualità", "Vincoli"]) assert.ok(s.includes(w), w);
});

test("i template centrati sull'origine: il frame contiene l'origine", () => {
  for (const t of TEMPLATES) {
    const f = t.build().find((e) => e.type === "frame");
    assert.ok(f.x <= 0 && f.y <= 0 && f.x + f.width >= 0 && f.y + f.height >= 0, t.id);
  }
});

test("le frecce hanno una geometria esplicita che congiunge i bordi dei riquadri collegati", () => {
  for (const t of TEMPLATES) {
    const sk = t.build();
    const byId = Object.fromEntries(sk.map((e) => [e.id, e]));
    for (const a of sk.filter((e) => e.type === "arrow")) {
      assert.equal(a.points?.length, 2, `${t.id}/${a.id}: points`);
      const [ex, ey] = [a.x + a.points[1][0], a.y + a.points[1][1]];
      const near = (b: any, x: number, y: number) => x >= b.x - 1 && x <= b.x + b.width + 1 && y >= b.y - 1 && y <= b.y + b.height + 1;
      assert.ok(near(byId[a.start.id], a.x, a.y), `${t.id}/${a.id}: l'inizio non è sul bordo di ${a.start.id}`);
      assert.ok(near(byId[a.end.id], ex, ey), `${t.id}/${a.id}: la fine non è sul bordo di ${a.end.id}`);
      assert.ok(Math.hypot(a.points[1][0], a.points[1][1]) > 40, `${t.id}/${a.id}: freccia troppo corta`);
    }
  }
});

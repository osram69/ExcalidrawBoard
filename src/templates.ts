// Template di board: dati puri (skeleton per `convertToExcalidrawElements`), senza importare Excalidraw, così si provano in Node.
// Ogni template è racchiuso in un frame con il suo nome e centrato sull'origine. Solo tipi di elemento ammessi dal server.
import { box, type Sk } from "./skeleton";

export interface Template {
  id: string;
  name: string;
  build(): Sk[];
}

/** Nota adesiva (come quelle della barra): votabile e da riempire. */
const note = (id: string, x: number, y: number, bg = "#ffec99"): Sk =>
  box(id, "Scrivi qui…", x, y, 180, 180, bg, { stroke: "transparent", round: true, extra: { customData: { kind: "nota" } } });

/** Punto sul bordo di `b` nella direzione di `toward` (bordo sinistro/destro se i due sono più distanti in orizzontale, altrimenti alto/basso). */
function edge(b: Sk, toward: Sk): [number, number] {
  const [cx, cy] = [b.x + b.width / 2, b.y + b.height / 2];
  const [tx, ty] = [toward.x + toward.width / 2, toward.y + toward.height / 2];
  if (Math.abs(tx - cx) > Math.abs(ty - cy)) return [tx > cx ? b.x + b.width : b.x, cy];
  return [cx, ty > cy ? b.y + b.height : b.y];
}

/** Freccia da `a` a `b`: Excalidraw non ne calcola la geometria dagli id, quindi i punti sono espliciti (gli id servono all'aggancio). */
const arrow = (id: string, a: Sk, b: Sk, text: string): Sk => {
  const [sx, sy] = edge(a, b);
  const [ex, ey] = edge(b, a);
  return {
    type: "arrow",
    id,
    x: sx,
    y: sy,
    width: Math.abs(ex - sx),
    height: Math.abs(ey - sy),
    points: [
      [0, 0],
      [ex - sx, ey - sy],
    ],
    start: { id: a.id },
    end: { id: b.id },
    roughness: 0,
    strokeColor: "#1e1e1e",
    endArrowhead: "arrow",
    label: { text, fontSize: 16 },
  };
};

/** Avvolge gli elementi in un frame con `name` e centra tutto sull'origine. */
function finish(name: string, items: Sk[]): Sk[] {
  const sized = items.filter((e) => e.type !== "arrow");
  const PAD = 40;
  const minX = Math.min(...sized.map((e) => e.x)) - PAD;
  const minY = Math.min(...sized.map((e) => e.y)) - PAD - 20; // spazio per il nome del frame
  const maxX = Math.max(...sized.map((e) => e.x + e.width)) + PAD;
  const maxY = Math.max(...sized.map((e) => e.y + e.height)) + PAD;
  const dx = -(minX + maxX) / 2;
  const dy = -(minY + maxY) / 2;
  const shifted = items.map((e) => ({ ...e, x: e.x + dx, y: e.y + dy }));
  const frame: Sk = { type: "frame", id: "frame", name, children: items.map((e) => e.id), x: minX + dx, y: minY + dy, width: maxX - minX, height: maxY - minY };
  return [frame, ...shifted];
}

/** Tre colonne con titolo, area di lavoro e una nota di esempio (retrospettiva, requisiti). */
function columns(prefix: string, name: string, cols: { title: string; bg: string }[]): Sk[] {
  const items: Sk[] = [];
  cols.forEach((c, i) => {
    const x = i * 320;
    items.push(box(`${prefix}-h${i}`, c.title, x, 0, 300, 70, c.bg, { font: 18 }));
    items.push(box(`${prefix}-c${i}`, "", x, 80, 300, 500, "#f8f9fa", { stroke: "#ced4da" }));
    items.push(note(`${prefix}-n${i}`, x + 60, 110));
  });
  return finish(name, items);
}

const retro: Template = {
  id: "retro",
  name: "Retrospettiva",
  build: () =>
    columns("retro", "Retrospettiva", [
      { title: "Start\ncosa iniziare a fare", bg: "#b2f2bb" },
      { title: "Stop\ncosa smettere di fare", bg: "#ffc9c9" },
      { title: "Continue\ncosa continuare a fare", bg: "#a5d8ff" },
    ]),
};

const requisiti: Template = {
  id: "requisiti",
  name: "Requisiti e qualità",
  build: () =>
    columns("req", "Requisiti e qualità", [
      { title: "Funzionali\nche cosa fa il sistema", bg: "#a5d8ff" },
      { title: "Qualità\ncome deve comportarsi", bg: "#b2f2bb" },
      { title: "Vincoli\ncosa non si può scegliere", bg: "#ffd8a8" },
    ]),
};

const matrice: Template = {
  id: "matrice",
  name: "Matrice impatto/sforzo",
  build: () =>
    finish("Matrice impatto/sforzo", [
      box("mx-q0", "Quick win", 0, 0, 360, 300, "#b2f2bb", { font: 22 }),
      box("mx-q1", "Progetti importanti", 370, 0, 360, 300, "#a5d8ff", { font: 22 }),
      box("mx-q2", "Riempitivi", 0, 310, 360, 300, "#e9ecef", { font: 22 }),
      box("mx-q3", "Da evitare", 370, 310, 360, 300, "#ffc9c9", { font: 22 }),
      box("mx-y", "Impatto ↑", -140, 0, 130, 610, "transparent", { stroke: "transparent", font: 20 }),
      box("mx-x", "Sforzo →", 0, 620, 730, 50, "transparent", { stroke: "transparent", font: 20 }),
    ]),
};

const c4: Template = {
  id: "c4-contesto",
  name: "Contesto di sistema (C4)",
  build: () => {
    const user = box("c4-user", "Utente\n[Persona]\nChi usa il sistema", 300, 0, 240, 120, "#08427b", { labelColor: "#ffffff", round: true });
    const sys = box("c4-sys", "Sistema\n[Sistema software]\nCosa fa, in una frase", 270, 260, 300, 140, "#1168bd", { labelColor: "#ffffff", round: true });
    const ext1 = box("c4-ext1", "Sistema esterno\n[Sistema software]", -180, 275, 260, 110, "#999999", { labelColor: "#ffffff", round: true, dashed: true });
    const ext2 = box("c4-ext2", "Sistema esterno\n[Sistema software]", 760, 275, 260, 110, "#999999", { labelColor: "#ffffff", round: true, dashed: true });
    return finish("Contesto di sistema (C4)", [user, sys, ext1, ext2, arrow("c4-a1", user, sys, "Usa"), arrow("c4-a2", sys, ext1, "Legge e scrive dati"), arrow("c4-a3", sys, ext2, "Invia notifiche")]);
  },
};

const adr: Template = {
  id: "adr",
  name: "ADR (decisione architetturale)",
  build: () => {
    const items: Sk[] = [
      box("adr-title", "ADR-000 · Titolo della decisione", 0, 0, 700, 70, "#ffec99", { font: 22 }),
      box("adr-status", "Stato: proposta · Data: ··· · Decisori: ···", 0, 80, 700, 44, "#ffffff", { font: 16 }),
    ];
    ["Contesto", "Decisione", "Alternative", "Conseguenze"].forEach((s, i) => {
      const y = 140 + i * 180;
      items.push(box(`adr-h${i}`, s, 0, y, 700, 36, "#dbe4ff", { font: 18, align: "left" }));
      items.push(box(`adr-b${i}`, "", 0, y + 40, 700, 130, "#ffffff"));
    });
    return finish("ADR (decisione architetturale)", items);
  },
};

export const TEMPLATES: Template[] = [retro, matrice, c4, adr, requisiti];

/** Skeleton pronto da inserire: gli id vengono rinominati con un suffisso casuale, così inserire due volte lo stesso template non duplica gli id. */
export function instantiate(t: Template): Sk[] {
  const sfx = Math.random().toString(36).slice(2, 8);
  const re = (id: string) => `${id}-${sfx}`;
  return t.build().map((e) => ({
    ...e,
    ...(e.id ? { id: re(e.id) } : {}),
    ...(e.children ? { children: e.children.map(re) } : {}),
    ...(e.start ? { start: { ...e.start, id: re(e.start.id) } } : {}),
    ...(e.end ? { end: { ...e.end, id: re(e.end.id) } } : {}),
  }));
}

// Libreria di forme per l'architettura software (stile "stencil" da Visio): dati puri, convertiti all'avvio in `registerLibrary`.
// Solo tipi di elemento che il server accetta; linee nette (`roughness: 0`); nome con prefisso di categoria (la libreria di Excalidraw non ha cartelle).
import { box, type Sk } from "./skeleton";

export interface LibraryEntry {
  id: string; // stabile: lib-<categoria>-<nome>
  name: string; // "UML · Componente"
  skeleton: Sk[];
}

const INK = "#1e1e1e";
const CATEGORY = { uml: "UML", rel: "Relazione", c4: "C4", infra: "Infrastruttura", svc: "Servizi", arc: "arc42" } as const;
type Cat = keyof typeof CATEGORY;

// --- mattoni ---
const base = { strokeColor: INK, roughness: 0, fillStyle: "solid" } as const;
const line = (x: number, y: number, points: number[][], o: { dashed?: boolean; round?: boolean } = {}): Sk => ({
  type: "line", x, y, points, ...base, strokeStyle: o.dashed ? "dashed" : "solid", roundness: o.round ? { type: 2 } : null,
});
const ellipse = (x: number, y: number, w: number, h: number, bg = "#ffffff", text = "", o: { dashed?: boolean } = {}): Sk => ({
  type: "ellipse", x, y, width: w, height: h, backgroundColor: bg, ...base, strokeStyle: o.dashed ? "dashed" : "solid",
  ...(text ? { label: { text, fontSize: 18, strokeColor: INK } } : {}),
});
const diamond = (x: number, y: number, w: number, h: number, bg = "#ffffff", text = ""): Sk => ({
  type: "diamond", x, y, width: w, height: h, backgroundColor: bg, ...base, ...(text ? { label: { text, fontSize: 16, strokeColor: INK } } : {}),
});
const text = (t: string, x: number, y: number, fontSize = 16): Sk => ({ type: "text", text: t, x, y, fontSize, strokeColor: INK });
const rel = (o: Record<string, unknown>): Sk => ({
  type: "arrow", x: 0, y: 0, width: 220, height: 0, points: [[0, 0], [220, 0]], ...base, strokeStyle: "solid", startArrowhead: null, endArrowhead: null, ...o,
});

/** Crea una voce; le forme composte condividono un groupId così si trascinano insieme. */
function entry(cat: Cat, key: string, name: string, items: Sk[]): LibraryEntry {
  const id = `lib-${cat}-${key}`;
  return { id, name: `${CATEGORY[cat]} · ${name}`, skeleton: items.length > 1 ? items.map((e) => ({ ...e, groupIds: [`grp-${id}`] })) : items };
}

// --- UML ---
const uml: LibraryEntry[] = [
  entry("uml", "componente", "Componente", [
    box(undefined, "«component»\nNome", 10, 0, 220, 100),
    box(undefined, "", 0, 22, 20, 12),
    box(undefined, "", 0, 56, 20, 12),
  ]),
  entry("uml", "interfaccia-fornita", "Interfaccia fornita (lollipop)", [line(0, 12, [[0, 0], [50, 0]]), ellipse(50, 0, 24, 24), text("IInterfaccia", 10, 36)]),
  entry("uml", "interfaccia-richiesta", "Interfaccia richiesta (socket)", [line(0, 12, [[0, 0], [26, 0]]), line(40, 0, [[0, 0], [-14, 12], [0, 24]], { round: true }), text("IInterfaccia", 0, 36)]),
  entry("uml", "porta", "Porta", [box(undefined, "", 0, 0, 18, 18)]),
  entry("uml", "classe", "Classe", [
    box(undefined, "NomeClasse", 0, 0, 200, 44),
    box(undefined, "- attributo: Tipo", 0, 44, 200, 64, "#ffffff", { align: "left", valign: "top", font: 16 }),
    box(undefined, "+ metodo(): Tipo", 0, 108, 200, 64, "#ffffff", { align: "left", valign: "top", font: 16 }),
  ]),
  entry("uml", "interfaccia-stereotipo", "Interfaccia «interface»", [
    box(undefined, "«interface»\nNome", 0, 0, 200, 56),
    box(undefined, "+ operazione()", 0, 56, 200, 60, "#ffffff", { align: "left", valign: "top", font: 16 }),
  ]),
  entry("uml", "package", "Package", [box(undefined, "", 0, 0, 90, 26), box(undefined, "NomePackage", 0, 26, 240, 150, "#ffffff", { align: "left", valign: "top" })]),
  entry("uml", "nota", "Nota", [box(undefined, "Nota", 0, 0, 200, 100, "#fff3bf", { align: "left", valign: "top", font: 16 }), line(182, 0, [[0, 0], [0, 18], [18, 18]])]),
  entry("uml", "attore", "Attore", [
    ellipse(11, 0, 22, 22),
    line(22, 22, [[0, 0], [0, 38]]),
    line(0, 36, [[0, 0], [44, 0]]),
    line(22, 60, [[0, 0], [-20, 30]]),
    line(22, 60, [[0, 0], [20, 30]]),
    text("Attore", 0, 96),
  ]),
  entry("uml", "caso-uso", "Caso d'uso", [ellipse(0, 0, 200, 90, "#ffffff", "Caso d'uso")]),
  entry("uml", "lifeline", "Lifeline (sequenza)", [
    box(undefined, "Oggetto", 0, 0, 120, 44),
    line(60, 44, [[0, 0], [0, 300]], { dashed: true }),
    box(undefined, "", 53, 90, 14, 90),
  ]),
  entry("uml", "stato", "Stato", [box(undefined, "Stato", 0, 0, 160, 70, "#ffffff", { round: true })]),
  entry("uml", "stato-iniziale", "Stato iniziale", [ellipse(0, 0, 24, 24, INK)]),
  entry("uml", "stato-finale", "Stato finale", [ellipse(0, 0, 32, 32), ellipse(7, 7, 18, 18, INK)]),
  entry("uml", "decisione", "Decisione", [diamond(0, 0, 70, 70)]),
  entry("uml", "fork-join", "Fork / Join", [box(undefined, "", 0, 0, 120, 10, INK)]),
];

// --- relazioni UML ---
const relations: LibraryEntry[] = [
  entry("rel", "dipendenza", "Dipendenza", [rel({ strokeStyle: "dashed", endArrowhead: "arrow" })]),
  entry("rel", "realizzazione", "Realizzazione", [rel({ strokeStyle: "dashed", endArrowhead: "triangle_outline" })]),
  entry("rel", "generalizzazione", "Generalizzazione", [rel({ endArrowhead: "triangle_outline" })]),
  entry("rel", "associazione", "Associazione", [rel({})]),
  entry("rel", "aggregazione", "Aggregazione", [rel({ startArrowhead: "diamond_outline" })]),
  entry("rel", "composizione", "Composizione", [rel({ startArrowhead: "diamond" })]),
];

export const LIBRARY: LibraryEntry[] = [...uml, ...relations];

/**
 * Registra la libreria nel pannello di Excalidraw. Sostituisce solo le proprie voci (id `lib-…`) e lascia intatte quelle
 * caricate dall'utente, quindi un aggiornamento della libreria non lascia forme vecchie né duplicati.
 */
export async function registerLibrary(api: any, convert: (skeleton: Sk[]) => any[]): Promise<void> {
  const created = Date.now();
  const mine = LIBRARY.map((e) => ({ id: e.id, status: "published", created, name: e.name, elements: convert(e.skeleton) }));
  await api.updateLibrary({
    libraryItems: (current: any[]) => [...current.filter((i) => !String(i.id).startsWith("lib-")), ...mine],
    merge: false,
    defaultStatus: "published",
  });
}

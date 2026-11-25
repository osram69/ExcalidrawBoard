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

// --- C4 (colori del modello C4) ---
const c4Box = (label: string, bg: string, o: { labelColor?: string; dashed?: boolean } = {}): Sk =>
  box(undefined, label, 0, 0, 280, 140, bg, { labelColor: o.labelColor ?? "#ffffff", round: true, dashed: o.dashed, stroke: bg === "#85bbf0" ? "#5d9bd1" : "#1e1e1e" });
const c4: LibraryEntry[] = [
  entry("c4", "persona", "Persona", [ellipse(50, 0, 60, 60, "#08427b"), box(undefined, "Persona\n[Persona]\nDescrizione", 0, 66, 160, 100, "#08427b", { labelColor: "#ffffff", round: true, font: 16 })]),
  entry("c4", "sistema", "Sistema", [c4Box("Sistema\n[Sistema software]\nDescrizione", "#1168bd")]),
  entry("c4", "sistema-esterno", "Sistema esterno", [c4Box("Sistema esterno\n[Sistema software]\nDescrizione", "#999999", { dashed: true })]),
  entry("c4", "container", "Container", [c4Box("Container\n[Tecnologia]\nDescrizione", "#438dd5")]),
  entry("c4", "componente", "Componente", [c4Box("Componente\n[Tecnologia]\nDescrizione", "#85bbf0", { labelColor: "#1e1e1e" })]),
];

// --- infrastruttura e distribuzione ---
const infra: LibraryEntry[] = [
  entry("infra", "nodo", "Nodo / server (3D)", [
    box(undefined, "«device»\nNodo", 0, 24, 200, 116),
    line(0, 24, [[0, 0], [24, -24], [224, -24], [200, 0]]),
    line(200, 24, [[0, 0], [24, -24], [24, 92], [0, 116]]),
  ]),
  entry("infra", "ambiente-esecuzione", "Ambiente di esecuzione", [box(undefined, "«execution environment»\nRuntime", 0, 0, 240, 140, "#f1f3f5", { valign: "top", font: 16 })]),
  entry("infra", "container-docker", "Container Docker", [box(undefined, "Container\n[Docker]", 0, 0, 200, 100, "#d0ebff", { stroke: "#1c7ed6", round: true })]),
  entry("infra", "cloud", "Cloud", [
    { ...line(0, 0, [[40, 80], [10, 70], [0, 45], [20, 25], [45, 25], [55, 5], [85, -5], [115, 10], [125, 30], [155, 30], [175, 50], [165, 75], [140, 80], [40, 80]], { round: true }), backgroundColor: "#e7f5ff" },
    text("Cloud", 62, 34, 18),
  ]),
  entry("infra", "database", "Database", [
    ellipse(0, 100, 140, 30),
    box(undefined, "", 0, 15, 140, 100, "#ffffff", { stroke: "transparent" }),
    line(0, 15, [[0, 0], [0, 100]]),
    line(140, 15, [[0, 0], [0, 100]]),
    ellipse(0, 0, 140, 30),
    text("Database", 28, 62, 18),
  ]),
  entry("infra", "coda", "Coda / broker", [
    box(undefined, "", 0, 0, 200, 56),
    line(50, 0, [[0, 0], [0, 56]]),
    line(100, 0, [[0, 0], [0, 56]]),
    line(150, 0, [[0, 0], [0, 56]]),
    text("Coda / broker", 40, -26, 16),
  ]),
  entry("infra", "cache", "Cache", [box(undefined, "Cache", 0, 0, 130, 70, "#fff3bf", { round: true, dashed: true })]),
  entry("infra", "storage-file", "Storage di file", [box(undefined, "", 0, 0, 60, 18), box(undefined, "Storage\n(file)", 0, 18, 160, 92, "#fff9db", { font: 16 })]),
  entry("infra", "api-gateway", "API gateway", [box(undefined, "API\ngateway", 0, 0, 160, 90, "#e5dbff", { round: true })]),
  entry("infra", "load-balancer", "Load balancer", [diamond(0, 0, 150, 100, "#d3f9d8", "Load\nbalancer")]),
  entry("infra", "browser", "Browser / utente", [
    box(undefined, "", 0, 0, 220, 150),
    box(undefined, "", 0, 0, 220, 28, "#e9ecef"),
    ellipse(10, 9, 10, 10, "#fa5252"),
    ellipse(26, 9, 10, 10, "#fab005"),
    ellipse(42, 9, 10, 10, "#40c057"),
    text("Browser", 80, 62, 20),
  ]),
  entry("infra", "mobile", "Dispositivo mobile", [box(undefined, "", 0, 0, 86, 160, "#ffffff", { round: true }), box(undefined, "", 8, 20, 70, 108, "#e7f5ff"), ellipse(37, 136, 12, 12), text("Mobile", 12, 168)]),
];

// --- servizi e integrazione ---
const services: LibraryEntry[] = [
  entry("svc", "microservizio", "Microservizio (esagono)", [
    { ...line(0, 0, [[40, 0], [120, 0], [160, 45], [120, 90], [40, 90], [0, 45], [40, 0]]), backgroundColor: "#fff" },
    text("Micro-\nservizio", 40, 26, 18),
  ]),
  entry("svc", "servizio-esterno", "Servizio esterno", [box(undefined, "Servizio\nesterno", 0, 0, 180, 90, "#f1f3f5", { round: true, dashed: true })]),
  entry("svc", "event-bus", "Event bus", [box(undefined, "Event bus", 0, 0, 360, 44, "#ffe8cc", { stroke: "#e8590c" })]),
  entry("svc", "job-batch", "Job batch", [box(undefined, "Job batch", 0, 0, 180, 70, "#fff4e6"), ellipse(12, 22, 26, 26), line(25, 35, [[0, 0], [0, -8]]), line(25, 35, [[0, 0], [7, 4]])]),
];

// --- arc42 / iSAQB ---
const arc: LibraryEntry[] = [
  entry("arc", "blocco-scatola-nera", "Blocco (scatola nera)", [box(undefined, "Nome del blocco\nResponsabilità", 0, 0, 240, 100, "#ffffff", { font: 16 })]),
  entry("arc", "blocco-scatola-bianca", "Blocco (scatola bianca)", [
    box(undefined, "Nome del blocco", 0, 0, 340, 230, "#ffffff", { valign: "top" }),
    box(undefined, "Blocco 1", 20, 50, 130, 60, "#e7f5ff", { font: 16 }),
    box(undefined, "Blocco 2", 190, 50, 130, 60, "#e7f5ff", { font: 16 }),
    box(undefined, "Blocco 3", 105, 140, 130, 60, "#e7f5ff", { font: 16 }),
  ]),
  entry("arc", "stakeholder", "Stakeholder", [box(undefined, "Stakeholder\nRuolo · aspettative", 0, 0, 220, 90, "#e7f5ff", { round: true, font: 16 })]),
  entry("arc", "scenario-qualita", "Scenario di qualità", [
    box(undefined, "Scenario di qualità", 0, 0, 320, 40, "#d0ebff"),
    box(undefined, "Stimolo: …", 0, 40, 320, 46, "#ffffff", { align: "left", font: 16 }),
    box(undefined, "Ambiente: …", 0, 86, 320, 46, "#ffffff", { align: "left", font: 16 }),
    box(undefined, "Risposta: …", 0, 132, 320, 46, "#ffffff", { align: "left", font: 16 }),
    box(undefined, "Misura: …", 0, 178, 320, 46, "#ffffff", { align: "left", font: 16 }),
  ]),
  entry("arc", "rischio", "Rischio / debito tecnico", [box(undefined, "Rischio / debito tecnico\n…", 0, 0, 230, 110, "#ffc9c9", { stroke: "#e03131", align: "left", valign: "top", font: 16 })]),
  entry("arc", "concetto-trasversale", "Concetto trasversale", [box(undefined, "Concetto trasversale\n(es. sicurezza, logging)", 0, 0, 270, 90, "#f3d9fa", { round: true, dashed: true, font: 16 })]),
];

export const LIBRARY: LibraryEntry[] = [...uml, ...relations, ...c4, ...infra, ...services, ...arc];

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

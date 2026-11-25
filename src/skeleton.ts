// Mattoni comuni per template e libreria: dati puri (skeleton per `convertToExcalidrawElements`), senza importare Excalidraw.
export type Sk = any;

export interface BoxOpts {
  stroke?: string;
  labelColor?: string;
  font?: number;
  align?: "left" | "center";
  valign?: "top" | "middle";
  dashed?: boolean;
  round?: boolean;
  extra?: Record<string, unknown>;
}

/** Rettangolo con testo opzionale al centro (o allineato), stile pulito (`roughness: 0`). Senza `id`, Excalidraw ne assegna uno. */
export const box = (id: string | undefined, text: string, x: number, y: number, width: number, height: number, bg = "#ffffff", o: BoxOpts = {}): Sk => ({
  type: "rectangle",
  ...(id ? { id } : {}),
  x,
  y,
  width,
  height,
  backgroundColor: bg,
  fillStyle: "solid",
  strokeColor: o.stroke ?? "#1e1e1e",
  strokeStyle: o.dashed ? "dashed" : "solid",
  roughness: 0,
  roundness: o.round ? { type: 3 } : null,
  ...(text ? { label: { text, fontSize: o.font ?? 18, strokeColor: o.labelColor ?? "#1e1e1e", textAlign: o.align ?? "center", verticalAlign: o.valign ?? "middle" } } : {}),
  ...(o.extra ?? {}),
});

// Assegnazione dei partecipanti alle stanze: funzioni pure, senza dipendenze di Node, usate dal server e dall'interfaccia.
export const MAX_AULA = 50; // lunghezza massima del nome dell'aula se si usano le stanze
export const MIN_ROOMS = 2;
export const MAX_ROOMS = 12;
export const MAX_ASSIGN = 200;

/** Nome della board di una stanza: `<aula>-r<turno>-s<n>` (con l'aula di al massimo 50 caratteri resta entro i 64 di una board). */
export const roomId = (aula: string, round: number, n: number): string => `${aula}-r${round}-s${n}`;

export type ValidAssign = { ok: true; rooms: number; assign: Map<string, number> } | { ok: false; motivo: string };

/** Controlla numero di stanze e assegnazioni; `allowed` sono le chiavi dei partecipanti che si possono assegnare (i collegati non-trainer). */
export function validateAssign(rooms: unknown, assign: unknown, allowed: Set<string>): ValidAssign {
  if (typeof rooms !== "number" || !Number.isInteger(rooms) || rooms < MIN_ROOMS || rooms > MAX_ROOMS) {
    return { ok: false, motivo: `Le stanze devono essere da ${MIN_ROOMS} a ${MAX_ROOMS}.` };
  }
  if (!assign || typeof assign !== "object" || Array.isArray(assign)) return { ok: false, motivo: "Assegnazioni non valide." };
  const entries = Object.entries(assign as Record<string, unknown>);
  if (!entries.length) return { ok: false, motivo: "Assegna almeno una persona a una stanza." };
  if (entries.length > MAX_ASSIGN) return { ok: false, motivo: `Al massimo ${MAX_ASSIGN} assegnazioni.` };
  const map = new Map<string, number>(); // Map: una chiave come "__proto__" non fa danni
  for (const [key, n] of entries) {
    if (!allowed.has(key)) return { ok: false, motivo: "Una persona assegnata non è più collegata all'aula." };
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > rooms) return { ok: false, motivo: `La stanza deve essere un numero da 1 a ${rooms}.` };
    map.set(key, n);
  }
  return { ok: true, rooms, assign: map };
}

/** Distribuisce a caso e in modo equilibrato (le stanze differiscono al massimo di una persona). */
export function randomAssign(keys: string[], rooms: number, rand: () => number = Math.random): Record<string, number> {
  const a = [...keys];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  const out: Record<string, number> = Object.create(null);
  a.forEach((k, i) => (out[k] = (i % rooms) + 1));
  return out;
}

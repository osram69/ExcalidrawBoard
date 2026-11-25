/** Conteggio per id da un oggetto ricevuto dal server: legge solo proprietà proprie, così un id come "__proto__" non restituisce `Object.prototype`. */
export function countOf(rec: Record<string, number>, id: string): number {
  return Object.hasOwn(rec, id) ? rec[id] : 0;
}

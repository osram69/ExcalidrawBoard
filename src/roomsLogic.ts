// Logica pura del pannello delle stanze (provata in Node, senza React).
export interface PresencePerson {
  key: string;
  name: string;
  role: "editor" | "participant" | "viewer";
}
export interface RoundInfo {
  round: number;
  rooms: { n: number; id: string; members: { key: string; name: string }[] }[];
}
export interface PresenceInfo {
  rooms: Record<string, PresencePerson[]>;
  current: RoundInfo | null;
  history: RoundInfo[];
}

/** Dove si trova una board: "Aula", "Stanza n" (turno aperto), "Stanza n (turno k)" (turni passati) o il suo nome. */
export function placeLabel(boardId: string, aula: string, p: PresenceInfo | null): string {
  if (boardId === aula) return "Aula";
  const cur = p?.current?.rooms.find((r) => r.id === boardId);
  if (cur) return `Stanza ${cur.n}`;
  for (const h of p?.history ?? []) {
    const r = h.rooms.find((x) => x.id === boardId);
    if (r) return `Stanza ${r.n} (turno ${h.round})`;
  }
  return boardId;
}

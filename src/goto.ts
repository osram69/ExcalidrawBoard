// Spostamento tra board (aula e stanze): il server manda `goto` con un token firmato; qui lo si salva e si apre la nuova board.
import type { Stores } from "./remember";

const ROOM = /^[A-Za-z0-9_-]{1,64}$/;

/** Indirizzo della board; rifiuta nomi che non siano una board valida (niente `/`, `..`, spazi). */
export function gotoUrl(room: string): string {
  if (!ROOM.test(room)) throw new Error("Board non valida");
  return `/b/${room}`;
}

/** Salva il token ricevuto per la nuova board nella scheda del browser e toglie un eventuale accesso ricordato sul dispositivo per la stessa board. */
export function saveGotoToken(s: Stores, room: string, token: string): void {
  if (!ROOM.test(room)) throw new Error("Board non valida");
  try {
    s.session.setItem(`board:token:${room}`, token);
  } catch {
    /* sessionStorage non disponibile: la nuova pagina chiederà il login */
  }
  try {
    s.local.removeItem(`board:token:${room}`);
  } catch {
    /* ignora */
  }
}

/** Se il server dice che la stanza è chiusa (o non è della persona), l'aula a cui tornare. */
export function closedAula(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const j = json as { motivo?: unknown; aula?: unknown };
  return j.motivo === "stanza chiusa" && typeof j.aula === "string" && ROOM.test(j.aula) ? j.aula : null;
}

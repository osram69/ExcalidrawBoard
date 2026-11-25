// Accesso del trainer con l'account Cube Academy: la board manda al login del sito e il sito rimanda qui con un token firmato (?t=…).
const BOARD = /^[A-Za-z0-9_-]{1,64}$/;

export const validBoardName = (s: string): boolean => BOARD.test(s);

/**
 * Indirizzo a cui mandare il trainer: il login del sito (`base`) con la board richiesta (`room`) e dove tornare (`return` = indirizzo della board).
 * Conserva i parametri già presenti in `base`. Rifiuta nomi di board non validi e indirizzi che non siano http(s).
 */
export function trainerLoginRedirect(base: string, room: string, origin: string): string {
  if (!validBoardName(room)) throw new Error("Nome di board non valido");
  let u: URL;
  try {
    u = new URL(base);
  } catch {
    throw new Error("Indirizzo del login del trainer non valido");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Indirizzo del login del trainer non valido");
  u.searchParams.set("room", room);
  u.searchParams.set("return", `${origin.replace(/\/+$/, "")}/b/${room}`);
  return u.toString();
}

// Messaggi dei gadget (timer, votazione): controllo del ruolo e smistamento. Il server è l'unica fonte di verità.
import type { Room, Peer } from "./rooms.ts";
import type { TimerState } from "./timer.ts";

const isObj = (m: unknown): m is Record<string, unknown> => !!m && typeof m === "object" && !Array.isArray(m);

/** `true` se il messaggio era di questa funzione (anche se scartato), così il chiamante non lo tratta altrove. */
export function handleFeatureMessage(r: Room, peer: Peer, msg: unknown): boolean {
  if (!isObj(msg)) return false;
  if (msg.t === "timer") {
    if (peer.role === "editor" && r.timer.apply(msg.action, msg.seconds)) {
      r.broadcast({ t: "timer", state: r.timer.state, now: Date.now() });
    }
    return true;
  }
  return false;
}

/** Stato dei gadget da includere nel messaggio `init` di chi si collega. */
export function featureSnapshot(r: Room, _peer: Peer): { timer: { state: TimerState; now: number } } {
  return { timer: { state: r.timer.state, now: Date.now() } };
}

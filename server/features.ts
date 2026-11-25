// Messaggi dei gadget (timer, votazione): controllo del ruolo e smistamento. Il server è l'unica fonte di verità.
import type { Where } from "./course.ts";
import { handleRoomsMessage } from "./rooms-actions.ts";
import type { Room, Peer } from "./rooms.ts";
import type { TimerState } from "./timer.ts";
import type { MyVotes, VotePublic } from "./votes.ts";

const isObj = (m: unknown): m is Record<string, unknown> => !!m && typeof m === "object" && !Array.isArray(m);

const sendTo = (peer: Peer, msg: unknown) => {
  if (peer.ws.readyState === 1) peer.ws.send(JSON.stringify(msg));
};

const sendMine = (r: Room, peer: Peer) => sendTo(peer, { t: "my-votes", ...r.votes.mine(peer.key) });

/** I voti sono della persona (chiave utente), non della scheda: si aggiornano tutte le schede con la stessa chiave. */
const sendMineToSameUser = (r: Room, key: string) => {
  for (const p of r.peers) if (p.key === key) sendMine(r, p);
};

/** Da chiamare dopo che degli elementi sono stati accettati: se una nota non è più votabile i suoi voti decadono e tutti vedono i nuovi conteggi. */
export function onElementsChanged(r: Room): void {
  if (!r.votes.prune()) return;
  r.broadcast({ t: "votes", ...r.votes.publicState() });
  for (const p of r.peers) sendMine(r, p);
}

/** `true` se il messaggio era di questa funzione (anche se scartato), così il chiamante non lo tratta altrove. */
export function handleFeatureMessage(r: Room, peer: Peer, msg: unknown): boolean {
  if (!isObj(msg)) return false;
  if (msg.t === "timer") {
    if (peer.role === "editor" && r.timer.apply(msg.action, msg.seconds)) {
      // il timer è unico per tutto il corso: lo stato arriva a tutte le board (aula e stanze); una board senza corso lo manda solo a sé
      (r.course ?? r).broadcast({ t: "timer", state: r.timer.state, now: Date.now() });
    }
    return true;
  }
  if (msg.t === "vote-ctl") {
    if (peer.role === "editor" && r.votes.control(msg.action, msg.perPerson)) {
      r.broadcast({ t: "votes", ...r.votes.publicState() });
      for (const p of r.peers) sendMine(r, p); // il budget residuo di ciascuno può essere cambiato
    }
    return true;
  }
  if (typeof msg.t === "string" && msg.t.startsWith("rooms-")) return handleRoomsMessage(r, peer, msg);
  if (msg.t === "vote") {
    if ((peer.role === "editor" || peer.role === "participant") && r.votes.vote(peer.key, msg.id, msg.delta)) {
      r.broadcast({ t: "votes", ...r.votes.publicState() });
      sendMineToSameUser(r, peer.key);
    }
    return true;
  }
  return false;
}

/** Stato dei gadget da includere nel messaggio `init` di chi si collega. */
export function featureSnapshot(r: Room, peer: Peer): { timer: { state: TimerState; now: number }; votes: VotePublic; myVotes: MyVotes; course: Where | null } {
  return { timer: { state: r.timer.state, now: Date.now() }, votes: r.votes.publicState(), myVotes: r.votes.mine(peer.key), course: r.course ? r.course.whereIs(r.id) : null };
}

// Messaggi dei gadget (timer, votazione): controllo del ruolo e smistamento. Il server è l'unica fonte di verità.
import type { Room, Peer } from "./rooms.ts";
import type { TimerState } from "./timer.ts";
import type { MyVotes, VotePublic } from "./votes.ts";

const isObj = (m: unknown): m is Record<string, unknown> => !!m && typeof m === "object" && !Array.isArray(m);

const sendTo = (peer: Peer, msg: unknown) => {
  if (peer.ws.readyState === 1) peer.ws.send(JSON.stringify(msg));
};

const sendMine = (r: Room, peer: Peer) => sendTo(peer, { t: "my-votes", ...r.votes.mine(peer.key) });

/** `true` se il messaggio era di questa funzione (anche se scartato), così il chiamante non lo tratta altrove. */
export function handleFeatureMessage(r: Room, peer: Peer, msg: unknown): boolean {
  if (!isObj(msg)) return false;
  if (msg.t === "timer") {
    if (peer.role === "editor" && r.timer.apply(msg.action, msg.seconds)) {
      r.broadcast({ t: "timer", state: r.timer.state, now: Date.now() });
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
  if (msg.t === "vote") {
    if ((peer.role === "editor" || peer.role === "participant") && r.votes.vote(peer.key, msg.id, msg.delta)) {
      r.broadcast({ t: "votes", ...r.votes.publicState() });
      sendMine(r, peer);
    }
    return true;
  }
  return false;
}

/** Stato dei gadget da includere nel messaggio `init` di chi si collega. */
export function featureSnapshot(r: Room, peer: Peer): { timer: { state: TimerState; now: number }; votes: VotePublic; myVotes: MyVotes } {
  return { timer: { state: r.timer.state, now: Date.now() }, votes: r.votes.publicState(), myVotes: r.votes.mine(peer.key) };
}

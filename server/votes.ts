// Votazione con puntini sulle note di una board. Stato nel server, salvato su file: i client non possono falsarlo.
// Strutture interne con Map (gli id elemento e le chiavi utente possono essere "__proto__": passano i controlli sugli id).
import fs from "node:fs";
import path from "node:path";

export interface VotePublic {
  open: boolean;
  perPerson: number;
  totals: Record<string, number>;
}
export interface MyVotes {
  mine: Record<string, number>;
  left: number;
}

const DEFAULT_PER_PERSON = 5;

/** Budget valido: intero tra 1 e 20. */
const validBudget = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 20;

const toRecord = (m: Map<string, number>): Record<string, number> => Object.fromEntries(m); // fromEntries definisce proprietà proprie: sicuro con "__proto__"

export class RoomVotes {
  private open = false;
  private perPerson = DEFAULT_PER_PERSON;
  private votes = new Map<string, Map<string, number>>(); // chiave utente -> (id nota -> n)
  private dirty = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(private file: string, private isVotable: (id: string) => boolean) {
    try {
      const j = JSON.parse(fs.readFileSync(file, "utf8"));
      if (typeof j.open === "boolean") this.open = j.open;
      if (validBudget(j.perPerson)) this.perPerson = j.perPerson;
      for (const [key, list] of Array.isArray(j.votes) ? j.votes : []) {
        const m = new Map<string, number>();
        for (const [id, n] of list) if (typeof id === "string" && Number.isInteger(n) && n > 0) m.set(id, n);
        if (typeof key === "string" && m.size) this.votes.set(key, m);
      }
    } catch {
      /* nessuno stato salvato (o file illeggibile): si riparte da zero */
    }
  }

  /** Voti validi di una persona: solo su note ancora votabili. */
  private valid(key: string): Map<string, number> {
    const out = new Map<string, number>();
    for (const [id, n] of this.votes.get(key) ?? []) if (this.isVotable(id)) out.set(id, n);
    return out;
  }

  private used(key: string): number {
    let s = 0;
    for (const n of this.valid(key).values()) s += n;
    return s;
  }

  publicState(): VotePublic {
    const totals = new Map<string, number>();
    for (const key of this.votes.keys()) for (const [id, n] of this.valid(key)) totals.set(id, (totals.get(id) ?? 0) + n);
    return { open: this.open, perPerson: this.perPerson, totals: toRecord(totals) };
  }

  mine(key: string): MyVotes {
    return { mine: toRecord(this.valid(key)), left: Math.max(0, this.perPerson - this.used(key)) };
  }

  /** Comando del trainer; `true` se lo stato è cambiato. */
  control(action: unknown, perPerson?: unknown): boolean {
    if (action === "open") {
      if (perPerson !== undefined && !validBudget(perPerson)) return false;
      this.open = true;
      if (perPerson !== undefined) this.perPerson = perPerson as number;
    } else if (action === "close") {
      this.open = false;
    } else if (action === "reset") {
      this.votes.clear();
    } else {
      return false;
    }
    this.save();
    return true;
  }

  /** Aggiunge (+1) o toglie (−1) un puntino; `true` se il voto è stato registrato. */
  vote(key: string, id: unknown, delta: unknown): boolean {
    if (!this.open || typeof id !== "string" || (delta !== 1 && delta !== -1) || !this.isVotable(id)) return false;
    const mine = this.votes.get(key) ?? new Map<string, number>();
    const cur = mine.get(id) ?? 0;
    if (delta === 1) {
      if (this.perPerson - this.used(key) <= 0) return false;
      mine.set(id, cur + 1);
    } else {
      if (cur <= 0) return false;
      if (cur === 1) mine.delete(id);
      else mine.set(id, cur - 1);
    }
    if (mine.size) this.votes.set(key, mine);
    else this.votes.delete(key);
    this.save();
    return true;
  }

  /** Toglie per sempre i voti su note non più votabili (cancellate o non più note): così annullare una cancellazione non riporta in vita voti già "restituiti". */
  prune(): boolean {
    let changed = false;
    for (const [key, m] of this.votes) {
      for (const id of [...m.keys()]) {
        if (!this.isVotable(id)) {
          m.delete(id);
          changed = true;
        }
      }
      if (!m.size) this.votes.delete(key);
    }
    if (changed) this.save();
    return changed;
  }

  /** Il salvataggio è rimandato di 1 s (come la scena): molti voti in fila fanno una sola scrittura. */
  private save() {
    this.dirty = true;
    this.timer ??= setTimeout(() => this.flush(), 1000);
    this.timer.unref();
  }

  /** Scrive subito, se c'è qualcosa da scrivere (chiamato anche alla chiusura della stanza e allo spegnimento del server). */
  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty) return;
    this.dirty = false;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.part`;
      const votes = [...this.votes].map(([key, m]) => [key, [...m]]);
      fs.writeFileSync(tmp, JSON.stringify({ open: this.open, perPerson: this.perPerson, votes }));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error("Salvataggio dei voti non riuscito:", e);
    }
  }
}

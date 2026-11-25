import type { MyVotes, VotePublic } from "../server/votes.ts";

export interface NoteBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface ViewInfo {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

interface LayerProps {
  notes: NoteBox[];
  view: ViewInfo;
  votes: VotePublic;
  myVotes: MyVotes;
  canVote: boolean; // false per i viewer
  send: (msg: unknown) => void;
}

/** Badge dei voti agganciati all'angolo in alto a destra di ogni nota (livello HTML sopra il canvas). */
export function VoteLayer({ notes, view, votes, myVotes, canVote, send }: LayerProps) {
  return (
    <div className="vote-layer" aria-hidden={false}>
      {notes.map((n) => {
        const total = votes.totals[n.id] ?? 0;
        const mine = myVotes.mine[n.id] ?? 0;
        const interactive = votes.open && canVote;
        if (!total && !interactive) return null;
        const left = (n.x + n.width + view.scrollX) * view.zoom;
        const top = (n.y + view.scrollY) * view.zoom;
        return (
          <div key={n.id} className="vote-badge" style={{ left, top }}>
            {interactive && (
              <button disabled={mine <= 0} onClick={() => send({ t: "vote", id: n.id, delta: -1 })} aria-label="Togli un voto" title="Togli un voto">
                −
              </button>
            )}
            <span className={`vote-count${mine ? " mine" : ""}`} title={mine ? `Di cui tuoi: ${mine}` : undefined}>
              {total}
            </span>
            {interactive && (
              <button disabled={myVotes.left <= 0} onClick={() => send({ t: "vote", id: n.id, delta: 1 })} aria-label="Aggiungi un voto" title="Aggiungi un voto">
                +
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface PanelProps {
  votes: VotePublic;
  myVotes: MyVotes;
  isEditor: boolean;
  canVote: boolean;
  send: (msg: unknown) => void;
  budgetDraft: number;
  setBudgetDraft: (n: number) => void;
}

/** Pannello della votazione: puntini residui per tutti, comandi per il trainer. */
export function VotePanel({ votes, myVotes, isEditor, canVote, send, budgetDraft, setBudgetDraft }: PanelProps) {
  const hasTotals = Object.keys(votes.totals).length > 0;
  if (!votes.open && !isEditor) return null;
  return (
    <div className="board-votepanel" role="group" aria-label="Votazione">
      {votes.open ? (
        <span className="vote-info">
          Votazione aperta{canVote ? <> · hai <b>{myVotes.left}</b> {myVotes.left === 1 ? "puntino" : "puntini"}</> : null}
        </span>
      ) : (
        <span className="vote-info">Votazione</span>
      )}
      {isEditor && (
        <span className="vote-controls">
          {!votes.open && (
            <>
              <label className="vote-budget">
                puntini a testa
                <input type="number" min={1} max={20} value={budgetDraft} onChange={(e) => setBudgetDraft(Math.min(20, Math.max(1, Math.round(Number(e.target.value) || 1))))} />
              </label>
              <button onClick={() => send({ t: "vote-ctl", action: "open", perPerson: budgetDraft })}>{hasTotals ? "Riapri" : "Avvia"}</button>
            </>
          )}
          {votes.open && <button onClick={() => send({ t: "vote-ctl", action: "close" })}>Chiudi</button>}
          {hasTotals && (
            <button
              onClick={() => {
                if (window.confirm("Azzerare tutti i voti? L'operazione non si può annullare.")) send({ t: "vote-ctl", action: "reset" });
              }}
            >
              Azzera
            </button>
          )}
        </span>
      )}
    </div>
  );
}

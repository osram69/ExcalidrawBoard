import { useMemo, useState } from "react";
import { MAX_ROOMS, MIN_ROOMS, randomAssign } from "../server/assign.ts";
import { placeLabel, type PresenceInfo } from "./roomsLogic";

interface Props {
  presence: PresenceInfo | null;
  aula: string; // l'aula del corso
  here: string; // la board in cui si trova il trainer
  error: string | null;
  send: (msg: unknown) => void;
  clearError: () => void;
  onClose: () => void;
}

/** Pannello del trainer: chi è collegato e dove, crea stanze (assegnazione a mano o a caso), gestione del turno aperto, storico. */
export function Rooms({ presence, aula, here, error, send, clearError, onClose }: Props) {
  const [count, setCount] = useState(3);
  const [assign, setAssign] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false); // creazione in corso: evita il doppio clic
  const inAula = here === aula;

  const people = useMemo(() => {
    const out: { key: string; name: string; board: string; role: string }[] = [];
    for (const [board, list] of Object.entries(presence?.rooms ?? {})) for (const p of list) out.push({ key: p.key, name: p.name, board, role: p.role });
    return out;
  }, [presence]);
  const students = people.filter((p) => p.role !== "editor");
  const inAulaStudents = students.filter((p) => p.board === aula);
  const current = presence?.current ?? null;

  if (!presence) return <aside className="side-panel"><PanelHead title="Stanze" onClose={onClose} /><p className="side-note">Carico l'elenco dei collegati…</p></aside>;

  const nRooms = Math.min(MAX_ROOMS, Math.max(MIN_ROOMS, count));
  const chosen = Object.fromEntries(Object.entries(assign).filter(([k, n]) => n >= 1 && n <= nRooms && inAulaStudents.some((p) => p.key === k)));
  const create = () => {
    setBusy(true);
    send({ t: "rooms-create", rooms: nRooms, assign: chosen });
    window.setTimeout(() => setBusy(false), 8000); // se non arriva né l'esito né un errore, si può riprovare
  };

  return (
    <aside className="side-panel" aria-label="Stanze">
      <PanelHead title="Stanze" onClose={onClose} />
      {error && (
        <p role="alert" className="side-error">
          {error} <button onClick={clearError}>ok</button>
        </p>
      )}

      <section>
        <h3>Collegati ({people.length})</h3>
        <ul className="side-list">
          {people.map((p, i) => (
            <li key={`${p.key}-${i}`}>
              <span>{p.name}{p.role === "editor" ? " (trainer)" : ""}</span>
              <em>{placeLabel(p.board, aula, presence)}</em>
            </li>
          ))}
        </ul>
      </section>

      {!inAula && (
        <section>
          <button className="side-btn" onClick={() => send({ t: "rooms-visit", room: aula })}>← Torna in aula</button>
        </section>
      )}

      {inAula && !current && (
        <section>
          <h3>Crea stanze</h3>
          <label className="side-row">
            Numero di stanze
            <input type="number" min={MIN_ROOMS} max={MAX_ROOMS} value={count} onChange={(e) => setCount(Math.round(Number(e.target.value) || MIN_ROOMS))} />
          </label>
          {inAulaStudents.length === 0 ? (
            <p className="side-note">Nessun allievo collegato all'aula: appena entrano compaiono qui.</p>
          ) : (
            <ul className="side-list">
              {inAulaStudents.map((p) => (
                <li key={p.key}>
                  <span>{p.name}</span>
                  <select value={chosen[p.key] ?? 0} onChange={(e) => setAssign({ ...assign, [p.key]: Number(e.target.value) })} aria-label={`Stanza di ${p.name}`}>
                    <option value={0}>— resta in aula</option>
                    {Array.from({ length: nRooms }, (_, i) => (
                      <option key={i} value={i + 1}>Stanza {i + 1}</option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          )}
          <div className="side-actions">
            <button className="side-btn" disabled={!inAulaStudents.length} onClick={() => setAssign({ ...randomAssign(inAulaStudents.map((p) => p.key), nRooms) })}>
              Distribuisci a caso
            </button>
            <button className="side-btn primary" disabled={busy || !Object.keys(chosen).length} onClick={create}>
              {busy ? "Creo le stanze…" : "Crea e sposta"}
            </button>
          </div>
        </section>
      )}

      {current && (
        <section>
          <h3>Stanze in corso (turno {current.round})</h3>
          {current.rooms.map((r) => (
            <div key={r.id} className="side-room">
              <div className="side-room-head">
                <b>Stanza {r.n}</b>
                {r.id !== here && <button className="side-btn" onClick={() => send({ t: "rooms-visit", room: r.id })}>Entra</button>}
              </div>
              <ul className="side-list">
                {r.members.length === 0 && <li className="side-note">nessuno</li>}
                {r.members.map((m) => (
                  <li key={m.key}>
                    <span>{m.name}</span>
                    <select value={r.n} onChange={(e) => send({ t: "rooms-move", key: m.key, n: Number(e.target.value) })} aria-label={`Sposta ${m.name}`}>
                      {current.rooms.map((x) => (
                        <option key={x.n} value={x.n}>Stanza {x.n}</option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {inAulaStudents.filter((p) => !current.rooms.some((r) => r.members.some((m) => m.key === p.key))).length > 0 && (
            <div className="side-room">
              <b>In aula, non assegnati</b>
              <ul className="side-list">
                {inAulaStudents
                  .filter((p) => !current.rooms.some((r) => r.members.some((m) => m.key === p.key)))
                  .map((p) => (
                    <li key={p.key}>
                      <span>{p.name}</span>
                      <select value={0} onChange={(e) => e.target.value !== "0" && send({ t: "rooms-move", key: p.key, n: Number(e.target.value) })} aria-label={`Sposta ${p.name}`}>
                        <option value={0}>Sposta in…</option>
                        {current.rooms.map((x) => (
                          <option key={x.n} value={x.n}>Stanza {x.n}</option>
                        ))}
                      </select>
                    </li>
                  ))}
              </ul>
            </div>
          )}
          <button
            className="side-btn danger"
            onClick={() => {
              if (window.confirm("Chiudere le stanze? Tutti tornano in aula; le stanze restano salvate.")) send({ t: "rooms-close" });
            }}
          >
            Chiudi stanze
          </button>
        </section>
      )}

      {presence.history.length > 0 && (
        <section>
          <h3>Turni precedenti</h3>
          {presence.history.map((h) => (
            <div key={h.round} className="side-room">
              <b>Turno {h.round}</b>
              <div className="side-actions">
                {h.rooms.map((r) => (
                  <button key={r.id} className="side-btn" onClick={() => send({ t: "rooms-visit", room: r.id })} title={r.members.map((m) => m.name).join(", ") || "nessuno"}>
                    Apri stanza {r.n}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
    </aside>
  );
}

function PanelHead({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <header className="side-head">
      <h2>{title}</h2>
      <button onClick={onClose} aria-label="Chiudi il pannello">×</button>
    </header>
  );
}

export { PanelHead };

import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Board } from "./Board";
import { Login } from "./Login";
import { reasonText } from "./remember";
import { aulaOf, closedAula, gotoUrl } from "./goto";
import { acceptLogin, dropSession, loadSession, moveTo, roomFromPath, type BoardSession } from "./session";
import "./styles.css";

type State = { kind: "checking" } | { kind: "login"; reason?: string } | { kind: "board"; session: BoardSession };

/** Chiede al server se l'accesso salvato vale ancora (non scaduto, non di un'altra board). Se il server non risponde, non blocca. */
async function checkAccess(session: BoardSession): Promise<{ ok: true } | { ok: false; motivo?: string; aula?: string }> {
  try {
    const r = await fetch(`/auth/check?room=${encodeURIComponent(session.room)}`, { headers: { Authorization: `Bearer ${session.token}` } });
    if (r.ok) return { ok: true };
    if (r.status === 401) {
      const j = await r.json().catch(() => null);
      return { ok: false, motivo: j?.motivo, aula: closedAula(j) ?? undefined };
    }
  } catch {
    /* server non raggiungibile: la board mostrerà "offline" e ritenterà */
  }
  return { ok: true };
}

function BoardPage({ room }: { room: string }) {
  const [state, setState] = useState<State>(() => {
    const hadLink = new URL(location.href).searchParams.has("t"); // arrivato con un link firmato (che loadSession toglie dall'indirizzo)
    const s = loadSession(room);
    if (s) return { kind: "checking" };
    return hadLink ? { kind: "login", reason: "Il link non è valido o è scaduto: accedi con la password della sessione." } : { kind: "login" };
  });

  useEffect(() => {
    if (state.kind !== "checking") return;
    const s = loadSession(room);
    if (!s) return setState({ kind: "login" });
    let alive = true;
    checkAccess(s).then((r) => {
      if (!alive) return;
      if (r.ok) setState({ kind: "board", session: s });
      else if (r.aula) {
        // una stanza chiusa (o non assegnata a questa persona): si torna all'aula
        dropSession(room, false);
        location.replace(gotoUrl(r.aula));
      } else {
        dropSession(room, false);
        setState({ kind: "login", reason: reasonText(r.motivo) });
      }
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  // stabile tra un render e l'altro: è tra le dipendenze del collegamento della board, che altrimenti si riaprirebbe
  const onExpired = useCallback(() => {
    dropSession(room, false);
    setState({ kind: "login", reason: "La sessione è terminata o il tuo accesso è scaduto: accedi di nuovo." });
  }, [room]);

  // chi arriva a una stanza senza un accesso valido non ha un login per quella stanza: lo si porta al login dell'aula (da lì rientra nella sua stanza)
  useEffect(() => {
    if (state.kind !== "login") return;
    let alive = true;
    fetch(`/auth/aula?room=${encodeURIComponent(room)}`)
      .then((r) => r.json())
      .then((j) => {
        const aula = aulaOf(j);
        if (alive && aula && aula !== room) location.replace(gotoUrl(aula));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [state.kind, room]);

  const onGoto = useCallback((to: string, token: string) => moveTo(to, token), []);
  const onBackToAula = useCallback(
    (aula: string) => {
      dropSession(room, false);
      location.assign(gotoUrl(aula));
    },
    [room],
  );

  if (state.kind === "checking") return <div className="board-msg"><p>Verifico l'accesso…</p></div>;
  if (state.kind === "login") {
    return (
      <Login
        room={room}
        reason={state.reason}
        onLogin={(token, profile) => {
          const s = acceptLogin(room, token, profile);
          setState(s ? { kind: "board", session: s } : { kind: "login", reason: "L'accesso ricevuto non è valido: riprova." });
        }}
      />
    );
  }
  return (
    <Board
      session={state.session}
      onExpired={onExpired}
      onGoto={onGoto}
      onBackToAula={onBackToAula}
      onLogout={
        state.session.email
          ? () => {
              dropSession(room, true);
              setState({ kind: "login" });
            }
          : undefined
      }
    />
  );
}

function Page() {
  const room = roomFromPath();
  if (!room) {
    return (
      <div className="board-msg">
        <h1>Board Cube Academy</h1>
        <p>Apri la board dal link che ti ha inviato il tuo trainer.</p>
      </div>
    );
  }
  return <BoardPage room={room} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Page />
  </StrictMode>
);

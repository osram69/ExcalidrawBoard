import { useEffect, useState, type FormEvent } from "react";
import { trainerLoginRedirect, validBoardName } from "./trainerLogin";

/** Pagina iniziale (senza nome di board): il trainer apre o crea una board con il suo account Cube Academy. */
export function Home() {
  const [trainerUrl, setTrainerUrl] = useState<string | null | undefined>(undefined); // undefined = sto leggendo la configurazione
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/auth/config")
      .then((r) => r.json())
      .then((j) => alive && setTrainerUrl(typeof j?.trainerLoginUrl === "string" ? j.trainerLoginUrl : null))
      .catch(() => alive && setTrainerUrl(null));
    return () => {
      alive = false;
    };
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    const board = name.trim();
    if (!validBoardName(board)) return setError("Il nome può avere solo lettere, numeri, - e _ (massimo 64 caratteri).");
    if (!trainerUrl) return;
    location.assign(trainerLoginRedirect(trainerUrl, board, location.origin));
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <h1>
          Cube<span>Academy</span> Board
        </h1>
        {trainerUrl === undefined ? null : trainerUrl ? (
          <>
            <p className="login-room">Sei un trainer? Apri o crea una board con il tuo account Cube Academy.</p>
            <label>
              Nome della board
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="per esempio isaqb-dic26" maxLength={64} required autoFocus />
            </label>
            {error && (
              <p role="alert" className="login-error">
                {error}
              </p>
            )}
            <button type="submit">Accedi come trainer</button>
          </>
        ) : (
          <p className="login-room">Apri la board dal link che ti ha inviato il tuo trainer.</p>
        )}
      </form>
    </div>
  );
}

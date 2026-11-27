import { useState, type FormEvent } from "react";
import { savedProfile } from "./session";
import { trainerLoginRedirect } from "./trainerLogin";

interface Props {
  room: string;
  reason?: string; // perché si è tornati al login (accesso scaduto, ecc.)
  trainerLoginUrl?: string | null; // login del trainer sul sito Cube Academy, se configurato
  onLogin: (token: string, profile: { nome: string; cognome: string; ricordami: boolean }) => void;
}

/** Pagina di accesso degli allievi: nome, cognome e la password della sessione (uguale per tutti). */
export function Login({ room, reason, trainerLoginUrl, onLogin }: Props) {
  const saved = savedProfile();
  const [nome, setNome] = useState(saved.nome);
  const [cognome, setCognome] = useState(saved.cognome);
  const [password, setPassword] = useState("");
  const [ricordami, setRicordami] = useState(saved.ricordami);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room, nome, cognome, password, ricordami }),
      });
      const j = await r.json().catch(() => null);
      if (r.ok && j?.token) {
        onLogin(j.token, { nome: nome.trim(), cognome: cognome.trim(), ricordami });
        return;
      }
      setError(j?.motivo || "Accesso non riuscito: riprova.");
    } catch {
      setError("Non riesco a contattare il server: controlla la connessione e riprova.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <h1>
          Cube<span>Academy</span> Board
        </h1>
        <p className="login-room">
          Board <b>{room}</b>
        </p>
        {reason && <p className="login-reason">{reason}</p>}
        <div className="login-row">
          <label>
            Nome
            <input value={nome} onChange={(e) => setNome(e.target.value)} required maxLength={40} autoComplete="given-name" autoFocus={!nome} />
          </label>
          <label>
            Cognome
            <input value={cognome} onChange={(e) => setCognome(e.target.value)} required maxLength={40} autoComplete="family-name" />
          </label>
        </div>
        <label>
          Password della sessione
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required maxLength={200} autoComplete="off" autoFocus={!!nome} />
        </label>
        <p className="login-hint">È la password che ti ha comunicato Cube Academy per questa sessione del corso.</p>
        <label className="login-check">
          <input type="checkbox" checked={ricordami} onChange={(e) => setRicordami(e.target.checked)} />
          Ricordami su questo dispositivo
        </label>
        {error && (
          <p role="alert" className="login-error">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy}>
          {busy ? "Accesso in corso…" : "Entra nella board"}
        </button>
        {trainerLoginUrl && (
          <div className="login-trainer">
            <span>Sei un trainer?</span>
            <button type="button" onClick={() => location.assign(trainerLoginRedirect(trainerLoginUrl, room, location.origin))}>
              Accedi come trainer
            </button>
          </div>
        )}
      </form>
    </div>
  );
}

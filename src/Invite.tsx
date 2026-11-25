import { useState } from "react";
import { PanelHead } from "./Rooms";

interface Props {
  room: string; // l'aula
  token: string; // token da trainer
  onClose: () => void;
}

/** Pannello "Invita": il link da dare agli allievi e la password della sessione (con la data di fine, facoltativa). */
export function Invite({ room, token, onClose }: Props) {
  const link = `${location.origin}/b/${room}`;
  const [password, setPassword] = useState("");
  const [until, setUntil] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(body: Record<string, unknown>, okText: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/auth/access?room=${encodeURIComponent(room)}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => null);
      if (r.ok) {
        setMsg({ ok: true, text: okText });
        setPassword("");
      } else setMsg({ ok: false, text: j?.motivo || "Non sono riuscito a salvare." });
    } catch {
      setMsg({ ok: false, text: "Non riesco a contattare il server." });
    } finally {
      setBusy(false);
    }
  }

  const submit = () => {
    const body: Record<string, unknown> = {};
    if (password) body.password = password;
    if (until) {
      const [y, m, d] = until.split("-").map(Number);
      body.until = new Date(y, m - 1, d, 23, 59, 59, 999).getTime(); // fino a fine giornata
    }
    if (!Object.keys(body).length) return setMsg({ ok: false, text: "Scrivi la password e/o scegli la data di fine." });
    void save(body, "Salvato. Gli allievi entrano con la password della sessione.");
  };

  return (
    <aside className="side-panel" aria-label="Invita gli allievi">
      <PanelHead title="Invita gli allievi" onClose={onClose} />
      <section>
        <h3>Link per gli allievi</h3>
        <p className="side-note">Lo stesso per tutti: chi lo apre trova la pagina di accesso con nome, cognome, email e la password della sessione.</p>
        <div className="side-row">
          <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Link per gli allievi" />
          <button className="side-btn" onClick={() => void navigator.clipboard?.writeText(link).then(() => setMsg({ ok: true, text: "Link copiato." }))}>
            Copia
          </button>
        </div>
      </section>
      <section>
        <h3>Password della sessione</h3>
        <label className="side-col">
          Password (da 8 a 200 caratteri)
          <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} maxLength={200} autoComplete="off" placeholder="la stessa che comunichi agli iscritti" />
        </label>
        <label className="side-col">
          Ultimo giorno della sessione (facoltativo)
          <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </label>
        <div className="side-actions">
          <button className="side-btn primary" disabled={busy} onClick={submit}>
            Salva
          </button>
          <button className="side-btn" disabled={busy} onClick={() => void save({ until: null }, "Data di fine tolta.")} title="Toglie la data di fine, senza cambiare la password">
            Togli la data di fine
          </button>
        </div>
        {msg && (
          <p role="status" className={msg.ok ? "side-ok" : "side-error"}>
            {msg.text}
          </p>
        )}
      </section>
    </aside>
  );
}

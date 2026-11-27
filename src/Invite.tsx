import { useEffect, useState } from "react";
import { PanelHead } from "./Rooms";
import { generatePassword } from "./invitePassword";

interface Props {
  room: string; // l'aula
  token: string; // token da trainer
  onClose: () => void;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** ms epoch -> valore per <input type="date"> nel fuso del browser ("" se non c'è). */
const toInputDate = (ms: number | null) => {
  if (ms === null) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
/** valore di <input type="date"> -> fine di quella giornata, in ms epoch (null se vuoto). */
const fromInputDate = (v: string) => {
  if (!v) return null;
  const [y, m, d] = v.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
};

/** Testo da incollare in una mail o in chat: link, password e (se c'è) l'ultimo giorno, da poter rimandare quante volte serve. */
function inviteText(link: string, password: string, until: string): string {
  const fine = until ? `\nDisponibile fino al ${until.split("-").reverse().join("/")}.` : "";
  return `Accesso alla board del corso\nLink: ${link}\nPassword: ${password}\nAll'apertura inserisci nome, cognome, email e la password.${fine}`;
}

/** Pannello "Invita": il link da dare agli allievi e la password della sessione (con la data di fine, facoltativa). */
export function Invite({ room, token, onClose }: Props) {
  const link = `${location.origin}/b/${room}`;
  const [password, setPassword] = useState("");
  const [until, setUntil] = useState("");
  // ciò che il server ha salvato: il pannello lo rilegge a ogni apertura, così la password non "sparisce"
  const [saved, setSaved] = useState<{ password: string; until: string; configured: boolean } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/auth/access?room=${encodeURIComponent(room)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const j = await r.json().catch(() => null);
        if (!alive) return;
        if (r.ok && j?.ok) {
          const s = { password: String(j.password ?? ""), until: toInputDate(j.until ?? null), configured: !!j.configured };
          setSaved(s);
          setPassword(s.password);
          setUntil(s.until);
        } else setMsg({ ok: false, text: j?.motivo || "Non riesco a leggere la password salvata." });
      } catch {
        if (alive) setMsg({ ok: false, text: "Non riesco a contattare il server." });
      }
    })();
    return () => {
      alive = false;
    };
  }, [room, token]);

  async function save(body: Record<string, unknown>, okText: string, next: { password: string; until: string }) {
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
        setSaved({ password: next.password, until: next.until, configured: true });
      } else setMsg({ ok: false, text: j?.motivo || "Non sono riuscito a salvare." });
    } catch {
      setMsg({ ok: false, text: "Non riesco a contattare il server." });
    } finally {
      setBusy(false);
    }
  }

  const dirty = !!saved && (password !== saved.password || until !== saved.until);

  const submit = () => {
    const body: Record<string, unknown> = {};
    if (password && password !== saved?.password) {
      if (password.length < 8) return setMsg({ ok: false, text: "La password deve avere almeno 8 caratteri." });
      body.password = password;
    }
    if (until !== (saved?.until ?? "")) body.until = fromInputDate(until);
    if (!Object.keys(body).length) return setMsg({ ok: false, text: saved?.configured ? "Nessuna modifica da salvare." : "Scrivi la password o premi Genera." });
    void save(body, "Salvato per questa aula. Gli allievi entrano con la password della sessione.", { password: password || saved?.password || "", until });
  };

  const generate = () => {
    setPassword(generatePassword());
    setMsg({ ok: true, text: "Password generata: premi Salva per attivarla." });
  };

  const copy = (text: string, done: string) => void navigator.clipboard?.writeText(text).then(() => setMsg({ ok: true, text: done }));

  // password già impostata in passato, quando il server non la conservava leggibile: non si può rileggere
  const legacy = !!saved?.configured && !saved.password;

  return (
    <aside className="side-panel" aria-label="Invita gli allievi">
      <PanelHead title="Invita gli allievi" onClose={onClose} />
      <section>
        <h3>Link per gli allievi</h3>
        <p className="side-note">Lo stesso per tutti: chi lo apre trova la pagina di accesso con nome, cognome, email e la password della sessione.</p>
        <div className="side-row">
          <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Link per gli allievi" />
          <button className="side-btn" onClick={() => copy(link, "Link copiato.")}>
            Copia
          </button>
        </div>
      </section>
      <section>
        <h3>Password della sessione</h3>
        <p className="side-note">Vale per questa aula. Resta salvata: la ritrovi qui ogni volta che apri il pannello.</p>
        <label className="side-col">
          Password (da 8 a 200 caratteri)
          <div className="side-row">
            <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} maxLength={200} autoComplete="off" placeholder="la stessa che comunichi agli iscritti" />
            <button className="side-btn" disabled={busy || !password} onClick={() => copy(password, "Password copiata.")} title="Copia la password">
              Copia
            </button>
          </div>
        </label>
        {legacy && <p className="side-note">Per questa aula c'è già una password, ma è stata impostata prima che il pannello la conservasse e non si può rileggere. Scrivine una nuova o premi Genera.</p>}
        <label className="side-col">
          Ultimo giorno della sessione (facoltativo)
          <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </label>
        <div className="side-actions">
          <button className="side-btn primary" disabled={busy || !saved} onClick={submit}>
            Salva
          </button>
          <button className="side-btn" disabled={busy || !saved} onClick={generate} title="Compila il campo con una password casuale di 8 caratteri (poi premi Salva)">
            Genera
          </button>
          <button
            className="side-btn"
            disabled={busy || !saved || !until}
            onClick={() => {
              setUntil("");
              void save({ until: null }, "Data di fine tolta.", { password: saved?.password ?? "", until: "" });
            }}
            title="Toglie la data di fine, senza cambiare la password"
          >
            Togli la data di fine
          </button>
        </div>
        <div className="side-actions">
          <button
            className="side-btn"
            disabled={busy || !saved?.password}
            onClick={() => copy(inviteText(link, saved?.password ?? "", saved?.until ?? ""), "Messaggio copiato: incollalo in una mail o in chat.")}
            title="Copia link, password e ultimo giorno in un messaggio pronto da incollare (usa la password salvata)"
          >
            Copia messaggio per gli allievi
          </button>
        </div>
        {dirty && <p className="side-note">Modifiche non ancora salvate: il messaggio copiato usa la password già salvata.</p>}
        {msg && (
          <p role="status" className={msg.ok ? "side-ok" : "side-error"}>
            {msg.text}
          </p>
        )}
      </section>
    </aside>
  );
}

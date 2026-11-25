import { useEffect, useRef, useState } from "react";
import type { TimerState } from "../server/timer.ts";
import { formatClock, remainingMs } from "./timerMath";

const PRESETS = [5, 10, 15, 30]; // minuti

interface Props {
  state: TimerState;
  offsetMs: number; // ora del server − ora del client
  canControl: boolean; // solo il trainer (il server lo impone comunque)
  send: (msg: unknown) => void;
}

export function TimerPill({ state, offsetMs, canControl, send }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [flash, setFlash] = useState(false);
  const [muted, setMuted] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const prevLeft = useRef(0);

  // il browser permette l'audio solo dopo un gesto dell'utente: si prepara al primo clic sulla pagina
  useEffect(() => {
    const arm = () => {
      try {
        audio.current ??= new AudioContext();
      } catch {
        /* audio non disponibile */
      }
    };
    window.addEventListener("pointerdown", arm, { once: true });
    return () => window.removeEventListener("pointerdown", arm);
  }, []);

  useEffect(() => {
    if (state.status !== "running") return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [state.status]);

  const left = remainingMs(state, offsetMs, now);

  // scadenza osservata dal vivo (non quando ci si collega a timer già scaduto): lampeggio e beep
  useEffect(() => {
    const justEnded = state.status === "running" && prevLeft.current > 0 && left === 0;
    prevLeft.current = left;
    if (!justEnded) return;
    setFlash(true);
    window.setTimeout(() => setFlash(false), 5000);
    const ctx = audio.current;
    if (ctx && !muted) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 1.2);
    }
  }, [left, state.status, muted]);

  if (state.status === "idle" && !canControl) return null;

  const ended = state.status === "done" || (state.status === "running" && left === 0);
  return (
    <div className={`board-timer${flash ? " flash" : ""}${ended ? " ended" : ""}`} role="timer" aria-label="Timer">
      {state.status !== "idle" && <span className="timer-clock">{formatClock(left)}</span>}
      {state.status === "paused" && <span className="timer-tag">in pausa</span>}
      {canControl && (
        <span className="timer-controls">
          {state.status === "idle" || ended ? (
            PRESETS.map((m) => (
              <button key={m} onClick={() => send({ t: "timer", action: "start", seconds: m * 60 })} title={`Avvia ${m} minuti`}>
                {m} min
              </button>
            ))
          ) : (
            <>
              {state.status === "running" && <button onClick={() => send({ t: "timer", action: "pause" })}>Pausa</button>}
              {state.status === "paused" && <button onClick={() => send({ t: "timer", action: "resume" })}>Riprendi</button>}
              <button onClick={() => send({ t: "timer", action: "extend", seconds: 60 })}>+1 min</button>
            </>
          )}
          {state.status !== "idle" && <button onClick={() => send({ t: "timer", action: "reset" })}>Azzera</button>}
        </span>
      )}
      <button className="timer-mute" onClick={() => setMuted((m) => !m)} title={muted ? "Attiva il suono" : "Silenzia"} aria-label={muted ? "Attiva il suono" : "Silenzia"}>
        {muted ? "🔇" : "🔔"}
      </button>
    </div>
  );
}

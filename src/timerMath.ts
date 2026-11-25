// Calcoli del timer lato client: l'ora di riferimento è quella del server, mai l'orologio locale da solo.
import type { TimerState } from "../server/timer.ts";

/** Residuo in ms. `serverOffsetMs` = ora del server − ora del client, misurata alla ricezione del messaggio. */
export function remainingMs(s: TimerState, serverOffsetMs: number, clientNow: number): number {
  if (s.status === "running") return Math.max(0, s.endsAt - (clientNow + serverOffsetMs));
  if (s.status === "paused") return s.remainingMs;
  return 0;
}

/** `mm:ss` (secondi arrotondati per eccesso), `H:mm:ss` da un'ora in su. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}

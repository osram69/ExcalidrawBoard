// Timer condiviso di una board: lo stato vive nel server, i client calcolano il residuo dall'ora del server.
export type TimerStatus = "idle" | "running" | "paused" | "done";

export interface TimerState {
  status: TimerStatus;
  endsAt: number; // ms epoch del server (solo running/done)
  remainingMs: number;
  durationMs: number;
}

const MAX_SECONDS = 10_800; // 3 ore

/** Durata valida: numero finito, intero dopo `floor`, tra 1 e 10800 secondi. */
const toMs = (seconds: unknown): number | null => {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  const s = Math.floor(seconds);
  return s >= 1 && s <= MAX_SECONDS ? s * 1000 : null;
};

export class RoomTimer {
  private status: "idle" | "running" | "paused" = "idle";
  private endsAt = 0;
  private paused = 0;
  private duration = 0;

  constructor(private now: () => number = Date.now) {}

  get state(): TimerState {
    if (this.status === "running") {
      const left = this.endsAt - this.now();
      if (left <= 0) return { status: "done", endsAt: this.endsAt, remainingMs: 0, durationMs: this.duration };
      return { status: "running", endsAt: this.endsAt, remainingMs: left, durationMs: this.duration };
    }
    if (this.status === "paused") return { status: "paused", endsAt: 0, remainingMs: this.paused, durationMs: this.duration };
    return { status: "idle", endsAt: 0, remainingMs: 0, durationMs: 0 };
  }

  /** Applica un comando; `true` se lo stato è cambiato. */
  apply(action: unknown, seconds?: unknown): boolean {
    const t = this.now();
    switch (action) {
      case "start": {
        const ms = toMs(seconds);
        if (ms === null) return false;
        this.status = "running";
        this.endsAt = t + ms;
        this.duration = ms;
        return true;
      }
      case "pause": {
        if (this.status !== "running") return false;
        this.paused = Math.max(0, this.endsAt - t);
        this.status = "paused";
        return true;
      }
      case "resume": {
        if (this.status !== "paused") return false;
        this.endsAt = t + this.paused;
        this.status = "running";
        return true;
      }
      case "extend": {
        const ms = toMs(seconds);
        if (ms === null || this.status === "idle") return false;
        if (this.status === "running") this.endsAt = Math.max(this.endsAt, t) + ms; // scaduto: riparte da adesso
        else this.paused += ms;
        this.duration += ms;
        return true;
      }
      case "reset": {
        this.status = "idle";
        this.endsAt = 0;
        this.paused = 0;
        this.duration = 0;
        return true;
      }
      default:
        return false;
    }
  }
}

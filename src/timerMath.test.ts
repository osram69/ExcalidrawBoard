import assert from "node:assert/strict";
import { test } from "node:test";
import type { TimerState } from "../server/timer.ts";
import { formatClock, remainingMs } from "./timerMath.ts";

const running = (endsAt: number): TimerState => ({ status: "running", endsAt, remainingMs: 0, durationMs: 0 });

test("remainingMs usa l'ora del server: un orologio client sbagliato non cambia il residuo", () => {
  const serverNow = 1_000_000;
  const endsAt = serverNow + 120_000;
  // client con orologio indietro di 1 ora: l'offset corregge lo scarto
  const clientNow = serverNow - 3_600_000;
  const offset = serverNow - clientNow;
  assert.equal(remainingMs(running(endsAt), offset, clientNow), 120_000);
  assert.equal(remainingMs(running(endsAt), offset, clientNow + 5_000), 115_000);
});

test("remainingMs non scende sotto zero", () => {
  assert.equal(remainingMs(running(1000), 0, 5000), 0);
});

test("paused ignora l'orologio, idle e done valgono 0", () => {
  assert.equal(remainingMs({ status: "paused", endsAt: 0, remainingMs: 42_000, durationMs: 0 }, 999, 12345), 42_000);
  assert.equal(remainingMs({ status: "idle", endsAt: 0, remainingMs: 0, durationMs: 0 }, 0, 0), 0);
  assert.equal(remainingMs({ status: "done", endsAt: 5, remainingMs: 0, durationMs: 0 }, 0, 0), 0);
});

test("formatClock", () => {
  assert.equal(formatClock(0), "00:00");
  assert.equal(formatClock(59_001), "01:00");
  assert.equal(formatClock(3_600_000), "1:00:00");
  assert.equal(formatClock(754_000), "12:34");
});

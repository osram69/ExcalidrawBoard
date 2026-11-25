import assert from "node:assert/strict";
import { test } from "node:test";
import { RoomTimer } from "./timer.ts";

const make = () => {
  const clock = { t: 1_000_000 };
  const timer = new RoomTimer(() => clock.t);
  return { clock, timer };
};

test("start imposta lo stato running con scadenza e durata", () => {
  const { clock, timer } = make();
  assert.equal(timer.apply("start", 300), true);
  assert.deepEqual(timer.state, { status: "running", endsAt: clock.t + 300_000, remainingMs: 300_000, durationMs: 300_000 });
});

test("pause conserva il tempo residuo", () => {
  const { clock, timer } = make();
  timer.apply("start", 300);
  clock.t += 100_000;
  assert.equal(timer.apply("pause"), true);
  assert.equal(timer.state.status, "paused");
  assert.equal(timer.state.remainingMs, 200_000);
});

test("resume ricalcola la scadenza dal residuo", () => {
  const { clock, timer } = make();
  timer.apply("start", 300);
  clock.t += 100_000;
  timer.apply("pause");
  clock.t += 50_000;
  assert.equal(timer.apply("resume"), true);
  assert.equal(timer.state.status, "running");
  assert.equal(timer.state.endsAt, clock.t + 200_000);
});

test("extend aggiunge un minuto in running", () => {
  const { clock, timer } = make();
  timer.apply("start", 300);
  assert.equal(timer.apply("extend", 60), true);
  assert.equal(timer.state.endsAt, clock.t + 360_000);
});

test("extend aggiunge un minuto in pausa", () => {
  const { clock, timer } = make();
  timer.apply("start", 300);
  clock.t += 100_000;
  timer.apply("pause");
  assert.equal(timer.apply("extend", 60), true);
  assert.equal(timer.state.remainingMs, 260_000);
});

test("extend da idle è rifiutato", () => {
  const { timer } = make();
  assert.equal(timer.apply("extend", 60), false);
  assert.equal(timer.state.status, "idle");
});

test("superata la scadenza lo stato è done", () => {
  const { clock, timer } = make();
  timer.apply("start", 10);
  clock.t += 10_000;
  assert.equal(timer.state.status, "done");
  assert.equal(timer.state.remainingMs, 0);
});

test("extend dopo la scadenza riparte da adesso", () => {
  const { clock, timer } = make();
  timer.apply("start", 10);
  clock.t += 30_000;
  assert.equal(timer.state.status, "done");
  assert.equal(timer.apply("extend", 60), true);
  assert.equal(timer.state.status, "running");
  assert.equal(timer.state.endsAt, clock.t + 60_000);
});

test("reset riporta a idle", () => {
  const { timer } = make();
  timer.apply("start", 300);
  assert.equal(timer.apply("reset"), true);
  assert.equal(timer.state.status, "idle");
  assert.equal(timer.state.remainingMs, 0);
});

test("durate non valide sono rifiutate e lo stato non cambia", () => {
  for (const bad of [0, -5, 10_801, NaN, Infinity, "300", undefined, null]) {
    const { timer } = make();
    assert.equal(timer.apply("start", bad), false, `seconds=${String(bad)}`);
    assert.equal(timer.state.status, "idle");
  }
});

test("azioni non ammesse nello stato corrente sono rifiutate", () => {
  const { timer } = make();
  assert.equal(timer.apply("pause"), false);
  assert.equal(timer.apply("resume"), false);
  assert.equal(timer.apply("boh"), false);
  assert.equal(timer.apply(42 as unknown), false);
  timer.apply("start", 60);
  assert.equal(timer.apply("resume"), false);
});

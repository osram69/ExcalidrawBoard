// Supporto ai test di aula e stanze: un server di prova e le funzioni per preparare corsi, trainer e allievi.
import fs from "node:fs";
import path from "node:path";
import { writeCourse, writeParent } from "./course-data.ts";
import { roomDir } from "./rooms.ts";
import { connect, tokenFor, type Client } from "./test-client.ts";
import { startServer, type TestServer } from "./test-server.ts";

export const SECRET = "chiave-di-prova";

export interface Fixture {
  srv: TestServer;
  trainer(room: string): string;
  student(room: string, uid: string, name?: string, exp?: number): string;
  seedCourse(aula: string, members: Record<number, string[]>, open?: boolean): string[];
  aulaConAllievi(aula: string, uids: string[], exp?: number): Promise<{ t: Client; kids: Client[] }>;
  roomsOnDisk(): string[];
  stop(): void;
}

export const peopleIn = (p: any, room: string) => (p.rooms[room] ?? []).map((x: any) => x.key).sort();
export const pause = (ms = 250) => new Promise((r) => setTimeout(r, ms));
export const gotoOf = (c: Client) => c.waitFor((m) => m.t === "goto");
export const elem = (id: string, extra: Record<string, unknown> = {}) => ({
  id, type: "rectangle", x: 10, y: 20, width: 100, height: 50, version: 1, versionNonce: 1, strokeColor: "#000", backgroundColor: "#fff", ...extra,
});

export async function startFixture(): Promise<Fixture> {
  const srv = await startServer({ BOARD_SECRET: SECRET });
  const trainer = (room: string) => tokenFor(SECRET, room, "editor", "trainer", "Trainer");
  const student = (room: string, uid: string, name = uid, exp?: number) => tokenFor(SECRET, room, "participant", uid, name, exp);
  return {
    srv, trainer, student,
    /** Corso su disco con un turno, come lo lascerebbe "Crea stanze" (da fare prima del primo collegamento a quelle board). */
    seedCourse(aula, members, open = true) {
      const rooms = Object.entries(members).map(([n, keys]) => ({ n: Number(n), id: `${aula}-r1-s${n}`, members: keys.map((key) => ({ key, name: key })) }));
      writeCourse(roomDir(srv.dataDir, aula), { round: 1, rounds: [{ round: 1, open, createdAt: 1, rooms }] });
      for (const r of rooms) writeParent(roomDir(srv.dataDir, r.id), { aula, round: 1, n: r.n });
      return rooms.map((r) => r.id);
    },
    /** Aula con il trainer e gli allievi collegati; il trainer ha già disegnato e1 (e2 cancellato, da non copiare). */
    async aulaConAllievi(aula, uids, exp) {
      const t = await connect(srv.url, aula, trainer(aula));
      t.send({ t: "els", els: [elem("e1"), elem("e2", { isDeleted: true })] });
      await pause();
      const kids: Client[] = [];
      for (const uid of uids) kids.push(await connect(srv.url, aula, student(aula, uid, uid[0].toUpperCase() + uid.slice(1), exp)));
      await t.waitFor((m) => m.t === "presence" && uids.every((u) => peopleIn(m, aula).includes(u)));
      return { t, kids };
    },
    roomsOnDisk: () => fs.readdirSync(path.join(srv.dataDir, "rooms")),
    stop: () => srv.stop(),
  };
}

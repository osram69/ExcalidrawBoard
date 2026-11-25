// Dati su disco del corso (aula e turni di stanze): `course.json` nella cartella dell'aula, `parent.json` in quella di ogni stanza.
import fs from "node:fs";
import path from "node:path";
import { ROOM_ID } from "./auth.ts";

export interface Member {
  key: string;
  name: string;
}
export interface RoomInfo {
  n: number;
  id: string;
  members: Member[];
}
export interface Round {
  round: number;
  open: boolean;
  createdAt: number;
  rooms: RoomInfo[];
}
export interface CourseData {
  round: number;
  rounds: Round[];
}

const COURSE = "course.json";
const PARENT = "parent.json";
const int = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

function validMember(m: any): m is Member {
  return !!m && typeof m.key === "string" && typeof m.name === "string";
}
function validRoom(r: any): r is RoomInfo {
  return !!r && int(r.n) && r.n >= 1 && typeof r.id === "string" && Array.isArray(r.members) && r.members.every(validMember);
}
function validRound(r: any): r is Round {
  return !!r && int(r.round) && typeof r.open === "boolean" && typeof r.createdAt === "number" && Array.isArray(r.rooms) && r.rooms.every(validRoom);
}

const empty = (): CourseData => ({ round: 0, rounds: [] });

export function readCourse(dir: string): CourseData {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, COURSE), "utf8"));
    if (!int(j?.round) || !Array.isArray(j.rounds) || !j.rounds.every(validRound)) return empty();
    return { round: j.round, rounds: j.rounds };
  } catch {
    return empty();
  }
}

function writeAtomic(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.part`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

export function writeCourse(dir: string, c: CourseData): void {
  writeAtomic(path.join(dir, COURSE), c);
}

export interface Parent {
  aula: string;
  round: number;
  n: number;
}

export function readParent(dir: string): Parent | null {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, PARENT), "utf8"));
    if (typeof j?.aula !== "string" || !ROOM_ID.test(j.aula) || !int(j.round) || j.round < 1 || !int(j.n) || j.n < 1) return null;
    return { aula: j.aula, round: j.round, n: j.n };
  } catch {
    return null;
  }
}

export function writeParent(dir: string, p: Parent): void {
  writeAtomic(path.join(dir, PARENT), p);
}

export const openRound = (c: CourseData): Round | null => c.rounds.find((r) => r.open) ?? null;

/** Stanza del turno aperto di cui la persona è membro (`null` se non è assegnata o il turno è chiuso). */
export function assignedRoom(c: CourseData, key: string): RoomInfo | null {
  const r = openRound(c);
  return r?.rooms.find((room) => room.members.some((m) => m.key === key)) ?? null;
}

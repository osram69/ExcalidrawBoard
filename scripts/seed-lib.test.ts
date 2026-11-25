import assert from "node:assert/strict";
import { test } from "node:test";
import { assignStudents, buildImageScene, groupRoom, imageInfo, parseArgs } from "./seed-lib.ts";

const ok = (r: any) => {
  assert.ok(!("errore" in r), `errore inatteso: ${r.errore}`);
  return r;
};

test("parseArgs: caso completo", () => {
  const a = ok(parseArgs(["isaqb-dic26", "4", "uml.png", "--server", "https://board.example.org/", "--base", "https://b.example.org", "--ore", "6", "--trainer", "Patrick", "--allievi", "allievi.txt"]));
  assert.deepEqual(a, {
    corso: "isaqb-dic26", gruppi: 4, materiale: { tipo: "immagine", percorso: "uml.png" },
    server: "https://board.example.org", base: "https://b.example.org", ore: 6, trainer: "Patrick", allievi: "allievi.txt",
  });
});

test("parseArgs: predefiniti e board come materiale", () => {
  const a = ok(parseArgs(["corso", "3", "board:lezione1"]));
  assert.deepEqual(a.materiale, { tipo: "board", id: "lezione1" });
  assert.equal(a.server, "http://localhost:3030");
  assert.equal(a.base, "http://localhost:3030");
  assert.equal(a.ore, 12);
  assert.equal(a.trainer, "Trainer");
  assert.equal(a.allievi, undefined);
});

test("parseArgs: errori chiari", () => {
  const bad: string[][] = [
    [], ["corso"], ["corso", "3"], ["corso", "0", "x.png"], ["corso", "13", "x.png"], ["corso", "abc", "x.png"], ["corso", "2.5", "x.png"],
    ["a".repeat(61), "2", "x.png"], ["co rso", "2", "x.png"], ["corso", "2", "x.png", "--ore", "0"], ["corso", "2", "x.png", "--ore", "-3"],
    ["corso", "2", "x.png", "--ore", "boh"], ["corso", "2", "x.png", "--boh", "1"], ["corso", "2", "board:"], ["corso", "2", "board:no spazi"],
    ["corso", "2", "x.png", "--server"],
  ];
  for (const argv of bad) {
    const r: any = parseArgs(argv);
    assert.ok(typeof r.errore === "string" && r.errore.length > 0, JSON.stringify(argv));
  }
});

test("assignStudents: distribuzione a turno", () => {
  const r = ok(assignStudents(["Anna", "Marco", "Giulia", "Luca", "Sara"], 2));
  assert.deepEqual(r.ok.map((s: any) => s.group), [1, 2, 1, 2, 1]);
});

test("assignStudents: gruppo esplicito, righe vuote e commenti", () => {
  const r = ok(assignStudents(["# classe", "", "Anna;2", "  ", "Marco", "Giulia"], 2));
  assert.deepEqual(r.ok.map((s: any) => [s.name, s.group]), [["Anna", 2], ["Marco", 1], ["Giulia", 1]]);
});

test("assignStudents: uid unici, senza accenti e validi per il server", () => {
  const r = ok(assignStudents(["Zoë Müller", "Anna", "Anna", "   !!!   "], 2));
  assert.deepEqual(r.ok.map((s: any) => s.uid), ["zoe-muller", "anna", "anna-2", "allievo"]);
  for (const s of r.ok) assert.match(s.uid, /^[\w.@-]{1,64}$/);
});

test("assignStudents: errori", () => {
  for (const lines of [["Anna;0"], ["Anna;3"], ["Anna;x"], [";2"], ["Anna;1.5"]]) {
    const r: any = assignStudents(lines, 2);
    assert.ok(typeof r.errore === "string" && r.errore.length > 0, JSON.stringify(lines));
  }
});

// --- intestazioni di immagini minime ---
const png = (w: number, h: number) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};
const gif = (w: number, h: number) => {
  const b = Buffer.alloc(13);
  b.write("GIF89a");
  b.writeUInt16LE(w, 6);
  b.writeUInt16LE(h, 8);
  return b;
};
const jpeg = (w: number, h: number) => {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x01, 0x01, 0x11, 0x00]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
};
const webpHead = (fourcc: string, size: number) => {
  const b = Buffer.alloc(40);
  b.write("RIFF");
  b.writeUInt32LE(32, 4);
  b.write("WEBP", 8);
  b.write(fourcc, 12);
  b.writeUInt32LE(size, 16);
  return b;
};
const webpVp8x = (w: number, h: number) => {
  const b = webpHead("VP8X", 10);
  b.writeUIntLE(w - 1, 24, 3);
  b.writeUIntLE(h - 1, 27, 3);
  return b;
};
const webpVp8l = (w: number, h: number) => {
  const b = webpHead("VP8L", 5);
  b[20] = 0x2f;
  b.writeUInt32LE(((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14), 21);
  return b;
};
const webpVp8 = (w: number, h: number) => {
  const b = webpHead("VP8 ", 10);
  b[23] = 0x9d; b[24] = 0x01; b[25] = 0x2a;
  b.writeUInt16LE(w, 26);
  b.writeUInt16LE(h, 28);
  return b;
};

test("imageInfo: PNG, GIF, JPEG e le tre varianti WebP", () => {
  assert.deepEqual(imageInfo(png(3, 2)), { mime: "image/png", width: 3, height: 2 });
  assert.deepEqual(imageInfo(gif(4, 5)), { mime: "image/gif", width: 4, height: 5 });
  assert.deepEqual(imageInfo(jpeg(6, 7)), { mime: "image/jpeg", width: 6, height: 7 });
  assert.deepEqual(imageInfo(webpVp8x(8, 9)), { mime: "image/webp", width: 8, height: 9 });
  assert.deepEqual(imageInfo(webpVp8l(10, 11)), { mime: "image/webp", width: 10, height: 11 });
  assert.deepEqual(imageInfo(webpVp8(12, 13)), { mime: "image/webp", width: 12, height: 13 });
});

test("imageInfo: null per ciò che non è un'immagine o è troncato", () => {
  assert.equal(imageInfo(Buffer.from("questo è testo, non un'immagine")), null);
  assert.equal(imageInfo(Buffer.alloc(0)), null);
  assert.equal(imageInfo(png(3, 2).subarray(0, 20)), null);
  assert.equal(imageInfo(Buffer.from([0xff, 0xd8, 0xff])), null);
});

test("buildImageScene: scala, centra, blocca", () => {
  const { els, files } = buildImageScene({ mime: "image/png", width: 2800, height: 1000 }, "data:image/png;base64,AAAA");
  const e = els[0];
  assert.equal(els.length, 1);
  assert.equal(e.type, "image");
  assert.equal(e.locked, true);
  assert.equal(e.width, 1400);
  assert.equal(e.height, 500);
  assert.equal(e.x, -700);
  assert.equal(e.y, -250);
  assert.equal(files[0].id, e.fileId);
  assert.equal(files[0].dataURL, "data:image/png;base64,AAAA");
  assert.equal(files[0].mimeType, "image/png");
  for (const k of ["x", "y", "width", "height"]) assert.ok(Number.isFinite(e[k]), k);
  for (const k of ["strokeColor", "backgroundColor"]) assert.ok(typeof e[k] === "string" && e[k].length <= 60, k);
});

test("buildImageScene: non ingrandisce le immagini piccole e limita l'altezza", () => {
  assert.equal(buildImageScene({ mime: "image/png", width: 400, height: 300 }, "d").els[0].width, 400);
  const tall = buildImageScene({ mime: "image/png", width: 3000, height: 6000 }, "d").els[0];
  assert.equal(tall.height, 1000);
  assert.equal(tall.width, 500);
});

test("buildImageScene: dimensioni non valide sono rifiutate", () => {
  for (const [width, height] of [[0, 10], [10, 0], [-1, 5], [NaN, 5], [Infinity, 5]]) {
    assert.throws(() => buildImageScene({ mime: "image/png", width, height }, "d"), /dimension/i);
  }
});

test("groupRoom", () => {
  assert.equal(groupRoom("isaqb-dic26", 3), "isaqb-dic26-g3");
});

test("assignStudents: un allievo di nome 'Trainer' non prende l'uid del trainer", () => {
  const r = ok(assignStudents(["Trainer", "Anna"], 2));
  assert.notEqual(r.ok[0].uid, "trainer");
  assert.equal(r.ok[0].uid, "trainer-2");
  assert.equal(r.ok[1].uid, "anna");
});

test("parseArgs: --server e --base devono essere indirizzi http(s) completi", () => {
  for (const [opt, v] of [["--server", "board.esempio.it"], ["--server", "localhost:3030"], ["--server", "ftp://x.org"], ["--base", "board.esempio.it"], ["--base", "//x.org"]]) {
    const r: any = parseArgs(["corso", "2", "x.png", opt, v]);
    assert.ok(typeof r.errore === "string" && r.errore.includes(opt), `${opt} ${v}`);
  }
  const a = ok(parseArgs(["corso", "2", "x.png", "--server", "https://x.org/", "--base", "http://localhost:5173//"]));
  assert.equal(a.server, "https://x.org");
  assert.equal(a.base, "http://localhost:5173");
});

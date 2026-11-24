// Server delle board (Excalidraw): serve l'interfaccia (dist/) e la sincronizzazione in tempo reale (WebSocket).
//   GET  /b/<board>?t=<token>        interfaccia (le pagine sono sempre index.html)
//   WS   /connect/<board>?t=<token>  sincronizzazione (token verificato; "viewer" = sola lettura, imposta dal server)
//   GET  /health
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { WebSocketServer } from "ws";
import { ROOM_ID, verifyToken } from "./auth.ts";
import { closeAllRooms, getRoom, openRooms, type Peer } from "./rooms.ts";

try {
  process.loadEnvFile(".env");
} catch {
  /* nessun file .env */
}

const PORT = Number(process.env.PORT) || 3030;
const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");
const PUBLIC_DIR = path.resolve(process.env.PUBLIC_DIR || "./dist");

let SECRET = process.env.BOARD_SECRET || "";
if (!SECRET) {
  if (process.env.NODE_ENV === "production") {
    console.error("BOARD_SECRET mancante: impostalo (stringa lunga e casuale) nelle variabili d'ambiente.");
    process.exit(1);
  }
  SECRET = "dev-secret-solo-per-prove";
  console.warn("BOARD_SECRET non impostato: uso un valore di prova (solo sviluppo).");
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".map": "application/json",
};

const send = (res: http.ServerResponse, status: number, body: string, type = "text/plain; charset=utf-8") => {
  res.writeHead(status, { "Content-Type": type, "X-Content-Type-Options": "nosniff" });
  res.end(body);
};

/** Percorso file sicuro dentro `base` (niente ".."). */
function safeJoin(base: string, ...parts: string[]) {
  const p = path.resolve(base, ...parts);
  return p === base || p.startsWith(base + path.sep) ? p : null;
}

function serveFile(res: http.ServerResponse, file: string, cache: string) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, "Non trovato");
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Content-Length": st.size,
      "Cache-Control": cache,
      "X-Content-Type-Options": "nosniff",
    });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://x");
  try {
    if (url.pathname === "/health") return send(res, 200, JSON.stringify({ ok: true, rooms: openRooms() }), "application/json");
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Metodo non consentito");
    const asset = url.pathname === "/" ? null : safeJoin(PUBLIC_DIR, "." + decodeURIComponent(url.pathname));
    if (asset && fs.existsSync(asset) && fs.statSync(asset).isFile()) {
      return serveFile(res, asset, url.pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
    }
    return serveFile(res, path.join(PUBLIC_DIR, "index.html"), "no-cache");
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, "Errore interno");
  }
});

// --- sincronizzazione ---
const COLORS = ["#e8321e", "#ff6a45", "#177a4b", "#a9760a", "#5e1220", "#2563eb", "#7c3aed", "#0d9488"];
const colorFor = (s: string) => COLORS[[...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length];

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", "http://x");
  const m = /^\/connect\/([^/]+)$/.exec(url.pathname);
  const room = m ? decodeURIComponent(m[1]) : "";
  const t = verifyToken(url.searchParams.get("t"), SECRET);
  if (!m || !t || t.room !== room || !ROOM_ID.test(room)) {
    console.warn(`WebSocket rifiutato: ${url.pathname} (token ${t ? "ok" : "non valido"})`);
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const r = getRoom(DATA_DIR, room);
    const peer: Peer = { id: crypto.randomUUID(), ws, name: t.name, role: t.role, color: colorFor(t.uid || t.name) };
    const info = (p: Peer) => ({ id: p.id, name: p.name, color: p.color, role: p.role });
    ws.send(JSON.stringify({ t: "init", me: info(peer), els: [...r.els.values()], peers: [...r.peers].map(info) }));
    for (const f of r.files.values()) ws.send(JSON.stringify({ t: "files", files: [f] }));
    r.join(peer);
    r.broadcast({ t: "join", peer: info(peer) }, peer);
    if (process.env.DEBUG_BOARD) console.log(`connesso ${t.name} (${t.role}) a ${room}`);

    ws.on("message", (data) => {
      let msg: any;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg?.t === "ptr") {
        // il puntatore è consentito a tutti (anche ai viewer), ma il contenuto è limitato a valori semplici
        const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
        r.broadcast({ t: "ptr", id: peer.id, x: n(msg.x), y: n(msg.y), tool: msg.tool === "laser" ? "laser" : "pointer", button: msg.button === "down" ? "down" : "up", sel: Array.isArray(msg.sel) ? msg.sel.filter((s: unknown) => typeof s === "string").slice(0, 50) : [] }, peer);
        return;
      }
      if (peer.role !== "editor") return; // sola lettura: i viewer non scrivono, qualunque cosa mandino
      if (msg?.t === "els") {
        const ok = r.applyElements(msg.els);
        if (ok.length) r.broadcast({ t: "els", els: ok }, peer);
      } else if (msg?.t === "files") {
        const ok = r.applyFiles(msg.files);
        if (ok.length) r.broadcast({ t: "files", files: ok }, peer);
      }
    });
    ws.on("close", () => r.leave(peer));
    ws.on("error", (e) => console.error("WebSocket:", e.message));
  });
});

server.listen(PORT, () => console.log(`Board in ascolto su http://localhost:${PORT} (dati in ${DATA_DIR})`));

const stop = () => {
  closeAllRooms();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

// Rotte di accesso (/auth/…): login degli allievi con la password di sessione, impostazione della password da parte del trainer,
// verifica di un token. Tutte rispondono JSON; il token viaggia solo nell'intestazione Authorization, mai nell'indirizzo.
//   POST /auth/login                      { room, nome, cognome, email, password, ricordami? } -> { ok, token, name, exp }
//   PUT  /auth/access?room=<board>        (editor della board) { password?, until? }            -> { ok, until }
//   GET  /auth/check?room=<board>         Authorization: Bearer <token>                         -> { ok, name, role, exp }
import type http from "node:http";
import path from "node:path";
import { inspectToken, personalUid, ROOM_ID, signToken, type TokenPayload } from "./auth.ts";
import { AttemptLimiter, ConcurrencyGate, hashPassword, normalizeIp, parseLoginBody, passwordOk, readAccess, sessionExp, verifyPassword, writeAccess } from "./access.ts";

export interface AuthOptions {
  secret: string;
  dataDir: string;
  hours: number; // durata normale dell'accesso
  days: number; // durata con "ricordami"
  /** Se la persona non può entrare in quella board (stanza chiusa o non sua), restituisce l'aula a cui tornare. */
  guard?: (room: string, payload: TokenPayload) => { aula: string } | null;
}

const MAX_BODY = 4096;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(body));
};
const fail = (res: http.ServerResponse, status: number, motivo: string) => json(res, status, { ok: false, motivo });

/** Indirizzo del client: dietro il tunnel Cloudflare arriva in `CF-Connecting-IP`, altrimenti `X-Forwarded-For`. */
function clientIp(req: http.IncomingMessage): string {
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf) return cf.trim();
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf) return xf.split(",")[0].trim();
  return req.socket.remoteAddress || "?";
}

const bearer = (req: http.IncomingMessage) => /^Bearer (.+)$/.exec(String(req.headers.authorization || ""))?.[1];

class TooBig extends Error {}
class BadJson extends Error {}

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let over = false;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) over = true;
      else chunks.push(c);
    });
    req.on("end", () => {
      if (over) return reject(new TooBig());
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new BadJson());
      }
    });
    req.on("error", reject);
  });
}

/** Gestisce le rotte /auth/…; restituisce `true` se la richiesta era di questo gruppo. */
export function createAuthHandler(opts: AuthOptions) {
  const personLimit = new AttemptLimiter(10); // per indirizzo + board + email
  const netLimit = new AttemptLimiter(100); // per indirizzo + board
  const roomLimit = new AttemptLimiter(500); // per board: oltre, si rallenta (non si blocca)
  const gate = new ConcurrencyGate(4); // verifiche della password in corso insieme
  const roomDir = (room: string) => path.join(opts.dataDir, "rooms", room);

  async function body(req: http.IncomingMessage, res: http.ServerResponse): Promise<unknown | undefined> {
    try {
      return await readJson(req);
    } catch (e) {
      if (e instanceof TooBig) fail(res, 413, "Richiesta troppo grande.");
      else fail(res, 400, "Richiesta non valida.");
      return undefined;
    }
  }

  async function login(req: http.IncomingMessage, res: http.ServerResponse) {
    const raw = await body(req, res);
    if (raw === undefined) return;
    const b = parseLoginBody(raw);
    if (!b.ok) return fail(res, b.status, b.motivo);
    const WRONG = "Password non corretta, oppure questa board non ha un accesso con password.";
    const access = readAccess(roomDir(b.room));
    if (!access) return fail(res, 401, WRONG); // niente da verificare e nessun contatore da riempire: i nomi delle board sono pubblici nei link
    // Limiti: per persona (indirizzo, board, email: 10) e per rete (indirizzo, board: 100, così una classe dietro lo stesso indirizzo non si blocca a vicenda).
    const net = `${normalizeIp(clientIp(req))}|${b.room}`;
    const person = `${net}|${b.email}`;
    if (personLimit.blocked(person) || netLimit.blocked(net)) return fail(res, 429, "Troppi tentativi: riprova tra qualche minuto.");
    if (!gate.tryEnter()) return fail(res, 503, "Il server è occupato: riprova tra qualche secondo.");
    // Il tentativo si conta PRIMA di verificare (richieste in parallelo non lo aggirano) e si restituisce se la password è giusta.
    personLimit.fail(person);
    netLimit.fail(net);
    roomLimit.fail(b.room);
    let ok = false;
    try {
      if (roomLimit.blocked(b.room)) await sleep(1000); // troppi errori sulla board: si rallenta chiunque, senza bloccare nessuno
      ok = await verifyPassword(b.password, access.passwordHash);
    } finally {
      gate.leave();
    }
    if (!ok) return fail(res, 401, WRONG);
    personLimit.clear(person);
    netLimit.refund(net);
    roomLimit.refund(b.room);
    const now = Date.now();
    if (access.until !== null && access.until <= now) return fail(res, 403, "La sessione è terminata.");
    const exp = sessionExp(now, access.until, b.ricordami, opts.hours, opts.days);
    const token = signToken({ room: b.room, name: b.name, uid: personalUid(b.email, opts.secret), email: b.email, role: "participant", exp }, opts.secret);
    json(res, 200, { ok: true, token, name: b.name, exp });
  }

  async function setAccess(req: http.IncomingMessage, res: http.ServerResponse, room: string) {
    const check = ROOM_ID.test(room) ? inspectToken(bearer(req), room, opts.secret) : ({ ok: false, motivo: "non valido" } as const);
    if (!check.ok) return fail(res, 401, check.motivo);
    if (check.payload.role !== "editor") return fail(res, 403, "Solo il trainer può impostare la password.");
    const raw = await body(req, res);
    if (raw === undefined) return;
    const b = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
    if (b.password !== undefined && !passwordOk(b.password)) return fail(res, 400, "La password deve avere da 8 a 200 caratteri.");
    if (b.until !== undefined && b.until !== null && !(typeof b.until === "number" && Number.isFinite(b.until) && b.until > 0)) return fail(res, 400, "Data di fine non valida.");
    if (b.password === undefined && b.until === undefined) return fail(res, 400, "Indica la password e/o la data di fine.");
    const existing = readAccess(roomDir(room));
    if (!existing && b.password === undefined) return fail(res, 400, "Per questa board serve prima la password.");
    const until = b.until !== undefined ? (b.until as number | null) : (existing?.until ?? null);
    writeAccess(roomDir(room), { passwordHash: b.password !== undefined ? hashPassword(b.password as string) : existing!.passwordHash, until });
    json(res, 200, { ok: true, until });
  }

  function checkToken(req: http.IncomingMessage, res: http.ServerResponse, room: string) {
    const c = ROOM_ID.test(room) ? inspectToken(bearer(req), room, opts.secret) : ({ ok: false, motivo: "non valido" } as const);
    if (!c.ok) return fail(res, 401, c.motivo);
    const closed = opts.guard?.(room, c.payload);
    if (closed) return json(res, 401, { ok: false, motivo: "stanza chiusa", aula: closed.aula });
    json(res, 200, { ok: true, name: c.payload.name, role: c.payload.role, exp: c.payload.exp });
  }

  return async function handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
    const room = url.searchParams.get("room") ?? "";
    switch (url.pathname) {
      case "/auth/login":
        return req.method === "POST" ? login(req, res) : fail(res, 405, "Metodo non consentito.");
      case "/auth/access":
        return req.method === "PUT" ? setAccess(req, res, room) : fail(res, 405, "Metodo non consentito.");
      case "/auth/check":
        return req.method === "GET" ? checkToken(req, res, room) : fail(res, 405, "Metodo non consentito.");
      default:
        return fail(res, 404, "Non trovato.");
    }
  };
}

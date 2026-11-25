// Supporto ai test di integrazione: un client WebSocket che raccoglie i messaggi e permette di attenderne uno.
import { WebSocket } from "ws";
import { signToken, type Role } from "./auth.ts";

export interface Client {
  ws: WebSocket;
  msgs: any[];
  init: any;
  send(m: unknown): void;
  waitFor(pred: (m: any) => boolean, ms?: number): Promise<any>;
  closed: Promise<{ code: number; reason: string }>;
  close(): Promise<void>;
}

/** Collega e attende `init`; rifiuta con `Error("HTTP <stato>")` se il server rifiuta il collegamento. */
export function connect(url: string, room: string, token: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${url.replace("http", "ws")}/connect/${encodeURIComponent(room)}?t=${encodeURIComponent(token)}`);
    const msgs: any[] = [];
    const waiters: { pred: (m: any) => boolean; res: (m: any) => void }[] = [];
    let init: any;
    const closed = new Promise<{ code: number; reason: string }>((res) => ws.on("close", (code, reason) => res({ code, reason: reason.toString() })));
    const client: Client = {
      ws, msgs,
      get init() {
        return init;
      },
      send: (m) => ws.send(JSON.stringify(m)),
      waitFor: (pred, ms = 4000) =>
        new Promise((res, rej) => {
          const found = msgs.find(pred);
          if (found) return res(found);
          const t = setTimeout(() => rej(new Error("messaggio atteso non arrivato")), ms);
          waiters.push({ pred, res: (m) => (clearTimeout(t), res(m)) });
        }),
      closed,
      close: async () => {
        if (ws.readyState !== WebSocket.CLOSED) ws.close();
        await closed;
      },
    } as Client;
    ws.on("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.on("error", (e) => reject(e));
    ws.on("message", (d) => {
      const m = JSON.parse(d.toString());
      if (m.t === "init") {
        init = m;
        resolve(client);
      }
      msgs.push(m);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].pred(m)) waiters.splice(i, 1)[0].res(m);
      }
    });
  });
}

export const tokenFor = (secret: string, room: string, role: Role, uid: string, name = uid, exp = Date.now() + 3600e3, email?: string) =>
  signToken({ room, name, uid, role, exp, ...(email ? { email } : {}) }, secret);

// Supporto ai test di integrazione: avvia il vero server su una porta libera con una cartella dati temporanea.
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export interface TestServer {
  url: string;
  port: number;
  dataDir: string;
  stop(): void;
}

export const freePort = () =>
  new Promise<number>((resolve) => {
    const s = net.createServer().listen(0, () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });

export async function startServer(env: Record<string, string> = {}): Promise<TestServer> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "board-data-"));
  const port = await freePort();
  const child: ChildProcess = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, NODE_ENV: "", LOGIN_URL: "", ...env },
    stdio: "ignore",
  });
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${url}/health`)).ok) return { url, port, dataDir, stop: () => child.kill() };
    } catch {
      /* non ancora pronto */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error("il server di prova non è partito");
}

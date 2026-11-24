import { CaptureUpdateAction, Excalidraw, reconcileElements } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardSession } from "./session";

type Status = "connecting" | "online" | "offline";
interface Peer { id: string; name: string; color: string; role: string }

const light = (hex: string) => hex + "33";

export function Board({ session }: { session: BoardSession }) {
  const apiRef = useRef<any>(null);
  const [api, setApi] = useState<any>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const sentVersion = useRef(new Map<string, string>()); // id -> "versione:nonce" già noto al server
  const sentFiles = useRef(new Set<string>());
  const peers = useRef(new Map<string, Peer & { pointer?: any; button?: string; sel?: string[] }>());
  const flushTimer = useRef<number | null>(null);
  const firstInit = useRef(true);
  const readonly = session.role === "viewer";

  const setApiBoth = useCallback((a: any) => {
    apiRef.current = a;
    setApi(a);
  }, []);

  const pushCollaborators = useCallback(() => {
    const a = apiRef.current;
    if (!a) return;
    const m = new Map<string, any>();
    for (const [id, p] of peers.current) {
      m.set(id, {
        pointer: p.pointer,
        button: p.button,
        selectedElementIds: Object.fromEntries((p.sel || []).map((s) => [s, true])),
        username: p.name,
        color: { background: light(p.color), stroke: p.color },
        id,
      });
    }
    a.updateScene({ collaborators: m });
  }, []);

  const send = (msg: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  };

  /** Manda al server gli elementi cambiati da quando glieli abbiamo mandati l'ultima volta. */
  const flush = useCallback(() => {
    flushTimer.current = null;
    const a = apiRef.current;
    if (!a || readonly) return;
    const changed = a.getSceneElementsIncludingDeleted().filter((e: any) => sentVersion.current.get(e.id) !== `${e.version}:${e.versionNonce}`);
    if (changed.length) {
      for (const e of changed) sentVersion.current.set(e.id, `${e.version}:${e.versionNonce}`);
      send({ t: "els", els: changed });
    }
    const files = Object.values(a.getFiles() as Record<string, any>).filter((f: any) => !sentFiles.current.has(f.id));
    if (files.length) {
      for (const f of files as any[]) sentFiles.current.add(f.id);
      send({ t: "files", files });
    }
  }, [readonly]);

  const applyRemote = useCallback((els: any[]) => {
    const a = apiRef.current;
    if (!a) return;
    for (const e of els) sentVersion.current.set(e.id, `${e.version}:${e.versionNonce}`);
    const merged = reconcileElements(a.getSceneElementsIncludingDeleted(), els, a.getAppState());
    a.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER });
  }, []);

  // connessione, con riconnessione automatica
  useEffect(() => {
    if (!api) return;
    let stop = false;
    let retry = 0;
    let timer: number | undefined;
    const open = () => {
      setStatus("connecting");
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${proto}//${location.host}/connect/${session.room}?t=${encodeURIComponent(session.token)}`);
      wsRef.current = ws;
      ws.onopen = () => {
        retry = 0;
        setStatus("online");
      };
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.t === "init") {
          peers.current.clear();
          for (const p of m.peers as Peer[]) peers.current.set(p.id, p);
          applyRemote(m.els);
          if (firstInit.current) {
            firstInit.current = false;
            if (m.els.length) apiRef.current.scrollToContent(undefined, { fitToContent: true });
          }
          pushCollaborators();
          if (!readonly) flush(); // dopo una riconnessione rimanda ciò che si è disegnato offline
        } else if (m.t === "els") applyRemote(m.els);
        else if (m.t === "files") {
          for (const f of m.files) sentFiles.current.add(f.id);
          apiRef.current.addFiles(m.files);
        } else if (m.t === "join") {
          peers.current.set(m.peer.id, m.peer);
          pushCollaborators();
        } else if (m.t === "leave") {
          peers.current.delete(m.id);
          pushCollaborators();
        } else if (m.t === "ptr") {
          const p = peers.current.get(m.id);
          if (p) {
            p.pointer = { x: m.x, y: m.y, tool: m.tool };
            p.button = m.button;
            p.sel = m.sel;
            pushCollaborators();
          }
        }
      };
      ws.onclose = () => {
        if (stop) return;
        setStatus("offline");
        timer = window.setTimeout(open, Math.min(8000, 500 * 2 ** retry++));
      };
    };
    open();
    return () => {
      stop = true;
      window.clearTimeout(timer);
      wsRef.current?.close();
    };
  }, [api, session.room, session.token, readonly, applyRemote, flush, pushCollaborators]);

  const lastPtr = useRef(0);
  return (
    <div className="board-root">
      <div className="board-bar">
        <div className="board-brand">
          <b>
            Cube<span>Academy</span> Board
          </b>
          <span className="board-room">{session.room}</span>
        </div>
        <div className="board-meta">
          <span className={`chip ${status === "online" ? "chip-ok" : status === "offline" ? "chip-bad" : "chip-wait"}`}>
            {status === "online" ? "in linea" : status === "offline" ? "offline" : "connessione…"}
          </span>
          <span className="chip">{readonly ? "sola lettura" : "può modificare"}</span>
          <span className="board-user">{session.name}</span>
        </div>
      </div>
      <div className="board-canvas">
        <Excalidraw
          excalidrawAPI={setApiBoth}
          langCode="it-IT"
          viewModeEnabled={readonly}
          isCollaborating
          UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false } }}
          onChange={() => {
            if (!readonly && flushTimer.current === null) flushTimer.current = window.setTimeout(flush, 60);
          }}
          onPointerUpdate={(p: any) => {
            const now = performance.now();
            if (now - lastPtr.current < 40) return;
            lastPtr.current = now;
            send({ t: "ptr", x: p.pointer.x, y: p.pointer.y, tool: p.pointer.tool, button: p.button, sel: Object.keys(apiRef.current?.getAppState().selectedElementIds || {}) });
          }}
        />
      </div>
    </div>
  );
}

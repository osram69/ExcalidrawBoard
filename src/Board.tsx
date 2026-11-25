import { CaptureUpdateAction, convertToExcalidrawElements, Excalidraw, reconcileElements, restoreElements } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TimerState } from "../server/timer.ts";
import type { BoardSession } from "./session";
import type { MyVotes, VotePublic } from "../server/votes.ts";
import { shouldReturnToLogin } from "./expiry";
import { registerLibrary } from "./library";
import { instantiate, TEMPLATES, type Template } from "./templates";
import { TimerPill } from "./Timer";
import { VoteLayer, VotePanel, type NoteBox, type ViewInfo } from "./Votes";

type Status = "connecting" | "online" | "offline";
interface Peer { id: string; name: string; color: string; role: string }

const light = (hex: string) => hex + "33";

// colori delle note adesive
const NOTE_COLORS = [
  { name: "Giallo", bg: "#ffec99" },
  { name: "Rosa", bg: "#ffc9c9" },
  { name: "Verde", bg: "#b2f2bb" },
  { name: "Azzurro", bg: "#a5d8ff" },
  { name: "Arancio", bg: "#ffd8a8" },
];

interface BoardProps {
  session: BoardSession;
  onExpired: () => void; // il server ha chiuso il collegamento perché l'accesso è scaduto (codice 4001)
  onLogout?: () => void; // "Esci": solo per chi è entrato con il login
}

export function Board({ session, onExpired, onLogout }: BoardProps) {
  const apiRef = useRef<any>(null);
  const [api, setApi] = useState<any>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [timer, setTimer] = useState<{ state: TimerState; offsetMs: number }>({ state: { status: "idle", endsAt: 0, remainingMs: 0, durationMs: 0 }, offsetMs: 0 });
  const [votes, setVotes] = useState<VotePublic>({ open: false, perPerson: 5, totals: {} });
  const [myVotes, setMyVotes] = useState<MyVotes>({ mine: {}, left: 0 });
  const [voteView, setVoteView] = useState<{ view: ViewInfo; notes: NoteBox[] }>({ view: { scrollX: 0, scrollY: 0, zoom: 1 }, notes: [] });
  const [budgetDraft, setBudgetDraft] = useState(5);
  const [tplOpen, setTplOpen] = useState(false);
  const viewRaf = useRef<number | null>(null);
  const viewKey = useRef("");
  const votesActive = votes.open || Object.keys(votes.totals).length > 0;
  const votesActiveRef = useRef(false);
  votesActiveRef.current = votesActive;
  const wsRef = useRef<WebSocket | null>(null);
  const sentVersion = useRef(new Map<string, string>()); // id -> "versione:nonce" già noto al server
  const sentFiles = useRef(new Set<string>());
  const peers = useRef(new Map<string, Peer & { pointer?: any; button?: string; sel?: string[] }>());
  const flushTimer = useRef<number | null>(null);
  const firstInit = useRef(true);
  const readonly = session.role === "viewer";
  const participant = session.role === "participant"; // modifica solo i propri oggetti (lo impone il server; qui si evita solo di selezionare quelli altrui)
  const myKey = useRef("");
  const foreign = (e: any) => !!e.customData?.owner && e.customData.owner !== myKey.current;

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
    els = restoreElements(els as any, null) as any[]; // ripara campi mancanti: un elemento difettoso non deve bloccare la lavagna
    const merged = reconcileElements(a.getSceneElementsIncludingDeleted(), els as any, a.getAppState());
    a.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER });
  }, []);

  /** Posizione e zoom della vista e note visibili, per i badge dei voti: al massimo una volta per frame, solo se cambia qualcosa. */
  const scheduleVoteView = useCallback(() => {
    if (viewRaf.current !== null) return;
    viewRaf.current = requestAnimationFrame(() => {
      viewRaf.current = null;
      const a = apiRef.current;
      if (!a || !votesActiveRef.current) return;
      const s = a.getAppState();
      const notes: NoteBox[] = a
        .getSceneElements()
        .filter((e: any) => !e.isDeleted && e.customData?.kind === "nota")
        .map((e: any) => ({ id: e.id, x: e.x, y: e.y, width: e.width, height: e.height }));
      const next = { view: { scrollX: s.scrollX, scrollY: s.scrollY, zoom: s.zoom.value }, notes };
      const key = JSON.stringify(next);
      if (key === viewKey.current) return;
      viewKey.current = key;
      setVoteView(next);
    });
  }, []);
  useEffect(() => {
    if (votesActive) scheduleVoteView();
  }, [votesActive, scheduleVoteView]);

  /** Centro della parte di lavagna visibile, in coordinate della scena. */
  const viewCenter = () => {
    const s = apiRef.current.getAppState();
    return { x: s.width / 2 / s.zoom.value - s.scrollX, y: s.height / 2 / s.zoom.value - s.scrollY };
  };

  /** Aggiunge elementi alla scena (e li seleziona); la sincronizzazione parte dall'onChange di Excalidraw. */
  const insert = (skeleton: any[], selectIndex = 0) => {
    const a = apiRef.current;
    const created = convertToExcalidrawElements(skeleton as any);
    // piccolo scarto a cascata, così più note inserite di fila non si sovrappongono esattamente
    const n = a.getSceneElements().length % 6;
    for (const e of created as any[]) {
      e.x += n * 14;
      e.y += n * 14;
    }
    a.updateScene({
      elements: [...a.getSceneElementsIncludingDeleted(), ...created],
      appState: { selectedElementIds: { [(created as any[])[selectIndex].id]: true } },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  };

  const addNote = (bg: string) => {
    const { x, y } = viewCenter();
    insert([
      {
        type: "rectangle",
        x: x - 100,
        y: y - 100,
        width: 200,
        height: 200,
        backgroundColor: bg,
        fillStyle: "solid",
        strokeColor: "transparent",
        roughness: 0,
        roundness: { type: 3 },
        customData: { kind: "nota", author: session.name },
        label: { text: "Scrivi qui…", fontSize: 20, strokeColor: "#1e1e1e", textAlign: "center", verticalAlign: "middle" },
      },
    ]);
  };

  /** Inserisce un template al centro della vista (in un frame col suo nome). */
  const addTemplate = (t: Template) => {
    const { x, y } = viewCenter();
    insert(instantiate(t).map((e) => ({ ...e, x: e.x + x, y: e.y + y })));
    setTplOpen(false);
  };

  const addFrame = () => {
    const { x, y } = viewCenter();
    const count = apiRef.current.getSceneElements().filter((e: any) => e.type === "frame").length + 1;
    insert([{ type: "frame", children: [], name: `Frame ${count}`, x: x - 480, y: y - 270, width: 960, height: 540 }]);
  };

  /** Aggiunge foto dal dispositivo (o dalla fotocamera, su telefono): ridotte a 1600 px per stare nel limite del server. */
  const addPhotos = async (list: FileList | null) => {
    const a = apiRef.current;
    if (!list || !a) return;
    for (const file of Array.from(list).slice(0, 6)) {
      try {
        const bmp = await createImageBitmap(file);
        const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
        const w = Math.round(bmp.width * k);
        const h = Math.round(bmp.height * k);
        const cv = document.createElement("canvas");
        cv.width = w;
        cv.height = h;
        cv.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
        let mimeType = file.type === "image/png" ? "image/png" : "image/jpeg"; // PNG resta tale (trasparenze, schermate); il resto diventa JPEG
        let dataURL = cv.toDataURL(mimeType, 0.85);
        if (dataURL.length > 9_000_000 && mimeType === "image/png") {
          mimeType = "image/jpeg";
          dataURL = cv.toDataURL(mimeType, 0.85);
        }
        const id = crypto.randomUUID().replace(/-/g, "");
        a.addFiles([{ id, mimeType, dataURL, created: Date.now() }]);
        const show = Math.min(1, 480 / Math.max(w, h)); // sulla lavagna parte a ~480 px: si ridimensiona a mano
        const { x, y } = viewCenter();
        insert([{ type: "image", fileId: id, status: "saved", x: x - (w * show) / 2, y: y - (h * show) / 2, width: w * show, height: h * show, customData: { kind: "foto", author: session.name } }]);
      } catch (e) {
        console.error("Foto non inserita:", e);
        window.alert(`Non riesco ad aggiungere "${file.name}": formato non supportato o file danneggiato.`);
      }
    }
  };

  // libreria di forme per l'architettura (solo chi può disegnare); gli errori restano in console
  useEffect(() => {
    if (!api || readonly) return;
    registerLibrary(api, (sk) => convertToExcalidrawElements(sk as any) as any[]).catch((e) => console.error("Libreria di forme non caricata:", e));
  }, [api, readonly]);

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
          myKey.current = m.me.key;
          peers.current.clear();
          for (const p of m.peers as Peer[]) peers.current.set(p.id, p);
          applyRemote(m.els);
          if (firstInit.current) {
            firstInit.current = false;
            if (m.els.length) apiRef.current.scrollToContent(undefined, { fitToContent: true });
          }
          pushCollaborators();
          if (m.timer) setTimer({ state: m.timer.state, offsetMs: m.timer.now - Date.now() });
          if (m.votes) setVotes(m.votes);
          if (m.myVotes) setMyVotes(m.myVotes);
          if (!readonly) flush(); // dopo una riconnessione rimanda ciò che si è disegnato offline
        } else if (m.t === "timer") setTimer({ state: m.state, offsetMs: m.now - Date.now() });
        else if (m.t === "votes") {
          setVotes({ open: m.open, perPerson: m.perPerson, totals: m.totals });
          if (m.open) setBudgetDraft(m.perPerson);
        } else if (m.t === "my-votes") setMyVotes({ mine: m.mine, left: m.left });
        else if (m.t === "els") applyRemote(m.els);
        else if (m.t === "deny") {
          // il server ha respinto una modifica a oggetti altrui: si ripristina la loro versione
          const back = new Map<string, any>((restoreElements(m.els, null) as any[]).map((e: any) => [e.id, e]));
          for (const e of m.els) sentVersion.current.set(e.id, `${e.version}:${e.versionNonce}`);
          const a = apiRef.current;
          a.updateScene({ elements: a.getSceneElementsIncludingDeleted().map((e: any) => back.get(e.id) ?? e), captureUpdate: CaptureUpdateAction.NEVER });
        }
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
      ws.onclose = (ev) => {
        if (stop) return;
        if (shouldReturnToLogin(ev.code, session.exp, Date.now())) {
          // accesso scaduto (detto dal server, o scaduto durante uno standby o una caduta di rete): niente ritentativi, si torna al login
          stop = true;
          onExpired();
          return;
        }
        setStatus("offline");
        // dopo due tentativi falliti si chiede al server se l'accesso vale ancora (rifiutato, revocato o di un'altra board: login, non "offline" per sempre)
        if (retry >= 2) {
          fetch(`/auth/check?room=${encodeURIComponent(session.room)}`, { headers: { Authorization: `Bearer ${session.token}` } })
            .then((r) => {
              if (r.status === 401 && !stop) {
                stop = true;
                window.clearTimeout(timer);
                onExpired();
              }
            })
            .catch(() => undefined);
        }
        timer = window.setTimeout(open, Math.min(8000, 500 * 2 ** retry++));
      };
    };
    open();
    return () => {
      stop = true;
      window.clearTimeout(timer);
      wsRef.current?.close();
    };
  }, [api, session.room, session.token, readonly, applyRemote, flush, pushCollaborators, onExpired]);

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
        <div className="board-gadgets">
          <TimerPill state={timer.state} offsetMs={timer.offsetMs} canControl={session.role === "editor"} send={send} />
          <VotePanel votes={votes} myVotes={myVotes} isEditor={session.role === "editor"} canVote={!readonly} send={send} budgetDraft={budgetDraft} setBudgetDraft={setBudgetDraft} />
        </div>
        <div className="board-meta">
          <span className={`chip ${status === "online" ? "chip-ok" : status === "offline" ? "chip-bad" : "chip-wait"}`}>
            {status === "online" ? "in linea" : status === "offline" ? "offline" : "connessione…"}
          </span>
          <span className="chip">{readonly ? "sola lettura" : participant ? "modifica i propri oggetti" : "può modificare tutto"}</span>
          <span className="board-user">{session.name}</span>
          {onLogout && (
            <button className="chip chip-btn" onClick={onLogout} title="Esci e cancella i dati ricordati su questo dispositivo">
              Esci
            </button>
          )}
        </div>
      </div>
      <div className="board-canvas">
        <Excalidraw
          excalidrawAPI={(a: any) => { setApiBoth(a); if (import.meta.env.DEV) (window as any).__api = a; }}
          langCode="it-IT"
          viewModeEnabled={readonly}
          isCollaborating
          UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false } }}
          onChange={(els: readonly any[], appState: any) => {
            if (participant) {
              // un partecipante non seleziona oggetti altrui (non può spostarli né cancellarli)
              const sel = appState.selectedElementIds as Record<string, boolean>;
              const mine = els.filter((e) => sel[e.id] && foreign(e));
              if (mine.length) {
                const next = { ...sel };
                for (const e of mine) delete next[e.id];
                apiRef.current?.updateScene({ appState: { selectedElementIds: next } });
              }
            }
            if (votesActiveRef.current) scheduleVoteView();
            if (!readonly && flushTimer.current === null) flushTimer.current = window.setTimeout(flush, 60);
          }}
          onPointerUpdate={(p: any) => {
            const now = performance.now();
            if (now - lastPtr.current < 40) return;
            lastPtr.current = now;
            send({ t: "ptr", x: p.pointer.x, y: p.pointer.y, tool: p.pointer.tool, button: p.button, sel: Object.keys(apiRef.current?.getAppState().selectedElementIds || {}) });
          }}
        />
        {votesActive && <VoteLayer notes={voteView.notes} view={voteView.view} votes={votes} myVotes={myVotes} canVote={!readonly} send={send} />}
        {!readonly && api && (
          <div className="board-palette" role="toolbar" aria-label="Note e frame">
            <span className="pal-label">Nota</span>
            {NOTE_COLORS.map((c) => (
              <button key={c.bg} className="pal-note" style={{ background: c.bg }} title={`Nota adesiva ${c.name.toLowerCase()}`} aria-label={`Nota adesiva ${c.name.toLowerCase()}`} onClick={() => addNote(c.bg)} />
            ))}
            <span className="pal-sep" />
            <button className="pal-frame" title="Aggiungi un frame (area per raggruppare o presentare)" onClick={addFrame}>
              <span aria-hidden>▭</span> Frame
            </button>
            <span className="pal-menu">
              <button className="pal-frame" aria-haspopup="menu" aria-expanded={tplOpen} title="Inserisci un template di board" onClick={() => setTplOpen((o) => !o)}>
                <span aria-hidden>▤</span> Template
              </button>
              {tplOpen && (
                <div className="tpl-menu" role="menu">
                  {TEMPLATES.map((t) => (
                    <button key={t.id} role="menuitem" onClick={() => addTemplate(t)}>
                      {t.name}
                    </button>
                  ))}
                </div>
              )}
            </span>
            <label className="pal-frame pal-photo" title="Aggiungi una foto dal dispositivo o dalla fotocamera">
              <span aria-hidden>🖼</span> Foto
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                hidden
                onChange={(e) => {
                  void addPhotos(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

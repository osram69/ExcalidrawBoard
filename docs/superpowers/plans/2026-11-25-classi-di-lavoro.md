# Classi di lavoro (`npm run seed`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un comando che crea N board (una per gruppo) con lo stesso materiale (immagine o board già preparata) e stampa i link da trainer e da allievi.

**Architecture:** `scripts/seed-lib.ts` contiene le parti pure (argomenti, assegnazione allievi, lettura dimensioni immagine, costruzione degli elementi). `scripts/seed.ts` è la CLI: si collega alle board come `editor` via WebSocket (come un browser), legge lo stato, invia gli elementi, stampa i link. Nessuna modifica al server.

**Tech Stack:** Node >= 22, TypeScript via `tsx`, `ws`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-25-classi-di-lavoro-design.md`

## Global Constraints

- Nessuna nuova dipendenza. Nessuna modifica a `server/`.
- Nomi board `<corso>-g1 … -gN`: regex del server `^[a-zA-Z0-9_-]{1,64}$`, quindi `<corso>` al massimo 60 caratteri; gruppi da 1 a 12.
- Immagini ammesse: PNG, JPEG, WebP, GIF, dataURL al massimo 10 MB (limite `MAX_FILE` del server); niente SVG.
- Segreto: `BOARD_SECRET` da ambiente o `.env`, altrimenti `dev-secret-solo-per-prove` (come server e `npm run token`). Firma con `signToken` di `server/auth.ts`.
- Link: validità predefinita 12 ore, ruoli `editor` (trainer, `uid` `trainer`) e `participant` (allievi). Link e nomi stampati solo a video.
- Tipi di elemento e campi accettati dal server (`wellFormed` in `server/rooms.ts`): `x, y, width, height` numeri finiti, `strokeColor` e `backgroundColor` stringhe ≤ 60 caratteri.
- Una board di destinazione con contenuto viene saltata, mai svuotata.
- Messaggi all'utente in italiano; errore = messaggio chiaro e `process.exit(1)`, mai uno stack trace.
- Test: `npm test` (esteso a `scripts/**/*.test.ts`).

## Review Focus

1. Intestazione dell'immagine con dimensioni assurde (0, enormi) o file che non è un'immagine / troppo grande: errore chiaro, nessun elemento inviato.
2. File degli allievi con righe vuote, nomi duplicati, nomi con accenti/spazi, gruppo fuori intervallo o non numerico: errore chiaro o `uid` unici e validi.
3. Server spento o link rifiutato: messaggio chiaro, nessun gruppo a metà senza avviso.
4. Board di destinazione già piena (anche solo una nota): saltata con avviso, contenuto intatto.
5. `board:<id>` uguale a una board di destinazione, o board di origine vuota/inesistente: errore chiaro.

---

### Task 1: Parti pure (`scripts/seed-lib.ts`)

**Files:**
- Create: `scripts/seed-lib.ts`, `scripts/seed-lib.test.ts`
- Modify: `package.json` (script `test` esteso a `scripts/**/*.test.ts`, script `seed`), `tsconfig.json` (`include` con `scripts`)

**Interfaces:**
- Produces:
  - `interface SeedArgs { corso: string; gruppi: number; materiale: { tipo: "immagine"; percorso: string } | { tipo: "board"; id: string }; server: string; base: string; ore: number; trainer: string; allievi?: string }`
  - `parseArgs(argv: string[]): SeedArgs | { errore: string }` — posizionali `<corso> <gruppi> <materiale>`; opzioni `--server --base --ore --trainer --allievi`; `materiale` che inizia con `board:` è una board. Predefiniti: server `http://localhost:3030` (senza `/` finale), base = server, ore 12, trainer `Trainer`.
  - `assignStudents(lines: string[], gruppi: number): { ok: Student[] } | { errore: string }`, `interface Student { name: string; uid: string; group: number }`. Righe vuote e commenti `#` ignorati; `Nome` oppure `Nome;gruppo`; senza gruppo, distribuzione a turno (1,2,…,N,1,…) sui soli allievi senza gruppo, continuando dal gruppo meno numeroso; `uid` = nome minuscolo, senza accenti, caratteri non `[a-z0-9]` → `-`, massimo 40 caratteri, unico (suffisso `-2`, `-3`…).
  - `imageInfo(buf: Buffer): { mime: string; width: number; height: number } | null` per PNG, JPEG, WebP (VP8, VP8L, VP8X) e GIF, dalle intestazioni.
  - `buildImageScene(info: { mime: string; width: number; height: number }, dataURL: string): { els: any[]; files: any[] }` — un elemento `image` bloccato (`locked: true`), larghezza al massimo 1400 px mantenendo le proporzioni (mai ingrandita), altezza al massimo 1000 px, centrato su (0, 0), `fileId` casuale, e il file `{ id, mimeType, dataURL, created }`.
  - `groupRoom(corso: string, n: number): string` → `` `${corso}-g${n}` ``.

- [ ] **Step 1: Test.** In `scripts/seed-lib.test.ts`: `parseArgs` — caso completo con tutte le opzioni; predefiniti; `materiale` `board:lezione1` → `{tipo:"board", id:"lezione1"}`; errori (messaggio non vuoto) per: argomenti mancanti, `gruppi` `0`, `13`, `abc`, `2.5`, `corso` di 61 caratteri o con caratteri non ammessi, `ore` `0`/negative/non numeriche, opzione sconosciuta, `board:` vuoto. `assignStudents` — `["Anna", "Marco", "Giulia", "Luca", "Sara"]` con 2 gruppi → gruppi 1,2,1,2,1; `"Anna;2"` fissa il gruppo; righe vuote e `# commento` ignorate; uid `"Zoë Müller"` → `zoe-muller`, due `"Anna"` → `anna` e `anna-2`; errore per gruppo `0`, `3` (con 2 gruppi), `x`; errore per nome vuoto prima del `;`. `imageInfo` — buffer minimi costruiti nel test per PNG (IHDR 3x2), GIF (4x5), JPEG (SOF0 6x7), WebP VP8X (8x9), WebP VP8L (10x11), WebP VP8 (12x13); `null` per testo, buffer vuoto, PNG troncato. `buildImageScene` — immagine 2800x1000 → larghezza 1400, altezza 500, `locked true`, centrata (`x === -width/2`); immagine 400x300 non ingrandita; 3000x6000 → altezza 1000; dimensioni 0 → rifiutate (lancia `Error`); il file ha `id === els[0].fileId` e `dataURL` invariato; l'elemento ha `x,y,width,height` finiti e `strokeColor`/`backgroundColor` stringhe.
- [ ] **Step 2: `npm test`** (FAIL), poi **implementare** `scripts/seed-lib.ts` con le firme sopra. `imageInfo` legge solo le intestazioni (PNG: 8 byte di firma + IHDR; GIF: byte 6-9; JPEG: scorrere i marker fino a un SOF0-SOF3/SOF5-SOF7/SOF9-SOF11/SOF13-SOF15; WebP: chunk dopo `RIFF....WEBP`).
- [ ] **Step 3:** aggiungere `"seed": "tsx scripts/seed.ts"` a `package.json`, estendere `test` con `"scripts/**/*.test.ts"` e `tsconfig.json` `include` con `"scripts"`. Eseguire `npm test` e `npx tsc --noEmit` (PASS).
- [ ] **Step 4: Commit** (`feat: parti pure del comando seed`).

### Task 2: CLI e materiale immagine

**Files:**
- Create: `scripts/seed.ts`, `scripts/seed.test.ts`
- Modify: `README.md` (sezione "Classi di lavoro")

**Interfaces:**
- Consumes: tutto da `seed-lib.ts`; `signToken`, `TokenPayload` da `server/auth.ts`.
- Produces:
  - `connectBoard(server: string, room: string, token: string): Promise<BoardConn>`, `interface BoardConn { els: any[]; files: any[]; send(msg: unknown): void; close(): Promise<void> }` — apre `ws(s)://…/connect/<room>?t=<token>`, attende `init`, raccoglie i messaggi `files` che arrivano subito dopo (fino a 400 ms senza altri), rifiuta con `Error` leggibile se il server è spento o il link è rifiutato.
  - `main(argv: string[], env: NodeJS.ProcessEnv): Promise<number>` — restituisce il codice di uscita; stampa in italiano; l'esecuzione diretta del file chiama `main(process.argv.slice(2), process.env)` e `process.exit(code)`.
  - Formato dell'elenco stampato: una sezione per gruppo con riga `Gruppo N — <board> (saltata: ha già del contenuto)` oppure `Gruppo N — <board>`, `  Trainer: <link>`, e per ogni allievo `  <Nome>: <link>`; senza `--allievi`, una riga `  Allievi (link di gruppo, condividono identità e puntini): <link>`.

- [ ] **Step 1: Test di integrazione** (`scripts/seed.test.ts`): avvia `npx tsx server/index.ts` come processo figlio con `PORT` libera, `DATA_DIR` temporanea, `BOARD_SECRET=test-secret` e `NODE_ENV` vuoto, attende `GET /health`, e a fine test termina il processo. Test: (a) **immagine su 3 gruppi con 5 allievi:** crea un PNG minimo valido in una cartella temporanea, lancia `main([...])` con `--allievi`; atteso exit 0, output con tre gruppi, 5 link allievi e 3 link trainer; connettendosi a `corso-g1` con un link `viewer` si ricevono un elemento `image` con `locked true` e un file con lo stesso `fileId`; (b) **secondo lancio con lo stesso corso:** exit 0, ogni gruppo marcato `saltata`, e gli elementi della board invariati (una sola immagine); (c) **sicurezza del materiale:** con un link `participant` del gruppo si invia un `els` che sposta l'immagine e il server risponde `deny`, la scena sul server resta con la posizione originale; (d) **errori:** file inesistente, file di testo al posto dell'immagine, immagine di 11 MB (buffer riempito, dataURL oltre il limite) → exit 1 con messaggio, nessuna board creata (la cartella `rooms/` non contiene le board del corso); server spento (porta chiusa) → exit 1 con messaggio che nomina il server; `--allievi` con gruppo non valido → exit 1, nessuna board creata.
- [ ] **Step 2: `npm test`** (FAIL). **Implementare** `scripts/seed.ts`: leggere `.env` con `process.loadEnvFile` come il server (silenzioso se manca), validare tutto (argomenti, immagine, allievi) **prima** di aprire qualsiasi connessione, poi per ogni gruppo connettersi come `editor` (`uid` `trainer`), saltare se `els.length > 0`, altrimenti inviare `files` e poi `els` e chiudere solo dopo aver ricevuto la conferma (rimandare `ptr` vuoto e attendere ~300 ms oppure verificare riconnettendosi: scegliere un modo che garantisca che il server abbia applicato i messaggi prima di chiudere), poi firmare i link con `signToken` (`exp` = ora + `ore` ore).
- [ ] **Step 3: `npm test`** (PASS) e `npx tsc --noEmit`.
- [ ] **Step 4: README:** sezione "Classi di lavoro" con uso, esempi (immagine e `board:`), formato di `--allievi`, cosa succede con board già piene e senza elenco allievi.
- [ ] **Step 5: Commit** (`feat: comando seed per le classi di lavoro (immagine)`).

### Task 3: Materiale da una board già preparata

**Files:**
- Modify: `scripts/seed.ts`, `scripts/seed.test.ts`, `README.md`

**Interfaces:**
- Consumes: `connectBoard`, `main` dal Task 2.
- Produces: gestione di `board:<id>` in `main`: legge scena e immagini dalla board `<id>` (come `editor`, `uid` `trainer`) e le invia a ogni gruppo; errore se `<id>` è vuota, non esiste o coincide con una board di destinazione.

- [ ] **Step 1: Test di integrazione:** (a) si prepara la board `lezione1` inviando come `editor` due elementi (un rettangolo con testo e un'immagine con il suo file); `main(["corso", "2", "board:lezione1", …])` → exit 0; `corso-g1` e `corso-g2` contengono gli stessi elementi e lo stesso file di `lezione1`, e la board d'origine è invariata; un link `participant` non può modificarli (`deny`); (b) `board:` con id inesistente/vuota → exit 1 con messaggio, nessuna board del corso creata; (c) `board:corso-g1` con corso `corso` → exit 1 (coincide con una destinazione).
- [ ] **Step 2: `npm test`** (FAIL), **implementare** il ramo `board` in `scripts/seed.ts` (stessa validazione prima di scrivere; gli elementi si inviano così come sono, perché il server assegna la proprietà al trainer), rieseguire (PASS), `npx tsc --noEmit`.
- [ ] **Step 3: README:** esempio con `board:` e nota che gli elementi risultano del trainer.
- [ ] **Step 4: Verifica manuale** con il server di sviluppo: preparare una board, lanciare `npm run seed -- prova 3 board:<id> --allievi allievi.txt`, aprire due link in due browser (trainer e allievo) e controllare che l'allievo veda il materiale, non possa spostarlo e possa aggiungere note; poi cancellare le board di prova.
- [ ] **Step 5: `npm test`, `npm run build`, commit** (`feat: seed da una board già preparata`).

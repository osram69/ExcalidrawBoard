# Stanze dal vivo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aula con elenco dei collegati, creazione di stanze con spostamento automatico degli allievi, timer unico per tutto il corso, chiusura con ritorno in aula e stanze salvate, pannello "Invita".

**Architecture:** Ogni board resta una board vera. Un oggetto `Course` in memoria (per aula) tiene stato del corso (turni di stanze, `course.json` su disco), timer condiviso e presenza; le stanze di un turno si chiamano `<aula>-r<turno>-s<n>` e hanno `parent.json`. Lo spostamento è un messaggio `goto` con token firmato dal server (stesso nome/uid/ruolo/scadenza di quello che l'allievo già ha) che il client usa per aprire la nuova board.

**Tech Stack:** Node >= 22, TypeScript via `tsx`, `ws`, React 19, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-25-stanze-dal-vivo-design.md`

## Global Constraints

- Nessuna nuova dipendenza. Stesso formato e stesso segreto dei token. I ruoli si controllano sul server.
- Nome aula massimo 50 caratteri per creare stanze; stanze `<aula>-r<turno>-s<n>` entro i 64 caratteri di `ROOM_ID`. Stanze per turno da 2 a 12, al massimo 200 assegnazioni, una sola stanza per persona.
- `rooms-create`, `rooms-move`, `rooms-visit`, `rooms-close` solo da `editor`; `rooms-create` solo dall'aula; un solo turno aperto alla volta.
- Il token di spostamento mantiene `name`, `uid`, `email`, `role` ed `exp` del token del peer: mai più lungo, mai ruolo diverso.
- Presenza solo ai `editor`; mai email; chiavi (`key`) già note ai peer.
- Gli oggetti copiati nelle stanze appartengono al trainer che crea (proprietà impostata dal server, come `seed`).
- Un partecipante entra in una stanza solo se assegnato a quella stanza in un turno **aperto** del corso; gli `editor` possono entrare in qualsiasi stanza del corso.
- Un'aula senza stanze si comporta come oggi (timer proprio, nessun cambiamento visibile se non l'elenco dei collegati per il trainer).
- Le board delle stanze restano su disco alla chiusura.
- Testi in italiano nello stile esistente. Test: `npm test`.

## Review Focus

1. Un allievo (participant/viewer) che prova `rooms-create`, `rooms-move`, `rooms-visit`, `rooms-close`, o che prova a collegarsi a una stanza non sua / di un turno chiuso / di un altro corso con un token di un'altra board: ignorato o rifiutato, senza effetti.
2. Il token di spostamento non allunga la scadenza né cambia ruolo (anche con `uid` assente: chiave `n:Nome`).
3. Chiavi di assegnazione ostili (`__proto__`, non collegate, duplicate, stanza fuori intervallo, `rooms` 1 o 13): errore chiaro, nessuna stanza creata.
4. Aula con più di 5000 elementi o molte immagini: la copia nelle stanze non perde niente (blocchi) e non blocca il server.
5. Chiudere mentre qualcuno si sta ricollegando, ricarica nella stanza, trainer che chiude da una stanza: nessun allievo resta in una stanza chiusa.

---

### Task 1: Funzioni pure e dati del corso

**Files:**
- Create: `server/assign.ts` (senza dipendenze di Node: importabile dal client), `server/assign.test.ts`, `server/course-data.ts`, `server/course-data.test.ts`

**Interfaces (Produces):**
- `server/assign.ts`: `MAX_AULA = 50`; `MIN_ROOMS = 2`; `MAX_ROOMS = 12`; `MAX_ASSIGN = 200`; `roomId(aula: string, round: number, n: number): string` → `` `${aula}-r${round}-s${n}` ``; `validateAssign(rooms: unknown, assign: unknown, allowed: Set<string>): { ok: true; rooms: number; assign: Map<string, number> } | { ok: false; motivo: string }` (`rooms` intero tra 2 e 12; `assign` oggetto semplice con chiavi presenti in `allowed`, valori interi tra 1 e `rooms`, al massimo 200; `__proto__` come chiave tratta come qualsiasi altra e quindi rifiutata se non in `allowed`); `randomAssign(keys: string[], rooms: number, rand?: () => number): Record<string, number>` (mescola e distribuisce a turno: stanze con numero di persone che differisce al massimo di uno; usa `Object.create(null)` per l'oggetto restituito).
- `server/course-data.ts` (usa `node:fs`): `interface Member { key: string; name: string }`, `interface RoomInfo { n: number; id: string; members: Member[] }`, `interface Round { round: number; open: boolean; createdAt: number; rooms: RoomInfo[] }`, `interface CourseData { round: number; rounds: Round[] }`; `readCourse(dir: string): CourseData` (vuoto se manca o è corrotto: `{ round: 0, rounds: [] }`), `writeCourse(dir: string, c: CourseData): void` (atomica), `readParent(dir: string): { aula: string; round: number; n: number } | null`, `writeParent(dir: string, p: { aula: string; round: number; n: number }): void`, `openRound(c: CourseData): Round | null`, `assignedRoom(c: CourseData, key: string): RoomInfo | null` (stanza del turno aperto in cui la chiave è membro).

- [ ] **Step 1: Test di `assign.ts`:** `roomId("isaqb-dic26", 2, 3) === "isaqb-dic26-r2-s3"`; `validateAssign` valido con 3 chiavi su 3 stanze (restituisce `Map` con i valori); errori per `rooms` `1`, `13`, `2.5`, `"3"`; chiave non in `allowed`; chiave `__proto__` non in `allowed`; valore `0`, `4` (con 3 stanze), `"1"`, `1.5`; `assign` non oggetto (`null`, array, stringa); più di 200 voci; nessuna voce (valido: stanze vuote?: rifiutato con motivo "Assegna almeno una persona"); `randomAssign` con 7 chiavi e 3 stanze → stanze di 3, 2, 2 persone (conteggi con differenza ≤ 1), tutte le chiavi presenti, valori tra 1 e 3, deterministico con `rand` fissato, chiave `__proto__` presente come proprietà propria senza toccare il prototipo.
- [ ] **Step 2: Test di `course-data.ts`** (cartella temporanea): `readCourse` su cartella vuota → `{round:0, rounds:[]}`, su JSON corrotto → vuoto; giro scrittura/lettura; `openRound` con un turno aperto e uno chiuso; `assignedRoom` trova la stanza del membro solo se il turno è aperto, `null` per chiave sconosciuta o turno chiuso; `readParent`/`writeParent` giro completo, `null` se manca o malformato.
- [ ] **Step 3: `npm test`** (FAIL), implementare i due moduli, rieseguire (PASS), `npx tsc --noEmit`.
- [ ] **Step 4: Commit** (`feat: funzioni pure e dati del corso per le stanze`).

### Task 2: Corso in memoria, presenza, token di spostamento

**Files:**
- Create: `server/course.ts`, `server/course.test.ts`
- Modify: `server/rooms.ts` (`Peer.exp`, `Peer.email?`; `Room.timer` non più `readonly`; `Room.course`; `loadedRoom`), `server/index.ts` (collegare il corso, presenza, `init.course`), `server/features.ts` (`featureSnapshot` con `course`)

**Interfaces:**
- Consumes: Task 1.
- Produces in `server/course.ts`: `gotoToken(p: { name: string; key: string; role: Role; exp: number; email?: string }, room: string, secret: string): string` (token firmato; `uid` = `key` se valido per la regex `[\w.@-]{1,64}`, altrimenti assente; stesso `name`/`role`/`exp`/`email`); `class Course { aula: string; dir: string; dataDir: string; secret: string; data: CourseData; timer: RoomTimer; boardIds(): string[]; broadcast(msg: unknown): void; presence(): { rooms: Record<string, { key: string; name: string; role: Role }[]>; current: { round: number; rooms: { n: number; id: string; members: Member[] }[] } | null }; pushPresence(): void; canEnter(room: string, peer: { key: string; role: Role }): boolean; whereIs(room: string): { aula: string; round: number | null; n: number | null } }`; `getCourse(dataDir: string, secret: string, boardId: string): Course` (cache per aula; l'aula di una board è `readParent(dir)?.aula ?? boardId`; carica `course.json`); `Room.course: Course | null` e `Room.timer` impostati al collegamento.
- `Peer` guadagna `exp: number` e `email?: string`; `loadedRoom(id: string): Room | undefined` in `rooms.ts`.

- [ ] **Step 1: Test di `course.ts`** (senza server): `gotoToken` firmato con un segreto → `inspectToken` per la stanza di destinazione dà stesso nome, ruolo ed `exp`, `uid` uguale alla chiave valida, `uid` assente per chiave `n:Anna Rossi`, mai `exp` maggiore; `canEnter`: aula sempre vero; stanza di turno aperto vero per il membro, falso per un non membro, falso per turno chiuso, vero per `editor` anche con turno chiuso; stanza di un altro corso falso; `presence()` con peer finti nell'aula e in una stanza (uso di `loadedRoom` con `getRoom` e peer finti come nei test di `features`): chiavi e nomi, nessun campo `email`; `whereIs` per aula (`n: null`), stanza (`round`, `n`), stanza sconosciuta.
- [ ] **Step 2: `npm test`** (FAIL), implementare `course.ts` e gli adattamenti in `rooms.ts`, `features.ts` (`featureSnapshot` aggiunge `course: whereIs(room)`) e `index.ts`: `getCourse` al collegamento, `r.course = course; r.timer = course.timer`, `exp`/`email` nel `Peer`, **`presence`** inviata ai `editor` del corso a ogni entrata e uscita (`course.pushPresence()` dopo `r.join` e dopo `r.leave`), rifiuto del collegamento (403) se `!course.canEnter(room, peer)`.
- [ ] **Step 3: Test di integrazione** (`server/rooms.test.ts`, vero server, client WebSocket di prova con raccolta dei messaggi e `waitFor`): trainer collegato all'aula; un allievo entra → il trainer riceve `presence` con l'allievo in `rooms[aula]` e senza `email`; un secondo allievo; il primo esce → `presence` aggiornata; **gli allievi non ricevono mai `presence`**; `init` contiene `course: { aula, round: null, n: null }`.
- [ ] **Step 4: `npm test`, `npx tsc --noEmit`, commit** (`feat: corso in memoria, presenza dei collegati e token di spostamento`).

### Task 3: Timer unico per corso

**Files:**
- Modify: `server/features.ts` (broadcast del timer a tutto il corso), `server/rooms.test.ts`

**Interfaces:**
- Consumes: `Course.timer`, `Course.broadcast`.
- Produces: i comandi `timer` dell'`editor` aggiornano il timer del corso e il nuovo stato va a tutti i collegati di tutte le board del corso (aula e stanze caricate); le board senza corso usano ancora `r.broadcast`.

- [ ] **Step 1: Test** (in `server/features.test.ts` con peer finti e in `server/rooms.test.ts` con il vero server): due board dello stesso corso (aula e una stanza caricata): il trainer avvia 60 secondi in una → i peer di entrambe ricevono `timer` `running`; un allievo che si collega dopo riceve lo stato corrente in `init`; il trainer avvia dalla stanza e l'aula lo riceve; un'altra aula non collegata non riceve nulla; un `participant` non può avviare il timer.
- [ ] **Step 2: `npm test`** (FAIL), implementare (`handleFeatureMessage` usa `r.course ? r.course.broadcast(msg) : r.broadcast(msg)`; i test esistenti di `features.test.ts` restano validi senza corso), rieseguire (PASS), `npx tsc --noEmit`.
- [ ] **Step 3: Commit** (`feat: timer unico per tutto il corso`).

### Task 4: Crea stanze, spostamento, rientro

**Files:**
- Create: `server/rooms-actions.ts` (azioni `rooms-*`), `server/rooms-actions.test.ts` (unitari con peer finti dove possibile)
- Modify: `server/features.ts` (instrada `rooms-*`), `server/index.ts` (`goto` al rientro nell'aula e controllo `canEnter`), `server/auth-http.ts` (`/auth/check` con `stanza chiusa` e `aula`), `server/rooms.test.ts`

**Interfaces:**
- Consumes: Task 1-3.
- Produces: messaggi `rooms-create`, `rooms-move`, `rooms-visit`, `rooms-close` e risposte `goto` (`{ t: "goto", room, token }`) e `rooms-error` (`{ t: "rooms-error", motivo }`); `Course.pushPresence()` dopo ogni cambiamento di assegnazioni; funzioni `createRooms(r, peer, msg)`, `moveMember(r, peer, msg)`, `visit(r, peer, msg)`, `closeRooms(r, peer)` in `rooms-actions.ts`.

Regole (dal disegno): `rooms-create` solo `editor` dell'aula, non con turno aperto, aula ≤ 50 caratteri, validazione con `validateAssign` (chiavi dei soli peer non-editor collegati all'aula, `allowed` costruito dai peer), copia di elementi non cancellati (blocchi da 1000, proprietà del trainer) e immagini (blocchi da 20) in `roomId(aula, round+1, n)`, `flush`, `writeParent` e `writeCourse`, poi `goto` agli assegnati collegati. `rooms-move` (`{ key, n }`) per qualsiasi non-editor collegato al corso con turno aperto. `rooms-visit` (`{ room }`) per stanze dell'elenco dei turni (anche chiusi) o l'aula, con token da `editor`. `rooms-close` chiude il turno aperto e manda in aula (con `goto`) tutti i collegati delle stanze di quel turno. Al collegamento all'aula, un non-editor con assegnazione nel turno aperto riceve `goto` verso la sua stanza.

- [ ] **Step 1: Test di integrazione** (vero server, WebSocket di prova), scenari: **(a)** crea con due allievi assegnati: ricevono `goto` con token verificabile (`inspectToken`: stessa persona, ruolo `participant`, `exp` uguale, board giusta) e, collegandosi con quel token, ottengono nell'`init` gli elementi disegnati in aula dal trainer, con `customData.owner` del trainer, e il loro tentativo di spostarli riceve `deny`; **(b)** un allievo non può creare/spostare/visitare/chiudere e un `editor` di una stanza non può creare; **(c)** errori: `rooms` 1 e 13, chiave non collegata, valore fuori intervallo, `__proto__`, aula con nome di 51 caratteri, turno già aperto → `rooms-error` e nessuna cartella di stanza creata; **(d)** ricarica: un allievo assegnato che si ricollega all'aula riceve subito `goto` verso la sua stanza; **(e)** un token per una stanza di un altro allievo non entra (403) e un token valido per la stanza ma con turno chiuso non entra; **(f)** `/auth/check` per un allievo con token di stanza chiusa risponde 401 con `motivo: "stanza chiusa"` e `aula`; **(g)** aula con 6000 elementi e un'immagine: tutte le stanze ricevono tutto (conteggi e file).
- [ ] **Step 2: `npm test`** (FAIL), implementare `rooms-actions.ts` e gli instradamenti, rieseguire (PASS), `npx tsc --noEmit`.
- [ ] **Step 3: Commit** (`feat: creazione delle stanze, spostamento degli allievi e rientro nella propria stanza`).

### Task 5: Visita, spostamento di un allievo e chiusura (server)

**Files:**
- Modify: `server/rooms.test.ts` (i comportamenti sono già in `rooms-actions.ts` dal Task 4; qui si fissano con i test e si correggono le lacune)

- [ ] **Step 1: Test di integrazione:** **(a)** `rooms-move`: l'allievo riceve `goto` verso la nuova stanza, `course.json` aggiornato (membri), la presenza cambia, il suo vecchio token di stanza non entra più; **(b)** `rooms-visit`: il trainer riceve `goto` con token da `editor` (ruolo `editor`, `exp` uguale al suo) per una stanza aperta, per una di un turno chiuso e per l'aula; richiesta di una stanza di un altro corso → `rooms-error`; **(c)** `rooms-close` dall'aula e da una stanza: tutti i collegati nelle stanze ricevono `goto` verso l'aula (stesso nome/ruolo/`exp`), `course.json` ha `open: false`, le cartelle e il contenuto delle stanze restano (riaperte dal trainer con `rooms-visit` contengono le modifiche fatte dagli allievi), un allievo non può rientrare nella stanza chiusa; **(d)** secondo turno dopo la chiusura: nascono `-r2-s1…` con una nuova copia dell'aula, i membri del turno 1 non cambiano; **(e)** un allievo che si ricollega all'aula dopo la chiusura resta in aula (nessun `goto`); **(f)** il timer avviato dalla stanza arriva all'aula e alle altre stanze.
- [ ] **Step 2: `npm test`**; correggere ciò che manca nei moduli del Task 4 finché passa (ogni correzione con il test già scritto); `npx tsc --noEmit`.
- [ ] **Step 3: Commit** (`feat: visita, spostamento e chiusura delle stanze`).

### Task 6: Interfaccia: collegati, stanze, invito

**Files:**
- Create: `src/Rooms.tsx`, `src/Invite.tsx`, `src/goto.ts` (+ `src/goto.test.ts`)
- Modify: `src/Board.tsx` (messaggi `presence`, `goto`, `rooms-error`; `init.course`; pulsanti "Stanze" e "Invita" per l'`editor`; chip della stanza per tutti), `src/main.tsx` (gestione di `goto` con salvataggio del token nella sessione e apertura della nuova board; `stanza chiusa` da `/auth/check` porta all'aula), `src/session.ts` (`saveGotoToken`), `src/remember.ts` se serve, `src/styles.css`

**Interfaces:**
- Produces: `saveGotoToken(room: string, token: string): void` (token solo nella sessione del browser della scheda; toglie un eventuale token ricordato per quella board), `gotoUrl(room: string): string` → `/b/<room>`; pannello "Stanze" (collegati con luogo; crea stanze con numero, assegnazione per persona e "Distribuisci a caso" che usa `randomAssign`; a turno aperto: membri per stanza, "Entra", "Sposta", "Chiudi stanze"; dalle stanze "Torna in aula"; elenco dei turni già fatti con "Apri"); pannello "Invita" (link `/b/<aula>` con "Copia", password 8-200, data di fine facoltativa, "Salva" con `PUT /auth/access` e token da trainer; nascosto fuori dall'aula).
- [ ] **Step 1: Test di `src/goto.ts`:** `gotoUrl` accetta solo nomi di board validi (`[A-Za-z0-9_-]{1,64}`) e restituisce `/b/<nome>`, altrimenti lancia; `saveGotoToken` scrive nel deposito di sessione e rimuove quello locale della stessa board (deposito finto come in `remember.test.ts`); chiavi con `..` o `/` rifiutate.
- [ ] **Step 2: `npm test`** (FAIL), implementare `goto.ts`, poi i componenti e l'integrazione in `Board.tsx`/`main.tsx`; `npx tsc --noEmit`, `npm test` (PASS).
- [ ] **Step 3: Verifica manuale nel browser** (server di sviluppo, schede separate): trainer + tre allievi nell'aula (login con password impostata dal pannello "Invita"); l'elenco mostra tutti con i nomi; il trainer disegna, crea 2 stanze con "Distribuisci a caso": gli allievi finiscono nelle stanze con la copia del disegno e il chip "Stanza n"; il timer avviato dal trainer parte per tutti; ricarica di un allievo → resta nella stanza; il trainer entra in una stanza, sposta un allievo, torna in aula; "Chiudi stanze" riporta tutti in aula, le stanze si riaprono dallo storico; un nuovo turno crea `-r2-`. Controllare anche cursori e nomi nelle stanze.
- [ ] **Step 4: Commit** (`feat: interfaccia di collegati, stanze e invito`).

### Task 7: Documentazione e controlli finali

**Files:**
- Modify: `README.md`

- [ ] **Step 1:** Sezione "Aula e stanze dal vivo" nel README (flusso, "Invita", turni, ritorno in aula, stanze salvate, differenze con `seed`, limiti: un turno alla volta, nome aula ≤ 50 caratteri, si assegna chi è collegato).
- [ ] **Step 2:** `npx tsc --noEmit`, `npm test`, `npm run build` (tutti PASS), commit (`docs: aula e stanze dal vivo`).

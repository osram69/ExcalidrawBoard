# Gadget board (timer, votazione, template, libreria) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere alla board Excalidraw un timer condiviso, la votazione con puntini sulle note, cinque template e una libreria di circa 45 forme per l'architettura software.

**Architecture:** Timer e voti sono stato per stanza nel server (`Room`), modificato da nuovi messaggi WebSocket `{t: ...}` con controllo del ruolo lato server e inviato a chi si collega dentro `init`. Template e libreria sono dati lato browser convertiti con `convertToExcalidrawElements`; i dati sono testabili in Node perché non importano Excalidraw.

**Tech Stack:** Node >= 22, TypeScript via `tsx`, `ws`, React 19, `@excalidraw/excalidraw` 0.18, test con `node:test` (nessuna nuova dipendenza).

**Spec:** `docs/superpowers/specs/2026-11-25-gadget-board-design.md`

## Global Constraints

- Nessuna nuova dipendenza npm.
- Ruoli: `editor` controlla timer e votazione e può votare; `participant` vota; `viewer` non scrive nulla (vede timer e totali). Ogni controllo di ruolo è sul server, mai solo nell'interfaccia.
- Tipi di elemento ammessi dal server ([server/rooms.ts](../../../server/rooms.ts) `TYPES`): `rectangle, diamond, ellipse, arrow, line, freedraw, text, image, frame`. Template e libreria non devono usarne altri.
- `strokeColor` e `backgroundColor` stringhe di al massimo 60 caratteri; `x, y, width, height` numeri finiti.
- Budget voti: predefinito 5, valido 1-20 (intero), nessun limite per nota. Chiave utente = `peer.key`.
- Timer: durata valida 1-10800 secondi (intero). Non persistito. Voti e impostazioni della votazione persistiti in `data/rooms/<board>/votes.json` (scrittura atomica).
- Stile libreria e template: `roughness: 0`.
- Testi dell'interfaccia in italiano, nello stile della palette esistente.
- Test: `npm test` esegue `node --import tsx --test "server/**/*.test.ts" "src/**/*.test.ts"`.
- Comportamento esistente di `els`, `files`, `ptr`, proprietà degli oggetti e ruoli invariato.

## Review Focus

1. Client con orologio sbagliato: il timer deve usare l'ora del server (`now` nel messaggio) per calcolare il residuo. Test in Task 2.
2. Due clic rapidi sul "+" al limite del budget: il secondo voto è respinto e i puntini residui non vanno mai sotto zero. Test in Task 3.
3. Id elemento `__proto__` (passa la regex `ID` del server) usato come id di una nota votata: non deve inquinare gli oggetti né far crashare il server. Test in Task 3.
4. Nota votata poi cancellata: i suoi voti spariscono dai totali e il puntino torna disponibile. Test in Task 3.
5. Messaggi malformati o ruoli non ammessi (`seconds` stringa/NaN/enorme, `perPerson` 0 o 999, `delta` 5, `viewer` che vota, `participant` che avvia il timer): ignorati senza eccezioni e senza broadcast. Test in Task 1 e Task 3.

---

### Task 1: Timer sul server

**Files:**
- Create: `server/timer.ts`, `server/features.ts`, `server/timer.test.ts`, `server/features.test.ts`
- Modify: `server/rooms.ts` (campo `timer` su `Room`), `server/index.ts` (messaggio `init` e smistamento), `package.json` (script `test`), `docs/superpowers/specs/2026-11-25-gadget-board-design.md` (tabella protocollo: azione `extend` e stato `done`)

**Interfaces:**
- Produces:
  - `type TimerStatus = "idle" | "running" | "paused" | "done"`; `interface TimerState { status: TimerStatus; endsAt: number; remainingMs: number; durationMs: number }`
  - `class RoomTimer { constructor(now?: () => number); get state(): TimerState; apply(action: unknown, seconds?: unknown): boolean }` (`true` se lo stato è cambiato). Azioni: `start` (richiede `seconds`), `pause` (solo se running), `resume` (solo se paused), `extend` (richiede `seconds`; ammesso se running o paused), `reset`. `state` restituisce `done` quando `running` ed `endsAt <= now()`.
  - `function handleFeatureMessage(r: Room, peer: Peer, msg: unknown): boolean` in `server/features.ts` (`true` se il messaggio era `timer`, `vote-ctl` o `vote`, anche se scartato). Per `timer`: solo `editor`; ritrasmette `{ t: "timer", state, now: Date.now() }` a tutti, mittente compreso.
  - `function featureSnapshot(r: Room, peer: Peer): { timer: { state: TimerState; now: number } }` (esteso nel Task 3).
  - `Room.timer: RoomTimer`.

- [ ] **Step 1: Aggiungere lo script e scrivere i test del timer.** In `package.json` aggiungere `"test": "node --import tsx --test \"server/**/*.test.ts\" \"src/**/*.test.ts\""`. In `server/timer.test.ts`, con un orologio finto modificabile, test: `start 300` → `status "running"`, `endsAt = t0 + 300000`, `durationMs 300000`; `pause` a t0+100s → `paused`, `remainingMs 200000`; `resume` a un altro istante → `endsAt = ora + 200000`; `extend 60` da running sposta `endsAt` di +60000, da paused aumenta `remainingMs` di 60000, da idle torna `false`; superata `endsAt` lo `state.status` è `done`; `reset` → `idle`; rifiutati (`false`, stato invariato): `seconds` `0`, `-5`, `10801`, `NaN`, `"300"`, `undefined` per `start`, azione sconosciuta, `pause` da idle, `resume` da running.
- [ ] **Step 2: Eseguire `npm test`.** Atteso: FAIL (modulo `./timer.ts` mancante).
- [ ] **Step 3: Implementare `RoomTimer` in `server/timer.ts`** con le firme sopra; `seconds` valido solo se numero finito, intero dopo `Math.floor`, tra 1 e 10800.
- [ ] **Step 4: Eseguire `npm test`.** Atteso: PASS dei test del timer.
- [ ] **Step 5: Scrivere `server/features.test.ts` per il timer.** Con peer finti (`ws` con `readyState: 1` e `send` che accumula i messaggi, `Room` creata con una cartella temporanea): un `editor` che manda `{t:"timer", action:"start", seconds:60}` fa arrivare `{t:"timer"}` con `state.status "running"` a tutti i peer, mittente compreso; la stessa mossa di un `participant` e di un `viewer` non invia nulla e lascia il timer `idle`; `{t:"timer", action:"start", seconds:"abc"}` da `editor` non invia nulla; `handleFeatureMessage` restituisce `false` per `{t:"els"}`.
- [ ] **Step 6: Implementare `handleFeatureMessage` (ramo `timer`) e `featureSnapshot` in `server/features.ts`**, aggiungere `readonly timer = new RoomTimer()` a `Room`, e in `server/index.ts` (a) chiamare `handleFeatureMessage(r, peer, msg)` subito dopo il ramo `ptr` e *prima* dell'uscita dei `viewer`, uscendo se restituisce `true`; (b) aggiungere `...featureSnapshot(r, peer)` al messaggio `init`.
- [ ] **Step 7: Aggiornare la tabella del protocollo nello spec** con l'azione `extend` e lo stato `done`.
- [ ] **Step 8: Eseguire `npm test` e `npx tsc --noEmit`.** Atteso: tutti i test PASS, nessun errore di tipo.
- [ ] **Step 9: Commit** (`git add server package.json docs`, messaggio `feat: timer condiviso sul server`).

### Task 2: Timer nell'interfaccia

**Files:**
- Create: `src/timerMath.ts`, `src/timerMath.test.ts`, `src/Timer.tsx`
- Modify: `src/Board.tsx` (stato e messaggi), `src/styles.css`

**Interfaces:**
- Consumes: `TimerState` (`import type` da `../server/timer.ts`); messaggio `timer` e campo `timer` di `init`.
- Produces:
  - `remainingMs(s: TimerState, serverOffsetMs: number, clientNow: number): number` — `running`: `max(0, s.endsAt - (clientNow + serverOffsetMs))`; `paused`: `s.remainingMs`; `idle` e `done`: `0`. L'offset è `m.now - Date.now()` al momento della ricezione.
  - `formatClock(ms: number): string` — `mm:ss` arrotondando i secondi per eccesso, `H:mm:ss` da un'ora in su.
  - `<TimerPill state offsetMs canControl send />` in `src/Timer.tsx`.

- [ ] **Step 1: Scrivere `src/timerMath.test.ts`:** `remainingMs` con orologio client indietro di 1 ora rispetto al server dà lo stesso residuo che con orologio corretto (stesso `endsAt`, stesso `offset` corretto); `paused` ignora l'orologio; `formatClock(0)` = `"00:00"`, `formatClock(59001)` = `"01:00"`, `formatClock(3600000)` = `"1:00:00"`.
- [ ] **Step 2: Eseguire `npm test`** (FAIL), implementare `src/timerMath.ts`, rieseguire (PASS).
- [ ] **Step 3: Implementare `TimerPill` in `src/Timer.tsx`:** visibile solo se lo stato non è `idle` oppure `canControl`; mostra `formatClock(remainingMs(...))` aggiornato ogni 250 ms; con `canControl` mostra preset 5/10/15/30 min (`start`), "+1 min" (`extend`, 60), pausa/riprendi, azzera. A `done` lampeggia per 5 secondi e suona un breve beep Web Audio (si crea l'`AudioContext` dopo il primo gesto dell'utente; pulsante muto che ricorda la scelta solo in memoria).
- [ ] **Step 4: Integrare in `Board.tsx`:** stato `timer` (`{state, offsetMs}`) aggiornato da `init` e `timer`; `<TimerPill>` in alto al centro di `.board-canvas`, con `canControl = session.role === "editor"`; invio con la `send` esistente. Stile in `styles.css` coerente con `.board-palette`.
- [ ] **Step 5: Verifica manuale** (`npm run dev`, un link `editor` e uno `participant` in due browser): il trainer avvia 5 minuti e il partecipante vede lo stesso conto alla rovescia; pausa e riprendi si propagano; ricaricando la pagina del partecipante il timer riparte dal valore corretto; il partecipante non vede i comandi; un link `viewer` vede il timer ma non i comandi. Atteso: tutto confermato.
- [ ] **Step 6: Eseguire `npm test` e `npx tsc --noEmit`, poi commit** (`feat: timer nell'interfaccia`).

### Task 3: Votazione sul server

**Files:**
- Create: `server/votes.ts`, `server/votes.test.ts`
- Modify: `server/rooms.ts` (campo `votes`), `server/features.ts` (rami `vote-ctl` e `vote`, snapshot), `server/features.test.ts`

**Interfaces:**
- Consumes: `handleFeatureMessage`, `featureSnapshot`, `Room.els`.
- Produces:
  - `interface VotePublic { open: boolean; perPerson: number; totals: Record<string, number> }`; `interface MyVotes { mine: Record<string, number>; left: number }`
  - `class RoomVotes { constructor(file: string, isVotable: (id: string) => boolean); control(action: unknown, perPerson?: unknown): boolean; vote(key: string, id: unknown, delta: unknown): boolean; publicState(): VotePublic; mine(key: string): MyVotes }`. `control`: `open` (con `perPerson` opzionale), `close`, `reset` (cancella tutti i voti, mantiene `open` e `perPerson`). `vote` accetta `delta` solo `1` o `-1`. Nei calcoli (totali, usati, residui) contano solo gli id per cui `isVotable` è vero; il salvataggio su `file` è immediato e atomico.
  - `Room.votes: RoomVotes` con `isVotable = id => e esiste && !e.isDeleted && customData.kind === "nota"`.
  - Messaggi: server→tutti `{t:"votes", ...VotePublic}`; server→singolo `{t:"my-votes", ...MyVotes}`; `featureSnapshot` aggiunge `votes: VotePublic` e `myVotes: MyVotes`.

- [ ] **Step 1: Scrivere `server/votes.test.ts`** (`isVotable` finto, file in cartella temporanea). Test: votazione chiusa di default e `vote` → `false`; dopo `open` con `perPerson 3` tre `vote(+1)` anche sulla stessa nota riescono, il quarto → `false`, `left` mai negativo (due voti "simultanei" all'ultimo puntino: il secondo è respinto); `delta -1` senza voti su quella nota → `false`, con un voto → `true`; `delta 5`, `0`, `"1"` → `false`; id non votabile → `false`; nota resa non votabile (cancellata) → sparisce dai totali e `left` aumenta; id `"__proto__"` votabile → il voto funziona, `Object.getPrototypeOf(publicState().totals)` resta `Object.prototype` e `({}).polluted` non esiste; `close` → voti rifiutati, `totals` conservati; `reset` → `totals {}`; `control` con `perPerson` `0`, `21`, `2.5`, `"5"` → `false` e valore invariato; ripresa da file: una nuova `RoomVotes` sullo stesso file ha stessi `open`, `perPerson`, `totals`.
- [ ] **Step 2: Eseguire `npm test`** (FAIL), implementare `server/votes.ts` (strutture interne con `Map`, serializzazione con `Object.fromEntries`), rieseguire (PASS).
- [ ] **Step 3: Estendere `server/features.test.ts`:** `participant` che vota (votazione aperta da un `editor` con `vote-ctl`) fa arrivare `votes` a tutti e `my-votes` solo a lui; `participant` che manda `vote-ctl` → ignorato; `viewer` che manda `vote` → ignorato; `editor` può votare; `vote` con `id` non stringa → ignorato; dopo `vote-ctl` `open`, ogni peer riceve il proprio `my-votes`.
- [ ] **Step 4: Implementare i rami `vote-ctl` (solo `editor`; dopo ogni cambio broadcast di `votes` e `my-votes` a ciascun peer con i suoi dati) e `vote` (`editor` e `participant`)** in `features.ts`; creare `Room.votes` in `rooms.ts` con file `path.join(dir, "votes.json")`; estendere `featureSnapshot`.
- [ ] **Step 5: Eseguire `npm test` e `npx tsc --noEmit`** (tutti PASS) e **commit** (`feat: votazione con puntini sul server`).

### Task 4: Votazione nell'interfaccia

**Files:**
- Create: `src/Votes.tsx`
- Modify: `src/Board.tsx`, `src/styles.css`

**Interfaces:**
- Consumes: messaggi `votes`, `my-votes` e campi `votes`, `myVotes` di `init` (Task 3); note identificate da `customData.kind === "nota"`.
- Produces: `<VoteLayer notes view votes myVotes canVote send />` (badge sopra ogni nota) e `<VotePanel votes myVotes isEditor send />` (pannello). `view = { scrollX, scrollY, zoom, offsetLeft, offsetTop }`; `notes = { id, x, y, width, height }[]` in coordinate di scena.

- [ ] **Step 1: Implementare `VoteLayer`:** contenitore assoluto con `pointer-events: none` sopra il canvas; per ogni nota un badge all'angolo in alto a destra (`left = (x + width + scrollX) * zoom + offsetLeft`, `top = (y + scrollY) * zoom + offsetTop`) con il totale se > 0 e, a votazione aperta e `canVote`, pulsanti "−" e "+" con `pointer-events: auto` che mandano `{t:"vote", id, delta}`. Sui `viewer` nessun pulsante. I pulsanti sono disabilitati se `left === 0` ("+") o se la persona non ha voti su quella nota ("−").
- [ ] **Step 2: Implementare `VotePanel`:** per tutti, quando la votazione è aperta, "Hai N puntini"; per l'`editor` anche apri (con budget 1-20), chiudi, azzera (con conferma `window.confirm`).
- [ ] **Step 3: Integrare in `Board.tsx`:** stati `votes` e `myVotes` aggiornati da `init`, `votes`, `my-votes`; nell'`onChange` esistente, solo se la votazione è aperta o ci sono totali > 0, aggiornare con `requestAnimationFrame` (una volta per frame) lo stato `{view, notes}` ricavato da `appState` e dagli elementi non cancellati con `customData.kind === "nota"`; evitare re-render quando nulla è cambiato.
- [ ] **Step 4: Verifica manuale** (editor + 2 participant + 1 viewer): il trainer apre la votazione con 3 puntini; i partecipanti votano e i totali si aggiornano per tutti in tempo reale; al quarto voto il pulsante "+" è disabilitato; zoom e scorrimento tengono i badge agganciati alle note; il viewer vede i totali ma nessun pulsante; chiusa la votazione i pulsanti spariscono e i totali restano; ricaricando la pagina i voti persistono; riavviando il server persistono (il budget residuo di ciascuno resta corretto); "azzera" li cancella per tutti. Atteso: tutto confermato.
- [ ] **Step 5: `npx tsc --noEmit`, `npm test`, commit** (`feat: votazione con puntini nell'interfaccia`).

### Task 5: Template

**Files:**
- Create: `src/templates.ts`, `src/templates.test.ts`
- Modify: `src/Board.tsx` (pulsante "Template" nella palette e funzione di inserimento), `src/styles.css`

**Interfaces:**
- Consumes: `insert(skeleton, selectIndex)` e `viewCenter()` di `Board.tsx`.
- Produces: `interface Template { id: string; name: string; build(): any[] }` e `export const TEMPLATES: Template[]` (5 elementi, id `retro`, `matrice`, `c4-contesto`, `adr`, `requisiti`). `build()` restituisce skeleton per `convertToExcalidrawElements` centrati su `(0, 0)`, tutti figli di un `frame` con `name` = nome del template; il modulo non importa nulla da Excalidraw (dati puri, testabili in Node).

- [ ] **Step 1: Scrivere `src/templates.test.ts`:** esistono esattamente i cinque id; per ogni template: gli `id` degli skeleton sono unici, ogni id in `frame.children` esiste, ogni `type` è tra quelli ammessi dal server (vedi Global Constraints), colori stringhe ≤ 60 caratteri, coordinate e dimensioni finite, e c'è esattamente un `frame` con `name` uguale al nome del template; `retro` contiene i testi "Start", "Stop", "Continue"; `matrice` contiene "Impatto" e "Sforzo"; `c4-contesto` contiene almeno 2 frecce; `adr` contiene "Contesto", "Decisione", "Alternative", "Conseguenze"; `requisiti` contiene "Funzionali", "Qualità", "Vincoli" (la ricerca guarda sia `text` sia `label.text`).
- [ ] **Step 2: Eseguire `npm test`** (FAIL), implementare `src/templates.ts` (stile `roughness: 0`, note con `customData: { kind: "nota" }` dove il template prevede note da riempire), rieseguire (PASS).
- [ ] **Step 3: Integrare in `Board.tsx`:** pulsante "Template" nella barra in basso (solo `!readonly`), che apre un piccolo menu con i cinque nomi; la scelta inserisce `build()` traslato al centro della vista tramite `insert`, selezionando il frame.
- [ ] **Step 4: Verifica manuale:** inserire ogni template come `editor` e come `participant`; gli elementi compaiono per entrambi, si sincronizzano e (per il participant) restano modificabili solo da chi li ha inseriti. Un viewer non vede il pulsante.
- [ ] **Step 5: `npx tsc --noEmit`, `npm test`, commit** (`feat: template di board`).

### Task 6: Libreria di forme (infrastruttura, UML, relazioni)

**Files:**
- Create: `src/library.ts`, `src/library.test.ts`
- Modify: `src/Board.tsx` (registrazione all'avvio)

**Interfaces:**
- Produces:
  - `interface LibraryEntry { id: string; name: string; skeleton: any[] }`; `export const LIBRARY: LibraryEntry[]`; id stabili `lib-<categoria>-<nome>`; `name` con prefisso di categoria (`"UML · Componente"`).
  - `registerLibrary(api: any, convert: (skeleton: any[]) => any[]): Promise<void>` — chiama `api.updateLibrary({ libraryItems, merge: true })` con `status: "published"` e il nome; gli elementi di una stessa forma condividono un `groupIds` così si trascinano insieme.

- [ ] **Step 1: Scrivere `src/library.test.ts`:** id unici; ogni `name` inizia con una delle categorie `UML ·`, `Relazione ·`, `C4 ·`, `Infrastruttura ·`, `Servizi ·`, `arc42 ·`; ogni skeleton ha solo tipi ammessi dal server, colori ≤ 60 caratteri, coordinate finite; nessuno skeleton è vuoto; il numero totale è ≥ 40 (verificato alla fine del Task 7; in questo task solo le categorie `UML ·` e `Relazione ·` sono richieste e il test del conteggio è marcato `todo`); per le categorie di questo task gli id attesi sono presenti (vedi step 3).
- [ ] **Step 2: Eseguire `npm test`** (FAIL) e implementare l'infrastruttura (`LIBRARY` con funzioni di costruzione interne per scatole etichettate, linee e frecce) e `registerLibrary`.
- [ ] **Step 3: Aggiungere le forme UML e le relazioni** con id in italiano: *UML:* `componente`, `interfaccia-fornita` (lollipop), `interfaccia-richiesta` (socket), `porta`, `classe` (tre compartimenti), `interfaccia-stereotipo`, `package`, `nota`, `attore`, `caso-uso`, `lifeline` (box + linea tratteggiata + barra di attivazione), `stato`, `stato-iniziale`, `stato-finale`, `decisione`, `fork-join`. *Relazione:* `dipendenza`, `realizzazione`, `generalizzazione`, `associazione`, `aggregazione`, `composizione` (frecce con `endArrowhead` nativo `triangle_outline`, `diamond`, `diamond_outline`, `arrow` e `strokeStyle: "dashed"` dove previsto).
- [ ] **Step 4: Registrare la libreria in `Board.tsx`** con un `useEffect` che parte quando `api` è disponibile, chiamando `registerLibrary(api, convertToExcalidrawElements)` una sola volta (ricarica della pagina compresa: `merge: true` evita duplicati). Errori solo in console.
- [ ] **Step 5: Verifica manuale:** aprire il pannello librerie di Excalidraw, controllare che le forme siano presenti una volta sola anche dopo un ricaricamento, trascinarle sulla lavagna come participant e verificare che le forme composte si muovano insieme e che le frecce abbiano le punte previste. Se il raggruppamento o le punte non si applicano dallo skeleton, applicarli dopo la conversione in `registerLibrary`.
- [ ] **Step 6: `npx tsc --noEmit`, `npm test`, commit** (`feat: libreria di forme (UML e relazioni)`).

### Task 7: Libreria di forme (C4, infrastruttura, servizi, arc42) e documentazione

**Files:**
- Modify: `src/library.ts`, `src/library.test.ts`, `README.md`

**Interfaces:**
- Consumes: `LIBRARY`, i costruttori interni del Task 6.

- [ ] **Step 1: Estendere i test:** togliere il `todo` dal conteggio (totale ≥ 40) e aggiungere gli id attesi delle nuove categorie.
- [ ] **Step 2: Eseguire `npm test`** (FAIL), poi aggiungere le forme. *C4:* `persona`, `sistema`, `sistema-esterno` (grigio, tratteggiato), `container`, `componente` (titolo, tecnologia, descrizione). *Infrastruttura:* `nodo` (box 3D), `ambiente-esecuzione`, `container-docker`, `cloud`, `database` (cilindro), `coda`, `cache`, `storage-file`, `api-gateway`, `load-balancer`, `browser`, `mobile`. *Servizi:* `microservizio` (esagono), `servizio-esterno`, `event-bus`, `job-batch`. *arc42:* `blocco-scatola-nera`, `blocco-scatola-bianca` (con compartimento interno), `stakeholder`, `scenario-qualita` (Stimolo / Ambiente / Risposta / Misura), `rischio` (nota rossa), `concetto-trasversale`.
- [ ] **Step 3: Eseguire `npm test`** (PASS), `npx tsc --noEmit`.
- [ ] **Step 4: Verifica manuale:** scorrere l'intera libreria nel pannello e inserire a campione una forma per categoria; leggibilità di testi e frecce a zoom 100%.
- [ ] **Step 5: Aggiornare `README.md`:** nuove funzioni (timer, votazione, template, libreria con elenco delle categorie), aggiornare la sezione "Limiti" (rimuovere "niente voti o timer"), indicare che i voti sono per chiave utente (stesso `uid` = stesso budget) e che il timer non sopravvive al riavvio del server, aggiungere `npm test`.
- [ ] **Step 6: Verifica finale** con `npm run build` (atteso: build riuscita) e un ultimo giro manuale con editor, participant e viewer su timer, voti, template e libreria.
- [ ] **Step 7: Commit** (`feat: libreria completa e documentazione`).

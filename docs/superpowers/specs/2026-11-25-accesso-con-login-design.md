# Accesso degli allievi con login sulla board (password di sessione)

Data: 2026-11-25. Stato: **approvato dall'utente a voce** (flusso descritto in chat: pagina di login sulla board con nome e cognome, mail e la password della sessione, uguale per tutti). Dimensione: media (server, client, comando `seed`, documentazione). Sostituisce la bozza precedente (reindirizzamento al login del sito Academy), scartata perché la password di sessione basta e la board non deve dipendere da Hostinger.

## Intento e perché

Come in Miro, il trainer dà **un solo link per board**, uguale per tutti. L'allievo lo apre, trova la pagina di login della board e inserisce **nome e cognome, email e la password della sessione** (la stessa che la Cube Academy comunica a tutti gli iscritti di quell'edizione, per esempio quella di dicembre). Entra con il proprio nome, e il trainer ne vede il cursore.
Chi ha seguito una sessione precedente non entra: ogni sessione ha **le sue board, la sua password e una data di fine**.

## Obiettivi

1. `/b/<board>` senza accesso valido mostra la **pagina di login** (Nome, Cognome, Email, Password).
2. Il server controlla la password di quella board (conservata come impronta, mai in chiaro), la data di fine e i tentativi, e consegna un token firmato personale (`participant`).
3. Il token è **personale**: `uid` derivato dalla mail con un'impronta (la mail non viene mostrata agli altri), nome "Nome Cognome", `email` firmata nel token. Cursori, oggetti e voti sono per persona.
4. Il trainer imposta password e data di fine con `npm run seed` (`--password`, `--fino-al`); il trainer entra con il suo link firmato (`editor`), come oggi.
5. Un token scaduto, non valido o di un'altra board viene riconosciuto subito e riporta al login con un messaggio chiaro; chi è collegato quando il token scade viene scollegato dal server (codice `4001`) e riportato al login.
6. Protezione dai tentativi: dopo 10 password errate in 10 minuti, per la stessa coppia (indirizzo, board), il login risponde "troppi tentativi" per 10 minuti.

7. **"Ricordami"** (richiesta dell'utente): una casella nel login. Se è spuntata, su quel dispositivo si ricordano nome, cognome ed email (il login successivo, anche su un'altra board, li ripropone già compilati) e l'accesso dura più a lungo (fino alla fine della sessione, al massimo `LOGIN_REMEMBER_DAYS`, predefinito 7), così riaprendo la board non si rifà il login. **La password non viene mai salvata nel browser.** Se non è spuntata, non si ricorda nulla (e quanto ricordato prima viene cancellato). Un pulsante "Esci" nella barra in alto cancella accesso e dati ricordati (per i computer condivisi).

## Non obiettivi

Account o password individuali, registrazione, recupero credenziali. Verifica della mail (si dichiara, non si prova: serve a identificare, non ad autenticare; l'autenticazione è la password di sessione). Integrazione con il sito Cube Academy su Hostinger (resta possibile in seguito con link firmati o con un controllo del Raspberry verso il sito). Revoca di un singolo accesso. Interfaccia per cambiare la password dalla board (si rilancia `seed`). Elenco dei collegati e raggruppamento dal vivo (fasi successive).

## Anti-obiettivi

- Conservare o stampare la password in chiaro sul server, nei log o nell'elenco di `seed` oltre l'uso previsto.
- Lasciare indovinare la password con tentativi illimitati.
- Rompere i link firmati che funzionano oggi (stesso formato, stesso segreto) o i ruoli.
- Dare a un allievo il ruolo di trainer o permettergli di cambiare la password della board.
- Ciclo di reindirizzamenti o pagina vuota quando il token non è valido.

## Contesto di installazione

Board su un Raspberry in ufficio (Docker, Cloudflare Tunnel), sito Cube Academy su Hostinger: non servono chiamate tra i due. Dietro il tunnel l'indirizzo del client arriva nell'intestazione `CF-Connecting-IP` (altrimenti `X-Forwarded-For`, altrimenti l'indirizzo della connessione). L'orologio del Raspberry deve essere sincronizzato (NTP) perché scadenza del token e data di fine siano giuste.

## Approcci considerati

- **Password di sessione verificata dalla board (scelto):** semplice, funziona con il Raspberry isolato, la password è quella già comunicata agli iscritti.
- Reindirizzamento al login `/materiali` del sito: scartato, dipende dal sito e dalla sua installazione.
- Controllo della password sul sito dal Raspberry: possibile in seguito se si vuole una sola fonte di verità.

## Disegno

**Dati per board** (`data/rooms/<board>/access.json`, scrittura atomica): `{ passwordHash: "scrypt$<sale>$<hash>", until: <ms epoch> | null }`. Senza il file, il login con password per quella board è disattivato (si entra solo con link firmati).

**Server** (`server/access.ts`, `server/auth.ts`, `server/index.ts`):
- `TokenPayload` guadagna `email?` (facoltativo, firmato con il resto; letto solo se valido).
- `inspectToken(token, room, secret, now)`: come `verifyToken` ma con il motivo del rifiuto (`scaduto`, `altra board`, `non valido`).
- `POST /auth/login` con JSON `{ room, nome, cognome, email, password, ricordami? }` → `200 { token, name, exp }` oppure `{ ok: false, motivo }` con `400` (dati non validi), `401` (password non corretta o accesso non attivo, stesso messaggio), `403` (sessione terminata, dopo `until`), `429` (troppi tentativi), `413` (corpo troppo grande). La password si confronta con `scrypt` e `timingSafeEqual`. Il token ha `role: "participant"`, scadenza `min(until, ora + LOGIN_TOKEN_HOURS)` (predefinito 12 ore) oppure, con `ricordami: true`, `min(until, ora + LOGIN_REMEMBER_DAYS giorni)` (predefinito 7).
- `PUT /auth/access?room=<board>` con `Authorization: Bearer <token editor>` e JSON `{ password?: string, until?: number | null }` → imposta/aggiorna password (8-200 caratteri) e data di fine; solo ruolo `editor` della **stessa** board.
- `GET /auth/check?room=<board>` con `Authorization: Bearer <token>` → `200 { ok: true, name, role, exp }` oppure `401 { ok: false, motivo }`. Il token non va mai nell'indirizzo.
- Alla scadenza del token il server chiude il WebSocket con codice `4001` e motivo `scaduto`; il timer si annulla alla chiusura.
- Corpi limitati a 4 KB; messaggi di errore in italiano.

**Client** (`src/Login.tsx`, `src/session.ts`, `src/main.tsx`, `src/Board.tsx`):
- All'apertura: con un token, lo verifica con `/auth/check`; se rifiutato lo toglie e mostra il login con il motivo. Senza token, mostra il login.
- Il login è un modulo: Nome, Cognome, Email, Password e la casella "Ricordami su questo dispositivo" (non spuntata di partenza; dopo la prima volta resta come l'utente l'ha lasciata). Con "ricordami": profilo (nome, cognome, email) e token in `localStorage` (il token per board, fino alla sua scadenza); senza: token in `sessionStorage` come oggi e nessun profilo salvato (quello vecchio si cancella). Il pulsante "Esci" nella barra (per chi è entrato con il login) cancella token e profilo e riporta al login. Un trainer che arriva dal suo link non vede il login.
- Alla chiusura del WebSocket con codice `4001` la sessione si toglie e si mostra il login ("La sessione è terminata o il tuo accesso è scaduto").
- In sviluppo Vite inoltra anche `/auth` al server.

**Comando `seed`:** `--password <testo>` (la stessa per tutti i gruppi del corso) e `--fino-al AAAA-MM-GG` (fine giornata, ora locale); con la password impostata stampa **un solo link semplice per gruppo** da dare a tutti (nessun link degli allievi) più i link da trainer; senza password funziona come oggi. La password non si ristampa nell'elenco.

**Documentazione:** README (sezione "Accesso degli allievi") e `.env.example`/`docker-compose.yml` (`LOGIN_TOKEN_HOURS`, `LOGIN_REMEMBER_DAYS`).

**Test:** unitari su `inspectToken`, email e uid, hash e verifica della password, limite di tentativi, argomenti di `seed`; integrazione con il vero server: `/auth/login` (ok, password sbagliata, accesso non attivo, dopo la fine, troppi tentativi, dati non validi, corpo troppo grande), `/auth/access` (solo editor della stessa board), `/auth/check`, token personale accettato dal WebSocket, chiusura `4001`; verifica a mano nel browser.

## Decisioni mie (da correggere se non vanno)

- Nome e cognome in due campi, uniti nel nome mostrato.
- "Ricordami" non è spuntato di partenza (più sicuro sui computer condivisi); la durata lunga dell'accesso è la contropartita di non salvare la password.
- Una password per corso, applicata a tutte le sue board dal comando `seed`; non si legge dal sito Academy (il sito conserva solo impronte): chi crea le board scrive la stessa password che comunica agli iscritti.
- Durata del token 12 ore (`LOGIN_TOKEN_HOURS`), mai oltre la data di fine.
- Il trainer entra con il link firmato; un login da trainer con password propria è una fase successiva.
- I link personali con `--allievi` restano come alternativa (non servono più per il login).

## Lasciato a chi costruisce

Testi esatti e stile della pagina di login, struttura interna dei test, messaggi di errore a parole.

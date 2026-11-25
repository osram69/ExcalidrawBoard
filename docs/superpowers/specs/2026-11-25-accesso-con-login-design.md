# Accesso con login (come Miro): link unico per board, login sul backend Cube Academy

Data: 2026-11-25. Stato: **approvato dall'utente a voce** ("sì, procedi" al flusso descritto in chat). Dimensione: media (server, client, comando `seed`, documentazione).

## Intento e perché

Come in Miro, il trainer dà un **solo link per board**, uguale per tutti. L'allievo si autentica sul backend della Cube Academy (che crea gli account e abilita l'accesso alla board quando serve) e torna sulla board, dove il trainer ne vede il cursore. Chi ha seguito edizioni passate non deve poter entrare: il backend decide, board per board, chi è iscritto a quella sessione, e il link firmato scade a fine sessione.
La board **non gestisce password né account**: riceve dal backend un token firmato (formato già esistente: `base64url(JSON).base64url(HMAC-SHA256("board:" + body))`, con `room`, `name`, `uid`, `role`, `exp`).

## Obiettivi

1. Aprendo `/b/<board>` senza accesso valido, la board manda al login del backend indicando quale board è e dove tornare.
2. Dopo il login il backend rimanda a `/b/<board>?t=<token>`: entra come già oggi.
3. Un token scaduto, non valido o di un'altra board viene riconosciuto subito (non resta una pagina "offline" a ritentare) e porta di nuovo al login.
4. Chi è già collegato quando il token scade viene scollegato dal server e riportato al login.
5. Documento per il backend con formato, flusso, esempio di codice e un vettore di prova per verificare la firma.
6. `seed --senza-token`: stampa i link semplici di board (senza token), da dare a tutti.

## Non obiettivi

Account, password, registrazione o recupero credenziali sulla board. Revoca di un singolo accesso prima della scadenza (si fa con scadenza breve o cambiando il nome della board della sessione; l'interfaccia di revoca è una fase successiva). Biglietto monouso a scambio. Elenco dei collegati e raggruppamento dal vivo (fasi successive).

## Anti-obiettivi

- Reindirizzare l'allievo a un indirizzo di login deciso da chi apre il link: l'indirizzo del login lo configura solo il server (`LOGIN_URL`).
- Mettere il token in indirizzi che finiscono nei log più del necessario (resta nell'indirizzo solo al ritorno dal login e viene tolto subito, come oggi).
- Rompere i link firmati che funzionano oggi (stesso formato, stesso segreto).
- Un ciclo infinito di reindirizzamenti se il login restituisce un token che la board rifiuta.

## Vincoli

- Nessuna nuova dipendenza. Stesso formato token e stesso `BOARD_SECRET`.
- Senza `LOGIN_URL` il comportamento resta quello di oggi (pagina "Link non valido o scaduto").
- I controlli veri restano sul server; il client fa solo da guida.

## Contesto di installazione

- **La board gira su un Raspberry in ufficio** (Docker, esposta con Cloudflare Tunnel); **il sito Cube Academy resta l'app Next.js su Hostinger**. Server diversi, domini diversi.
- Il collegamento è solo il **reindirizzamento del browser** (board → login sul sito → board con il token) più il **segreto condiviso** `BOARD_SECRET` (nelle variabili d'ambiente di entrambi). Nessuna chiamata da server a server: Hostinger non deve raggiungere l'ufficio, e la board non deve raggiungere Hostinger. Quindi nessun problema di CORS e nessuna porta da aprire.
- Il cookie di login vive sul dominio del sito; la board non lo vede e non ne ha bisogno: tiene solo il token firmato nella sessione del browser (come oggi).
- **Il backend deve accettare `return` solo verso l'indirizzo della board** (lista consentita, es. variabile `BOARD_URL`): senza questo controllo, un link costruito ad arte porterebbe il token di un utente a un sito qualsiasi. Il documento lo presenta come regola obbligatoria.
- Le scadenze dei token sono controllate dall'orologio del Raspberry: serve che sia sincronizzato (NTP, attivo di default su Raspberry Pi OS); il documento lo ricorda.
- Se il Raspberry o il tunnel sono spenti, il login sul sito funziona ma la board non è raggiungibile: la pagina di ritorno mostra l'errore del browser, nessuna gestione speciale.

## Approcci considerati

- **Reindirizzamento al login del backend (scelto):** nessun account sulla board, il backend resta l'unica fonte di verità sulle iscrizioni.
- **Login dentro la board con codice di sessione:** scartato, duplica gli account e la gestione degli iscritti.
- **Biglietto monouso scambiato dalla board:** rimandato; utile se si temono link inoltrati, ma aggiunge stato sul server.

## Disegno

**Server** (`server/index.ts`, `server/auth.ts`):
- `GET /auth/config` → `{ "loginUrl": string | null }`, da `LOGIN_URL` (deve essere http(s); se non valido il server lo ignora con un avviso).
- `GET /auth/check?room=<board>` con il token in `Authorization: Bearer <token>` → `200 { ok: true, name, role, exp }` oppure `401 { ok: false, motivo: "scaduto" | "non valido" | "altra board" }`. Il token non va nell'indirizzo, per non finire nei log.
- `inspectToken(token, room, secret, now)` in `auth.ts`: come `verifyToken` ma con il motivo del rifiuto; `verifyToken` resta com'è.
- Alla scadenza del token il server chiude il WebSocket con codice `4001` ("scaduto"); il timer si annulla alla chiusura e non supera il massimo dei timer di Node.

**Client** (`src/login.ts`, `src/session.ts`, `src/main.tsx`, `src/Board.tsx`):
- `loginRedirect(loginUrl, room, here)` → `loginUrl` con `room` e `return` (`here` = indirizzo della board senza token); conserva i parametri già presenti in `loginUrl`.
- All'apertura: se c'è un token lo verifica con `/auth/check`; se è rifiutato lo toglie dalla sessione del browser. Senza accesso valido e con `loginUrl` configurato, mostra "Ti porto al login…" e reindirizza; senza `loginUrl` mostra la pagina di oggi, con il motivo.
- Contro i cicli: se si torna dal login con un token che `/auth/check` rifiuta, non si reindirizza di nuovo ma si mostra la pagina di errore con il motivo.
- Alla chiusura del WebSocket con codice `4001`, la sessione si toglie e si segue lo stesso percorso.
- In sviluppo Vite inoltra anche `/auth` al server.

**Comando `seed`:** `--senza-token` stampa per ogni gruppo il solo link `base/b/<board>` (nessun link per trainer o allievi).

**Configurazione:** `LOGIN_URL` in `.env.example`, `docker-compose.yml` e README.

**Documento per il backend** (`docs/accesso-cube-academy.md`): flusso, parametri `room` e `return`, regole che il backend deve applicare (verificare l'iscrizione alla sessione di quella board, accettare `return` solo verso l'indirizzo della board, scadenza a fine sessione, ruolo), formato del token con **vettore di prova** (segreto, payload e token attesi, verificati da un test), esempio in Node.js.

**Test:** unitari su `inspectToken`, `loginRedirect`, lettura di `LOGIN_URL`, flag di `seed`, vettore di prova; integrazione con il vero server: `/auth/config`, `/auth/check` (valido, scaduto, firma sbagliata, altra board, senza token), chiusura `4001` alla scadenza; verifica a mano nel browser con un finto backend di login (script temporaneo).

## Decisioni mie (da correggere se non vanno)

- Il backend Cube Academy è un'app Next.js in TypeScript (repository `osram69/Academy1`, compilato su Hostinger) con un'area `/materiali` che ha già utenti con ruolo (`studente`/`trainer`) e cartelle di corso abilitate (`folders`, `canSee`). L'esempio del documento è quindi un Route Handler Next.js che riusa quel meccanismo, con la regola: il nome della board è `<corso>` oppure `<corso>-g<N>` (come crea `seed`), e l'accesso si concede se l'utente è abilitato alla cartella `<corso>` (o ha `*`). Formato e vettore di prova valgono per qualsiasi linguaggio.
- **Non modifico il repository della Cube Academy** in questo lavoro: preparo la parte della board e il documento con l'esempio; l'eventuale route sul sito (e il suo deploy da GitHub a Hostinger) lo decidi tu.
- Nessun biglietto monouso né revoca in questa fase.
- Il motivo del rifiuto è mostrato all'utente in italiano ("scaduto", "non valido", "altra board").

## Lasciato a chi costruisce

Testi esatti delle pagine, stile della schermata di passaggio, struttura interna dei test.

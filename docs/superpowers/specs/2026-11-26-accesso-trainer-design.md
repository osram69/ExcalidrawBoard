# Accesso del trainer con l'account Cube Academy (`/admin/materiali`)

Data: 2026-11-26. Stato: **approvato dall'utente a voce** ("i trainer già registrati come tali, entrando nella board, possono gestirla completamente, senza dover usare i comandi npm"). Dimensione: media, **due repository** (la board e il sito Cube Academy).

## Intento e perché

Oggi per entrare come trainer serve un link firmato creato con `npm run token` (o `seed`). Il sito Cube Academy ha già l'elenco degli utenti in `/admin/materiali` (nome utente, email, ruolo `trainer`/`studente`, cartelle). Un utente con **ruolo trainer** deve poter aprire la board e **gestirla per intero** (creare board nuove, invitare gli allievi, stanze, timer…) usando il suo account di sempre, **senza comandi**.

## Obiettivi

1. La pagina di accesso della board ha il pulsante **"Accedi come trainer"** (visibile solo se il server lo ha configurato).
2. Il pulsante porta al login esistente di `/materiali` sul sito; se l'utente ha il **ruolo trainer** torna sulla board con tutti i permessi (`editor`).
3. La pagina iniziale della board (`/`, senza nome) permette al trainer di **aprire o creare una board dandole un nome**.
4. Gli allievi (`studente`) **non** diventano trainer: solo il ruolo `trainer` ottiene l'accesso `editor`.
5. La password dell'account non passa mai dalla board; l'unica cosa che si scambiano i due server è il token firmato, nel reindirizzamento del browser (nessuna chiamata da server a server).
6. Documento per il sito con il formato del token e un vettore di prova; modifica del sito preparata su un branch separato.

## Non obiettivi

Limitare un trainer a certi corsi/cartelle (qualsiasi trainer apre qualsiasi board: si può aggiungere dopo). Accesso degli allievi con l'account del sito (restano la password di sessione). Revoca di un trainer prima della scadenza del token (scadenza breve). Modificare i comandi `token` e `seed` (restano come alternativa).

## Anti-obiettivi

- Che un utente non trainer (o senza login) ottenga un token `editor`.
- Che il sito reindirizzi il token a un indirizzo qualsiasi: il ritorno è accettato **solo** verso l'indirizzo della board configurato (`BOARD_URL`), per la board richiesta.
- Mettere password o `BOARD_SECRET` nell'indirizzo o nei log; rompere i link firmati e il login con password esistenti.

## Disegno

**Flusso:** board (`/b/<board>`) → pulsante "Accedi come trainer" → `<TRAINER_LOGIN_URL>?room=<board>&return=<indirizzo della board>` (sito) → login `/materiali` se serve → il sito controlla che l'utente sia trainer, firma un token `editor` (stesso formato e stesso segreto della board: `base64url(JSON).base64url(HMAC-SHA256("board:" + body))`, con `room`, `name`, `uid` = nome utente, `role: "editor"`, `exp` = 12 ore) e rimanda a `<return>?t=<token>` → la board lo accetta come qualsiasi link firmato (il token viene tolto subito dall'indirizzo).

**Board** (questo repository):
- `TRAINER_LOGIN_URL` (variabile d'ambiente, solo http/https, altrimenti ignorata con un avviso): `GET /auth/config` → `{ trainerLoginUrl: string | null }`, senza cache.
- Client: funzione pura `trainerLoginRedirect(base, room, origin)` (conserva i parametri già presenti nell'indirizzo del sito, rifiuta nomi di board non validi); la pagina di accesso mostra "Sei un trainer? Accedi con il tuo account Cube Academy"; la pagina iniziale ha il modulo "Apri o crea una board" (nome valido) che avvia lo stesso reindirizzamento.
- Nessuna modifica al formato dei token né ai controlli sul server.
- Documento `docs/accesso-cube-academy.md` per il sito (flusso, parametri, regole obbligatorie, vettore di prova, esempio).

**Sito Cube Academy** (repository `Academy1`, preparato su un branch separato in una copia di lavoro a parte, senza toccare i file non salvati dell'utente e senza pubblicare):
- Nuova rotta `GET /materiali/board?room=&return=`: valida `room` (`[A-Za-z0-9_-]{1,64}`) e `return` (origine tra quelle di `BOARD_URL`, percorso esattamente `/b/<room>`, nessun parametro); legge il cookie `materiali_sid`; senza accesso passa dal login esistente e poi torna (`vai` nell'indirizzo, solo percorsi interni `/materiali/board…`); se l'utente non è trainer mostra un messaggio chiaro; altrimenti firma il token e reindirizza.
- Modifiche minime al login esistente: la pagina `/materiali` e `POST /materiali/login` accettano `vai` (solo `/materiali/board?…`).
- Variabili d'ambiente su Hostinger: `BOARD_SECRET` (lo stesso della board), `BOARD_URL` (indirizzo pubblico della board, anche più d'uno separati da virgola), facoltativa `BOARD_TOKEN_HOURS` (predefinito 12).
- Funzioni pure in `server/board-access.mjs` con test `node --test` (nessuna dipendenza nuova) che usano lo stesso vettore di prova della board.

**Test:** unitari su `parseHttpUrl` e `trainerLoginRedirect`; integrazione (vero server) su `/auth/config` con indirizzo valido, non valido e assente; per il sito: firma (vettore di prova), validazione di `return`/`room`/`vai`, ruolo e scadenza.

## Decisioni mie (da correggere se non vanno)

- Qualsiasi utente con ruolo `trainer` apre qualsiasi board e ne crea di nuove; il filtro per cartelle corso resta come evoluzione.
- Token da trainer di 12 ore (nessuna revoca prima).
- Il sito si prepara in una copia di lavoro separata (`D:\Work\AcademyNew-board`, branch `feature/board-trainer`): non cambio la tua cartella `AcademyNew` e non pubblico nulla.

## Lasciato a chi costruisce

Testi esatti, stile delle pagine, nomi interni delle funzioni.

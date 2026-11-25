# Board Cube Academy (variante Excalidraw)

Stessa idea della board con tldraw, ma costruita su [Excalidraw](https://github.com/excalidraw/excalidraw) (**licenza MIT: nessuna chiave, nessun costo, uso commerciale libero**)
con un server di sincronizzazione nostro.

```
 browser ──https──> (Cloudflare Tunnel) ──> container "board" (Node)
                                              ├─ interfaccia (dist/)
                                              ├─ WebSocket /connect/<board>   sincronizzazione
                                              └─ /data  (scene.json + immagini per board)
```

- **Un solo container**, nessun database: ogni board è una cartella in `data/rooms/<board>/` (`scene.json` e `files/`).
- **Accesso con link firmati** (HMAC-SHA256, scadenza, ruolo `editor`, `participant` o `viewer`), identici a quelli della variante tldraw: stesso `BOARD_SECRET`,
  stessa firma, quindi il sito Cube Academy può emettere link per entrambe.
- **Tre ruoli nel link** (tutti imposti dal server, non dall'interfaccia):
  - `editor` (trainer): modifica e cancella tutto.
  - `participant`: crea e modifica **solo i propri oggetti**, come su Miro; vede e non può toccare quelli degli altri.
  - `viewer`: sola lettura.
- **Proprietà degli oggetti**: il server marca ogni oggetto nuovo con il proprietario (l'`uid` del link, altrimenti il nome), ignorando ciò che dichiara il client.
  Se il trainer modifica un oggetto, il proprietario resta quello originale. Gli oggetti preesistenti senza proprietario li può cambiare solo il trainer.
  Per attribuire bene gli oggetti ogni persona deve avere un `uid` diverso: con un account condiviso di corso tutti risulterebbero lo stesso utente.
- **Note adesive** (5 colori), **frame** e **foto** (ridotte a 1600 px; da telefono anche dalla fotocamera) dalla barra in basso.
- **Timer** condiviso (in alto al centro): lo avvia il trainer (5/10/15/30 minuti, +1 min, pausa, azzera) e lo vedono tutti, anche i `viewer`. Allo scadere lampeggia e suona
  (il suono parte solo dopo il primo clic sulla pagina; c'è il pulsante muto). Il conto usa l'ora del server, quindi un orologio sbagliato sul dispositivo non conta. Non sopravvive al riavvio del server.
- **Votazione con puntini** sulle note adesive: il trainer la apre (da 1 a 20 puntini a testa, predefinito 5), la chiude o la azzera. Chi ha il ruolo `editor` o `participant` vota con i pulsanti
  − / + sull'angolo di ogni nota (nessun limite per nota, solo il budget totale); i `viewer` vedono solo i totali. Il conteggio e il budget li controlla il server e sono salvati
  in `data/rooms/<board>/votes.json`, quindi sopravvivono a un riavvio. Se una nota viene cancellata, i suoi voti spariscono e il puntino torna disponibile.
  I voti sono legati all'`uid` del link (o al nome): due persone con lo stesso `uid` condividono lo stesso budget.
- **Template** (pulsante "Template" nella barra in basso, per `editor` e `participant`): Retrospettiva (Start/Stop/Continue), Matrice impatto/sforzo, Contesto di sistema (C4),
  ADR (decisione architetturale), Requisiti e qualità. Si inseriscono al centro della vista dentro un frame con il loro nome.
- **Libreria di forme** per l'architettura software (49 forme) nel pannello "Libreria" di Excalidraw, sotto "Libreria di Excalidraw": UML strutturale e comportamentale (componente,
  interfacce, classe, package, attore, lifeline, stati…), relazioni UML già pronte (dipendenza, realizzazione, generalizzazione, associazione, aggregazione, composizione), C4,
  infrastruttura e distribuzione (nodo, container Docker, cloud, database, coda, API gateway, load balancer, browser, mobile), servizi (microservizio, event bus, job batch)
  e arc42/iSAQB (building block a scatola nera e bianca, stakeholder, scenario di qualità, rischio, concetto trasversale). Si possono sempre caricare altre librerie `.excalidrawlib`
  dal pannello; a ogni avvio vengono riscritte solo le voci della libreria incorporata (id `lib-…`).
- **Immagini**: PNG, JPEG, GIF, WebP fino a 10 MB (niente SVG), caricabili da `editor` e `participant` (non da `viewer`).

## Provarla in locale

```powershell
npm install
npm run dev
npm run token -- cpsaf-prova "Mario Rossi" editor 12 http://localhost:5173 mario
npm run token -- cpsaf-prova "Anna" participant 12 http://localhost:5173 anna
npm run token -- cpsaf-prova "Osservatore" viewer 12 http://localhost:5173 osservatore
```

Apri i due link in due browser. Versione di produzione in locale: `npm run build` e poi `npm start` (porta 3030).

Test automatici (timer, votazione, messaggi e ruoli del server, template, libreria): `npm test`.

## Classi di lavoro (una board per gruppo)

> **PowerShell:** i comandi `seed` si scrivono con `npm.cmd` (come negli esempi). Con `npm` semplice PowerShell toglie il `--` e le opzioni che iniziano con `--` (`--password`, `--fino-al`, `--base`…) vanno perse senza avvisi.
> In alternativa: `npx tsx scripts/seed.ts <corso> <gruppi> <materiale> …`. In `cmd` e nei terminali Linux/macOS vale anche `npm run seed -- …`.

Per le esercitazioni a gruppi, `npm run seed` prepara una board per ogni gruppo con lo stesso materiale di partenza e stampa i link:

```powershell
npm.cmd run seed -- isaqb-dic26 4 uml.png --allievi allievi.txt --ore 8
npm.cmd run seed -- isaqb-dic26 3 board:lezione1 --server https://board.esempio.it
```

- Crea `isaqb-dic26-g1 … -g4` (nome del corso al massimo 60 caratteri; da 1 a 12 gruppi).
- **Materiale:** un file immagine (PNG, JPEG, WebP, GIF, fino a circa 7 MB) oppure `board:<id>`, che copia una board già preparata sullo stesso server (la board d'origine non cambia, gli elementi cancellati non si copiano).
  L'immagine entra **bloccata**, ridotta a 1400 px di larghezza al massimo e centrata; il trainer può sbloccarla. Nelle board copiate gli oggetti risultano del trainer.
  In entrambi i casi gli allievi non possono spostare né cancellare il materiale: possono aggiungere i propri oggetti.
- **Allievi:** `--allievi file.txt`, un allievo per riga, `Nome` oppure `Nome;gruppo` (le righe vuote e quelle che iniziano con `#` si ignorano). Chi non ha il gruppo va a quello meno numeroso.
  Ognuno riceve un link personale (voti e proprietà degli oggetti sono per persona). Senza elenco si stampa un solo link per gruppo: chi lo usa condivide identità e puntini di voto.
- **Link:** per ogni gruppo un link da trainer (`editor`) e quelli degli allievi (`participant`), validi 12 ore (`--ore`). Compaiono solo a video: contengono la firma d'accesso, non vengono salvati.
- **Server:** `--server` (predefinito `http://localhost:3030`) e `--base` (indirizzo da mettere nei link, predefinito quello del server). Serve lo stesso `BOARD_SECRET` del server (ambiente o `.env`).
- **Sicurezza di ripartenza:** una board di destinazione che ha già del contenuto viene **saltata** con un avviso, mai svuotata; per ricominciare usa un altro nome di corso.
  Collegarsi a una board che non esiste ne crea la cartella vuota (succede anche con un nome di `board:` sbagliato).

## Accesso degli allievi (login con la password della sessione)

Il trainer dà **un solo link per board**, uguale per tutti (`https://…/b/<board>`). Chi lo apre senza accesso trova la **pagina di login**: nome, cognome, email e la **password della sessione**
(la stessa che Cube Academy comunica a tutti gli iscritti di quell'edizione, per esempio quella di dicembre). Poi entra con il proprio nome e il trainer ne vede il cursore, come in Miro.

```powershell
npm.cmd run seed -- isaqb-dic26 4 uml.png --password "la-password-di-dicembre" --fino-al 2026-12-20
```

- **Password e fine sessione:** `--password` (da 8 a 200 caratteri) vale per tutte le board del corso e si conserva sul server **solo come impronta** (scrypt), mai in chiaro;
  `--fino-al AAAA-MM-GG` è l'ultimo giorno (fino a fine giornata): dopo, nessuno entra e chi è collegato viene scollegato e riportato al login. Rilanciando il comando con un'altra password su board già piene,
  la password si aggiorna e **la data di fine resta quella di prima** (se non indichi `--fino-al`); `--fino-al nessuna` la toglie. Il comando stampa la data in vigore per ogni board.
  La password non viene mai stampata dal comando.
- **Edizioni passate:** ogni sessione ha le sue board, la sua password e la sua data di fine, quindi chi ha seguito l'edizione precedente non entra in quella nuova.
- **Identità personale:** l'identificativo di ciascuno deriva dall'email (con un'impronta firmata con il segreto del server: la mail non è visibile agli altri e nessuno può ricavare l'identificativo di una mail che conosce), quindi cursori, oggetti e puntini di voto sono per persona. L'email **non è verificata**: identifica,
  l'autenticazione è la password della sessione.
- **"Ricordami su questo dispositivo":** se spuntato, nome, cognome ed email restano nel browser (il login successivo, anche su un'altra board, li ripropone) e l'accesso dura più a lungo
  (fino alla fine della sessione, al massimo `LOGIN_REMEMBER_DAYS` giorni, predefinito 7), così riaprendo la board non si rifà il login. **La password non viene mai salvata nel browser.**
  Se non è spuntato non si ricorda nulla. Il pulsante **Esci** nella barra in alto cancella gli accessi di **tutte** le board e i dati ricordati su quel dispositivo (utile sui computer condivisi); anche un login senza "ricordami" cancella gli accessi ricordati prima.
- **Durata dell'accesso:** `LOGIN_TOKEN_HOURS` (predefinito 12) senza "ricordami"; mai oltre la data di fine.
- **Tentativi:** dopo 10 password sbagliate in 10 minuti per la stessa persona (indirizzo, board ed email), il login risponde "troppi tentativi" per 10 minuti; c'è anche un tetto per rete (100 errori su una board), così una classe dietro lo stesso indirizzo di ufficio non si blocca per un errore di battitura dei compagni.
  Se su una board arrivano più di 500 errori in 10 minuti, ogni tentativo viene rallentato di un secondo. La verifica della password non blocca il server (gira nel pool di thread, al massimo 4 insieme; oltre, il login risponde "server occupato, riprova").
  Gli indirizzi IPv6 si contano per rete /64. Dietro il tunnel Cloudflare si usa l'indirizzo `CF-Connecting-IP`: **non esporre la porta del server direttamente su internet**, altrimenti l'intestazione si può falsificare (con il `docker-compose.yml` fornito la porta è solo locale e passa dal tunnel).
  Se il blocco scatta per errore, basta aspettare 10 minuti o riavviare il server.
- **Il trainer** continua a entrare con il suo link firmato (`editor`), stampato dal comando; il login con password dà sempre il ruolo `participant`.
- **Link personali** (`--allievi file`) restano disponibili come alternativa al login, per chi vuole dare a ognuno un link.
- **Orologio:** scadenze e data di fine usano l'orologio del Raspberry: tienilo sincronizzato (NTP, attivo di default su Raspberry Pi OS).
- **Se l'accesso è scaduto** la board lo riconosce subito e riporta al login con un messaggio chiaro, invece di restare "offline".

## Accesso del trainer con l'account Cube Academy

I trainer registrati nell'elenco di **/admin/materiali** del sito (ruolo `trainer`) entrano nella board con il loro account e la gestiscono per intero, **senza comandi**: nella pagina di accesso (e nella pagina iniziale, dove si dà un nome a una board nuova)
c'è il pulsante **"Accedi come trainer"**. Porta al login di `/materiali` sul sito e, se l'utente è trainer, torna sulla board con tutti i permessi. Gli studenti del sito non diventano trainer; la password non passa dalla board
(la board non contatta mai il sito né Supabase: lo scambio è solo un reindirizzamento del browser con un token firmato, quindi funziona anche con la board su un Raspberry a casa raggiungibile dal tunnel).

- Si attiva impostando `TRAINER_LOGIN_URL` (indirizzo della rotta del sito, per esempio `https://cubeacademy.eu/materiali/board`); senza, il pulsante non compare e restano i link firmati (`npm run token`).
- Qualsiasi trainer apre qualsiasi board e ne crea di nuove dandole un nome. Il token lo emette il sito e dura 12 ore (impostabile sul sito, da 1 a 72).
- La parte del sito (rotta `/materiali/board`, `BOARD_SECRET`, `BOARD_URL`) e il formato del token sono descritti in [docs/accesso-cube-academy.md](docs/accesso-cube-academy.md).

## Aula e stanze dal vivo (come le stanze di Zoom o di Miro)

Tutti entrano nella **board del trainer (l'aula)**; poi il trainer crea le stanze e gli allievi vengono portati dentro da soli. Non servono link nuovi né password in più.

1. **Prepara l'aula.** Apri la board con il tuo link da trainer (`npm run token -- <aula> "Trainer" editor 12 <indirizzo> trainer`), disegna il materiale e premi **Invita** in alto: trovi il link da dare agli allievi
   (lo stesso per tutti), e imposti la **password della sessione** e, se vuoi, l'ultimo giorno. Il nome dell'aula può avere al massimo 50 caratteri se userai le stanze.
2. **Gli allievi entrano** dal link con nome, cognome, email e password (vedi "Accesso degli allievi"). Con il pulsante **Stanze** vedi chi è collegato e dove si trova (aula o stanza); i cursori hanno il nome accanto.
3. **Crea le stanze:** in **Stanze → Crea stanze** scegli quante (da 2 a 12) e assegni ogni allievo a mano, oppure premi **Distribuisci a caso**; poi **Crea e sposta**. Ogni stanza è una board nuova con **una copia di quello che hai
   disegnato in aula in quel momento** (gli oggetti restano tuoi: gli allievi non li spostano, aggiungono i propri) e gli assegnati vengono portati dentro automaticamente. Accanto al nome compare "Stanza n". Chi non assegni resta in aula.
4. **Il timer è unico per tutto il corso:** lo avvii dall'aula o da una stanza e parte per tutti (aula e stanze), con le stesse pause.
5. **Durante il turno:** puoi **Entrare** in una stanza e tornare in aula con **← Torna in aula**, **spostare** un allievo in un'altra stanza (anche uno rimasto in aula) dal menu accanto al suo nome. Chi ricarica la pagina o rientra dal link dell'aula
   **torna nella sua stanza**. Chi entra dopo la creazione resta in aula finché non lo sposti.
6. **Chiudi stanze:** tutti tornano in aula. **Le stanze restano salvate** (sono board vere, `<aula>-r<turno>-s<n>`, per esempio `isaqb-dic26-r1-s2`): le riapri da **Turni precedenti → Apri stanza n**, anche per mostrare il lavoro dei gruppi.
   Gli allievi non possono rientrare in una stanza di un turno chiuso. Per un nuovo giro di stanze basta crearle di nuovo: nasce il turno successivo (`-r2-`).

- **Chi può farlo:** solo chi entra come trainer (`editor`); i controlli sono sul server.
- **Limiti:** un solo turno aperto alla volta (per rifare le stanze chiudi quello aperto); si assegna chi è collegato in quel momento; ciò che i gruppi aggiungono nelle stanze non viene riportato in aula (restano consultabili);
  votazioni e note votate restano per board; sul server restano in memoria le board attive, il resto è su disco (`data/rooms/`).
- **Differenza con `seed`:** `seed` prepara in anticipo una board per gruppo da dare con link; le stanze dal vivo si creano durante la lezione. Si possono usare entrambi.
- **Sicurezza e recupero:** il server non si fida che il browser obbedisca allo spostamento: chi resta collegato a una stanza dopo averla lasciata (spostato o turno chiuso) viene scollegato e le sue modifiche non vengono salvate.
  Le nuove stanze non toccano mai una board che esiste già con quel nome (per esempio dopo aver perso `course.json`): si usa il primo turno libero. Se `course.json` dell'aula è danneggiato non si creano stanze (per non perdere quelle esistenti) e se ne conserva una copia in `course.json.bad`.
  Chi arriva a una stanza senza un accesso valido viene riportato al login dell'aula e da lì rientra nella sua stanza.
- **Identità:** l'email dichiarata al login decide anche in quale stanza si entra. Chi conosce l'email di un compagno e la password della sessione può entrare come lui: la mail identifica ma non autentica (vedi "Accesso degli allievi").

## Sul Raspberry (Docker)

Serve un Raspberry Pi 4 o 5 con sistema a 64 bit e Docker (se ci gira già un'altra board in Docker, c'è già). I comandi sono da eseguire sul Raspberry, via ssh, nella cartella del progetto.

1. **Scarica il codice:** `git clone https://github.com/osram69/ExcalidrawBoard.git && cd ExcalidrawBoard` (se il repository è privato, git chiede nome utente e un *token* personale di GitHub al posto della password).
2. **Crea il file `.env`** (`nano .env`):

   ```
   BOARD_SECRET=<stringa lunga e casuale: openssl rand -hex 32>
   BOARD_PORT=3031                # solo se la 3030 è già usata da un'altra board
   TRAINER_LOGIN_URL=https://cubeacademy.eu/materiali/board   # solo per l'accesso del trainer con l'account del sito
   TUNNEL_TOKEN=<token del tunnel Cloudflare>                 # solo se usi Cloudflare (vedi sotto)
   ```

   Con lo stesso `BOARD_SECRET` dell'altra variante (tldraw) i link firmati di entrambe restano validi.
3. **Cartella dei dati:** `mkdir -p data && sudo chown 1000:1000 data` (qui stanno le board e le immagini: è la cartella di cui fare il backup).
4. **Avvia:** `docker compose up -d --build`. La prima volta la costruzione dell'immagine richiede alcuni minuti.
5. **Controlla:** `docker compose ps` (deve risultare "healthy") e `curl localhost:3031/health` (o la porta scelta). In caso di problemi: `docker compose logs -f board`.
6. **Rendi la board raggiungibile da fuori**, con uno di questi modi (la board ascolta solo su `127.0.0.1`: non è esposta da sola):
   - **Cloudflare Tunnel** (consigliato per le lezioni, indirizzo con il tuo dominio): crea un tunnel in Cloudflare Zero Trust (*Networks → Tunnels*), metti il token in `.env` come `TUNNEL_TOKEN`, imposta come *Public hostname* il servizio \`http://board:3030\` e avvia con `docker compose --profile tunnel up -d`.
   - **Tailscale** (comodo per le prove): `sudo tailscale serve --bg 3031` la rende visibile solo ai dispositivi della tua rete Tailscale; `sudo tailscale funnel --bg 3031` la rende pubblica su un indirizzo `https://<nome>.<rete>.ts.net` (la sintassi cambia un po' tra le versioni: `tailscale serve --help`). Qui non serve il container del tunnel.
7. **Primo accesso come trainer:** con il pulsante "Accedi come trainer" (se il sito è configurato, vedi `docs/accesso-cube-academy.md`) oppure con un link firmato creato dal tuo PC, senza installare Node sul Raspberry:
   `npm run token -- lezione1 "Trainer" editor 12 https://<indirizzo pubblico> trainer` (con `BOARD_SECRET` uguale a quello del Raspberry; in PowerShell usa `npm.cmd` e imposta prima `$env:BOARD_SECRET`).

**Aggiornare:** `git pull && docker compose up -d --build`. **Backup:** copia la cartella `data/`. **Fermare:** `docker compose down` (i dati restano in `data/`).
Il compose limita la board a 768 MB e 2 processori per non togliere risorse ad altri servizi (Home Assistant, Jellyfin…). L'orologio del Raspberry deve essere sincronizzato (NTP, attivo di default su Raspberry Pi OS).

## Limiti rispetto a tldraw

- Stile "a mano libera" di Excalidraw (le forme della libreria e i template usano linee nette).
- Voti e timer valgono per una singola board: non c'è un timer o una votazione comune a più board.
- Frecce collegate a oggetti di altri: se un partecipante sposta un proprio oggetto a cui è agganciata una freccia altrui, quella freccia non si muove per gli altri.
- Conflitti: se due persone cambiano lo *stesso* elemento nello stesso istante, vince una delle due modifiche (ok per gruppi piccoli).
- Il server tiene l'intera scena in memoria e la ritrasmette in blocco alla connessione: va bene per board normali (centinaia di elementi), non per lavagne enormi.
- Annulla/ripristina è locale: ognuno annulla solo le proprie azioni.

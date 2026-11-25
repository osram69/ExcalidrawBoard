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

Per le esercitazioni a gruppi, `npm run seed` prepara una board per ogni gruppo con lo stesso materiale di partenza e stampa i link:

```powershell
npm run seed -- isaqb-dic26 4 uml.png --allievi allievi.txt --ore 8
npm run seed -- isaqb-dic26 3 board:lezione1 --server https://board.esempio.it
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

## Sul Raspberry (Docker)

Come la variante tldraw: `.env` con `BOARD_SECRET`, `mkdir -p data && sudo chown 1000:1000 data`, `docker compose up -d --build`.
Se la porta 3030 è già usata dall'altra board, cambia `3030:3030` nel compose (ad esempio `3031:3030`).

## Limiti rispetto a tldraw

- Stile "a mano libera" di Excalidraw (le forme della libreria e i template usano linee nette).
- Voti e timer valgono per una singola board: non c'è un timer o una votazione comune a più board.
- Frecce collegate a oggetti di altri: se un partecipante sposta un proprio oggetto a cui è agganciata una freccia altrui, quella freccia non si muove per gli altri.
- Conflitti: se due persone cambiano lo *stesso* elemento nello stesso istante, vince una delle due modifiche (ok per gruppi piccoli).
- Il server tiene l'intera scena in memoria e la ritrasmette in blocco alla connessione: va bene per board normali (centinaia di elementi), non per lavagne enormi.
- Annulla/ripristina è locale: ognuno annulla solo le proprie azioni.

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

## Sul Raspberry (Docker)

Come la variante tldraw: `.env` con `BOARD_SECRET`, `mkdir -p data && sudo chown 1000:1000 data`, `docker compose up -d --build`.
Se la porta 3030 è già usata dall'altra board, cambia `3030:3030` nel compose (ad esempio `3031:3030`).

## Limiti rispetto a tldraw

- Stile "a mano libera" di Excalidraw; niente voti o timer (si possono aggiungere).
- Frecce collegate a oggetti di altri: se un partecipante sposta un proprio oggetto a cui è agganciata una freccia altrui, quella freccia non si muove per gli altri.
- Conflitti: se due persone cambiano lo *stesso* elemento nello stesso istante, vince una delle due modifiche (ok per gruppi piccoli).
- Il server tiene l'intera scena in memoria e la ritrasmette in blocco alla connessione: va bene per board normali (centinaia di elementi), non per lavagne enormi.
- Annulla/ripristina è locale: ognuno annulla solo le proprie azioni.

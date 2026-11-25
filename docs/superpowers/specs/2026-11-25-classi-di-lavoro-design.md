# Classi di lavoro: `npm run seed`

Data: 2026-11-25. Stato: **bozza da approvare**. Dimensione: piccola (un comando, nessuna modifica al protocollo né all'interfaccia).

## Intento e perché

Nei corsi (massimo 12 persone) gli allievi si dividono in 3 o 4 gruppi, ognuno in una stanza Zoom con una propria board già carica di materiale (di solito l'immagine di un diagramma UML, a volte una board già preparata dal trainer) su cui aggiungere etichette e scrivere requisiti nelle note. Oggi preparare le board e i link a mano è lungo e soggetto a errori. Il comando prepara tutte le board di una "classe" con lo stesso materiale e stampa i link.
Come Miro nel caso "una board per gruppo" (duplicare la board dell'esercizio una volta per gruppo): i gruppi non si vedono tra loro e non possono rovinare il lavoro altrui.

## Obiettivi

1. Creare N board (1-12), una per gruppo, con lo stesso materiale di partenza.
2. Materiale: **un file immagine** (PNG, JPEG, WebP, GIF) oppure **una board già preparata** sullo stesso server.
3. Stampare i link: uno da trainer (`editor`) per ogni board e i link degli allievi (`participant`).
4. Funzionare con il server acceso, anche sul Raspberry, senza toccare i file di `data/`.

## Non obiettivi

Pagina web per il trainer, pulsanti "entra nella board", chiusura sessione, timer o votazioni comuni a più board (fasi successive). Nessuna modifica all'interfaccia, al protocollo o ai ruoli. Nessun database.

## Anti-obiettivi

- Sovrascrivere o duplicare il contenuto di una board che il corso sta già usando.
- Dare a un allievo il materiale come cosa da poter spostare o cancellare per sbaglio.
- Stampare link con scadenza o ruolo sbagliati.

## Vincoli

- Stesso segreto e stessa firma dei link esistenti (`BOARD_SECRET` dall'ambiente o da `.env`, come `npm run token` e il server; in sviluppo il valore di prova).
- Il materiale entra come lo farebbe un browser, connettendosi alla board con un link da `editor` (così valgono gli stessi controlli del server: tipi ammessi, 10 MB per immagine, proprietà degli oggetti). Il server tiene le stanze in memoria, quindi scrivere in `data/` mentre gira non è affidabile.
- I nomi delle board: `<corso>-g1 … <corso>-gN`, con le regole esistenti (lettere, numeri, `-`, `_`, massimo 64 caratteri, quindi `<corso>` al massimo 60).

## Approcci considerati

- **A. Collegarsi come trainer e inviare gli elementi (scelto).** Funziona con il server acceso, vale per immagine e per board da copiare (si legge la scena dalla board di origine con lo stesso canale).
- B. Scrivere i file in `data/rooms/…`: scartato, si perderebbe o verrebbe sovrascritto se la stanza è in memoria.
- C. Estendere il server con un endpoint di amministrazione: scartato per ora, aggiunge superficie d'attacco e protocollo.

## Disegno

```
npm run seed -- <corso> <gruppi> <materiale> [opzioni]

  <corso>      nome base, es. isaqb-dic26  ->  board isaqb-dic26-g1 … -gN
  <gruppi>     numero di gruppi, 1-12
  <materiale>  percorso di un'immagine, oppure board:<id> per copiare una board già preparata

  --server  <url>    server delle board (predefinito http://localhost:3030)
  --base    <url>    indirizzo per i link (predefinito: quello del server)
  --ore     <n>      validità dei link (predefinito 12)
  --trainer "<nome>" nome del trainer (predefinito "Trainer"); uid "trainer"
  --allievi <file>   un allievo per riga: "Nome" oppure "Nome;gruppo" (numero)
```

- **Immagine:** letta dal file, controllata (tipo, dimensione), inserita come elemento immagine **bloccato** (non selezionabile dagli allievi; il trainer lo sblocca se serve), con larghezza al massimo 1400 px e centrata nell'origine. Le dimensioni si leggono dall'intestazione del file (PNG, JPEG, WebP, GIF), senza librerie.
- **Board da copiare (`board:<id>`):** la scena e le immagini si leggono con un collegamento da `editor` alla board di origine e si inviano così come sono a ogni gruppo. Gli oggetti risultano del trainer (`uid trainer`), quindi gli allievi non possono modificarli: possono aggiungere i propri.
- **Ripartenza sicura:** se una board di destinazione ha già del contenuto, viene **saltata** con un avviso (si usa un altro nome di corso). Nessuna cancellazione.
- **Link:** per ogni gruppo un link da trainer; per gli allievi, con `--allievi`, un link personale ciascuno (`uid` derivato dal nome, così voti e proprietà degli oggetti sono per persona); gli allievi senza gruppo sono distribuiti a turno sui gruppi. Senza `--allievi` si stampa un solo link `participant` per gruppo, avvertendo che chi lo usa condivide identità e puntini di voto.
- **Implementazione:** `scripts/seed.ts` eseguito con `tsx`, con le parti pure (lettura argomenti, assegnazione degli allievi, lettura dimensioni immagine, costruzione degli elementi) in un modulo testabile. Firma dei link con `signToken` di `server/auth.ts`. Libreria `ws` già presente.
- **Test:** unitari sulle parti pure; un test di integrazione che avvia il server su una porta libera con una cartella dati temporanea, lancia il comando e verifica scena e immagini salvate, il salto di una board già piena e che un link `participant` non possa spostare il materiale.

## Decisioni mie (da correggere se non vanno)

- Immagine bloccata di default.
- Board già piene saltate, non svuotate.
- Un link personale per allievo solo se c'è l'elenco; altrimenti link di gruppo.
- Link e nomi stampati solo a video (nessun file), perché contengono firme di accesso.

## Lasciato a chi costruisce

Testi dei messaggi in italiano, formato esatto dell'elenco stampato, gestione degli errori di rete (server spento, token rifiutato).

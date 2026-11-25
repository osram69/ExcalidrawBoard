# Stanze dal vivo: aula, elenco dei partecipanti, gruppi, timer per tutti

Data: 2026-11-25. Stato: **bozza da approvare**. Dimensione: **progetto** (server, client, documentazione), da costruire a blocchi indipendenti.

## Intento e perché

Come con le stanze di Zoom o di Miro: **tutti entrano nella board del trainer (l'aula)**, il trainer vede i cursori con il nome degli allievi e l'**elenco dei collegati**. Con un pulsante **"Crea stanze"** assegna ogni partecipante a una stanza (1, 2, 3…): ogni stanza è una board con una **copia di ciò che il trainer ha disegnato in quel momento**, e gli allievi vengono **portati dentro automaticamente**. Il **timer** si avvia una volta ed è **per tutti**. Quando il trainer **chiude le stanze** tutti **tornano in aula** e le board delle stanze **restano salvate** (il trainer può riaprirle).
Sostituisce, per l'uso in aula, la preparazione in anticipo dei gruppi con `seed` (che resta disponibile per chi vuole gruppi già pronti).

## Obiettivi

1. **Elenco dei collegati** per il trainer (nome, dove si trova: aula o stanza n), sempre aggiornato.
2. **Crea stanze:** il trainer sceglie quante stanze (2-12) e assegna i partecipanti (a mano, o con "Distribuisci a caso"); alla conferma si creano le board copiando l'aula e gli assegnati vengono spostati.
3. **Spostamento automatico** degli allievi nella loro stanza, senza link né password; chi ricarica la pagina o rientra dal link dell'aula torna **nella sua stanza** finché le stanze sono aperte.
4. **Il trainer** entra in qualsiasi stanza, torna in aula, **sposta un allievo** da una stanza all'altra, **chiude le stanze** (tutti tornano in aula).
5. **Le stanze restano salvate** dopo la chiusura; il trainer le riapre dall'elenco dei turni di stanze già fatti.
6. **Timer per tutti:** avviato in aula o in una stanza, vale per aula e stanze del corso (stesso conto, stesse pause).
7. **Accesso degli allievi dalla board:** pannello "Invita" per il trainer con il **link da dare agli allievi** (copiabile) e l'impostazione di **password e data di fine** della sessione, senza usare la riga di comando.
8. **L'allievo vede in che stanza si trova** (indicazione nella barra in alto).

## Non obiettivi

Chat o audio/video (restano Zoom/Teams). Riportare in aula quello che i gruppi hanno aggiunto (le stanze restano consultabili ma non si fondono con l'aula). Gli allievi che scelgono o cambiano stanza da soli. Votazioni comuni tra stanze (restano per board). Revoca di un singolo allievo dalla sessione. Assegnare persone non ancora collegate (si assegna chi è collegato; chi entra dopo resta in aula).

## Anti-obiettivi

- Un allievo che si fa spostare dove non deve, o che ottiene un accesso più lungo o con ruolo diverso da quello che aveva.
- Un allievo che entra in una stanza di un turno già chiuso o che non è la sua.
- Perdere il contenuto di una stanza chiudendola.
- Rompere gli accessi che funzionano oggi (link firmati del trainer, login con password, `seed`).
- Spostare chiunque senza che il trainer lo abbia deciso.

## Contesto e vincoli

- Board su un Raspberry (Docker, tunnel Cloudflare); poche decine di collegati al massimo (corsi da 12), con più stanze contemporanee. Stanze e aula condividono lo stesso processo del server.
- Nessuna nuova dipendenza. Stesso formato e stesso segreto dei token.
- Le regole di ruolo si controllano sul server, non nell'interfaccia.
- I nomi delle board: l'aula ha un nome qualsiasi (massimo **50 caratteri** se si vogliono creare stanze); le stanze di un turno si chiamano `<aula>-r<turno>-s<n>` (esempio `isaqb-dic26-r1-s2`), entro i 64 caratteri ammessi.

## Approcci considerati

- **Stanze come board separate, con spostamento dei client (scelto):** coerente con tutto quello che esiste (ruoli, proprietà degli oggetti, salvataggio, `seed`); le stanze restano board vere, consultabili e salvate.
- Una sola board con aree per gruppo e visibilità filtrata: scartata (già scartata in precedenza): i gruppi si vedrebbero tra loro e servirebbe un motore di visibilità per ogni elemento.
- Spostamento con nuovi link da inviare: scartato, è proprio ciò che si vuole evitare.

## Disegno

**Dati su disco** (nella cartella dell'aula `data/rooms/<aula>/`):
- `course.json`: `{ round: <ultimo turno>, rounds: [ { round, open, createdAt, rooms: [ { n, id, members: [ { key, name } ] } ] } ] }`. Il turno **aperto** (al massimo uno) dice dove stanno gli assegnati; i turni chiusi sono lo storico.
- Nella cartella di ogni stanza, `parent.json`: `{ aula, round, n }`, così il server sa a quale corso appartiene.

**Server** (nuovo modulo `server/course.ts`, messaggi gestiti da `features.ts`):
- `Peer` ricorda `exp` ed `email` del proprio token (servono a emettere i token di spostamento senza allungarne la durata).
- Presenza: a ogni entrata, uscita o spostamento, i collegati **con ruolo `editor` di qualsiasi board del corso** ricevono `{ t: "presence", rooms: { [boardId]: [ { key, name, role } ] }, current: <turno aperto o null> }`. Gli allievi non vedono gli altri collegati (solo i cursori della propria board, come oggi). La mail non viene mai inviata.
- `{ t: "rooms-create", rooms: N, assign: { [key]: n } }` (solo `editor` dell'aula; `2 ≤ N ≤ 12`; al massimo 200 assegnazioni; una sola chiave per persona; `n` tra 1 e N; non c'è un turno già aperto): crea le board del nuovo turno **copiando gli elementi non cancellati e le immagini dell'aula** (proprietà degli oggetti: del trainer che ha creato, come con `seed`), salva `course.json` e `parent.json`, **poi** sposta chi è collegato. Risposta d'errore chiara se qualcosa non va.
- Spostamento: `{ t: "goto", room, token }` al singolo collegato: il token è firmato dal server per la stanza di destinazione, con **stesso nome, `uid`, ruolo ed `exp`** del token che l'allievo già ha (mai più lungo). Il client salva il token e apre la nuova board.
- Rientro: chi si collega all'**aula** con un'assegnazione nel turno aperto riceve subito `goto` verso la sua stanza (ricarica, rientro dal link, disconnessione). Un partecipante che si collega a una **stanza** deve avere un'assegnazione in un turno **aperto** di quel corso (altrimenti il server rifiuta, e `/auth/check` risponde `stanza chiusa` con l'aula di riferimento: il client torna all'aula). I trainer (`editor`) possono entrare in qualsiasi stanza.
- `{ t: "rooms-move", key, n }` (solo `editor`, turno aperto): sposta un allievo in un'altra stanza. `{ t: "rooms-visit", room }` (solo `editor`): `goto` con token da trainer verso aula o stanza del corso (anche di turni chiusi).
- `{ t: "rooms-close" }` (solo `editor`, da aula o da qualsiasi stanza): chiude il turno aperto e manda **tutti** i collegati nelle stanze di nuovo in **aula** (`goto`, stesso nome/ruolo/`exp`); le board delle stanze restano su disco.
- **Timer unico per corso:** le board del corso condividono lo stesso `RoomTimer`; i comandi del trainer (da aula o stanza) aggiornano il timer comune e il nuovo stato viene inviato **a tutti i collegati di tutte le board del corso**. Chi entra riceve lo stato corrente. Le board senza stanze mantengono il timer proprio.
- **Accesso dall'interfaccia:** nessun nuovo endpoint: il pannello "Invita" usa `PUT /auth/access` già esistente con il token da trainer.

**Client**:
- Nuova schermata `src/Rooms.tsx`: pulsante **"Stanze"** nella barra in alto (solo `editor`) con un pannello a tre sezioni: *Collegati* (nome e dove si trovano, aggiornato dal vivo), *Crea stanze* (numero di stanze, selezione per persona, "Distribuisci a caso", "Crea e sposta") e, a turno aperto, *Stanze in corso* (membri per stanza, "Entra", "Sposta", "Chiudi stanze", "Torna in aula"); più l'elenco dei turni già fatti con "Apri".
- Nuovo pannello **"Invita"** (solo `editor`, `src/Invite.tsx`): link per gli allievi (`/b/<aula>`, copiabile), campo password della sessione (8-200 caratteri), data di fine (facoltativa), pulsante "Salva".
- Messaggio `goto` (qualsiasi ruolo): il client salva il token ricevuto per la nuova board nella sessione del browser e apre `/b/<nuova board>`; la pagina riparte da lì (verifica dell'accesso e collegamento).
- L'allievo vede nella barra in alto "Stanza n" (o "Aula"); il suo nome compare come prima.
- Funzioni pure per la distribuzione a caso e per la validazione delle assegnazioni, testate in Node.

**Documentazione:** README (aula, stanze, invito, differenze con `seed`).

**Test:** unitari sulle regole (assegnazioni valide, distribuzione a caso equilibrata, nomi delle stanze entro i 64 caratteri, emissione dei token di spostamento senza allungare la scadenza né cambiare ruolo, copia dell'aula con proprietà del trainer); integrazione con il vero server e più WebSocket: aula con trainer e allievi → crea stanze → gli allievi ricevono `goto` e si collegano alla stanza con il token ricevuto, con la copia di ciò che c'era in aula; ricarica nell'aula riporta nella stanza; sposta un allievo; chiudi → tutti in aula, stanze salvate e non più accessibili agli allievi; un allievo che prova a creare stanze, spostare o visitare viene ignorato; timer avviato da una stanza arriva ad aula e altre stanze; un token di stanza non entra in un'altra; verifica a mano nel browser con trainer e più allievi.

## Decisioni mie (da correggere se non vanno)

- **Un turno alla volta:** per crearne un altro bisogna prima chiudere quello aperto; ogni turno ha le sue board (`-r1-`, `-r2-`…), così "le stanze restano salvate" vale per ogni turno.
- Le stanze nascono come **copia dell'aula nel momento della creazione**; ciò che gli allievi aggiungono in aula prima diventa del trainer nelle copie (come con `seed`).
- Gli allievi **non possono** lasciare o cambiare stanza da soli; solo il trainer li sposta.
- Chi entra **dopo** la creazione resta in aula finché il trainer non lo sposta.
- L'elenco dei collegati mostra **solo il nome** (mai la mail) e solo ai trainer.
- Il turno chiuso non è più accessibile agli allievi; il trainer riapre le stanze dallo storico (anche per mostrare il lavoro ai gruppi) tramite "Apri".
- Il corso ha un nome di aula di massimo 50 caratteri solo se si usano le stanze.

## Lasciato a chi costruisce

Aspetto grafico del pannello e dei messaggi, ordine dei blocchi di test, dettagli di salvataggio su disco di `course.json` (scrittura atomica come per `access.json`).

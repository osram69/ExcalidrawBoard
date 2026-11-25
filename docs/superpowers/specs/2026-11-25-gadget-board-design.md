# Gadget per la board Excalidraw: timer, votazione, template, libreria di forme

Data: 2026-11-25. Stato: **bozza da approvare**.

## Intento e perché

La board serve ai corsi Cube Academy (iSAQB, gruppi di massimo 12 persone). Per le esercitazioni gli allievi si dividono in 3-4 gruppi (stanze Zoom) e ognuno lavora su una propria board con materiale già caricato, per esempio un diagramma UML a cui aggiungere etichette e da cui ricavare requisiti in note.
Oggi la board ha note adesive, frame, foto, cursori live e tre ruoli (`editor` = trainer, `participant`, `viewer`). Mancano gli strumenti da workshop che Miro offre. Questo documento copre i primi quattro.
**Fase successiva (non in questo documento):** "classi di lavoro", cioè un comando `npm run seed` che copia lo stesso materiale di partenza in N board, una per gruppo, e stampa i link. Il disegno qui sotto non deve renderla più difficile.

## Obiettivi

1. **Timer** condiviso per board, avviato dal trainer, visibile a tutti.
2. **Votazione con puntini** sulle note adesive, con budget per persona e conteggio visibile.
3. **Template** di board inseribili con un clic.
4. **Libreria di forme** per l'architettura software, disponibile nel pannello librerie di Excalidraw.

## Non obiettivi

- Nessun gruppo/classe o gestione corsi (fase successiva).
- Nessun timer o voto *tra* board diverse (ogni board ha il suo stato).
- Nessun voto anonimo o segreto, nessun voto su elementi diversi dalle note adesive.
- Nessuna nuova dipendenza (né npm né servizi esterni).
- Nessun database: lo stato resta in memoria e su file come oggi.

## Anti-obiettivi (sarebbe un fallimento anche se "funziona")

- Un partecipante che riesce a votare più del suo budget, a votare quando la votazione è chiusa, o a controllare il timer.
- Un client che manda messaggi malformati e manda in errore la board agli altri (il server oggi si difende con `wellFormed`; le nuove funzioni devono fare altrettanto).
- Cambiare il comportamento esistente di `els`, `files`, `ptr`, proprietà degli oggetti e ruoli.

## Vincoli

- Server: Node >= 22, TypeScript eseguito con `tsx`, libreria `ws`. Sincronizzazione già basata su messaggi JSON `{t: ...}` ([server/index.ts](../../../server/index.ts)).
- Client: React 19, `@excalidraw/excalidraw` 0.18, tutto in [src/Board.tsx](../../../src/Board.tsx) e CSS in [src/styles.css](../../../src/styles.css).
- Il ruolo è imposto dal server dal token firmato; l'interfaccia nasconde solo i comandi. Ogni nuova azione va controllata sul server.
- I `viewer` non scrivono mai: vedono timer e conteggi ma non votano.
- Un oggetto non ha proprietario finché non lo crea un utente collegato. Il diagramma caricato dal trainer può quindi essere modificato solo da lui (comportamento esistente, invariato).

## Approcci considerati

**Come sincronizzare timer e voti**
- *A. Dentro gli elementi di Excalidraw* (il voto come `customData` della nota): scartato. I partecipanti non possono modificare note altrui, e due voti simultanei si sovrascriverebbero.
- *B. Messaggi dedicati e stato nel server (scelto).* Il server è l'unica fonte di verità, convalida budget e ruoli, e lo stato arriva nel messaggio `init` a chi si collega a metà.
- *C. Stato nel client del trainer e relay:* scartato, perché si perderebbe a ogni ricarica e non si può convalidare.

**Dove vivono template e libreria**
- *Definiti nel codice client e inseriti con `convertToExcalidrawElements` (scelto):* nessun file da mantenere, nessun problema di formato. La libreria si registra all'avvio con `updateLibrary`.
- *File `.excalidrawlib` scritti a mano:* scartato, fragile da produrre e da aggiornare.

## Disegno scelto

### Protocollo (nuovi messaggi)

| Direzione | Messaggio | Chi può | Effetto |
|---|---|---|---|
| client→server | `{t:"timer", action:"start"\|"pause"\|"resume"\|"extend"\|"reset", seconds?}` | solo `editor` | aggiorna il timer e lo ritrasmette (`extend` aggiunge `seconds` al conto; dopo la scadenza riparte da adesso) |
| server→tutti | `{t:"timer", state:{status, endsAt, remainingMs, durationMs}, now}` | — | `now` è l'ora del server, serve a correggere lo scarto dell'orologio del client |
| client→server | `{t:"vote-ctl", action:"open"\|"close"\|"reset", perPerson?}` | solo `editor` | apre/chiude/azzera la votazione (budget 1-20, predefinito 5) |
| client→server | `{t:"vote", id, delta:+1\|-1}` | `editor` e `participant` | aggiunge/toglie un puntino alla nota `id` |
| server→tutti | `{t:"votes", open, perPerson, totals:{<id>:n}}` | — | stato pubblico |
| server→singolo | `{t:"my-votes", mine:{<id>:n}, left}` | — | i voti e i puntini residui di quella persona |

`init` include anche timer e votazione correnti. Un messaggio non valido viene ignorato in silenzio, come già fa il server.

### Timer

- Stato per stanza nel server: `idle`, `running` (con `endsAt`), `paused` (con `remainingMs`), `done` (scaduto, calcolato dal server quando `endsAt` è passato). Non viene salvato su disco: un riavvio del server lo azzera (accettabile, le esercitazioni durano minuti).
- Allo scadere i client mostrano un lampeggio e un breve suono (Web Audio, con pulsante muto; i browser bloccano l'audio senza un gesto dell'utente, quindi il suono parte solo dopo il primo clic sulla pagina).
- Interfaccia: pillola in alto al centro (mm:ss), visibile a tutti. Il trainer vede anche i comandi: preset 5/10/15/30 minuti, +1 min, pausa/riprendi, azzera.

### Votazione

- Stato per stanza: `open`, `perPerson`, `votes: Map<chiave utente, Map<id nota, n>>` (la chiave è la stessa usata per la proprietà degli oggetti: `uid` del token, altrimenti il nome). Salvato in `votes.json` nella cartella della stanza con scrittura atomica, così sopravvive a un riavvio.
- Il server accetta un voto solo se: votazione aperta, ruolo ammesso, l'elemento esiste, non è cancellato ed è una nota (`customData.kind === "nota"`), la persona ha puntini residui (per `-1`: ha almeno un suo voto su quella nota). Il budget si calcola solo sulle note esistenti; se una nota viene cancellata i suoi voti non contano più e il puntino torna disponibile.
- Interfaccia: durante la votazione, un pulsante "+" e un contatore compaiono sull'angolo di ogni nota; un pannello mostra "Hai N puntini". A votazione chiusa restano visibili solo i totali. Il trainer ha apri / chiudi / azzera e il budget. I badge sono un livello HTML sopra il canvas, posizionato con le coordinate di scena (`scrollX`, `scrollY`, `zoom`, `offsetLeft/Top` di `appState`) e ricalcolato a ogni cambiamento.
- I totali sono visibili in tempo reale a tutti mentre la votazione è aperta.

### Template (solo client, `src/templates.ts`)

Cinque template, inseriti al centro della vista e racchiusi in un frame con nome:
1. **Retrospettiva**: Start / Stop / Continue.
2. **Matrice impatto/sforzo**: 2x2 con assi etichettati.
3. **Contesto di sistema (C4 livello 1)**: sistema al centro, persone e sistemi esterni con frecce.
4. **ADR**: scheda con Contesto, Decisione, Alternative, Conseguenze.
5. **Requisiti e qualità**: colonne Funzionali / Qualità / Vincoli, utile per gli esercizi iSAQB.

Vengono inseriti come oggetti normali: il server li assegna a chi li inserisce. Pulsante "Template" nella barra in basso, disponibile a `editor` e `participant`.

### Libreria di forme (solo client, `src/library.ts`)

Registrata all'avvio con `updateLibrary({ merge: true })` con id fissi, così non si duplica. Ogni elemento ha un nome con prefisso di categoria ("UML · Componente"), perché la libreria di Excalidraw non ha cartelle. Resta utilizzabile anche il caricamento di altre librerie dal pannello di Excalidraw. Il set ricalca le viste usate nei corsi (contesto, blocchi, runtime, distribuzione) e gli stencil che si userebbero in Visio:

- **UML strutturale:** componente (con icona), interfaccia fornita (lollipop) e richiesta (socket), porta, classe a tre compartimenti, interfaccia `<<interface>>`, package (con linguetta), nota con angolo piegato.
- **UML comportamentale:** attore, caso d'uso (ellisse), lifeline per diagrammi di sequenza (box + linea tratteggiata + barra di attivazione), stato, stato iniziale e finale, decisione (rombo), fork/join (barra).
- **Relazioni UML** come frecce pronte: dipendenza (tratteggiata), realizzazione (tratteggiata con triangolo vuoto), generalizzazione (triangolo vuoto), associazione, aggregazione (rombo vuoto), composizione (rombo pieno). Si usano le punte di freccia native di Excalidraw (`triangle_outline`, `diamond`, `diamond_outline`).
- **C4:** persona, sistema, sistema esterno (grigio/tratteggiato), container, componente: ciascuno con titolo, tecnologia e descrizione.
- **Infrastruttura e distribuzione:** nodo/server (box 3D), ambiente di esecuzione, container Docker, cloud, database (cilindro), coda/broker, cache, storage di file, API gateway, load balancer, browser/utente, dispositivo mobile.
- **Servizi e integrazione:** microservizio (esagono), servizio esterno, event bus, job batch.
- **arc42 / iSAQB:** building block (scatola nera e scatola bianca con compartimento interno), stakeholder, scenario di qualità (scheda Stimolo / Ambiente / Risposta / Misura), rischio e debito tecnico (nota rossa), concetto trasversale.

Sono circa 45 elementi, tutti disegnati con rettangoli, ellissi, linee, frecce e testo di Excalidraw (nessuna immagine, nessuna icona esterna), così restano modificabili e leggeri. Per la parte "tipo Visio" lo stile è volutamente pulito (`roughness: 0`, linee nette) e non a mano libera, per diagrammi da presentare in corso.

### Test

Il progetto non ha test. Aggiungo `npm test` con il runner integrato di Node (`node --import tsx --test`), senza nuove dipendenze, per la logica del server: stato del timer, regole di voto (budget, ruoli, votazione chiusa, nota cancellata, persistenza). L'interfaccia si verifica a mano con due browser (editor + participant) e un viewer.

## Decisioni mie (da correggere se non vanno)

- Il trainer (`editor`) può votare quanto un partecipante, con lo stesso budget.
- Budget predefinito 5 puntini, massimo 20; nessun limite per nota.
- Timer non persistente, voti persistenti.
- Template disponibili anche ai partecipanti, non solo al trainer.
- Voti legati alla chiave utente del token: se due persone condividono lo stesso `uid` (o lo stesso nome senza `uid`) condividono il budget. È lo stesso limite già documentato per la proprietà degli oggetti.

## Lasciato a chi costruisce

Aspetto grafico esatto di pillola, badge e menu (nello stile della palette esistente), valori precisi di colori e dimensioni dei template, scelta degli elementi di ogni forma della libreria, messaggi di errore e testi in italiano.

## Ordine di costruzione

Quattro blocchi indipendenti, ognuno utilizzabile da solo: timer, poi votazione, poi template, poi libreria. Il README si aggiorna alla fine (la sezione "Limiti" oggi dice "niente voti o timer").

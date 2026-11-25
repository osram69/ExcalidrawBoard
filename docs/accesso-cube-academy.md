# Accesso del trainer alla board con l'account Cube Academy

Questo documento descrive cosa deve fare il **sito Cube Academy** (Next.js su Hostinger) perché un utente con **ruolo trainer** dell'elenco di `/admin/materiali` entri nella board con tutti i permessi, senza link né comandi.
La board gira su un Raspberry (a casa, con il tunnel Cloudflare) e **non contatta mai il sito né Supabase**: l'unico scambio è il reindirizzamento del browser con un token firmato.

## Flusso

```
board:  https://<board>/b/lezione1           (senza accesso: pagina di login degli allievi)
   │  pulsante "Accedi come trainer"
   ▼
sito:   <TRAINER_LOGIN_URL>?room=lezione1&return=https://<board>/b/lezione1
   │  login /materiali se serve; controlla che l'utente sia trainer
   ▼
board:  https://<board>/b/lezione1?t=<token>   (il token viene tolto subito dall'indirizzo)
```

La board configura l'indirizzo del sito con la variabile d'ambiente `TRAINER_LOGIN_URL` (per esempio `https://cubeacademy.eu/materiali/board`). Senza, il pulsante non compare.

## Cosa deve fare la rotta del sito (`GET /materiali/board`)

Parametri: `room` (nome della board) e `return` (dove tornare).

1. **Validare `room`:** `^[A-Za-z0-9_-]{1,64}$`.
2. **Validare `return` (obbligatorio, altrimenti il token finirebbe a chi lo chiede):** l'origine deve essere una di quelle elencate in `BOARD_URL` (variabile del sito, indirizzi separati da virgola), il percorso deve essere **esattamente** `/b/<room>`, senza parametri né frammento.
3. **Leggere la sessione di `/materiali`** (cookie `materiali_sid`). Senza accesso, passare dal login esistente e tornare alla stessa rotta.
4. **Controllare il ruolo:** solo `trainer`. Uno studente o chi non ha un account riceve un messaggio chiaro e nessun token.
5. **Firmare il token** con `BOARD_SECRET` (lo stesso della board) e rimandare a `<return>?t=<token>`.

## Formato del token

`token = base64url(JSON) + "." + base64url(HMAC-SHA256(BOARD_SECRET, "board:" + base64url(JSON)))`

Campi del JSON: `room` (la board), `name` (nome mostrato accanto al cursore), `uid` (nome utente: solo lettere, numeri, `. _ @ -`, massimo 64), `role` (`"editor"` per il trainer), `exp` (scadenza, **millisecondi** dal 1970; consigliate 12 ore). `exp` deve essere un **numero JSON**.
La firma copre i byte esatti di `base64url(JSON)` come inviati: l'ordine delle chiavi nel JSON è libero.

**Vettore di prova** (controllato dai test della board e da quelli del sito): con `BOARD_SECRET = chiave-di-prova` e

```json
{"room":"lezione1","name":"Patrick Serra","uid":"patrick","role":"editor","exp":1893456000000}
```

il token è

```
eyJyb29tIjoibGV6aW9uZTEiLCJuYW1lIjoiUGF0cmljayBTZXJyYSIsInVpZCI6InBhdHJpY2siLCJyb2xlIjoiZWRpdG9yIiwiZXhwIjoxODkzNDU2MDAwMDAwfQ.fAM4baMfsWCi4Lsjdxv3z96Z8lhrbAnH4DXbUXItuh4
```

## Esempio (Node.js)

```js
import crypto from "node:crypto";
const body = Buffer.from(JSON.stringify({ room, name, uid, role: "editor", exp: Date.now() + 12 * 3600e3 })).toString("base64url");
const sig = crypto.createHmac("sha256", process.env.BOARD_SECRET).update(`board:${body}`).digest("base64url");
const token = `${body}.${sig}`;
```

## Variabili d'ambiente

| Dove | Variabile | Significato |
| --- | --- | --- |
| sito (Hostinger) | `BOARD_SECRET` | stesso valore della board; **mai** nell'indirizzo, nei log o nel browser |
| sito (Hostinger) | `BOARD_URL` | indirizzo pubblico della board (anche più d'uno, separati da virgola) |
| sito (Hostinger) | `BOARD_TOKEN_HOURS` | facoltativa, durata del token (predefinito 12) |
| board (Raspberry) | `TRAINER_LOGIN_URL` | indirizzo della rotta del sito, per esempio `https://cubeacademy.eu/materiali/board` |

L'orologio del Raspberry deve essere sincronizzato (NTP): la scadenza del token è controllata da lì.

## Uso in produzione: cose da sapere

- **`BOARD_URL` deve elencare tutti gli indirizzi da cui i trainer aprono la board**, scritti come li mostra il browser (schema, nome e porta). Se la board viene aperta da un altro indirizzo (l'IP del Raspberry in rete locale, `http` al posto di `https`, un secondo nome del tunnel) il sito risponde "Indirizzo della board non abilitato" e scrive l'indirizzo rifiutato nel suo log. Un eventuale percorso nella voce si ignora. Mai `http://localhost` in produzione.
- **`BOARD_TOKEN_HOURS`** va da 1 a 72 ore; oltre si ferma a 72.
- **Se il trainer torna sulla board e vede "L'accesso non è valido: accedi di nuovo"** in modo ripetuto: controlla che `BOARD_SECRET` sia **identico** sul sito e sulla board (nessuno spazio in più) e che gli orologi siano sincronizzati (NTP). La board non distingue un segreto sbagliato da un accesso scaduto.
- **Cambiare `BOARD_SECRET`:** va cambiato nello stesso momento sul sito e sulla board; da quel momento tutti i link firmati e gli accessi già emessi (anche quelli degli allievi) non valgono più.
- **Computer condivisi:** il token da trainer dura fino a 12 ore e il browser ricorda l'indirizzo con `?t=` nella cronologia. Su un computer condiviso usa una finestra privata, oppure `Esci` quando hai finito.
- **Chi può usare l'account:** qualsiasi utente con ruolo `trainer` apre qualsiasi board. Togliere o declassare un trainer in `/admin/materiali` impedisce nuovi accessi, ma non revoca un token già emesso prima della sua scadenza.

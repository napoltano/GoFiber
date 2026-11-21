# GoFiber

Gestionale per le pratiche di installazione in fibra ottica (FTTH): agenda per fasce orarie, pratiche Assurance e Delivery con rete Open Fiber o FiberCop, tecnici in coppia, magazzino a seriali con codici a barre, posizioni PFS, archivio, riepilogo e resa per settimana, mese e anno.

**App online:** https://napoltano.github.io/GoFiber/

## Come funziona senza Claude

L'app (`index.html`) è pubblicata con GitHub Pages. I dati condivisi stanno in un **Foglio Google**, con un piccolo server **Apps Script** (`backend/Code.gs`) che gestisce:
- account con email e password, conferma dei nuovi iscritti e ruoli (Tecnico, Ufficio, Amministratore), controllati anche sul server;
- pratiche, esiti, magazzino, utenti, sincronizzati tra tutti i dispositivi ogni 12 secondi circa;
- foto e allegati salvati nella cartella Drive **GoFiber Foto**;
- elenco delle posizioni PFS letto dal file privato `pfs-data.json` su Drive (non è nel repository).

Se l'app non è collegata a un foglio parte in **modalità locale**: i dati restano solo nel browser del dispositivo.

## Attivare il Foglio Google (una volta sola)

1. Apri il foglio **GoFiber – Database** nella cartella Drive *GoFiber* → **Estensioni → Apps Script**.
2. Cancella il codice presente e incolla tutto [`backend/Code.gs`](backend/Code.gs). Premi **Salva**.
3. Scegli la funzione `setup` e premi **Esegui**. Autorizza con il tuo account Google (*Avanzate → Vai a GoFiber → Consenti*).
4. **Esegui il deployment → Nuovo deployment →** ingranaggio **→ App web**. *Esegui come:* **Me** · *Chi ha accesso:* **Chiunque** → **Esegui il deployment**.
5. Copia l'URL dell'app web (finisce con `/exec`) e scrivilo in [`config.js`](config.js):
   ```js
   window.GOFIBER_API = 'https://script.google.com/macros/s/…/exec';
   ```
   Così tutti trovano l'app già collegata. In alternativa, nell'app premi **Collega il foglio Google** e incolla l'URL: vale solo su quel dispositivo.
6. Apri l'app e **crea per primo il tuo account**: il primo iscritto diventa il Proprietario (amministratore).
7. Trascina `pfs-data.json` (dalla cartella Documenti\GoFiber del PC) nella cartella Drive *GoFiber*, accanto al foglio.

### Aggiornare il codice del server
Incolla il nuovo `Code.gs`, premi Salva, poi **Esegui il deployment → Gestisci deployment →** matita **→ Versione: Nuova versione**. L'URL non cambia.

## File

| File | A cosa serve |
|---|---|
| `index.html` | L'app completa |
| `config.js` | Indirizzo del server Apps Script |
| `backend/Code.gs` | Server da incollare in Apps Script |
| `manifest.webmanifest`, `icon.svg` | Installazione sul telefono (Aggiungi a schermata Home) |
| `.nojekyll` | Fa servire i file a GitHub Pages così come sono |
| `.gitignore` | Tiene fuori l'elenco PFS riservato |

## Note
- `pfs-data.json` contiene le posizioni dei PFS esportate da FiberTools, che sono dati riservati: **non va caricato su GitHub**.
- Il server lavora con il tuo account Google e i limiti gratuiti di Apps Script, adatti a una squadra di qualche decina di persone.

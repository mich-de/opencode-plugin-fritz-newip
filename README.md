# opencode-plugin-fritz-newip

Plugin OpenCode per Windows, macOS e Linux: quando il provider risponde con limite o quota esaurita (429 o messaggio "limit"), chiede conferma e ottiene un nuovo IP pubblico riconnettendo il FRITZ!Box via TR-064, poi ripete la richiesta.

**Stacca internet a tutta la casa per 1-2 minuti a ciclo, e servono almeno 4 cicli.** Il plugin chiede sempre conferma e non parte più di una volta ogni 30 minuti.

## Contenuto

| Percorso | Uso |
|---|---|
| `index.ts` | plugin: hook `retry` di OpenCode, lancia `fritz-reconnect` |
| `bin/fritz-reconnect` | Mac/Linux (`sh` + `curl`); da Git Bash inoltra al `.cmd` |
| `bin/fritz-reconnect.cmd`, `bin/fritz-reconnect.ps1` | Windows (PowerShell) |
| `skills/fritz-newip/SKILL.md` | skill `/fritz-newip`: handover, conferma, riconnessione, verifica |
| `test/` | test di `bin/fritz-reconnect` con un FRITZ!Box finto |

## Requisiti

- OpenCode 2.x
- FRITZ!Box con accesso via TR-064 attivo e un utente con il permesso "Impostazioni FRITZ!Box"
- Windows: PowerShell (già presente). Mac/Linux: `curl`

## Installazione

La cartella di configurazione è `~/.config/opencode` (Windows: `%USERPROFILE%\.config\opencode`), oppure `$XDG_CONFIG_HOME/opencode` se impostata.

macOS / Linux:

```sh
git clone https://github.com/mich-de/opencode-plugin-fritz-newip.git ~/.config/opencode/plugins/fritz-newip
cd ~/.config/opencode/plugins/fritz-newip
mkdir -p ~/.config/opencode/skills ~/.local/bin
cp -R skills/fritz-newip ~/.config/opencode/skills/
ln -sf "$PWD/bin/fritz-reconnect" ~/.local/bin/fritz-reconnect   # ~/.local/bin deve essere nel PATH
fritz-reconnect -Setup
```

Windows (PowerShell):

```powershell
git clone https://github.com/mich-de/opencode-plugin-fritz-newip.git "$HOME\.config\opencode\plugins\fritz-newip"
cd "$HOME\.config\opencode\plugins\fritz-newip"
New-Item -ItemType Directory -Force "$HOME\.config\opencode\skills" | Out-Null
Copy-Item -Recurse skills\fritz-newip "$HOME\.config\opencode\skills\"
[Environment]::SetEnvironmentVariable('Path', "$([Environment]::GetEnvironmentVariable('Path','User'));$PWD\bin", 'User')
.\bin\fritz-reconnect.cmd -Setup
```

Poi riavvia OpenCode (su Windows apri prima un nuovo terminale, per il nuovo `Path`).

## Uso

```
fritz-reconnect -Setup        salva utente/password
fritz-reconnect               almeno 4 cicli, poi continua finché cambia la rete /16, max 30
fritz-reconnect -Prefix 24    basta che cambino i primi 3 numeri
fritz-reconnect -Status       mostra stato e IP, non disconnette
```

Altre opzioni: `-Min N`, `-Max N`, `-Box HOST`. Il box è `192.168.178.1` (IP di fabbrica), oppure `FRITZ_BOX` se impostata. Se hai cambiato IP al box imposta `FRITZ_BOX`. Evita `fritz.box` se il DNS in uso non è quello del box: può risolvere a un host pubblico.

## Credenziali

| Sistema | Dove |
|---|---|
| Windows | `data/fritz/cred.xml` accanto a `bin/`, cifrato con DPAPI (solo quell'utente Windows) |
| Mac/Linux | `~/.config/fritz-reconnect/cred`, **in chiaro** con permessi 600 |
| Tutti | in alternativa, variabili `FRITZ_USER` e `FRITZ_PASSWORD` |

Il certificato self-signed del box non viene verificato: usa il comando solo sulla tua rete.

## Limiti

- L'IP nuovo non è garantito: il provider può riassegnare la stessa rete.
- Inutile se il limite è legato all'account e non all'IP.
- Rispetta i termini del servizio del provider che usi.

## Test

```sh
node test/fritz-reconnect.test.mjs
```

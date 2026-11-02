---
name: fritz-newip
description: Nuovo IP pubblico via FRITZ!Box (fritz-reconnect) quando la quota del provider e' esaurita. Usa per /fritz-newip, "nuovo ip", "limit reached".
---

# Nuovo IP Fritz (fritz-reconnect) — /fritz-newip

Usa questa skill quando l'utente invoca `/fritz-newip`, `nuovo ip`, "quota esaurita/limit reached",
o quando l'agent percepisce che la sessione sta esaurendo i token/quota (avvisi di compattazione
imminente, subagent con "Free usage limit reached", errori di rate limit dal provider).

## Perché
Le quote dei modelli free (es. subagent "Free usage limit reached") spesso sono per-IP.
Cambiare IP pubblico può sbloccare la sessione.

## Cosa NON può fare
- Non esiste un trigger automatico "soglia token": l'agent valuta lui stesso quando è vicino alla fine
  (contesto cresciuto molto, avvisi di compattazione, errori di quota) e propone la skill.
- Se la sessione muore prima di eseguire la skill, serve la preparazione manuale (vedi passo 1).
- L'IP nuovo non è garantito diverso: il provider può riassegnare lo stesso.

## Procedura (in questo ordine, SEMPRE)
1. **Handover prima di tutto**: aggiorna la root del progetto `handover.md` (stato, ultime azioni,
   prossimo passo) e `memory.md`. Se la sessione muore qui sotto, una nuova deve ripartire subito.
2. **Conferma utente obbligatoria**: `fritz-reconnect` stacca internet a TUTTA la casa (~1-2 min).
   Chiedi: "Riconnessione Fritz? La casa resta senza internet per 1-2 minuti" — aspetta il sì,
   a meno che l'utente non abbia già scritto esplicitamente "vai col nuovo ip" in quel messaggio.
3. **Esegui**: `fritz-reconnect` (ciclo disconnetti/riconnetti; se non cambia IP, ripeti —
   almeno 4 cicli). NON usare `-Status` come comando di riconnessione: `-Status` è sola lettura.
4. **Verifica**:
   - `fritz-reconnect -Status` → mostra IP pubblico; confronta col precedente (se nota).
   - `curl -s -m 10 https://api.ipify.org` o `nslookup` per confermare internet attivo sul PC.
5. **Riprendi**: rileggi `handover.md`, seguila (prossimo passo già scritto). Se la sessione precedente
   è morta, l'utente resuma e l'agent riparte da handover, NON da zero.
6. **Registra**: un rigo in `memory.md`: data, IP (censurabile), motivo, se la quota si è sbloccata.

## Vincoli
- Mai durante un deploy o un'installazione in corso via rete (mezzo ciclo = installazione a meta').
- Mai più di 4 cicli senza chiedere all'utente.
- Se dopo 4 cicli l'IP non cambia, fermati e segna "provider riassegna stesso IP: quota non bypassabile da qui".

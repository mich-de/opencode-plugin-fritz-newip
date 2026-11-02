// Plugin "fritz-newip": quando il provider risponde con limite/quota esaurita (429 o messaggio
// "limit"), esegue fritz-reconnect (nuovo IP pubblico) CHIEDENDO PRIMA l'OK all'utente
// (stacca internet a tutta casa), aspetta che internet torni e consenti il retry della
// stessa richiesta. Fail-safe: mai piu' di una volta ogni 30 min; fallito -> retry:false
// cosi l'errore resta visibile all'utente.
import { Plugin } from "@opencode/plugin"
import { execFile } from "node:child_process"

const LIMIT_RE = /(usage|free|quota|rate)[ _-]*(limit|cap)|limit reached|remaining usage/i
const COOLDOWN_MS = 30 * 60 * 1000

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms))
}

async function waitInternet(maxWaitMs: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    try {
      const r = await fetch("https://api.ipify.org", { signal: AbortSignal.timeout(6000) })
      if (r.ok) return true
    } catch {
      // no internet yet, keep waiting
    }
    await sleep(5000)
  }
  return false
}

export default Plugin.define({
  id: "fritz-newip",
  async setup(ctx) {
    console.log("[fritz-newip] setup ok, registro hook retry")
    let lastRun = 0
    let running = false

    await ctx.session.hook("retry", async (event) => {
      const e = event.error
      const isLimit = e?.status === 429 || (e?.message ? LIMIT_RE.test(e.message) : false)
      if (!isLimit || running || Date.now() - lastRun < COOLDOWN_MS) return

      // registra la regola di permesso per questo evento (chiede all'utente, mai silenziosa)
      try {
        await ctx.session.update({
          sessionID: event.sessionID,
          permissions: [{ action: "fritz-reconnect", resource: "*", effect: "ask" }],
        })
        await ctx.permission.assert({
          sessionID: event.sessionID,
          action: "fritz-reconnect",
          resources: ["fritz-reconnect: stacca internet a TUTTA la casa per ~1-2 minuti"],
        })
      } catch {
        event.decision = { retry: true, delay: 60_000 } // utente ha negato: riprova dopo
        return
      }

      running = true
      lastRun = Date.now()
      try {
        await new Promise<void>((resolve) => {
          // shell su Windows: execFile da solo non lancia i .cmd
          execFile("fritz-reconnect", [], { timeout: 240_000, shell: process.platform === "win32" }, (err) => {
            if (err) console.error("[fritz-newip] fritz-reconnect error:", err)
            resolve()
          })
        })
        const back = await waitInternet(180_000)
        if (!back) {
          console.error("[fritz-newip] internet non tornata in 3 min: retry:false")
          event.decision = { retry: false }
          return
        }
        event.decision = { retry: true, delay: 15_000 }
      } finally {
        running = false
      }
    })
  },
})

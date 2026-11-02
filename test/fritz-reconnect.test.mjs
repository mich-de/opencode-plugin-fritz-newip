// Prova bin/fritz-reconnect contro un FRITZ!Box finto: nessun router reale viene toccato.
// node test/fritz-reconnect.test.mjs
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { fileURLToPath } from "node:url"

const script = fileURLToPath(new URL("../bin/fritz-reconnect", import.meta.url))

// uname finto: su Windows lo script altrimenti inoltrerebbe al .cmd
const fakeBin = mkdtempSync(join(tmpdir(), "fritz-test-"))
writeFileSync(join(fakeBin, "uname"), "#!/bin/sh\necho Linux\n")
chmodSync(join(fakeBin, "uname"), 0o755)

function mockBox(ips, { deny = false } = {}) {
  const box = { force: 0, connected: true, ip: ips[0], users: [] }
  const server = createServer((req, res) => {
    req.resume()
    req.on("end", () => {
      const auth = req.headers.authorization
      if (!auth || deny) {
        res.writeHead(401, { "WWW-Authenticate": 'Digest realm="F", nonce="n", qop="auth"' })
        return res.end()
      }
      box.users.push(/username="((?:[^"\\]|\\.)*)"/.exec(auth)?.[1])
      const action = req.headers.soapaction.split("#")[1]
      if (action === "ForceTermination") {
        box.force++
        box.connected = false
      }
      if (action === "RequestConnection") {
        box.connected = true
        box.ip = ips[Math.min(box.force, ips.length - 1)]
      }
      res.writeHead(200, { "Content-Type": "text/xml" })
      res.end(
        `<r>\n<NewConnectionStatus>${box.connected ? "Connected" : "Disconnected"}</NewConnectionStatus>\n` +
          `<NewExternalIPAddress>${box.ip}</NewExternalIPAddress>\n</r>\n`,
      )
    })
  })
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      box.url = `http://127.0.0.1:${server.address().port}`
      box.close = () => server.close()
      resolve(box)
    }),
  )
}

function run(box, args = [], user = "u") {
  const env = { ...process.env, PATH: fakeBin + delimiter + process.env.PATH, FRITZ_TR064_URL: box.url, FRITZ_USER: user, FRITZ_PASSWORD: 'p"\\w%d' }
  return new Promise((resolve) =>
    execFile("sh", [script, ...args], { env }, (err, stdout, stderr) =>
      resolve({ code: err ? err.code : 0, stdout, stderr }),
    ),
  )
}

async function test(name, ips, opts, fn) {
  const box = await mockBox(ips, opts)
  try {
    await fn(box)
    console.log("ok  ", name)
  } finally {
    box.close()
  }
}

await test("-Status non disconnette", ["1.2.3.4"], {}, async (box) => {
  const r = await run(box, ["-Status"])
  assert.equal(r.code, 0, r.stderr)
  assert.match(r.stdout, /Stato: Connected {2}IP: 1\.2\.3\.4 {2}\(WANPPPConnection:1\)/)
  assert.equal(box.force, 0)
})

await test("almeno 4 cicli anche se la rete cambia subito", ["1.2.3.4", "9.9.9.9"], {}, async (box) => {
  const r = await run(box)
  assert.equal(r.code, 0, r.stderr)
  assert.equal(box.force, 4)
  assert.match(r.stdout, /Rete \/16 cambiata: 1\.2\.3\.4 -> 9\.9\.9\.9/)
})

await test("continua oltre il minimo finche' cambia la rete", ["1.2.0.1", "1.2.0.2", "1.2.0.3", "1.2.0.4", "1.2.0.5", "9.9.0.1"], {}, async (box) => {
  const r = await run(box)
  assert.equal(r.code, 0, r.stderr)
  assert.equal(box.force, 5)
})

await test("-Prefix 24 si accontenta del terzo numero", ["1.2.3.4", "1.2.4.4"], {}, async (box) => {
  const r = await run(box, ["-Prefix", "24", "-Min", "1"])
  assert.equal(r.code, 0, r.stderr)
  assert.equal(box.force, 1)
})

await test("rete invariata dopo -Max: errore", ["1.2.0.1", "1.2.0.2"], {}, async (box) => {
  const r = await run(box, ["-Min", "1", "-Max", "2"])
  assert.equal(r.code, 1)
  assert.equal(box.force, 2)
  assert.match(r.stderr, /Rete \/16 invariata \(1\.2\.\*\) dopo 2 cicli/)
})

await test("401: errore chiaro, nessuna disconnessione", ["1.2.3.4"], { deny: true }, async (box) => {
  const r = await run(box)
  assert.equal(r.code, 1)
  assert.match(r.stderr, /401/)
  assert.equal(box.force, 0)
})

await test("utente con virgolette arriva integro", ["1.2.3.4"], {}, async (box) => {
  const r = await run(box, ["-Status"], 'a"b')
  assert.equal(r.code, 0, r.stderr)
  assert.equal(box.users[0], 'a\\"b')
})

rmSync(fakeBin, { recursive: true, force: true })

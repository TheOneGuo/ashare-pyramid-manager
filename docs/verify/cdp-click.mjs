// cdp-click.mjs — 链式 click + 截屏（先点击 tab "我的持仓研报" 再截）
import { spawn } from 'node:child_process'
import { writeFileSync, existsSync, statSync } from 'node:fs'
import { WebSocket } from 'ws'

const [, , urlArg, outArg, ...rest] = process.argv
const url = urlArg
const out = outArg
// rest: [ww, hh, clickJsExpr1, clickJsExpr2, ...]
const ww = Number(rest[0] || 393)
const hh = Number(rest[1] || 852)
const clickExprs = rest.slice(2)

const port = 9344
const userDataDir = `C:\\Users\\TheOne\\AppData\\Local\\Temp\\cdp-c2-${Date.now()}`

const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-sandbox',
  `--user-data-dir=${userDataDir}`, `--remote-debugging-port=${port}`,
  `--window-size=${ww},${hh}`,
  'about:blank',
], { stdio: 'ignore' })

async function getWsUrl() {
  for (let i = 0; i < 30; i++) {
    try { const r = await fetch(`http://localhost:${port}/json/version`); return (await r.json()).webSocketDebuggerUrl } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('chrome not ready')
}

let nextId = 1
function sendT(ws, sessionId, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++
    const onMsg = (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.id === id) {
        ws.off('message', onMsg)
        if (msg.error) reject(new Error(JSON.stringify(msg.error)))
        else resolve(msg.result)
      }
    }
    ws.on('message', onMsg)
    ws.send(JSON.stringify({ id, method, params, sessionId }))
  })
}

async function main() {
  const browserWsUrl = await getWsUrl()
  const ws = new WebSocket(browserWsUrl)
  await new Promise((r) => ws.once('open', r))
  // 普通 send（无 sessionId，用于 Target.* API）
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = nextId++
      const onMsg = (raw) => {
        const msg = JSON.parse(raw.toString())
        if (msg.id === id) {
          ws.off('message', onMsg)
          if (msg.error) reject(new Error(JSON.stringify(msg.error)))
          else resolve(msg.result)
        }
      }
      ws.on('message', onMsg)
      ws.send(JSON.stringify({ id, method, params }))
    })
  }
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })

  await sendT(ws, sessionId, 'Page.enable')
  await sendT(ws, sessionId, 'Runtime.enable')
  await sendT(ws, sessionId, 'Page.navigate', { url })
  await new Promise((r) => setTimeout(r, 2500))

  for (const expr of clickExprs) {
    const r = await sendT(ws, sessionId, 'Runtime.evaluate', { expression: expr, returnByValue: true })
    if (r.exceptionDetails) console.error('CLICK EXC:', JSON.stringify(r.exceptionDetails))
    else console.error('CLICK:', r.result?.value)
    await new Promise((r) => setTimeout(r, 400))
  }

  const r = await sendT(ws, sessionId, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip: { x: 0, y: 0, width: ww, height: hh, scale: 1 } })
  writeFileSync(out, Buffer.from(r.data, 'base64'))
  console.error('saved:', out, existsSync(out) ? `(${statSync(out).size} bytes)` : '')

  ws.close()
  chrome.kill()
}

main().catch((e) => { console.error('FATAL', e); chrome.kill(); process.exit(1) })

// cdp-shot.mjs — 用 CDP 控制 headless chrome 截屏：导航 + 等待 + 点击 + 截屏
// 用法：node cdp-shot.mjs <url> <out.png> [clickSelector] [waitMs]
import { spawn } from 'node:child_process'
import { writeFileSync, existsSync, mkdirSync, unlinkSync, statSync } from 'node:fs'
import { WebSocket } from 'ws'

const [, , urlArg, outArg, clickSelector, waitMsArg, wArg, hArg] = process.argv
const url = urlArg || 'http://localhost:5173/'
const out = outArg || 'shot.png'
const waitMs = Number(waitMsArg || 1500)
const ww = Number(wArg || 393)
const hh = Number(hArg || 852)

const port = 9333
const userDataDir = `C:\\Users\\TheOne\\AppData\\Local\\Temp\\cdp-cdp-${Date.now()}`
const profileDir = `C:\\Users\\TheOne\\AppData\\Local\\Temp\\cdp-cdp-profile-${Date.now()}`

// 1) 启动 chrome
const chromeArgs = [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-sandbox',
  `--user-data-dir=${userDataDir}`, `--remote-debugging-port=${port}`,
  `--window-size=${ww},${hh}`,
  'about:blank',
]
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', chromeArgs, { stdio: 'ignore', detached: false })

// 2) 拉 /json/version 拿 wsUrl
async function getWsUrl() {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`http://localhost:${port}/json/version`)
      const j = await r.json()
      return j.webSocketDebuggerUrl
    } catch { await new Promise((r) => setTimeout(r, 200)) }
  }
  throw new Error('chrome not ready')
}

let nextId = 1
function send(ws, method, params = {}) {
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

async function main() {
  const browserWsUrl = await getWsUrl()
  const ws = new WebSocket(browserWsUrl)
  await new Promise((r) => ws.once('open', r))

  // 新建一个 target（tab）
  const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send(ws, 'Target.attachToTarget', { targetId, flatten: true })

  function sendT(method, params = {}) {
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

  await sendT('Page.enable')
  await sendT('Runtime.enable')
  await sendT('Page.navigate', { url })
  // 等待 load
  await new Promise((r) => setTimeout(r, waitMs))

  if (clickSelector) {
    try {
      // 用 Runtime.evaluate 找元素并 click
      const expr = `(() => {
        const el = document.querySelector(${JSON.stringify(clickSelector)});
        if (!el) return 'no_element';
        el.scrollIntoView({block: 'center'});
        el.click();
        return 'clicked';
      })()`
      const r = await sendT('Runtime.evaluate', { expression: expr, returnByValue: true })
      console.error('click result:', r.result?.value)
      await new Promise((r) => setTimeout(r, 500))
    } catch (e) {
      console.error('click error:', e.message)
    }
  }

  const r = await sendT('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip: { x: 0, y: 0, width: ww, height: hh, scale: 1 } })
  writeFileSync(out, Buffer.from(r.data, 'base64'))
  console.error('screenshot saved:', out, existsSync(out) ? `(${statSync(out).size} bytes)` : '')

  ws.close()
  chrome.kill()
}

main().catch((e) => { console.error('FATAL', e); chrome.kill(); process.exit(1) })

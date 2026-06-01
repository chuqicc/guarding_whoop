/**
 * Electron main process.
 * Starts the Express/FFmpeg server in-process, then opens a BrowserWindow.
 */
import { app, BrowserWindow, shell } from 'electron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createServer } from 'net'

const __dirname  = dirname(fileURLToPath(import.meta.url))
const isDev      = !app.isPackaged

// Pick a free port so we never clash with whatever the user has running
function freePort () {
  return new Promise(resolve => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

let mainWindow

async function start () {
  const port = await freePort()

  // Tell server.mjs which port to use and where dist/ lives
  process.env.PORT     = String(port)
  process.env.NODE_ENV = 'production'

  // In packaged app, dist/ is placed in resources/ (extraResources).
  // In dev, it lives next to server.mjs in the project root.
  process.env.DIST_DIR = isDev
    ? join(__dirname, '..', 'dist')
    : join(process.resourcesPath, 'dist')

  // Import server — top-level awaits run, Express starts, app.listen() fires
  await import('../server.mjs')

  // Brief pause so the server socket is accepting before we navigate
  await new Promise(r => setTimeout(r, 600))

  mainWindow = new BrowserWindow({
    width:  1440,
    height: 900,
    minWidth:  900,
    minHeight: 600,
    title: 'NBA Guard Annotation',
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
    },
  })

  mainWindow.loadURL(`http://127.0.0.1:${port}`)

  // Open external links in the system browser, not in Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) mainWindow.webContents.openDevTools()

  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(start)
app.on('window-all-closed', () => app.quit())

/**
 * Electron main process.
 * Loads the built frontend directly from disk — no HTTP server involved.
 */
import { app, BrowserWindow, shell } from 'electron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const isDev     = !app.isPackaged

// In a packaged app dist/ is copied into resources/ (see build.extraResources).
// In dev it sits next to electron/ in the project root.
const DIST_DIR = isDev
  ? join(__dirname, '..', 'dist')
  : join(process.resourcesPath, 'dist')

let mainWindow

function createWindow () {
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

  mainWindow.loadFile(join(DIST_DIR, 'index.html'))

  // Open external links in the system browser, not in Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Block in-page navigation away from the bundled app
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault()
      shell.openExternal(url)
    }
  })

  if (isDev) mainWindow.webContents.openDevTools()

  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())

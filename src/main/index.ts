import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { EventStore } from './telemetry/event-store'
import { TelemetryServer } from './telemetry/telemetry-server'
import {
  getIntegrationStatus,
  installClaudeHooks,
  installCodexIntegration
} from './integrations/installers'

let mainWindow: BrowserWindow | null = null
let telemetryServer: TelemetryServer | null = null
let eventStore: EventStore | null = null

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#05070b',
    title: 'Neural Observatory',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(hookDirectory: string): void {
  ipcMain.handle('observatory:get-server-info', () => {
    if (!telemetryServer) throw new Error('Telemetry server is not running')
    return {
      baseUrl: telemetryServer.getBaseUrl(),
      websocketUrl: `${telemetryServer.getBaseUrl().replace('http', 'ws')}/ws`,
      demoRunning: telemetryServer.isDemoRunning()
    }
  })

  ipcMain.handle('observatory:get-integrations', () => {
    if (!telemetryServer) throw new Error('Telemetry server is not running')
    return getIntegrationStatus(hookDirectory, telemetryServer.getPort())
  })

  ipcMain.handle('observatory:install-claude', () => {
    if (!telemetryServer) throw new Error('Telemetry server is not running')
    return installClaudeHooks(hookDirectory, telemetryServer.getPort())
  })

  ipcMain.handle('observatory:install-codex', () => {
    if (!telemetryServer) throw new Error('Telemetry server is not running')
    return installCodexIntegration(hookDirectory, telemetryServer.getPort())
  })

  ipcMain.handle('observatory:set-demo', (_event, enabled: boolean) => {
    if (!telemetryServer) throw new Error('Telemetry server is not running')
    if (enabled) telemetryServer.startDemo()
    else telemetryServer.stopDemo()
    return telemetryServer.isDemoRunning()
  })

  ipcMain.handle('observatory:clear-history', () => {
    telemetryServer?.clear()
    return true
  })

  ipcMain.handle('observatory:open-path', async (_event, path: string) => {
    const result = await shell.openPath(path)
    return result
  })
}

app.whenReady().then(async () => {
  const userData = app.getPath('userData')
  eventStore = new EventStore(join(userData, 'neural-observatory.sqlite'))
  telemetryServer = new TelemetryServer(eventStore)
  await telemetryServer.start(4319)

  const hookDirectory = join(userData, 'hooks')
  registerIpc(hookDirectory)
  createWindow()

  // Start with a living scene. Real provider activity automatically takes visual priority.
  telemetryServer.startDemo()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  void telemetryServer?.close()
  eventStore?.close()
})

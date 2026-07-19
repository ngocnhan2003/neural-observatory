import { contextBridge, ipcRenderer } from 'electron'
import type { InstallResult, IntegrationStatus } from '../shared/events'

export interface ServerInfo {
  baseUrl: string
  websocketUrl: string
  demoRunning: boolean
}

const api = {
  getServerInfo: (): Promise<ServerInfo> => ipcRenderer.invoke('observatory:get-server-info'),
  getIntegrations: (): Promise<IntegrationStatus> => ipcRenderer.invoke('observatory:get-integrations'),
  installClaude: (): Promise<InstallResult> => ipcRenderer.invoke('observatory:install-claude'),
  installCodex: (): Promise<InstallResult> => ipcRenderer.invoke('observatory:install-codex'),
  setDemo: (enabled: boolean): Promise<boolean> => ipcRenderer.invoke('observatory:set-demo', enabled),
  clearHistory: (): Promise<boolean> => ipcRenderer.invoke('observatory:clear-history'),
  openPath: (path: string): Promise<string> => ipcRenderer.invoke('observatory:open-path', path)
}

contextBridge.exposeInMainWorld('neuralObservatory', api)

export type NeuralObservatoryApi = typeof api

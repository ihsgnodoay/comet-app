/**
 * preload：唯一允许 renderer 触碰的桥。
 * contextIsolation = true / nodeIntegration = false，
 * renderer 只能拿到下面这个白名单对象 window.comet，拿不到 require / fs / serialport。
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { CometAPI, EventChannel } from '../shared/types';

const ALLOWED_EVENTS: EventChannel[] = [
  'serial:data',
  'serial:line',
  'serial:status',
  'serial:ports',
  'serial:frame',
  'serial:stats',
  'serial:modem',
  'serial:error'
];

const api: CometAPI = {
  listPorts: () => ipcRenderer.invoke('serial:list'),
  connect: config => ipcRenderer.invoke('serial:connect', config),
  disconnect: () => ipcRenderer.invoke('serial:disconnect'),
  getStatus: () => ipcRenderer.invoke('serial:status'),
  send: payload => ipcRenderer.invoke('serial:send', payload),
  setSignals: signals => ipcRenderer.invoke('serial:signals', signals),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: patch => ipcRenderer.invoke('settings:set', patch),
  getDevices: () => ipcRenderer.invoke('devices:list'),
  saveDevices: devices => ipcRenderer.invoke('devices:save', devices),
  exportLog: (text, suggestedName) => ipcRenderer.invoke('log:export', { text, suggestedName }),
  copyText: text => ipcRenderer.invoke('clipboard:write', text),
  getSessionLog: sessionId => ipcRenderer.invoke('session:log', sessionId),
  clearSession: sessionId => ipcRenderer.invoke('session:clear', sessionId),
  newSession: name => ipcRenderer.invoke('session:new', name),
  closeSession: sessionId => ipcRenderer.invoke('session:close', sessionId),
  getActiveSession: () => ipcRenderer.invoke('session:active'),
  setActiveSession: sessionId => ipcRenderer.invoke('session:activate', sessionId),
  win: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    maximize: () => ipcRenderer.invoke('win:maximize'),
    close: () => ipcRenderer.invoke('win:close')
  },
  on(channel, callback) {
    if (!ALLOWED_EVENTS.includes(channel)) {
      throw new Error(`[comet] 未授权的事件通道: ${String(channel)}`);
    }
    const listener = (_event: IpcRendererEvent, payload: unknown): void => {
      callback(payload);
    };
    ipcRenderer.on(channel, listener);
    // 返回取消订阅函数，renderer 卸载时可清理
    return () => ipcRenderer.removeListener(channel, listener);
  }
};

contextBridge.exposeInMainWorld('comet', api);

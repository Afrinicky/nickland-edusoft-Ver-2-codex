// Nickland Edusoft — Preload / API Bridge
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// The installed application's transport. It takes the one API surface
// (electron/api-surface.js) and gives it Electron IPC to travel on, then
// hands the result to the window as `window.api` exactly as it always did.
//
// The same surface is given the network instead in a browser, by
// src/renderer/src/lib/desk.js. Nothing else differs between the two, and
// nothing about this file changed when that was added: a screen calling
// window.api.students.list() reaches the same handler either way.
const { contextBridge, ipcRenderer } = require('electron');
const { buildApi } = require('./api-surface');

const api = buildApi((channel, ...args) => ipcRenderer.invoke(channel, ...args));

contextBridge.exposeInMainWorld('api', api);

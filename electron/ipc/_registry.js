// Nickland Edusoft — the same handler, reachable from more than one place.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Every module registers its channels through ipcMain, and that is how the
// office PC's own window reaches them. A browser on the school Wi-Fi cannot
// speak Electron IPC, so the host has to be able to look a channel up by name
// and call the very same function.
//
// The temptation is to write HTTP routes beside the handlers. That is how a
// product ends up with two answers to "what does taking a payment do", and one
// of them wrong. This records the function as it is registered instead, so the
// browser cannot reach anything the window could not, and cannot reach it any
// differently.
//
// What is recorded is the handler AFTER _guard.js has wrapped it, because
// registration order is:
//
//   ipcMain  ←  this recorder  ←  guardedIpcMain  ←  the module
//
// so the permission and scope policy is inside what gets stored. There is no
// path to an unguarded handler from here.
//
// What is deliberately NOT recorded: anything registered straight onto the
// real ipcMain. electron/main.js keeps the app:* channels there — the file
// dialogs, the folder opener, the PDF printer — so they are unreachable from
// a browser by construction rather than by a list somebody has to maintain.

const handlers = new Map();

// Wraps ipcMain so that everything registered through it is also remembered.
// Anything else a module reaches for passes straight through untouched.
function recordingIpcMain(ipcMain) {
  return {
    handle(channel, handler) {
      // ipcMain FIRST, and only remember it if that succeeded.
      //
      // Electron refuses a second handler for a channel by throwing, and
      // _stubs.js relies on exactly that: it registers a stand-in for every
      // channel and lets the throw skip the ones a real module already took.
      // Remembering before calling meant the registry kept the STUB while the
      // window kept the real handler — so a browser would have been answered
      // "not yet implemented" by a feature that works perfectly on the office
      // PC, and nothing anywhere would have said why.
      const result = ipcMain.handle(channel, handler);
      handlers.set(channel, handler);
      return result;
    },
    removeHandler(channel) {
      handlers.delete(channel);
      return ipcMain.removeHandler(channel);
    },
    on: (...a) => ipcMain.on(...a),
    once: (...a) => ipcMain.once(...a),
    removeAllListeners: (...a) => ipcMain.removeAllListeners(...a),
  };
}

function handlerFor(channel) {
  return handlers.get(channel) || null;
}

function hasChannel(channel) {
  return handlers.has(channel);
}

function channels() {
  return [...handlers.keys()].sort();
}

// A stand-in for the IpcMainInvokeEvent a handler is passed as its first
// argument. Every handler in this application names it `_e` and none of them
// read it — checked, not assumed — but passing something identifiable beats
// passing undefined if that ever stops being true.
const DESK_EVENT = Object.freeze({ desk: true, sender: null });

// Call a channel by name, the way the window would. Throws if there is no such
// channel, which the caller turns into a 404 rather than a silent null.
function callChannel(channel, args = []) {
  const handler = handlers.get(channel);
  if (!handler) {
    const err = new Error(`No such channel: ${channel}`);
    err.code = 'NO_SUCH_CHANNEL';
    throw err;
  }
  return handler(DESK_EVENT, ...args);
}

// Testing seam: a test can register channels without an Electron ipcMain.
function _resetForTests() { handlers.clear(); }

module.exports = { recordingIpcMain, handlerFor, hasChannel, channels, callChannel, _resetForTests };

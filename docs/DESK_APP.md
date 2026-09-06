# The office application — installed, on the network, and hosted

**Nickland Edusoft · Copyright © 2026 Nickland Sales**

The application a school's office runs, in three places, from one source. Not
three applications that resemble each other: the same 94 screens, the same 399
calls, answered by the same handlers.

---

## 1. What changed, and what did not

The installed application is unchanged. It opens its own database, registers
its own handlers, and its window talks to them over Electron IPC exactly as it
always has. Somebody who only ever uses the office PC would not be able to tell
that any of this happened.

What was added is a second way for a call to arrive.

```
                   ONE list of channels
             electron/api-surface.js — 399 of them
                            │
             ┌──────────────┴───────────────┐
             │                              │
        preload.js                  src/renderer/src/lib/desk.js
     ipcRenderer.invoke                POST to a host
             │                              │
             ▼                              ▼
   the office PC's own window     a browser, anywhere
             │                              │
             └──────────────┬───────────────┘
                            ▼
             the same handler, in the same process
```

The important word is **one**. The mobile app is a different application for
different people and it is built against its own API; trying to make it look
like the office application was work with no end, because it was never the same
thing. This is the same thing.

---

## 2. Where it runs

| | Who opens it | What it needs |
|---|---|---|
| **The installed application** | The office PC | Nothing. It is the school's records. |
| **A browser on the school network** | Any machine on the school Wi-Fi — the bursar's laptop, the head's PC, a tablet in the staffroom | The office PC switched on, with its server running |
| **The installer as a client** | Another office PC, as a real desktop window | The same |
| **Hosted** | The internet, with the school's computer switched off | A deployment, and a Postgres school |

The mobile app is untouched by all of this. It is still at `/`, still what
parents and teachers open on a phone. The office application is at `/desk`,
because two audiences at one address is one address meaning two things.

---

## 3. On the school network

On the office PC, **Settings → Mobile App → Start server**. It shows the
addresses the school's own machine answers on.

Then, on any other machine on the same Wi-Fi:

```
http://192.168.1.20:4747/desk
```

That is the whole of it. Nothing is installed, and nothing needs the internet —
the office PC is the source of truth and the school's connection is not
dependable.

### The installer as a client

For a machine that should have a real application window rather than a browser
tab, install the same `.exe` and set one variable:

```
EDUSOFT_HOST_URL=http://192.168.1.20:4747
```

It then opens no database, starts no server, and loads the office application
**from the host** — so a client is never a version behind: upgrade the host and
every desk in the school is upgraded with it.

With the variable unset, which is every install that exists today, none of this
runs and the application behaves exactly as before.

---

## 4. Hosted

```bash
node scripts/build-desk.mjs --only-build --base /
```

Deployed as a second Vercel project — see `deploy/vercel-desk.json`, which
carries its own instructions — pointed at the Python service with
`VITE_DESK_HOST`.

**Not everything works online yet, and the application says so.** The hosted
service answers the channels the Python port has reached; the rest answer with
a sentence naming the part of the school and pointing at the office PC, rather
than failing silently. What is where is counted in
[`DESK_COVERAGE.md`](DESK_COVERAGE.md), which is generated:

```bash
node scripts/desk-coverage.mjs          # write it
node scripts/desk-coverage.mjs --check  # fail if it is stale (CI does this)
```

---

## 5. What a browser cannot do, and what happens instead

| On the office PC | In a browser |
|---|---|
| Choose a file with a dialog | A file input. The bytes are sent, the host writes them to a scratch folder, and the handler is given a real path — which is what it already expects. |
| A report is written to disk and opened | The host answers with its path as always; the bytes come back beside it, and the browser opens them. Nothing is reachable from an address alone. |
| A photograph is read from disk | It travels as bytes, exactly as it already does for the phone app. A child's face is never a URL. |
| Save to a chosen folder | The browser downloads it. |
| Print to PDF | The browser's own print dialog. |
| Open a folder, restore a backup, open the logs | Refused, with a sentence saying it happens at the school's own computer. Not hidden — located. |

---

## 6. What stops this being a way round the rules

Nothing in the network path decides what anybody may do.

The handler it reaches was wrapped by `electron/ipc/_guard.js` **at
registration**, so the permission and scope policy in `_policy.js` applies
exactly as it does to the office PC's own window — the same check, on the same
resolved permissions, against the live account. A browser cannot reach anything
the installed application would refuse, and a channel added next month is
covered without anybody remembering to cover it.

The file dialogs and the PDF printer are registered straight onto Electron's
`ipcMain`, which the channel registry does not record, so they are unreachable
from a browser **by construction** rather than by a list somebody maintains.

Three things the network adds, because a network is not a locked office:

* **The caller is carried per request.** The signed-in user used to be one
  variable in the main process — correct for one machine in one office, and
  wrong the moment the host answers a network: a bursar's request would be
  attributed to whoever signed in last, and so would every audit row it wrote.
* **Staff only.** A parent's token is refused outright. Parents have their own
  app; this is the school's office.
* **A short list of channels that only mean something on the host machine**,
  refused with an explanation rather than half-working.

---

## 7. Building it

```bash
npm run build:desk     # the browser build (dist-desk, and the copies servers read)
npm run serve:desk     # look at one before it ships
npm run desk:coverage  # regenerate DESK_COVERAGE.md
```

`npm run build:win` builds it as part of the installer, so a school's own
computer serves it with nothing extra to do.

---

## 8. Tested

| | |
|---|---|
| `test/desk_surface.js` | One list of channels, and it stays one. The preload script names exactly one channel — the one it is handed — and the browser transport names only the handful it answers itself. |
| `test/desk_api.js` | Two people working at once are two identities; the same rules, not a second set; a parent is refused; the office PC's own work stays there; a file cannot climb out of the folder it is written to; a document is fetched only by the account it was made for. |
| `test/webapp.js` | `/desk` is the office application and `/` is still the parents' app — the fault worth catching is `/desk` quietly returning the mobile app, because its single-page fallback answers every path with no file. |
| `cloud-python/tests/test_desk.py` | The hosted contract: the same shapes, the same refusals, and the two different answers a screen can be given for a channel that is not there. |
| `scripts/desk-coverage.mjs --check` | The coverage document is not stale, and the hosted map names no channel the application does not have. |

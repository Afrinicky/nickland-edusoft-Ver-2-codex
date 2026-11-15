# Nickland EduSoft — web platform security assessment

**Assessed against:** [GoogleChrome/modern-web-guidance](https://github.com/GoogleChrome/modern-web-guidance)
(209 guides; the 17 in `security/` and `privacy/` read in full, plus `pwa/`)
**Date:** 2026-11-15 · **Scope:** every surface EduSoft hands to a browser

EduSoft presents four of them, and they are not equally exposed:

| Surface | Served by | Reaches |
|---|---|---|
| Parents'/teachers' app (Expo) | `electron/server/webapp.js` at `/`; Vercel; `host/server.js` | LAN **and** the internet |
| Office application (`/desk`) | `webapp.js`; `host/server.js` | LAN **and** the internet |
| Office application (Electron) | `src/renderer/index.html` | the office PC, holding `window.api` |
| Public site / Superadmin console / parent portal | `cloud-python` | the internet |

---

## 1. The finding that mattered

**A stored cross-site scripting hole in the document generators, reachable by a
secretary and landing in three privileged places.**

`electron/ipc/reports.js` escaped its table cells and took everything else
straight into markup — 124 of its interpolations, including every pupil's name,
the school's own letterhead, and the term labels. `receipts_engine.js`,
`students_attendance.js` and `timetable.js` had the same gap for the same reason.

The documents those functions build are then rendered by:

1. **The Electron renderer.** `src/renderer/src/pages/Scores/Report.jsx` hands the
   string to `dangerouslySetInnerHTML`, in the window that holds `window.api` —
   the whole IPC surface, as whoever is signed in.
2. **A browser, same-origin.** `mobile/src/print.js` did `doc.write(html)` into an
   **unsandboxed** iframe, on a page whose `localStorage` holds a bearer token
   good for up to thirty days. Its fallback opened the same HTML as a `blob:` URL,
   which inherits the page's origin, with `window.opener` intact.
3. **The internet.** `sync/outbox.js` projects the finished report-card HTML to the
   cloud, which serves it to parents.

So: anybody holding `students:create` admits a pupil named
`<img src=x onerror=…>`; a head teacher later opens that report card; the script
runs with the head teacher's permissions. Or a parent taps "Print report" and the
script reads their token out of `localStorage`.

The renderer's own CSP did not stop it, because it carried
`script-src 'self' 'unsafe-inline'` — and `'unsafe-inline'` is exactly the
permission an injected `<script>` needs. Both builds emit a single external module
script and **zero** inline script blocks, so that token bought nothing and cost
everything.

**Proven before fixing.** `test/document_escaping.js` plants four payload shapes —
a tag that executes on load, an attribute break-out, a stylesheet break-out and an
ampersand — in every field a school can type into, renders each document, and
requires that nothing executable comes back. Against the old code it failed on all
four counts.

### What was changed

| Fix | Where | Effect |
|---|---|---|
| Escape at the data boundary | new `electron/ipc/_html.js`; `getSchoolHeader`, `reportCardHtml`, `billIdentityHtml`, `billHtml`, `studentProfileDocument` | The bug itself |
| `script-src 'self'` — dropped `'unsafe-inline'` | `src/renderer/index.html`, `desk.html` | Injected inline script cannot run in the Electron app or `/desk` at all |
| Documents declare `script-src 'none'` | all 19 generated documents | Inert wherever rendered — iframe, blob tab, `printToPDF`, cloud |
| Sandbox the print iframe | `mobile/src/print.js` | `allow-same-origin allow-modals`, **no** `allow-scripts` |
| `noopener` on the blob tab | `mobile/src/print.js` | Severs `window.opener` |

Two details worth stating, because getting either wrong would have been its own bug:

- **Colours are validated, not escaped.** `header.primaryColor` lands inside a
  `style` attribute. `escapeHtml` is the wrong tool there — `red;}</style><script>`
  needs `}` to close the rule, not `<` to open a tag. `cssColor()` validates
  against the colour grammar and substitutes the default for anything else.
  `imageDataUri()` does the same for the crest, and refuses SVG, which can carry
  script.
- **Escaped once, never twice.** The rule adopted is *the function that builds the
  markup escapes its own inputs*, so a row escaped by both a loader and a builder
  cannot render "Brown &amp;amp; Sons" on every report card. There is a test for
  that property, not just for the absence of script.

---

## 2. Surface-by-surface, against the guidance

`security.md` Phase 1 and Phase 3 ("companion policies"), applied.

| Guidance | Before | Now |
|---|---|---|
| **§1.1 Secure contexts / HSTS** | cloud: yes. LAN: plain HTTP | unchanged — see §4 |
| **§1.2 Dangerous DOM sinks** | **XSS in the generators** | fixed; §1 |
| **§1.3 Secure cookies** | n/a — no cookies anywhere; auth is a bearer token | n/a |
| **§1.4 Clickjacking** | cloud: `DENY` + `frame-ancestors`. **LAN: nothing** | both, on every response |
| **§1.5 `postMessage`** | not used — EduSoft's `postMessage` is parent↔school messaging, not `window.postMessage` | n/a |
| **§3.2 CSP** | renderer had `'unsafe-inline'`; LAN had no CSP | `script-src 'self'`; LAN sends the non-script directives |
| **§3.3 Trusted Types** | not deployed | still not — §3 |
| **§3.4 COOP** | cloud only | LAN too, `same-origin` |
| **§3.5 CORP** | nowhere | `same-site` on the LAN JSON API |
| **§3.6 Cross-origin isolation** | not needed (no `SharedArrayBuffer` in any browser surface) | correctly skipped |
| **§3.7 Fetch Metadata** | not deployed | §3 |
| **X-Content-Type-Options** | HTML and downloads only — **not the JSON API** | everywhere |
| **Referrer-Policy** | cloud only | LAN too |
| **Permissions-Policy** | cloud only | LAN too — `camera=(), microphone=(), geolocation=(), payment=(), usb=()` |
| **SRI** | only Google Fonts stylesheets | correctly absent — the guidance says **DO NOT** use SRI on mutable assets, and a Fonts CSS URL is mutable |
| **CORS** | `Access-Control-Allow-Origin: *` on the LAN API | unchanged — §4 |
| **Clear-Site-Data on logout** | missing | sent on `/auth/logout` |

### Local Network Access — checked, and **not** a problem

`security/local-network-access.md` describes Chrome 145's permission gate on
requests crossing from a less private address space into a more private one. It
looked like an existential risk to the whole 4747 model; it is not, and the reason
is worth recording so nobody re-panics:

> enforcing checks **only** when a request crosses from a *less private* address
> space into a *more private* address space

A browser on the school Wi-Fi loads the page **from** `192.168.x.x:4747`. The page
is therefore itself in the `local` space, and its API calls are same-origin
`local` → `local`. Nothing crosses. **The LAN model is unaffected**, and no change
was made for it.

What the guide does unlock is a capability EduSoft currently documents as
impossible. `webapp.js` says a hosted HTTPS page "cannot call a plain-HTTP LAN
address at all". With `targetAddressSpace: 'local'` plus the `local-network`
permission, it can — so the hosted portal could reach a school's own desktop. That
is a feature, not a fix, and it is Chrome/Edge 145+ only; recorded in §3 rather
than built.

---

## 3. Gaps deliberately left, with reasons

**G1 — No `script-src` for the parents' app.** The office application declares its
own (`script-src 'self'`); the Expo bundle ships none, and there is no built copy
in this environment to prove it has no inline bootstrap. Asserting a policy I
cannot verify risks a blank page in every parent's browser for a protection I
guessed at. The server sends the non-script directives meanwhile. **To close:**
build `mobile/dist-web`, check for inline script blocks, then add `script-src` (or
hashes) to `DOCUMENT_SECURITY_HEADERS` in `webapp.js`.

**G2 — Trusted Types not deployed.** It would require routing the remaining
`innerHTML` writes in `cloud-python/site/app.js` and `console/console.js` through a
policy. Those sites escape at every call site today (checked: `el({html})` callers
use `escapeHtml`, the parent portal uses `esc` on every string field), so this is
defence-in-depth rather than a live hole.

**G3 — Fetch Metadata resource isolation.** Needs the cross-site integration map
the guidance asks for first (`§2.1`): the payment webhooks are genuinely cross-site
and would break if this were enforced carelessly.

**G4 — Reporting endpoints.** No `Reporting-Endpoints`/`report-to` anywhere, so CSP
regressions are invisible. Worth adding before tightening CSP further, per Phase 2.

**G5 — Google Fonts from the internet** in the Electron renderer. Not a security
hole, but it leaks every school's IP to a third party on launch and blocks on a
network EduSoft is explicitly built to work without. Self-hosting the six families
would fix both.

**G6 — LNA opportunity** (§2). Hosted portal → school desktop, Chrome 145+.

---

## 4. Carried over from the earlier audit, still open by decision

- **S4 — the LAN is plain HTTP**, and `electron/main.js` loads remote code from it
  in thin-client mode. Optional HTTPS on 4747 with fingerprint pinning was deferred
  (O4) because it changes first-run behaviour for every existing install.
- **S7 — `Access-Control-Allow-Origin: *`** on the LAN API. Not a CSRF hole (bearer
  auth, no cookies, `allow-credentials` unset), and narrowing it would break the
  documented cross-origin client cases. Left with CORP added alongside.

---

## 5. Verification

- `test/document_escaping.js` — **26 assertions**, new. Payloads in every
  school-typed field, across the report card, the pupil profile and the bills;
  single-escape property; the colour and crest grammars; and that each document
  declares `script-src 'none'` **inside `<head>`**, where a meta CSP is honoured.
- `test/webapp.js` — **+12 assertions**: the full header set asserted on the
  parents' app and the office app, because a header set that is on some responses
  and not others is the gap it was meant to close.
- `test/desk_api.js` — **+1**: 120 consecutive RPC calls are all answered. The RPC
  limiter added here was first wired to the **sign-in** limiter (20/minute) — which
  would have broken the office application on its first screen. It has its own
  budget of 600/minute per account, and this test is what makes that regression
  impossible to reintroduce quietly.

**32 Node suites, 1964 assertions, 0 failures** (both Neon suites running).
**12 Python suites, 900 assertions, 0 failures** against Postgres 16.

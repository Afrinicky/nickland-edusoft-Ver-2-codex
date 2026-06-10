# Nickland Edusoft v2.0.0
### School Management System for Ghanaian Schools
**Copyright © 2026 Nickland Sales. All rights reserved.**

---

## About
Nickland Edusoft is a professional school management system designed for Ghanaian pre-tertiary schools (Nursery through JHS). Built with Electron + React + SQLite for offline-first operation on Windows PCs.

**Vendor:** Nickland Sales
**Developer:** Nicholas
**Version:** 2.0.0

---

## 🚀 Building the Windows Installer

There are **two ways** to build the `.exe`:

### Option A: Let GitHub build it for you (recommended — no Windows machine needed)

GitHub Actions has a free Windows build server that will compile the `.exe` in the cloud. Push the code to a GitHub repo and the installer is built automatically.

**Step-by-step:**

1. **Create a GitHub account** at https://github.com (free).

2. **Create a new repository.** On GitHub, click the **+** in the top-right → **New repository**. Name it (e.g., `nickland-edusoft`). You can make it **private** if you want — GitHub Actions still works on private repos with 2,000 free minutes/month, which is more than enough.

3. **Upload the code.** The easiest way without Git knowledge:
   - On the new repo page, click **"uploading an existing file"**.
   - Drag and drop the entire contents of this folder (everything except `node_modules/` and `dist-app/` — those are already excluded by `.gitignore`).
   - Add a commit message like "Initial upload" and click **Commit changes**.

4. **Watch the build run.** As soon as you push, GitHub starts building. Click the **Actions** tab in your repo. You'll see a workflow called **Build Windows Installer** running. It takes about 5–10 minutes.

5. **Download the .exe.** When the build finishes (green checkmark):
   - Click on the completed workflow run.
   - Scroll to the bottom — under **Artifacts** you'll see **nickland-edusoft-windows**.
   - Click it to download a ZIP containing the installer (`Nickland-Edusoft-Setup-2.0.0.exe`).

6. **(Optional) Create a tagged release.** If you want a permanent download link instead of an artifact that expires after 30 days:
   - On your repo page, click **Releases** → **Create a new release**.
   - In the **Tag** field, type `v2.0.0` and click **Create new tag: v2.0.0 on publish**.
   - Click **Publish release**.
   - GitHub Actions runs again, and this time it attaches the `.exe` permanently to the release. Anyone can download it from the Releases page forever.

**Building updated versions later:** Just upload your new code to the same repo. The build runs automatically every push. If you change `"version": "2.0.0"` in `package.json` to `"2.0.1"` and tag the release `v2.0.1`, GitHub will publish a versioned release.

### Option B: Build locally on Windows

If you have a Windows PC:

```bash
# 1. Install Node.js 20 from https://nodejs.org
# 2. Install dependencies
npm install

# 3. Rebuild native modules for Electron
npm run rebuild

# 4. Build the installer
npm run build:win

# The .exe appears in dist-app/
```

You'll need Python and Visual Studio Build Tools installed; Node.js usually prompts for these.

---

## Quick Start (Development)

```bash
# Install dependencies
npm install

# Rebuild native modules
npm run rebuild

# Run in development mode (hot reload)
npm run dev
```

## Tech Stack
| Layer | Technology |
|---|---|
| Desktop framework | Electron 32 |
| UI | React 18 + Vite 5 |
| Database | SQLite (better-sqlite3) |
| Auth | bcryptjs (local hash) |
| PDF | Electron printToPDF |
| Excel | ExcelJS |
| Word export | docx + docxtemplater |
| Packaging | electron-builder (NSIS) |
| CI | GitHub Actions |

## First Run
On first launch the app shows a one-time **Create Administrator Account** screen. Fill in the admin name, username, and password. After that, the standard login screen appears on every launch. Create accounts for all other staff in **Settings → Users & Access**.

## Project Structure
```
nickland-edusoft/
├── .github/workflows/   # GitHub Actions — Windows build automation
├── electron/            # Electron main process
│   ├── main.js          # App entry point
│   ├── preload.js       # IPC bridge to renderer
│   ├── db/              # SQLite schema + migrations
│   └── ipc/             # Per-module IPC handlers
├── src/renderer/        # React UI (Vite)
│   └── src/
│       ├── pages/       # Top-level pages (Students, Fees, Finance, etc.)
│       ├── components/  # Shared UI components
│       ├── store/       # Zustand global state
│       ├── lib/         # Helpers (formatting, etc.)
│       └── styles/      # Global CSS
├── resources/           # App icon + initial data files
├── package.json         # Dependencies + electron-builder config
└── vite.config.js       # Vite build config
```

## License
Proprietary software. See LICENSE.txt for full terms.
© 2026 Nickland Sales. Unauthorized copying, distribution, or modification is prohibited.

# How to Build the Windows .exe Using GitHub

This guide gets you from "zip file on your computer" to "downloadable .exe installer" without needing a Windows machine, a build server, or any developer tools.

**Total time:** 15–20 minutes the first time, 30 seconds for every rebuild after.
**Cost:** Free.

---

## Step 1 — Create a GitHub account

Go to https://github.com → click **Sign up** (top right).

- Pick a username (this becomes part of your repo URL).
- Use your real email.
- The free plan is all you need.

---

## Step 2 — Create a new repository

Once signed in, click the green **New** button (or the **+** menu → **New repository**) at https://github.com/new.

Fill in:

| Field | Value |
|---|---|
| **Repository name** | `nickland-edusoft` |
| **Description** | (optional) "School management system" |
| **Public / Private** | Choose **Private** if you don't want others to see the code. Either works. |
| **Initialize this repository with** | Leave all three checkboxes UNCHECKED. |

Click **Create repository**.

---

## Step 3 — Upload your code

You're now on a page that looks like a setup wizard. Look for the link that says:

> **uploading an existing file**

It's near the middle, in a sentence like: *"…or push an existing repository from the command line, or [import code from another repository], or [uploading an existing file]"*.

Click **uploading an existing file**.

### What to upload

Open your `nickland-edusoft` folder (the unzipped one). You should see:

```
nickland-edusoft/
├── .github/
├── electron/
├── resources/
├── src/
├── .gitignore
├── LICENSE.txt
├── package.json
├── README.md
└── vite.config.js
```

**Select ALL of these files and folders and drag them into the GitHub upload area.**

Things to know:
- The drag-and-drop area accepts entire folders.
- If your browser doesn't preserve folder structure on drag-drop (Safari sometimes doesn't), use Chrome or Firefox, or use the **"choose your files"** link instead and select everything.
- Do NOT include `node_modules/` or `dist-app/` if they exist — they're already excluded.
- Upload may take 1–3 minutes depending on your internet speed.

At the bottom, in the **Commit changes** box:
- **Commit message:** type `Initial upload`
- Leave "Commit directly to the main branch" selected.
- Click **Commit changes**.

---

## Step 4 — Watch the build run

The moment you click Commit, GitHub Actions starts building. To watch:

1. Click the **Actions** tab near the top of your repo page.
2. You'll see a workflow run called **Build Windows Installer** with a yellow spinner (running) or a green check (done).
3. Click on it to see live progress.

The workflow has 6 steps. Each takes between 30 seconds and 5 minutes. Total: **about 8–12 minutes** the first time.

If any step turns red ❌, click on it to see the error message. The most common first-time issues:

| Error message contains | What to do |
|---|---|
| `Cannot find module` | A file didn't upload. Re-upload from Step 3. |
| `electron-rebuild failed` | Re-run the workflow (Actions tab → Run workflow). Native modules sometimes fail once, succeed second try. |
| `EACCES` or `permission denied` | Re-run the workflow. Transient GitHub Actions issue. |
| `if-no-files-found: error` | Earlier step failed. Read the logs for the real error above this one. |

If it stays red, copy the error message and ask for help.

---

## Step 5 — Download your .exe

When the run finishes with a green check:

1. You're on the workflow run page.
2. Scroll all the way to the bottom.
3. Under **Artifacts**, you'll see a box labeled **nickland-edusoft-windows**.
4. Click it. A ZIP file downloads.
5. Unzip it. Inside is `Nickland-Edusoft-Setup-2.0.0.exe`.

**This .exe is the installer.** Give it to anyone running Windows 10 or 11 — they double-click it and the app installs.

---

## Step 6 (optional) — Create a permanent download link

Artifacts expire after 30 days. If you want a permanent link to share, create a **Release**:

1. On your repo page, click the **Releases** link (right sidebar, under "About").
2. Click **Create a new release**.
3. In the **Choose a tag** field, type `v2.0.0`.
4. A dropdown appears — click **Create new tag: v2.0.0 on publish**.
5. Set the title to `Nickland Edusoft v2.0.0`.
6. Optionally add release notes (e.g., "First release").
7. Click **Publish release**.

GitHub Actions automatically runs again (because of the tag), and when it finishes, the `.exe` is attached to the release. The download link is permanent.

The release URL looks like: `https://github.com/YOUR_USERNAME/nickland-edusoft/releases/tag/v2.0.0`

You can share this link with anyone, including schools you sell the software to.

---

## Building a new version later

After making changes:

1. Update the version in `package.json` (e.g., `"version": "2.0.1"`).
2. Upload your changed files to the repo (same drag-and-drop as Step 3, but it'll ask if you want to replace).
3. GitHub Actions builds automatically.
4. Optionally tag a new release as `v2.0.1`.

---

## Frequently asked questions

**Q: Will GitHub Actions cost money?**
A: For public repos: completely free, unlimited. For private repos: 2,000 free minutes/month — each Windows build uses about 10 minutes, so you get ~200 free builds/month. Most people never hit this.

**Q: Do I need to know Git or the command line?**
A: No. Everything in this guide uses the GitHub website.

**Q: Can I keep my code private?**
A: Yes. Choose **Private** when creating the repo (Step 2). GitHub Actions still works.

**Q: How do I update my code without re-uploading everything?**
A: On the file you want to change, click it on GitHub, then click the pencil icon to edit in the browser. Or, install GitHub Desktop (https://desktop.github.com) for a friendlier upload experience.

**Q: My antivirus flags the .exe.**
A: This is normal for unsigned Electron apps. Code-signing certificates cost $300–500/year. For internal school use, click "Run anyway". For wider distribution, buy a code-signing certificate and add it to the workflow.

**Q: Can I also build for Mac or Linux?**
A: Yes. The workflow currently builds Windows only. Adding `macos-latest` and `ubuntu-latest` to the build matrix is one extra block. Ask if you need this.

---

## What the workflow actually does

For the curious — here's what happens when you push code:

1. GitHub spins up a fresh Windows Server VM (no cost to you).
2. Checks out your code.
3. Installs Node.js 20.
4. Installs Python 3.11 (needed by `better-sqlite3` to compile its native bindings).
5. Runs `npm install` — downloads all dependencies (electron, react, etc.) — about 3 minutes.
6. Runs `electron-rebuild` to compile native modules against Electron's Node version.
7. Runs `vite build` to bundle the React UI.
8. Runs `electron-builder --win` to package everything into an NSIS installer.
9. Uploads the `.exe` as a downloadable artifact.
10. If you tagged a release, also publishes the `.exe` to the Releases page.

The whole process is defined in `.github/workflows/build-windows.yml`. You can read it — it's commented.

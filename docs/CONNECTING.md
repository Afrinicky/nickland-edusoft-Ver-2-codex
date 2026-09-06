# Connecting other computers, phones, and the internet

**Nickland Edusoft · Copyright © 2026 Nickland Sales**

Everything the school has lives on **one computer** — the office PC. This is how
everybody else reaches it: the bursar's laptop in the next room, a teacher's
phone on the school Wi-Fi, and, if the school wants it, the internet.

---

## Part 1 — Other computers on the school network

The office PC serves the whole office application to any other computer on the
same network. Nothing is installed on those computers, and nothing about the
school's records leaves the office PC.

### On the office PC (once)

1. Open **Settings → Mobile & Computers**.
2. Press **Start server**.
3. Set **Reachable from** to **Local network (LAN)**.
   If it says *This computer only*, nothing else can reach it — the screen says
   so in yellow when that is the case.
4. Windows will ask whether to allow Nickland Edusoft on the network. Say
   **yes**, and make sure **Private networks** is ticked.
5. The screen now shows the addresses, under **🖥️ Other computers**:

   ```
   http://192.168.1.20:4747/desk
   ```

   The numbers will be different on your school's network. There is a **Copy**
   button beside each one.

### On the other computer

Open Chrome or Edge and go to that address. That is all. Sign in with the same
username and password that person uses at the office PC — the same account, the
same permissions, the same everything.

Several people can work at once. Each is their own person to the system: their
own permissions, and their own name on everything they do.

### If you would rather it opened as an application than a browser tab

Install Nickland Edusoft on the other computer as normal, then tell it which
computer holds the school:

1. Press **Start**, type `environment variables`, open
   **Edit the system environment variables**.
2. **Environment Variables… → New…** (under *User variables*).
3. Variable name: `EDUSOFT_HOST_URL`
   Variable value: `http://192.168.1.20:4747`  *(your office PC's address)*
4. **OK**, then start Nickland Edusoft.

It now opens the office PC's school instead of a database of its own — no
second copy of the records, and nothing to keep in step. Upgrade the office PC
and every desk in the school is upgraded with it.

To turn a computer back into a standalone one, delete that variable.

### When a computer cannot connect

Almost always one of these, in this order:

| What you see | What it is |
|---|---|
| The page never loads | Windows Firewall on the **office PC**. Allow Nickland Edusoft on private networks, or add an inbound rule for port 4747. |
| "This site can't be reached" | The office PC is switched off, asleep, or the server is stopped. |
| It worked yesterday, not today | The office PC's address changed. Router-assigned addresses move; ask whoever manages the network for a **fixed (static) address** for the office PC. |
| Connects but says "This computer only" | **Reachable from** is set wrongly — see step 3 above. |

---

## Part 2 — Phones and tablets

Same server, same screen, different address — the one **without** `/desk`:

```
http://192.168.1.20:4747
```

That is the parents' and teachers' app. Parents see only their own children;
teachers get their own classes. It opens in the phone's browser with nothing to
install, or the Android app can be pointed at the same address.

Nothing about this changed when the office application was added. Any address a
parent already has still works.

---

## Part 3 — Over the internet

Two ways, and they are genuinely different. Read both before choosing.

### Option A — Publish the office PC (simplest, and the school stays the source of truth)

The office PC keeps everything; you just make it reachable from outside the
building. Best when the school has one site and a decent connection.

Use a tunnel rather than opening a port on the school's router — a tunnel needs
no fixed address, no router configuration, and gives you HTTPS:

```bash
# On the office PC, once:
cloudflared tunnel --url http://localhost:4747
```

It prints an address like `https://something.trycloudflare.com`. Staff open
that address with `/desk` on the end, from anywhere.

* **The school's records never move.** They stay on the office PC.
* **Everything works** — all 399 parts of the application, exactly as on the LAN.
* **The office PC must be on.** Switch it off and the address stops answering.
* Anyone with the address can reach the sign-in screen, so use strong passwords
  and turn the tunnel off when it is not wanted. A permanent, named tunnel with
  an account is better than the quick one above for anything long-term.

### Option B — The hosted service (works with the office PC switched off)

A copy of the school lives in the cloud, in Postgres, and the office
application is served from the internet against it.

**Be clear about what this gives you today: about a quarter of the application.**
[`DESK_COVERAGE.md`](DESK_COVERAGE.md) lists exactly which parts, module by
module. Anything not yet carried over says so on screen and points at the office
PC — it does not fail silently. The rest is a continuing piece of work.

What it takes:

1. **A Postgres database.** [Neon](https://neon.tech) has a free tier that is
   enough to start.

2. **Deploy the service** (`cloud-python/`) to Render, Fly or similar, with:

   ```
   DATABASE_URL=postgresql://…      your Neon connection string
   PORTAL_SECRET=…                  openssl rand -hex 32
   ```

3. **Create the school and its tables:**

   ```bash
   node scripts/schema-to-postgres.mjs          # regenerate the schema
   cd cloud-python
   python3 -c "from app.school import db; db.provision('your-school-id')"
   ```

4. **Deploy the office application** as a *second* Vercel project on this same
   repository — the first one serves the parents' app and must be left alone:

   * New Vercel project → this repository.
   * **Settings → General → Configuration File**: `deploy/vercel-desk.json`
   * **Settings → Environment Variables**:
     `VITE_DESK_HOST` = the address of the service from step 2.

   Staff open the Vercel address and pick their school on first use.

5. **Keep the two in step.** The office PC syncs to the cloud —
   [`CLOUD_SYNC.md`](CLOUD_SYNC.md) covers that. Set it up before anybody
   relies on the online copy, or the two will drift.

### Which to choose

| | Option A — publish the office PC | Option B — hosted |
|---|---|---|
| How much of the application works | All of it | About a quarter, and growing |
| With the office PC off | Nothing | The parts that are carried over |
| Setup | One command | A database, two deployments, and sync |
| Where the records are | Only on the office PC | Both places |
| Cost | Free | Free tiers to start |

**For most schools, Option A is the right answer** — it is one command, it is
everything, and the school keeps its own records. Option B earns its keep when
staff genuinely need to work while the office is shut.

---

## What is safe about all of this

* Whoever signs in gets exactly what their role allows — the same check the
  office PC makes, on the same permissions. A browser cannot reach anything the
  installed application would refuse.
* Two people working at once are two people. Everything either does is recorded
  under their own name.
* Photographs of children travel as pictures inside the page, never as an
  address anybody could paste into a browser.
* Backups, restoring, and opening folders stay on the office PC. Other machines
  are told where those live rather than being given a half-working version.
* Parents cannot open the office application at all. They have their own app.

---

## Appendix — Option B, revisited

Part 3 offered two ways onto the internet. There is now a third, and it is
better than either: **run the installed application's own code on a server**.

```bash
EDUSOFT_DATA_DIR=/data npm run host
```

That is the whole application — the same 22,000 lines of handlers the office PC
runs, mounted from the same list, answering the same channels through the same
permission rules. Not a port of it. It answers **374 of 399 channels**, which is
everything except the actions that only mean something on a machine somebody is
sitting at, and it cannot drift from the office PC because there is nothing for
it to drift from.

What a server needs that a desktop supplies for free:

| | |
|---|---|
| **A persistent disk** | `EDUSOFT_DATA_DIR` must survive a restart. A container's own filesystem does not. |
| **A headless browser** | For report cards, receipts and payslips. `npm install puppeteer` is the simplest. |
| **`sharp`** | Only if photographs are attached online. `npm install sharp`. |
| **`EDUSOFT_SECRET_KEY`** | 32+ characters. Without it, backup destination passwords are stored in the clear and the log says so. |

**On a server it uses Postgres, not SQLite.** Set `DATABASE_URL` and the same
handlers reach a Neon database instead of a local file — see
[`WEB_DEPLOYMENT.md`](WEB_DEPLOYMENT.md) for Neon, Render and Vercel. Leave it
unset and this is the LAN host, on the same local file as always.

**It is not yet joined to the office PC.** Both hold a complete school, and
nothing yet carries changes between them — so today this is a second school,
not the same school in two places. Two-way replication is a later phase; until
it lands, use one or the other for real work, not both.

# Getting Cour running on your own computer

Written assuming you have not done this before. Follow it top to bottom.
Roughly 30 minutes, most of it waiting for downloads.

If anything goes wrong, jump to **Step 8 — when something breaks**.

---

## Why local, and not the web sandbox

Claude Code on the web runs in a locked-down container that cannot reach
`myanimelist.net`, so the backfill cannot run there. You also want to open the
site in a real browser from Phase 1 onward. So: your own machine.

---

## Step 1 — Install four things

Install these in order. Accept every default in the installers.

1. **Node.js** — https://nodejs.org — download the big green **LTS** button.
2. **Git** — https://git-scm.com/downloads
   *(Mac: you may already have it. Skip if Step 2's check passes.)*
3. **VS Code** — https://code.visualstudio.com
4. **Claude Code** — open VS Code, click the Extensions icon in the left bar
   (four little squares), search **Claude Code**, click Install.

---

## Step 2 — Open a terminal and check they worked

In VS Code, press **Ctrl + `** (Windows) or **Cmd + `** (Mac) — that is the
backtick key, above Tab. A panel opens at the bottom. That is the terminal.
Everything below gets typed there, one line at a time, pressing Enter.

```bash
node --version
git --version
```

You want `v20` or higher from the first, and any version from the second. If
either says "command not found", the install did not finish — restart VS Code
and try again.

---

## Step 3 — Download the project

Pick where it lives. This puts it in your home folder:

```bash
cd ~
git clone https://github.com/kurush98/Cour.git
cd Cour
git checkout claude/zealous-allen-ozhdb6
npm install
```

`npm install` takes a minute or two and prints a lot. Fine as long as it ends
without the word `error`.

Now open the folder in VS Code: **File → Open Folder →** pick `Cour`.

---

## Step 4 — Create the database (Neon)

1. Go to https://neon.tech and sign up. Free tier is plenty.
2. Create a project. Name it `cour`. Take the default region.
3. You land on a dashboard with a **Connection string** box.

You need **two different strings** from this page:

- **Pooled** — the default. Its host contains **`-pooler`**.
- **Direct** — find the toggle or dropdown labelled *Connection pooling* and
  turn it **off**. The host loses the `-pooler` part. Copy that too.

Paste both somewhere temporary. They look like:

```
postgresql://cour_owner:AbC123@ep-cool-name-12345-pooler.us-east-2.aws.neon.tech/cour?sslmode=require
postgresql://cour_owner:AbC123@ep-cool-name-12345.us-east-2.aws.neon.tech/cour?sslmode=require
```

These contain your database password. Never paste them into a chat, an issue,
or a commit.

---

## Step 5 — Get a MyAnimeList API key

1. Go to https://myanimelist.net/apiconfig — log in, or make a free account.
2. Click **Create ID**.
3. Fill the form in:
   - **App Type:** `web`
   - **App Name:** `Cour`
   - **App Description:** an anime episode logging and review site
   - **App Redirect URL:** `http://localhost:3000/api/auth/callback/mal`
   - **Homepage URL:** `http://localhost:3000`
   - **Commercial / Non-Commercial:** **Non-Commercial**
4. Agree to the API agreement and submit.
5. Open the app you just created and copy the **Client ID**.

**Choose Non-Commercial deliberately.** §3(a)(xiv) of the agreement requires
MAL's written permission before we earn anything, and their definition of
commercial includes subscriptions and even monthly donations. Free and
non-commercial is where we are launching. Changing that later is a
conversation with MAL, not a checkbox.

Do not share the Client ID with anyone (§2(a) makes that our problem).

---

## Step 6 — Put the three values in a file

In the terminal, inside the `Cour` folder:

```bash
cp .env.example .env
```

*(Windows PowerShell: use `copy .env.example .env` instead.)*

In VS Code's file list on the left, click **`.env`** to open it. Fill in the
three values. Keep the quotes:

```
DATABASE_URL="<the POOLED string, the one with -pooler>"
DIRECT_DATABASE_URL="<the DIRECT string, no -pooler>"
MAL_CLIENT_ID="<your Client ID>"
```

Leave the rest alone. Save with **Ctrl+S** / **Cmd+S**.

`.env` is already git-ignored, so your secrets will not be committed.

---

## Step 7 — Build the database and load the catalog

Three commands.

```bash
npm run db:migrate
```

It will ask you to name the migration. Type `init` and press Enter. This
creates every table.

```bash
npm run db:sql
```

This adds the constraints and search indexes that Prisma cannot express. Not
optional — they hold the rating scale and the title search together. Safe to
re-run any time.

```bash
npm run doctor
```

Every line should say `ok`. If one says `FAIL`, it tells you what to do.

Then load real data:

```bash
npm run backfill
```

This pulls the current anime season and the previous four from MAL. It is
deliberately slow — one request per second, because MAL publishes no rate
limit and §4(j) asks us not to burden their servers. Expect **10–20 minutes**.
It prints each season as it goes. Leave it running.

Want to see it work first without waiting? `npm run backfill -- --dry-run`
fetches without writing anything.

---

## Step 8 — When something breaks

**First, always:**

```bash
npm run doctor
```

It checks Node, your `.env`, the connection, whether migrations ran, and
whether the SQL files were applied, and tells you the fix for each.

**"command not found: npm"** — Node did not install, or VS Code was open
before you installed it. Quit VS Code fully and reopen.

**"Can't reach database server"** — usually a typo in `DATABASE_URL`, or the
Neon project is paused (free projects sleep; opening the Neon dashboard wakes
it).

**"MAL API 401" or "403"** — the Client ID is wrong, or has a stray space or
quote around it.

**"MAL API 429"** — you are being rate limited. The client already backs off
and retries; if it persists, lower `MAL_REQUESTS_PER_SECOND` to `0.5` in
`.env`.

**Anything else** — open Claude Code in VS Code and paste the error. That is
what it is for. Say what you ran and what you saw.

---

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm run doctor` | Checks your setup and explains any problem |
| `npm run dev` | Starts the site at http://localhost:3000 (no UI until Phase 1) |
| `npm test` | Runs the test suite |
| `npm run typecheck` | Checks for type errors |
| `npm run backfill` | Refreshes the catalog from MAL |
| `npm run db:studio` | Opens a browser table viewer for the database |

`npm run db:studio` is the nice one — it shows you every row we just pulled
in, which is the quickest way to see that Phase 0 actually did something.

---

## Working with Claude Code from here

In VS Code, open the Claude Code panel and just describe what you want. It can
read this whole repo, including `cour-roadmap.md` and `decisions.md`, so it
already has the context.

Two things worth telling it at the start of a new session:

> Read cour-roadmap.md and decisions.md before you do anything.

and, when it proposes something that touches the catalog:

> Check this against the rules in README.md.

Those rules exist because of the MAL agreement, and they are easy to break by
accident.

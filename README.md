# GAR EP / OP Bot

A Discord bot for tracking **Event Points (EP)** and **Officer Points (OP)** with
quota enforcement and an automatic strike ladder.

- **Officers** give members **EP**.
- **HICOM** give Officers **OP**.
- **Upper HICOM / Officer Overseer** run quota checks that apply strikes (and, for EP, kicks).

Storage is a plain JSON file — no database to install and nothing to compile, so it
deploys cleanly on Railway, Render, a VPS, or your own machine.

---

## 1. Create the bot application

1. Go to https://discord.com/developers/applications → **New Application**.
2. Open the **Bot** tab → **Add Bot**. Copy the **token** (you'll need it).
3. Still on the **Bot** tab, scroll to **Privileged Gateway Intents** and enable:
   - **Server Members Intent** (needed for member fetch / quota checks)
   - **Message Content Intent** (needed for the `-logep` prefix command)
4. Open **General Information** and copy the **Application ID** (only needed if you
   later use the optional global deploy script).

## 2. Invite the bot

Use the **OAuth2 → URL Generator**:
- Scopes: `bot` **and** `applications.commands`
- Bot permissions: **Manage Roles**, **Kick Members**, **Manage Nicknames**
  (needed so `/verify` can rename members to their Roblox username),
  **Send Messages**, **Embed Links**, **Read Message History**, **View Channels**,
  **Manage Messages** (for `-logep` cleanup), **Add Reactions** (for the `-logep` ✅).

> Drag the bot's role **above** the Officer / strike roles it needs to add/remove,
> and above anyone it might kick. Discord won't let it manage roles or members
> ranked above its own highest role.

## 3. Configure & run

```bash
npm install
cp .env.example .env       # then paste your token into .env
npm start
```

On startup the bot registers its slash commands in every server it's in (instant).

## 4. Run `/setup`

`/setup` opens an interactive panel (needs **Manage Server**). Set:

- **Rank roles** — Officer, HICOM, Upper HICOM, Officer Overseer
- **Strike roles** — Strike 1–4
- **Channels & Member** — EP log channel, OP log channel, and an optional Member role
- **Exemptions** — the Inactivity Notice and Permanent Quota Excuse roles (optional)
- **Quotas** — the minimum EP and OP everyone is expected to have

> The optional **Member role** limits who the **EP quota check** targets. If you
> leave it unset, the EP quota check runs on every non-bot member — which could
> strike/kick officers too, so setting it is recommended.

---

## Commands

### Slash commands
| Command | Who can use it | What it does |
|---|---|---|
| `/setup` | Manage Server | Open the config panel |
| `/ep view [user]` | anyone | Show your (or someone's) EP |
| `/ep leaderboard` | anyone | Top 4 members by EP |
| `/ep quotacheck` | Upper HICOM | EP strike ladder (see below) — asks for confirmation first |
| `/op view [user]` | anyone | Show your (or someone's) OP |
| `/op leaderboard` | anyone | Every Officer and their OP |
| `/op quotacheck` | Upper HICOM **or** Officer Overseer | OP strike check |
| `/xp view [user]` | anyone | Show your (or someone's) XP and current/next rank |
| `/assign ep <users> <amount>` | Officer | Give EP to one or more members (also grants XP) |
| `/assign op <users> <amount>` | HICOM | Give OP to one or more officers |
| `/assign xp <users> <amount>` | HICOM | Give XP directly to one or more members |
| `/ranks` | Upper HICOM | Open the rank management panel |
| `/verifypanel` | Upper HICOM | Post the Roblox verification panel |
| `/verify <username>` | anyone | Link your own Roblox account (bio-code) |
| `/forceverify <user> <roblox>` | bot owner | Manually link someone (ID or username) |
| `/grouprank <user> <rank> <reason>` | Group Rank Permissions / Company Commander / HICOM / Overseer / owner | Set a member's rank in the Roblox group — **posts publicly** |
| `/groupaccept <user>` | Company Commander / owner | Accept a pending join request into the Roblox group — **posts publicly** |
| `/groupkick <user> [reason]` | HICOM / owner | Kick a member from the Roblox group — **posts publicly** |
| `/groupunkick <user>` | HICOM / owner | Reverse a kick so someone can rejoin the Roblox group — **posts publicly** |
| `/groupkicked` | HICOM / owner | List everyone currently kicked from the Roblox group (stays private) |
| `/groupapi setup` | Manage Server | Configure the Roblox group ranking system |
| `/reset` | Manage Server | Reset EP, OP, or both (logs a snapshot) |

> **Public vs. private replies.** Most commands reply only to the person who ran
> them ("ephemeral," in Discord's terms). `/grouprank`, `/groupaccept`,
> `/groupkick`, and `/groupunkick` are the exception — their result posts
> publicly in the channel for everyone to see, not just the runner.
> `/groupkicked` (viewing the list) stays private.

For `/assign`, the `users` field accepts any mix of `@mentions` and raw IDs, so you
can give the same amount to several people at once. Use a **negative** amount to
remove points.

### Prefix command (prefix `-`)
- **`-logep`** — reply to a message that mentions some members, then send `-logep`.
  The bot asks how much EP to give and applies it to everyone mentioned in the
  replied-to message. (Officer role required, same as `/assign ep`.)

  When it finishes, the bot **reacts ✅ to the message you replied to** (the event
  log message) to mark it as handled, then **deletes the command messages** — your
  `-logep` message, the bot's "how much EP?" prompt, and your number reply. The
  message you replied to is **never deleted**, and the full EP record still goes to
  the EP log channel. (Needs **Manage Messages** + **Add Reactions** in that channel.)

---

## How the quota checks work

**`/op quotacheck`** (Officers only):
- OP **below** quota → 1st strike. Already has it → **2nd strike** and the command
  runner is told who got escalated.
- OP **≥ quota + 4** → their OP strikes are cleared.
- Everything is logged to the **OP log channel**.

**`/ep quotacheck`** (members, or just the Member role if set):
- EP **below** quota → next strike up the ladder: none → 1 → 2 → 3 → 4.
- Already on the **4th** strike and still under quota → **kicked**.
- EP **above** quota → highest strike removed (one per run).
- Everything — strikes, removals, and kicks — is logged to the **EP log channel**.
- Because it can kick, it asks you to confirm before running.

(Exactly *at* quota = no change, in both checks.)

**Exemptions.** Anyone with the **Inactivity Notice** role or the **Permanent Quota
Excuse** role is skipped entirely by both quota checks — they get no strikes and are
never kicked. The results and log show how many members were excused. Set these roles
on the **Exemptions** page in `/setup` (both optional).

---

## XP & Ranks

Every member has an **XP** total that drives their rank role.

- **1 EP = 25 XP.** Whenever EP is given (via `/assign ep` or `-logep`), that member
  also gains 25× XP automatically. Removing EP (a negative amount) removes the XP too.
- **HICOM can also grant XP directly** with `/assign xp` — useful for one-off awards
  that aren't tied to an event.
- `/xp view` shows anyone's XP, their current rank, and how far off the next rank is.

### Rank roles

Ranks are role rewards tied to XP thresholds. The bot always keeps a member on
**exactly one** rank — the highest they qualify for — and removes the old one when
they move up (or down, if XP is reduced). When someone **joins the server** they're
given the 0-XP rank automatically.

Set them up with **`/ranks`** (Upper HICOM only). The panel lets you **Add Rank**
(pick a role, then enter its required XP) and **Remove Rank**. Add as many as you
like. A typical setup:

| Rank role | XP required |
|---|---|
| Rank 1 | 0 |
| Rank 2 | 125 |
| Rank 3 | 275 |
| Rank 4 | 425 |
| Rank 5 | 575 |
| Rank 6 | 750 |

> Add the **0-XP** rank so brand-new members get it on join. For the bot to hand out
> rank roles it needs **Manage Roles** and its own role must sit **above** every rank
> role (same rule as the strike roles).

> **Note:** `/reset` only clears EP/OP, not XP — rank progression is meant to persist
> across quota cycles. (Reducing someone's XP with a negative `/assign xp` is the way
> to lower a rank.)

---

## Roblox verification & group ranking

### Verification (linking Discord ↔ Roblox)

Ranking needs to know a member's Roblox account, so members link it once:

- **`/verifypanel`** (Upper HICOM) posts a panel with a **Verify** button in the
  current channel. Anyone can click it.
- Clicking **Verify** (or running **`/verify <username>`**) asks for the Roblox
  username, then gives the member a random code to paste into their Roblox profile
  **About/Description**. They save the bio, click **I've added it**, and the bot
  checks the bio for the code — if it's there, the accounts are linked and stored.
- **`/forceverify <user> <roblox>`** lets the **bot owner** link someone manually by
  Roblox **user ID or username**, skipping the bio step.

Either way, once verification succeeds the bot does three more things:

1. **Sets the member's server nickname to their Roblox username.** Needs the
   **Manage Nicknames** permission and the bot's role above the member's — same
   hierarchy rule as roles and kicks. If it can't (missing permission, hierarchy,
   or they're the server owner — Discord never lets a bot rename the owner),
   verification still succeeds and the reply says why the nickname didn't change.
2. **Posts a log embed** to the channel set as `verify_log_channel` (defaults to
   `1540354309449973830`; there's no `/setup` page for this yet — ask if you want
   one added, or it can be changed directly in the data file).
3. **Creates a Trello card** named after the member's Roblox username, on the
   configured list/board with the configured label (defaults to list
   `6a89d0ca1b896ee5ccf71a8b`, label `6a89d0ca1b896ee5ccf71b10`, board
   `6a89d0ca1b896ee5ccf71a8c` — same "ask to expose it in a setup page, or edit the
   data file" note applies). Needs `TRELLO_API_KEY` and `TRELLO_TOKEN` — see below.

All three are best-effort: if any of them fail (bad channel ID, missing Trello
credentials, Trello rejects the card, etc.), verification still succeeds — the
reply just adds a line noting what didn't happen and why.

Links are stored internally, so `/grouprank` just uses the saved Roblox ID.
Verification lookups use Roblox's public API and don't need an API key.

### Trello card on verify

Get a key and token from https://trello.com/app-key (the key is right there; the
token is generated by following that page's "Token" link, which authorizes as your
Trello account with read/write access to your boards). Put them in `TRELLO_API_KEY`
and `TRELLO_TOKEN`. Leave either blank to skip the Trello card — nothing else about
verification is affected.

> The list, label, and board IDs are currently fixed defaults (shown above) baked
> into the bot's config the first time it runs, not something you set in `/setup`.
> If you want to change them, either edit `data/db.json` directly (the fields are
> `trello_list_id`, `trello_label_id`, `trello_board_id` under a guild's `config`),
> or ask for a `/groupapi`-style panel to be added for them.

### `/grouprank <user> <rank> <reason>`

Sets a member's rank in the Roblox group (the member must be verified first).

**Who can assign what** (highest applicable tier wins; nobody can rank themselves):

| Tier | Ranks they can assign |
|---|---|
| Group Rank Permissions role | 2–150 |
| Company Commander role | 2–162 |
| HICOM role(s) | 2–200 |
| Overseer role | 2–220 |
| The configured owner Discord ID | any rank (1–255) |

> **Naming note:** these four tier names are just labels for the group-ranking
> permission system and are configured separately from (and don't have to point at
> the same Discord roles as) the main `/setup` **HICOM** / **Upper HICOM** / **Officer
> Overseer** roles used for EP/OP quotas — even though a couple of names now
> coincide. Group Rank Permissions and Company Commander fall back to your main
> `/setup` HICOM and Upper HICOM roles if left unset here; Overseer falls back to
> your main Officer Overseer role. HICOM (this tier) and Overseer have no fallback —
> pick roles for them explicitly.

**HICOM (this tier) can be up to 2 roles** — pick both in `/groupapi setup` → Rank
Roles if you want two separate roles (e.g. two moderator tiers) to share the same
cap. Anyone holding either one gets this tier.

Configure the roles, caps, group ID, owner ID, and the two log channels with
**`/groupapi setup`**. On success a log embed is posted to **both** log channels.

### `/groupaccept`, `/groupkick`, `/groupunkick`, `/groupkicked`

More Roblox group actions, separate from ranking. `/groupaccept`, `/groupkick`, and
`/groupunkick` all take a Discord `user` mention (like `/grouprank`) and resolve
their Roblox account the same way `/grouprank` does — via the link `/verify` (or
`/forceverify`) stored. **The target must be verified first**; if they aren't, the
bot tells you to have them run `/verify` (or verify them yourself) before it will
act.

- **`/groupaccept <user>`** approves that member's pending request to join the
  Roblox group. **Only Company Commander** (or the configured owner) can run it.
  Uses the same `ROBLOX_API_KEY` as `/grouprank` — Roblox's Open Cloud API fully
  supports this.
- **`/groupkick <user> [reason]`** kicks that member out of the Roblox group using
  Roblox's real Group Ban system — it removes them **and** blocks them (and their
  alts) from rejoining until un-kicked. **Only HICOM** (or the configured owner) can
  run it.
- **`/groupunkick <user>`** reverses a kick, letting the person rejoin. Same
  permission as `/groupkick`.
- **`/groupkicked`** lists everyone currently kicked from the group (by Roblox
  username/ID — Roblox's list doesn't say who's who on Discord). Same permission as
  `/groupkick`.

> **Why `/groupkick` needs a different setup:** Roblox's Open Cloud API — the
> `ROBLOX_API_KEY` system `/grouprank` and `/groupaccept` use — has no endpoint for
> banning/kicking a group member; Roblox has never added one there. The real Group
> Ban system lives on the older `groups.roblox.com` API, which logs in as a real
> account via a session cookie instead of a scoped key. See below.

### Roblox API key (required for ranking, accepting)

`/grouprank` and `/groupaccept` use the **Roblox Open Cloud API** with a key from the
`ROBLOX_API_KEY` environment variable (never stored in the config file).

1. Go to https://create.roblox.com/dashboard/credentials → **Create API Key**.
2. Add the **Group** system, select your group, and grant **group member management**
   (read + write).
3. The key's account must rank **above** the ranks you hand out.
4. Put the key in `ROBLOX_API_KEY` (locally in `.env`, on Railway as a variable).

> The verification `/verify` and `/forceverify` flows work **without** the API key;
> only `/grouprank` and `/groupaccept` need it. `/groupkick`, `/groupunkick`, and
> `/groupkicked` need the cookie below instead.

### Roblox account cookie (required for `/groupkick`, `/groupunkick`, `/groupkicked`)

Roblox's group-ban system (kicking, un-kicking, and listing who's kicked) isn't
something the API-key system can do at all, so these three commands use the legacy
`groups.roblox.com` endpoints, which authenticate as a logged-in account via its
session cookie instead of a scoped key.

1. Log into the Roblox account you want the bot to act as (an account ranked above
   whoever it will be kicking) in a browser.
2. Open dev tools → Application/Storage → Cookies → `https://www.roblox.com`, and
   copy the value of **`.ROBLOSECURITY`**.
3. Put it in `ROBLOX_COOKIE` (locally in `.env`, on Railway as a variable).

> **This cookie is a full login to that account** — not a scoped permission like
> the API key. Anyone who obtains it can do anything that account can do, on or off
> Roblox. Use a **dedicated alt account**, never your main, never commit it to
> git (`.gitignore` already excludes `.env`), and rotate it (log out elsewhere) if
> you ever suspect it leaked. Roblox may also periodically invalidate the cookie
> (password changes, security checks) — if these commands start failing, generate a
> fresh one. Leave `ROBLOX_COOKIE` blank if you'd rather not use them; every other
> command works fine without it.

---

## Deploying with GitHub + Railway

### A. Push to GitHub

> **Folder structure matters.** `package.json` must sit at the **root of the repo**,
> not inside a subfolder. If you unzip and your repo looks like
> `my-repo/gar-bot/package.json`, Railway won't find it. It should be
> `my-repo/package.json`, with `src/` next to it.

```bash
# from inside the unzipped folder (the one containing package.json)
git init
git add .
git commit -m "EP/OP bot"
git branch -M main
git remote add origin https://github.com/YOUR_NAME/YOUR_REPO.git
git push -u origin main
```

`.gitignore` already keeps `node_modules/`, `.env`, and your local `data/*.json`
out of the repo, so your token never gets committed.

### B. Deploy on Railway

1. **New Project → Deploy from GitHub repo**, pick your repo. Railway reads
   `railway.json` and `package.json` and runs `npm install` then `npm start`.
2. **Variables** (Variables tab):
   - `DISCORD_TOKEN` = your bot token
   - `DATABASE_PATH` = `/data/db.json`
   - `ROBLOX_API_KEY` = your Open Cloud key (for `/grouprank` and `/groupaccept`)
   - `ROBLOX_COOKIE` = your Roblox session cookie (for `/groupkick`, `/groupunkick`,
     `/groupkicked` — see the cookie section above)
   - `TRELLO_API_KEY` / `TRELLO_TOKEN` = your Trello credentials (for the Trello
     card on verify — optional, skips the card if unset)
3. **Add a Volume** (right-click the service → Add Volume, or the Volumes tab) and
   set its **mount path to `/data`**. This is what makes EP/OP survive restarts and
   redeploys. The path must match the folder in `DATABASE_PATH` (`/data`).
4. Railway redeploys automatically. Watch the **Deploy Logs** — you should see
   `Health server listening on :…` then `Logged in as <bot>#1234` and
   `Registered 5 commands in "<your server>"`.

That's it. Every `git push` to `main` triggers a fresh deploy.

### Troubleshooting

| Symptom | Fix |
|---|---|
| Build can't find `package.json` | It's nested in a subfolder — move the files so `package.json` is at the repo root (see warning above). |
| `Missing DISCORD_TOKEN` in logs | Add the `DISCORD_TOKEN` variable in Railway. |
| Bot connects but `Used disallowed intents` | Enable **Server Members** + **Message Content** intents in the Developer Portal → Bot tab. |
| EP/OP resets to 0 after every deploy | The volume isn't mounted at `/data`, or `DATABASE_PATH` doesn't point into it. Both must be `/data`. |
| Commands don't appear | Make sure the bot was invited with the `applications.commands` scope, then wait a few seconds and refresh Discord. |
| Bot can't add strikes / kick | Move the bot's role **above** the roles it manages, and grant **Manage Roles** + **Kick Members**. |

> Render works the same way: set `DATABASE_PATH` to a path on a mounted disk, add a
> persistent disk there, and set the start command to `npm start`. The included
> health server means it also runs fine as a Render **Web Service**.

---

## Tweaks you might want

- **Let HICOM also give EP:** in `src/handlers.js`, the EP permission check is one
  line — add `|| hasRole(interaction.member, cfg.hicom_role)`.
- **Change EP leaderboard size:** `getTopEp(..., 4)` in `src/handlers.js`.
- **Change the OP "clear" threshold:** the `quota + 4` checks in `src/quota.js`.

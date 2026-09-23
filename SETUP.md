# Setup Guide

Everything you need to run your own Jeopardy game night — local, LAN, or fully online.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Local Development](#local-development)
3. [Case 1: In-Person Game Night (LAN)](#case-1-in-person-game-night-lan)
4. [Case 2: Online / Remote Game Night (Fly.io)](#case-2-online--remote-game-night-flyio)
5. [Creating Your First Board](#creating-your-first-board)
6. [Running a Game](#running-a-game)
7. [Player Instructions](#player-instructions)
8. [Environment Variables](#environment-variables)
9. [Docker (Self-Hosting)](#docker-self-hosting)

---

## Prerequisites

- **Node.js** 18 or higher — [nodejs.org](https://nodejs.org)
- **npm** (comes with Node.js)
- For deployment: **Fly.io CLI** — [fly.io/docs/hands-on/install-flyctl](https://fly.io/docs/hands-on/install-flyctl/)

---

## Local Development

This runs two development servers — one for the backend, one for the frontend.

```bash
# Clone the repo
git clone https://github.com/Surge-Tech/jeopardy.git
cd jeopardy

# Install dependencies for both frontend and backend
npm run install:all

# Start both dev servers
npm run dev
```

| Server | URL | What it is |
|---|---|---|
| Frontend | http://localhost:5173 | Dashboard, Editor, Host, Board, Buzzer |
| Backend | http://localhost:3001 | API + Socket.io |

The frontend automatically proxies API and socket requests to the backend in dev mode.

---

## Case 1: In-Person Game Night (LAN)

Everyone is on the same Wi-Fi. The host's laptop runs the server, the TV is plugged in, and players connect from their phones.

**Step 1:** Start the dev server on the host's laptop:
```bash
npm run dev
```

**Step 2:** Find the laptop's local IP address.
- **Mac:** `ipconfig getifaddr en0`
- **Windows:** `ipconfig` → look for `IPv4 Address`
- **Linux:** `ip addr show`

The backend also prints LAN URLs on startup:
```
Local:   http://localhost:3001
Network: http://192.168.1.42:3001
```

**Step 3:** Open the following on each device:

| Device | URL |
|---|---|
| Host laptop | http://localhost:5173/host/ROOM_CODE |
| TV / projector | http://localhost:5173/board/ROOM_CODE |
| Player phones | http://192.168.1.42:5173/buzzer/ROOM_CODE |

> Replace `192.168.1.42` with your actual LAN IP and `ROOM_CODE` with the code shown on the Dashboard when you start a game.

---

## Case 2: Online / Remote Game Night (Fly.io)

Players are remote. You deploy the app once and share a public URL.

### First-Time Setup

**Step 1:** Install the Fly.io CLI and log in:
```bash
# macOS / Linux
curl -L https://fly.io/install.sh | sh

# Windows (PowerShell)
iwr https://fly.io/install.ps1 -useb | iex

fly auth login
```

**Step 2:** Create a persistent volume for your boards (only needed once):
```bash
fly volumes create jeopardy_data --region iad --size 1
```

**Step 3:** Launch the app (first time only — edits `fly.toml`):
```bash
fly launch
```
When prompted, choose:
- **App name:** pick a unique name (e.g. `your-name-jeopardy`)
- **Region:** choose the one closest to you
- **Postgres / Redis:** No
- **Deploy now:** Yes

> **Important:** After `fly launch` generates a new `fly.toml`, open it and add these lines under `[env]` if they're missing:
> ```toml
> [env]
>   DATA_DIR = '/app/data'
>   NODE_ENV = 'production'
>   PORT = '3001'
> ```
> And ensure the mounts section exists:
> ```toml
> [[mounts]]
>   source = 'jeopardy_data'
>   destination = '/app/data'
> ```

### Deploying Updates

```bash
fly deploy
```

That's it. Your app is now live at `https://your-app-name.fly.dev`.

### Sharing With Players

| Device | URL |
|---|---|
| Host | https://your-app.fly.dev/host/ROOM_CODE |
| Board (screen share) | https://your-app.fly.dev/board/ROOM_CODE |
| Players | https://your-app.fly.dev/buzzer/ROOM_CODE |

Share the buzzer URL in your video call chat. Players tap it on their phone or laptop — no install required.

### Fly.io Free Tier

Fly.io's free tier includes:
- 3 shared-CPU VMs (you only need 1)
- 3 GB persistent storage
- The app auto-sleeps when idle and wakes instantly on request

No credit card required for the free tier.

---

## Creating Your First Board

1. Go to the Dashboard (`/`)
2. Click **New Board**
3. Enter a name and click **Create**
4. Click **Edit** on your new board
5. In the editor:
   - Click a category header to rename it
   - Click any point cell to add a clue
   - Each clue has a **Question**, **Answer**, and optional **image/video**
   - Toggle **Daily Double** on any clue
6. Click **Save Board** when done

Boards are saved as JSON files in `backend/data/boards/`. You can back them up or share them by copying those files.

---

## Running a Game

1. From the Dashboard, click **Start Game** on the board you want to play
2. A **Room Code** is generated (e.g. `ABC123`)
3. Open three things:
   - **Host Panel** — your laptop/tablet: `/host/ABC123`
   - **Board View** — the TV/shared screen: `/board/ABC123`
   - **Buzzer** — share this URL with players: `/buzzer/ABC123`

### Host Panel Controls

| Control | What it does |
|---|---|
| Click a tile | Opens the clue on the board view |
| **Show Answer** | Reveals the answer on the board view |
| **✓ Correct / ✗ Wrong** | Awards or deducts points, closes the clue |
| **Lock Buzzers** | Closes buzzers if open without selecting a winner |
| **Adjust Score** | Manual ±point correction on any player |
| **Log tab** | Full history of the current game |
| **Stats tab** | Per-player leaderboard and correct/wrong breakdown |

### Daily Double Flow

1. Host clicks a Daily Double tile
2. Board view shows the DD splash screen — host announces it
3. Host clicks **Reveal Clue** to show the question
4. After the player answers, host marks Correct or Wrong

---

## Player Instructions

Share this with your players:

> **How to buzz in:**
> 1. Open the link your host shared (works on any phone or laptop browser)
> 2. Enter your name and click **Join**
> 3. When the host opens a question, a big button appears — tap it to buzz in
> 4. First tap wins — keep your phone awake and ready!

---

## Environment Variables

These can be set in a `.env` file in the `backend/` folder (for local dev) or in `fly.toml` under `[env]` (for deployment).

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Port the server listens on |
| `NODE_ENV` | `development` | Set to `production` for deployment |
| `DATA_DIR` | `./data` | Path where boards and uploads are stored |

---

## Docker (Self-Hosting)

If you want to run this on your own server (a VPS, Raspberry Pi, etc.) without Fly.io:

```bash
# Build and run with Docker Compose
docker compose up -d
```

The app runs on port `3001`. Put Nginx or Caddy in front of it for HTTPS.

To run on a different port:
```bash
PORT=8080 docker compose up -d
```

Data (boards + uploaded media) is stored in a named Docker volume `jeopardy_data` and persists across container restarts and updates.

To back up your boards:
```bash
docker compose cp app:/app/data ./backup
```

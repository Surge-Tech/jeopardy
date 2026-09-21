# Jeopardy

A self-hosted, fully customizable Jeopardy game platform. Build your own boards, host game nights in person or online, and let players buzz in from their phones — no app install required.

---

## Features

- **Board Editor** — Create unlimited Jeopardy boards with up to 6 categories and 5 clues each. Supports text, images, and video clues.
- **Real-time Buzzer System** — Players connect on any device via a browser. First buzz wins, ties are impossible.
- **Daily Doubles** — Mark any clue as a Daily Double. The host controls when to reveal it.
- **Projection View** — A fullscreen board view designed for a TV or shared screen.
- **Host Control Panel** — Score tracking, manual score adjustments, game history log, per-player stats, and roll-back support.
- **Sound Effects** — Synthesized audio cues for buzz-ins, Daily Doubles, and more. No audio files needed.
- **Persistent Storage** — Boards are saved as JSON files on disk. No database required.
- **Works Everywhere** — Run it on your laptop for an in-person game night, or deploy it to the cloud for a remote game night. Players connect from anywhere with a link.

---

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                        One Server                           │
│                                                             │
│   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐    │
│   │  Host Panel  │   │ Board (TV)   │   │Player Buzzer │    │
│   │ /host/:room  │   │/board/:room  │   │/buzzer/:room │    │
│   └──────────────┘   └──────────────┘   └──────────────┘    │
│          │                  │                  │            │
│          └──────────────────┴──────────────────┘            │
│                        Socket.io                            │
└─────────────────────────────────────────────────────────────┘
```

The host runs the game from the Host Panel. The board display goes on the main screen (TV/projector). Players connect to the Buzzer page from their phones — no account, no install, just a URL and a name.

---

## Quick Start (Local)

**Prerequisites:** Node.js 18+

```bash
# 1. Clone and install
git clone https://github.com/Surge-Tech/jeopardy.git
cd jeopardy
npm run install:all

# 2. Start development servers
npm run dev
```

- **Dashboard / Editor:** http://localhost:5173
- **Share with players (LAN):** http://YOUR_LAN_IP:5173

> For a full local + deployment guide, see [SETUP.md](SETUP.md).

---

## Deployment (Fly.io — Free Tier)

```bash
fly launch          # first time setup
fly deploy          # deploy or redeploy
```

Players connect to your `https://your-app.fly.dev` URL from anywhere. Full instructions in [SETUP.md](SETUP.md).

---

## Project Structure

```
jeopardy/
├── backend/
│   ├── src/
│   │   ├── index.ts            # Express server + static file serving
│   │   ├── routes/
│   │   │   ├── boards.ts       # Board CRUD API
│   │   │   └── media.ts        # Image/video upload
│   │   ├── socket/
│   │   │   ├── gameManager.ts  # In-memory game sessions
│   │   │   └── socketHandler.ts
│   │   └── storage/
│   │       └── boardStorage.ts # JSON file persistence
│   └── package.json
├── frontend/
│   └── src/
│       ├── pages/
│       │   ├── Dashboard.tsx   # Board list + create/delete
│       │   ├── Editor.tsx      # Board editor
│       │   ├── Host.tsx        # Host control panel
│       │   ├── BoardView.tsx   # Projection screen
│       │   └── Buzzer.tsx      # Player buzzer (phone)
│       ├── store/
│       │   └── gameStore.ts    # Zustand state (game log, etc.)
│       └── utils/
│           └── sounds.ts       # Web Audio API sound effects
├── Dockerfile
├── docker-compose.yml
├── fly.toml
└── SETUP.md
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js, Express, Socket.io |
| Frontend | React, Vite, Tailwind CSS, Zustand |
| Realtime | Socket.io (WebSockets) |
| Storage | JSON files on disk (no database) |
| Deployment | Docker, Fly.io |

---

## License

MIT — free to use, modify, and distribute. See [LICENSE](LICENSE).

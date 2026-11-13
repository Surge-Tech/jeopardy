# Jeopardy

A self-hosted, fully customizable Jeopardy game platform. Build your own boards, host game nights in person or online, and let players buzz in from their phones — no app install required.

---

## Features

- **Team Mode** — Create named, colored teams in the host’s lobby setup and assign players before starting. Everyone can buzz from their own phone; points go to the shared team score, and a wrong answer locks out the whole team for that clue. Captains submit Daily Double wagers and the team’s single Final Jeopardy wager and answer.
- **Board Editor** — Create unlimited Jeopardy boards with up to 6 categories and 5 clues each per round. Supports text, images, video, and audio clues, with separate image/video/audio uploads or YouTube links for correct answers, including Final Jeopardy. Answer media appears on the board when the host reveals the answer. Audio uploads support MP3, WAV, Ogg, M4A, AAC, FLAC, and WebM, with playback controls in the editor and on the board.
- **Multi-Round Boards** — A board can hold several rounds (Jeopardy!, Double Jeopardy!, and beyond). Players, scores, and stats all carry over when the host advances to the next round — no need to start a new game.
- **Real-time Buzzer System** — Players connect on any device via a browser. First buzz wins, ties are impossible. A configurable lockout (250/500/1000ms, or off) penalizes buzzing before the host opens it, so mashing the button no longer beats reacting to it.
- **Daily Doubles with Wagering** — Mark any clue as a Daily Double. The host reveals it and the game automatically prompts the right player to wager on their phone (with a host override, and a manual picker for the rare case no player has answered correctly yet) — scoring then uses their wager instead of the clue's face value. After showing the clue, the host can press **Space** or click **Start Answer Timer** to start a synced answer countdown (15 seconds by default). Set **Daily Double time** in the host controls to 0–300 seconds; 0 disables it. The countdown appears on the host panel, board, and contestant devices, and the host judges the answer when time runs out.
- **Final Jeopardy** — A full wager-clue-reveal round with live wagers, a synced countdown timer, ambient music during the countdown, a dramatic per-contestant reveal, and a final scoreboard with a podium and stats.
- **End-Game Lifecycle** — The game ends automatically once the last round is finished (if the board has no Final Jeopardy), or the host can end it manually at any point, including mid-Final-Jeopardy. A shared leaderboard — with tie handling — shows on every screen, and the host can resume or close the room from there.
- **Projection View** — A fullscreen board view designed for a TV or shared screen.
- **Host Control Panel** — Score tracking, manual score adjustments, game history log, per-player stats (including early buzzes), and roll-back support.
- **Sound Effects** — Synthesized audio cues for buzz-ins, Daily Doubles, Final Jeopardy, and more, played on the board/TV so the room hears them. No audio files needed.
- **Persistent Storage** — Boards are saved as JSON files on disk. No database required. Older single-round board files are migrated automatically.
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

If you accidentally close the host tab or browser, reopen the dashboard in the same browser profile and click **Resume game** on the board. Scores, players, and game progress remain on the running server; the browser remembers the room to reconnect to. **Close Room** clears that saved room. Rooms expire after roughly six hours without activity, and server restarts clear all games. If a saved room is no longer available, hosting starts a new game and shows a notice.

Every new game opens in the **lobby**, with **Teams** selected by default. You can switch to **Individual** before starting. Open **Board View** on the projector to show the player QR code, join URL, selected mode, and live roster. Team mode groups players by team and marks captains; unassigned players appear separately. Choose the mode in the host’s lobby setup, let players join, then click **Start game**. At least one player is required. Clues, round changes, and Final Jeopardy become available after starting, and phones switch from the lobby waiting message to normal buzzer mode.

Use **Buzzer test → Open buzzers** in the lobby to test player phones before starting. The first buzz locks the test; further buzzes within 500 ms appear in the buzz order with reaction times. Results appear on the admin screen, board, and phones. **Reset test** clears the results and closes the buzzers so you can open another test. Practice works before team assignments are complete, does not affect scores or stats, and clears when the game starts.

For a team game, use the host’s lobby setup to set **Game mode** to **Teams**, create teams, and assign every player. **Auto-assign players** shuffles all players into the existing teams with sizes differing by at most one and selects new captains. Create at least two teams with at least one player per team; click again to reshuffle, or adjust assignments manually. The first member assigned becomes captain; use the captain selector to change them. Each team needs at least one member and a captain. Click **Start game** to lock the setup and begin play. Team games accept new players only in the lobby; existing players can reconnect throughout the game. Captains can change between clues, during Daily Double wagering, and during Final Jeopardy to recover from a disconnected device. The host can enter a Daily Double wager when the captain has no connected device, and can enter Final Jeopardy wagers and answers through the existing override controls.

To test players created in the host panel without using phones, enable **Show test buzzers** in the **Players** tab. Each player gets a test buzzer that follows the normal buzz rules, including early-buzz penalties, answer timers, team lockouts, and buzz history. Disabled buttons explain why buzzing is unavailable. Test buzzes affect game stats and normal judging/scoring; they do not connect a player device or replace phone latency testing.

Image clues with clue text follow the same reading flow as text-only clues: show the clue, read the text, then select **Open Buzzers**. Images without clue text open buzzers immediately when revealed. If a clue recording is attached, buzzers open when the recording finishes.

For regular questions, the host panel shows a 30-second **Waiting for answers** countdown when buzzers first open. It pauses on a buzz or when buzzers are locked, resumes with the remaining time when buzzers reopen (including after a wrong answer), and survives a host-page refresh. Reaching 0:00 does not change the game; the host decides when to show the answer. Each new question gets a fresh 30 seconds.

Upload a spoken reading under **Clue recording (optional)** in the question editor. The board plays it when the host shows the clue, keeping regular buzzers closed until playback ends; the waiting-for-answers timer starts then. Clue images stay visible during the reading, while other clue audio/video waits. The host's media controls pause, play, or seek the recording. If the browser blocks autoplay, press Play on the board, or use **Skip Recording & Open Buzzers** on the host. Recordings also play for Daily Doubles, which retain their separate answer-timer controls. Final Jeopardy continues to use its existing clue media.

To project a join code, use **Player QR code (project this)** in the host's sharing links. **Open** displays `/qr/<roomCode>` on a separate screen; **Copy** shares that display URL. The page generates its QR locally and sends scanning phones directly to the normal `/buzz/<roomCode>` player page. It also shows the room code and a copyable player URL. For local games, open the host using its LAN address and connect phones to the same Wi-Fi; sharing a localhost address will not work on other devices. The QR display stays available when a game ends or a room closes, and opening it does not join the game.

Run the frontend QR decode and sharing checks with `npm test --prefix frontend`.

---

## Quick Start (Local)

### Nix

From the repository directory, run:

```bash
nix run
```

This uses a pinned Node.js 24 environment, installs the locked npm dependencies,
builds the frontend and backend, and starts the app at http://localhost:3001.
The first run requires internet access to download Nix packages and npm dependencies.
Subsequent runs also install dependencies and rebuild the current checkout.
Stop the server with Ctrl+C. Boards and uploaded media are stored in `backend/data/`.
Other devices on the same network can open `http://YOUR_LAN_IP:3001`.

For development with live reload, run:

```bash
nix run .#dev
```

This installs the locked dependencies and starts both development servers in one
terminal. Open http://localhost:3001, or `http://YOUR_LAN_IP:3001` on other devices.
Frontend changes reload automatically; backend changes restart the server and
clear active games. Vite serves the app on port 3001 and proxies API, media, and
Socket.IO traffic to the backend on port 3002. Ctrl+C stops both servers.
Stop any existing server on port 3001 before starting development mode.

You can also use `nix develop` for a Node.js shell and start the servers separately
with `PORT=3002 npm run dev --prefix backend` and `npm run dev --prefix frontend`.
The root `npm run dev` script below is Windows-specific.

### Node.js

**Prerequisites:** Node.js 18+

```bash
# 1. Clone and install
git clone https://github.com/Surge-Tech/jeopardy.git
cd jeopardy
npm run install:all

# 2. Start development servers
npm run dev
```

- **Dashboard / Editor:** http://localhost:3001
- **Share with players (LAN):** http://YOUR_LAN_IP:3001

> For a full local + deployment guide, see [SETUP.md](SETUP.md). For the REST API and Socket.io event reference, see [ARCHITECTURE.md](ARCHITECTURE.md).

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
│   │   │   └── media.ts        # Image/video/audio upload
│   │   ├── socket/
│   │   │   ├── gameManager.ts    # In-memory game sessions
│   │   │   ├── socketHandler.ts  # Core game + buzzer + Daily Double events
│   │   │   └── finalJeopardy.ts  # Final Jeopardy state machine + events
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
│       │   └── Buzzer.tsx      # Player buzzer / wager (phone)
│       ├── components/
│       │   ├── final/          # Final Jeopardy: board screens, host panel, editor
│       │   ├── dailydouble/    # Daily Double: host panel, player wager screen
│       │   └── shared/         # WagerInput, Leaderboard — reused across FJ and end-game
│       ├── store/
│       │   └── gameStore.ts    # Zustand state (game log, etc.)
│       └── utils/
│           ├── sounds.ts       # Web Audio API sound effects
│           └── rounds.ts       # Round-aware board helpers (getRound, isRoundComplete)
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

## Documentation

| Doc | For |
|---|---|
| [SETUP.md](SETUP.md) | Running a game night — local, LAN, Fly.io, or Docker. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Contributors — data model, REST API, and the full Socket.io event protocol. |

---

## License

MIT — free to use, modify, and distribute. See [LICENSE](LICENSE).

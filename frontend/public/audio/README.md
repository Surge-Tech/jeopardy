# Danish game intro

`jeopardy-intro-da.mp3` is the opening 20 seconds of Bent Fabricius-Bjerre's
**Temaet Fra "Jeopardy"**, with a three-second fade-out. Source: the
[official artist channel recording](https://www.youtube.com/watch?v=8CCQ7a8kfqg),
provided by Parlophone Denmark, ℗ 1995 Parlophone Music Denmark (Warner Music Group).
This third-party recording retains its original copyright and is not covered by
the repository's MIT license.

The projected board preloads it in the lobby and plays it once on the live
`lobby` → `playing` transition. Selecting a clue, leaving play, closing the room,
or leaving the board stops it. Opening an ongoing game or reconnecting does not
replay it. Enable sound on the board before starting, using the existing sound
control. Playback uses the same Web Audio output as game cues.

The host's **Play theme** button, next to **Board View**, can replay the theme
without opening a clue. Replaying stops the previous theme before starting again.

# Lobby speaker test

The lobby plays `speaker-test-da.mp3` on the board view using the same native audio playback and default volume as clue recordings. Host controls remotely start, replay, or stop the board's player; the host does not play a second copy.

The bundled recording was generated with OpenAI `gpt-4o-mini-tts`, voice `cedar`, at speed `1.0`, using the project's standard Danish quiz-host delivery instructions. The text is in `speaker-test-da.txt`. The MP3 is copied directly from the speech helper output to retain the same volume as generated clue recordings.

To regenerate from the repository root, with credentials configured at `~/.config/openai/credentials.env` or in `OPENAI_API_KEY`:

```bash
python .agents/skills/jeopardy-tts/scripts/generate_speech.py \
  --text-file frontend/public/audio/speaker-test-da.txt \
  --output "$HOME/Downloads/Jeopardy-recordings/lobby-speaker-test-openai-cedar-da.mp3"
cp "$HOME/Downloads/Jeopardy-recordings/lobby-speaker-test-openai-cedar-da.mp3" frontend/public/audio/speaker-test-da.mp3
```

Keep credentials and generation metadata outside the repository. Only the MP3 and its text belong in the application assets. Vite copies the audio to the production build. No speech service or API key is needed at playback time.

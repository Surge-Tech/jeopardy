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

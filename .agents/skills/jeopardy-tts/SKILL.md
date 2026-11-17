---
name: jeopardy-tts
description: Generate spoken clue recordings with OpenAI text to speech and attach them to this project's Jeopardy boards. Use for clue narration, batches of missing recordings, or adding narration alongside clue images.
---

# Jeopardy clue recordings

Generate local MP3 files, then attach them as `Question.clueAudioUrl` through the board REST API when requested. This is a content workflow, not an application integration: keep the user's OpenAI key and generated files outside this repository. Do not add API credentials or speech generation to the Jeopardy app.

## Select the work

Read the sibling [Jeopardy content skill](../jeopardy-content/SKILL.md) and follow its server selection, authentication, private backup, conflict checks, preservation, and read-back rules when accessing boards. Read this project's [REST API reference](../../../ARCHITECTURE.md#rest-api) and [canonical types](../../../backend/src/shared/types.ts) before constructing updates.

Use the board identified by the user or established in the conversation; do not hardcode a board ID. Fetch its full content and identify matching questions by exact clue text or stable question IDs. Summarize the eligible count and any material assumptions before a batch.

Unless the user specifies otherwise:

- Skip blank clues and questions with an existing `clueAudioUrl`.
- For “questions without clue media,” select nonblank clues without `mediaUrl` or `clueAudioUrl`. Answer/response media does not exclude a question.
- For “image clues with text,” select nonblank clues with `mediaType: 'image'` and a nonempty `mediaUrl`, without a recording. Preserve the image.
- Do not add narration to music/video/YouTube clues unless requested.
- Generate only the supplied clue, never the category, value, answer, or spoken introduction. Preserve its language and words. Do not rewrite clue content as a side effect of narration.

A request to generate and add recordings authorizes those writes and the necessary speech API calls; do not add another confirmation step. A request for local samples alone does not authorize attaching them to a board.

## Voice and credentials

The user's established preference is **Cedar**, a mature Danish male quiz host, at **normal conversational pace** (`speed: 1.0`), with clear standard Danish pronunciation, calm confidence, and no exaggerated pauses. Read English quotations in natural English, then switch back to Danish where appropriate. Reuse these defaults unless the user requests a change; the helper includes the delivery instructions.

The local credentials convention established for this user is `~/.config/openai/credentials.env`, containing `OPENAI_API_KEY=...`; this is not an OpenAI SDK auto-discovery path. The helper reads that file explicitly, or falls back to an existing `OPENAI_API_KEY` environment variable. Keep the credential file private and do not print or copy the key into project files, generated metadata, or tool arguments. If credentials are missing, report the expected location; never request the key in chat.

Before the first paid generation in a session, verify the supported model and request parameters against the current [official speech documentation](https://developers.openai.com/api/docs/guides/text-to-speech). The helper defaults to the previously used `gpt-4o-mini-tts` Speech API workflow. As documented in November 2026, that model retires January 6, 2027; do not assume the default will keep working. OpenAI's proposed Realtime replacement uses a different API workflow and cannot simply be substituted as the `/audio/speech` model. Update the helper workflow if needed, and report any material change in voice or API behavior.

## Generate locally

Use [scripts/generate_speech.py](scripts/generate_speech.py), a Python standard-library helper. Run it relative to this skill directory, or resolve its absolute path. Example:

```bash
python scripts/generate_speech.py --text 'På caféen bestiller du denne forkortelse på tre bogstaver.'
```

Use `--text-file /absolute/path/clue.txt` for text that is awkward to quote. Defaults save content-addressed MP3 files and public request metadata under `~/Downloads/Jeopardy-recordings/`. `--output /absolute/path/file.mp3` selects a different filename. Keep output outside the repo unless explicitly requested otherwise. Optional flags include `--voice`, `--speed`, `--model`, `--instructions-file`, and `--key-file`; see `--help`.

`--dry-run` shows the nonsecret request and destination without reading credentials or calling the API. Matching cached files are reused only when the request and audio checksum match. An incompatible existing output is preserved unless `--overwrite` is explicitly passed. Each invocation makes at most one speech request; after an uncertain network failure, inspect local output before retrying, as the API may already have billed the request.

For batches, group identical text with identical settings and generate it once; attach the same recording to all matching questions. Use low concurrency (up to three requests) if useful. Reuse existing approved samples only when their text and delivery settings match; do not label an unrelated recording as a cache hit. The helper validates nonempty MP3 output and uses `ffprobe` to check duration when available. Listen or iterate when the user reports pronunciation or delivery issues; a successful decode does not verify pronunciation.

## Attach and verify

Upload each distinct MP3 as multipart field `file` to `/api/media/upload`. Confirm an audio response and a relative `/media/...` URL, download it, and compare its checksum to the local file. Save returned URLs locally so a later board-write failure need not cause another upload. Do not retry an upload after an uncertain response without investigating.

Set **only `clueAudioUrl`** on each selected question. Keep `mediaType`/`mediaUrl` (including clue images), `responseMediaType`/`responseMediaUrl`, clue text, answers, IDs, ordering, Daily Doubles, and all other fields intact. Re-fetch before saving: build from the newest board, preserving unrelated edits; if a target's text, media, or recording changed, reconcile before attaching audio. Send the full retained `rounds` array, since the API replaces it as a whole. This API has no atomic conflict protection.

Read the saved board back and compare it with the intended update, allowing only the server's `updatedAt` change. After an uncertain board write, read before retrying. Report the board name/ID, number of attached recordings and skipped clues, local output location, and whether persistence was verified. Do not delete old recordings or media as cleanup.

Regular recorded clues keep buzzers closed until playback ends; clue images stay visible. Daily Doubles keep their separate answer flow. Final Jeopardy has no `clueAudioUrl` field: do not silently add one. This skill does not change the UI, operate live game sessions, or commit repository changes.

---
name: jeopardy-content
description: Create or edit content for the self-hosted Jeopardy project through its board REST API, including rounds, categories, clues, answers, media, Daily Doubles, and Final Jeopardy. Use for preparing game content, not operating live buzzers or scores.
---

# Jeopardy content

This skill belongs to the repository containing it; the repository root is three directories above this skill directory. Read its [REST API reference](../../../ARCHITECTURE.md#rest-api) before making requests and its [canonical content types](../../../backend/src/shared/types.ts) when constructing payloads. Resolve these paths relative to this skill directory, including when using another checkout or worktree. Keep endpoint/schema details in that project documentation rather than duplicating them here.

## Connect and select

- Use the server origin supplied by the user or established in the session. Otherwise check the local backend's default `http://localhost:3001/api/health`. Do not silently switch to a remote instance if it is unavailable. If needed, prepare a local JSON draft while resolving access.
- Use configured credentials privately for the `X-Host-Passcode` header. Never print the passcode, commit it, or include it in generated content. A `401` means credentials need resolving; do not disable authentication.
- List boards and fetch the full target board. Use the user's board ID/name and context to identify it; ask only if multiple plausible targets remain. A request to draft content alone does not authorize saving it to a server.

## Prepare content

Follow the user's language, topic, audience, difficulty, number of rounds/categories, point values, and answer style. Infer unspecified preferences from the existing board and state material assumptions. For an otherwise unspecified new standard round, use five values `[200, 400, 600, 800, 1000]`, increasing difficulty, and up to six categories; do not impose that format on an existing custom game.

Write clear clues with one defensible intended answer and a concise correct response. Avoid duplicate clues and clues that reveal their answers. Verify niche, uncertain, or time-sensitive facts with suitable sources; keep citations in the accompanying report or draft notes, since the board schema has no source field. Use Jeopardy-style responses when requested or consistent with the board. Do not invent media URLs or overwrite existing media/Daily Double settings as a side effect of rewriting text.

## Save and verify

- Save a private local snapshot of an existing board before changing it. Preserve existing IDs, ordering, untouched content, media, and optional fields. Generate UUIDs only for newly added items; question IDs must be unique across all rounds.
- Build updates from the fetched full board. `rounds` is replaced as a whole on update, so include every retained round/category/question. Keep question counts and values aligned with each round's `pointValues`. Validate the payload against the shared types before sending; the server does not validate its shape.
- Re-fetch immediately before updating. If `updatedAt` changed, reconcile with the newer content instead of overwriting it with the older snapshot. The API has no atomic conflict detection; do not promise protection against simultaneous saves.
- Perform writes within the user's requested scope without adding an extra approval step. Do not delete boards or media, replace unrelated content, or operate live game sessions unless requested.
- Check HTTP status and read the board back after writing. Compare intended content and preserved fields. After an uncertain write result, read before retrying; after an uncertain creation, inspect the board list to avoid duplicates. Stop and report unresolved authentication, conflicts, or persistence failures rather than repeatedly writing.
- Report the board name/ID, what changed, and whether persistence was verified. If only a draft was produced, link it and state that it has not been saved to the server.

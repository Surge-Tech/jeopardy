const storageKey = (boardId: string) => `jeopardy:host-room:${boardId}`;

export function getHostRoom(boardId: string): string | null {
  const key = storageKey(boardId);
  try {
    const room = window.localStorage.getItem(key);
    if (room) return room;
  } catch { /* Storage may be disabled. */ }
  // Keep games started before browser-closure recovery was added resumable.
  try {
    const room = window.sessionStorage.getItem(key);
    if (room) saveHostRoom(boardId, room);
    return room;
  } catch { return null; }
}

export function saveHostRoom(boardId: string, roomCode: string) {
  try { window.localStorage.setItem(storageKey(boardId), roomCode); } catch { /* Storage may be disabled. */ }
  try { window.sessionStorage.setItem(storageKey(boardId), roomCode); } catch { /* Storage may be disabled. */ }
}

export function clearHostRoom(boardId: string) {
  try { window.localStorage.removeItem(storageKey(boardId)); } catch { /* Storage may be disabled. */ }
  try { window.sessionStorage.removeItem(storageKey(boardId)); } catch { /* Storage may be disabled. */ }
}

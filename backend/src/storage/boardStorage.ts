import fs from 'fs/promises';
import path from 'path';
import { randomUUID as uuidv4 } from 'crypto';
import type { Board } from '../types.js';

const DATA_DIR = process.env.DATA_DIR ?? './data';
const BOARDS_DIR = path.join(DATA_DIR, 'boards');

async function ensureDir() {
  await fs.mkdir(BOARDS_DIR, { recursive: true });
}

export async function listBoards(): Promise<Omit<Board, 'categories'>[]> {
  await ensureDir();
  const files = await fs.readdir(BOARDS_DIR).catch(() => [] as string[]);
  const boards: Omit<Board, 'categories'>[] = [];
  for (const file of files.filter(f => f.endsWith('.json'))) {
    try {
      const raw = await fs.readFile(path.join(BOARDS_DIR, file), 'utf-8');
      const board: Board = JSON.parse(raw);
      boards.push({ id: board.id, name: board.name, pointValues: board.pointValues, createdAt: board.createdAt, updatedAt: board.updatedAt });
    } catch {}
  }
  return boards.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getBoard(id: string): Promise<Board | null> {
  await ensureDir();
  try {
    const raw = await fs.readFile(path.join(BOARDS_DIR, `${id}.json`), 'utf-8');
    return JSON.parse(raw) as Board;
  } catch {
    return null;
  }
}

export async function createBoard(data: Partial<Board>): Promise<Board> {
  await ensureDir();
  const now = new Date().toISOString();
  const board: Board = {
    id: uuidv4(),
    name: data.name ?? 'New Board',
    categories: data.categories ?? [],
    pointValues: data.pointValues ?? [200, 400, 600, 800, 1000],
    createdAt: now,
    updatedAt: now,
  };
  await fs.writeFile(path.join(BOARDS_DIR, `${board.id}.json`), JSON.stringify(board, null, 2));
  return board;
}

export async function updateBoard(id: string, data: Partial<Board>): Promise<Board | null> {
  const existing = await getBoard(id);
  if (!existing) return null;
  const updated: Board = { ...existing, ...data, id, updatedAt: new Date().toISOString() };
  await fs.writeFile(path.join(BOARDS_DIR, `${id}.json`), JSON.stringify(updated, null, 2));
  return updated;
}

export async function deleteBoard(id: string): Promise<boolean> {
  try {
    await fs.unlink(path.join(BOARDS_DIR, `${id}.json`));
    return true;
  } catch {
    return false;
  }
}

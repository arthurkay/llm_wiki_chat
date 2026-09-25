import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// All wiki state lives under <app>/data (gitignored except schema).
// - data/raw   : immutable uploaded sources (pdf/txt/md), LLM reads only
// - data/wiki  : LLM-owned markdown (index.md, log.md, overview.md, sources/, entities/, concepts/, analyses/)
// - data/wiki.db : sqlite operational store (sources, pages+FTS5, jobs, sessions/messages)
function defaultDataDir(): string {
	const fromEnv = process.env.WIKI_DATA_DIR;
	if (fromEnv) return resolve(process.cwd(), fromEnv);
	return resolve(process.cwd(), 'data');
}

let DATA_DIR = defaultDataDir();
let RAW_DIR = join(DATA_DIR, 'raw');
let WIKI_DIR = join(DATA_DIR, 'wiki');
let DB_PATH = join(DATA_DIR, 'wiki.db');

function ensureDirs(): void {
	for (const dir of [DATA_DIR, RAW_DIR, join(WIKI_DIR, 'sources'), join(WIKI_DIR, 'entities'), join(WIKI_DIR, 'concepts'), join(WIKI_DIR, 'analyses')]) {
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	}
}

ensureDirs();

export function getDataDir(): string {
	return DATA_DIR;
}

export function getRawDir(): string {
	return RAW_DIR;
}

export function getWikiDir(): string {
	return WIKI_DIR;
}

export function getDbPath(): string {
	return DB_PATH;
}

/**
 * Test seam: repoint all wiki storage at another directory (e.g. a tmp dir).
 * Closes any open database first. Not for production use.
 */
export function configureWikiPaths(dataDir: string): void {
	closeDb();
	DATA_DIR = resolve(dataDir);
	RAW_DIR = join(DATA_DIR, 'raw');
	WIKI_DIR = join(DATA_DIR, 'wiki');
	DB_PATH = join(DATA_DIR, 'wiki.db');
	db = null;
	ensureDirs();
}

let db: DatabaseSync | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  stored_name TEXT NOT NULL DEFAULT "",
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS wiki_pages (
  path TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'source',
  body TEXT NOT NULL,
  sources TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE VIRTUAL TABLE IF NOT EXISTS wiki_pages_fts USING fts5(path, title, body);
CREATE TABLE IF NOT EXISTS ingest_jobs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  opencode_session_id TEXT,
  title TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  citations TEXT NOT NULL DEFAULT '[]',
  thinking TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export function getDb(): DatabaseSync {
	if (db) return db;
	db = new DatabaseSync(DB_PATH);
	db.exec('PRAGMA journal_mode = WAL;');
	db.exec(SCHEMA);
	// Lightweight migrations for existing databases
	const srcCols = db.prepare('PRAGMA table_info(sources)').all() as Array<{ name: string }>;
	if (!srcCols.some((c) => c.name === 'stored_name')) {
		db.exec('ALTER TABLE sources ADD COLUMN stored_name TEXT NOT NULL DEFAULT ""');
	}
	const msgCols = db.prepare('PRAGMA table_info(chat_messages)').all() as Array<{ name: string }>;
	if (!msgCols.some((c) => c.name === 'thinking')) {
		db.exec("ALTER TABLE chat_messages ADD COLUMN thinking TEXT NOT NULL DEFAULT ''");
	}
	return db;
}

export function closeDb(): void {
	try {
		db?.close();
	} catch {
		/* ignore */
	}
	db = null;
}

export function upsertPageFts(path: string, title: string, body: string): void {
	const d = getDb();
	d.prepare('DELETE FROM wiki_pages_fts WHERE path = ?').run(path);
	d.prepare('INSERT INTO wiki_pages_fts (path, title, body) VALUES (?, ?, ?)').run(path, title, body);
}

export function deletePageFts(path: string): void {
	getDb().prepare('DELETE FROM wiki_pages_fts WHERE path = ?').run(path);
}

// Back-compat named exports (prefer the get*Dir() accessors in new code)
export { RAW_DIR, WIKI_DIR, DATA_DIR, DB_PATH };

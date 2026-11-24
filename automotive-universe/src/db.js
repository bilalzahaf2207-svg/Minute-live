// Mémoire persistante de l'agent : un fichier SQLite sur le disque du serveur.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

let db;

export function openDb(file = path.join(config.dataDir, 'agent.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS memory (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS topics (
      id INTEGER PRIMARY KEY, title TEXT NOT NULL, series TEXT, source TEXT,
      facts TEXT, score REAL DEFAULT 0, status TEXT DEFAULT 'new', created_at TEXT);
    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY, topic_id INTEGER, title TEXT, script TEXT, caption TEXT,
      file TEXT, status TEXT, planned_at TEXT, scheduled_at TEXT, published_at TEXT, remote_id TEXT,
      feedback TEXT, approved_script_at TEXT, approved_video_at TEXT, approved_publish_at TEXT,
      error TEXT, attempts INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS spend (
      id INTEGER PRIMARY KEY, ts TEXT, provider TEXT, purpose TEXT, amount_eur REAL, detail TEXT);
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY, ts TEXT, level TEXT, source TEXT, message TEXT, data TEXT);
    CREATE TABLE IF NOT EXISTS metrics (
      video_id INTEGER, ts TEXT, views INTEGER, likes INTEGER, comments INTEGER, shares INTEGER);
  `);
  return db;
}

export const getDb = () => db ?? openDb();
export const now = () => new Date().toISOString();

export function getSetting(key, fallback = null) {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}
export function setSetting(key, value) {
  getDb().prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

export function remember(key, value) {
  getDb().prepare('INSERT INTO memory(key, value, updated_at) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .run(key, JSON.stringify(value), now());
}
export function recall(key, fallback = null) {
  const row = getDb().prepare('SELECT value FROM memory WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}

export function logEvent(level, source, message, data = null) {
  getDb().prepare('INSERT INTO events(ts, level, source, message, data) VALUES(?, ?, ?, ?, ?)')
    .run(now(), level, source, message, data ? JSON.stringify(data) : null);
  if (level !== 'debug') console.log(`[${level}] ${source}: ${message}`);
}

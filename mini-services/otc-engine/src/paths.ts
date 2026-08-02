// Shared path resolution for the OTC engine mini-service.
//
// PROBLEM (fixed 2026-08-02): Previously DB_PATH was hardcoded to
//   '/home/z/my-project/db/custom.db' (3 places) and .env was hardcoded to
//   '/home/z/my-project/.env' (2 places). These paths don't exist on Railway
//   (where the app runs from /app) or in local dev (where the project is at
//   /home/z/my-project/plybit/). Result: candles/signals were written to one
//   DB file but read from another → UI always showed empty data.
//
// SOLUTION: derive both paths from a single source of truth:
//   - DATABASE_URL env var (preferred — set by Railway / .env)
//   - Falls back to <project-root>/db/custom.db
//   - .env is resolved from process.cwd() (always the project root)

import path from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';

// Project root = parent of mini-services/otc-engine
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * Resolve the SQLite DB file path from DATABASE_URL or fall back to
 * <project-root>/db/custom.db.
 *
 * Accepts both Prisma-style ("file:/abs/path/custom.db") and bare paths.
 */
export function getDbPath(): string {
  const envUrl = process.env.DATABASE_URL;
  if (envUrl) {
    // Strip Prisma's "file:" prefix
    const cleaned = envUrl.replace(/^file:/, '');
    if (path.isAbsolute(cleaned)) return cleaned;
    return path.resolve(PROJECT_ROOT, cleaned);
  }
  return path.resolve(PROJECT_ROOT, 'db', 'custom.db');
}

/**
 * Resolve the .env file path. Priority:
 *   1. QX_ENV_FILE env var (if set)
 *   2. <project-root>/.env
 */
export function getEnvFilePath(): string {
  if (process.env.QX_ENV_FILE) return process.env.QX_ENV_FILE;
  return path.resolve(PROJECT_ROOT, '.env');
}

/**
 * Read a single key from the .env file (without polluting process.env).
 * Returns '' if the key is missing or the file doesn't exist.
 */
export function readEnvKey(key: string): string {
  const envPath = getEnvFilePath();
  if (!existsSync(envPath)) return '';
  try {
    const content = readFileSync(envPath, 'utf8');
    const m = content.match(new RegExp(`^${key}=(.+)$`, 'm'));
    const val = m?.[1];
    return val ? val.trim() : '';
  } catch {
    return '';
  }
}

/**
 * Write a single key to the .env file (preserving all other keys).
 * Creates the file if it doesn't exist.
 */
export function writeEnvKey(key: string, value: string): void {
  const envPath = getEnvFilePath();
  let content = '';
  if (existsSync(envPath)) {
    content = readFileSync(envPath, 'utf8');
  }
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(content)) {
    content = content.replace(re, `${key}=${value}`);
  } else {
    content = content.trimEnd() + `\n${key}=${value}\n`;
  }
  writeFileSync(envPath, content);
}

export { PROJECT_ROOT };

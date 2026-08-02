import { PrismaClient } from '@prisma/client'

// Ensure DATABASE_URL is set — fall back to a known writable location.
// On Railway, /app/db/custom.db is created by railway-start.sh.
// In local dev, the project's db/custom.db is used (set in .env).
const FALLBACK_DB = process.cwd() + '/db/custom.db'
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = `file:${FALLBACK_DB}`
  console.warn(`[db] DATABASE_URL not set, falling back to ${process.env.DATABASE_URL}`)
}

// Ensure the db directory exists (Prisma doesn't auto-create the parent dir)
const dbPath = process.env.DATABASE_URL.replace(/^file:/, '')
const dbDir = dbPath.split('/').slice(0, -1).join('/')
if (dbDir && dbDir !== '.') {
  try {
    const fs = require('fs')
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true })
      console.log(`[db] created directory: ${dbDir}`)
    }
  } catch (e: any) {
    console.error(`[db] could not create directory ${dbDir}: ${e.message}`)
  }
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error', 'warn'] : ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

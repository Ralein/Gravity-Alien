import Database from "better-sqlite3";
import path from "path";
import fs from "fs-extra";
import { config } from "../config.js";

// ── Database Initialization ─────────────────────────────────────────────

const dbPath = path.resolve(process.cwd(), "memory.db");
const db = new Database(dbPath);

// Create tables if they don't exist
db.exec(`
    CREATE TABLE IF NOT EXISTS core_memories (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        fact TEXT NOT NULL,
        category TEXT CHECK(category IN ('personal', 'preference', 'context', 'instruction', 'relationship', 'event')),
        importance INTEGER DEFAULT 5,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, fact)
    );

    CREATE TABLE IF NOT EXISTS conversation_summaries (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        summary TEXT NOT NULL,
        topics TEXT, -- stored as JSON string
        message_count INTEGER,
        started_at TEXT,
        ended_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_core_user ON core_memories(user_id);
    CREATE INDEX IF NOT EXISTS idx_summaries_user ON conversation_summaries(user_id);
`);

// ── Types ────────────────────────────────────────────────────────────────

export interface CoreMemory {
    id?: string;
    user_id: number;
    fact: string;
    category: "personal" | "preference" | "context" | "instruction" | "relationship" | "event";
    importance: number;
    created_at?: string;
    updated_at?: string;
}

export interface ConversationSummary {
    id?: string;
    user_id: number;
    summary: string;
    topics: string[];
    message_count: number;
    started_at: string;
    ended_at?: string;
}

// ── Core Memory Operations ──────────────────────────────────────────────

/**
 * Save a core memory with automatic dedup.
 */
export async function saveCoreMemory(
    userId: number,
    fact: string,
    category: CoreMemory["category"] = "context",
    importance: number = 5,
): Promise<string | null> {
    const id = `fact_${userId}_${Date.now()}`;
    const stmt = db.prepare(`
        INSERT INTO core_memories (id, user_id, fact, category, importance)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, fact) DO UPDATE SET
            importance = MAX(core_memories.importance, excluded.importance),
            updated_at = CURRENT_TIMESTAMP
    `);

    try {
        stmt.run(id, userId, fact, category, importance);
        console.log(`   🧠 Core memory saved locally: "${fact.substring(0, 60)}..." [${category}]`);
        return id;
    } catch (err: any) {
        console.error(`   ❌ SQLite saveCoreMemory error:`, err.message);
        return null;
    }
}

/**
 * Get all core memories for a user, optionally filtered by category.
 */
export async function getCoreMemories(
    userId: number,
    category?: CoreMemory["category"],
): Promise<CoreMemory[]> {
    let sql = "SELECT * FROM core_memories WHERE user_id = ? ORDER BY importance DESC";
    const params: any[] = [userId];

    if (category) {
        sql = "SELECT * FROM core_memories WHERE user_id = ? AND category = ? ORDER BY importance DESC";
        params.push(category);
    }

    const stmt = db.prepare(sql);
    return stmt.all(...params) as CoreMemory[];
}

/**
 * Delete a core memory by ID.
 */
export async function deleteCoreMemory(id: string): Promise<boolean> {
    const stmt = db.prepare("DELETE FROM core_memories WHERE id = ?");
    try {
        stmt.run(id);
        return true;
    } catch (err: any) {
        console.error(`   ❌ SQLite deleteCoreMemory error:`, err.message);
        return false;
    }
}

// ── Conversation Summary Operations ─────────────────────────────────────

/**
 * Save a conversation summary.
 */
export async function saveConversationSummary(
    userId: number,
    summary: string,
    topics: string[],
    messageCount: number,
    startedAt: string,
): Promise<string | null> {
    const id = `summary_${userId}_${Date.now()}`;
    const stmt = db.prepare(`
        INSERT INTO conversation_summaries (id, user_id, summary, topics, message_count, started_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `);

    try {
        stmt.run(id, userId, summary, JSON.stringify(topics), messageCount, startedAt);
        console.log(`   📝 Conversation summary saved locally (${messageCount} messages)`);
        return id;
    } catch (err: any) {
        console.error(`   ❌ SQLite saveConversationSummary error:`, err.message);
        return null;
    }
}

/**
 * Get recent conversation summaries for a user.
 */
export async function getRecentSummaries(
    userId: number,
    limit: number = 5,
): Promise<ConversationSummary[]> {
    const stmt = db.prepare("SELECT * FROM conversation_summaries WHERE user_id = ? ORDER BY ended_at DESC LIMIT ?");
    const rows = stmt.all(userId, limit) as any[];

    return rows.map(r => ({
        ...r,
        topics: JSON.parse(r.topics || "[]")
    }));
}

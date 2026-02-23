import { Pinecone } from "@pinecone-database/pinecone";
import { config } from "../config.js";
import { embed } from "./embeddings.js";

// ── Pinecone client (singleton) ─────────────────────────────────────────

let pinecone: Pinecone | null = null;
let index: ReturnType<Pinecone["index"]> | null = null;

function getIndex() {
    if (!pinecone) {
        pinecone = new Pinecone({ apiKey: config.pineconeApiKey });
    }
    if (!index) {
        index = pinecone.index(config.pineconeIndex);
    }
    return index;
}

// ── Types ────────────────────────────────────────────────────────────────

export interface VectorMemoryMetadata {
    userId: number;
    text: string;
    type: "exchange" | "summary" | "core_fact";
    topic?: string;
    timestamp: string;
}

export interface VectorSearchResult {
    id: string;
    score: number;
    text: string;
    type: string;
    timestamp: string;
}

// ── Operations ──────────────────────────────────────────────────────────

/**
 * Upsert a memory into Pinecone with its embedding.
 */
export async function upsertMemory(
    id: string,
    text: string,
    metadata: VectorMemoryMetadata,
): Promise<void> {
    const embedding = await embed(text);
    const idx = getIndex();

    await idx.upsert({
        records: [
            {
                id,
                values: embedding,
                metadata: metadata as unknown as Record<string, string | number | boolean | string[]>,
            },
        ]
    });

    console.log(`   📌 Pinecone upsert: ${id} (${metadata.type})`);
}

/**
 * Search Pinecone for semantically similar memories.
 */
export async function queryMemories(
    query: string,
    userId: number,
    topK: number = 5,
    type?: string,
): Promise<VectorSearchResult[]> {
    const queryEmbedding = await embed(query);
    const idx = getIndex();

    const filter: Record<string, unknown> = { userId: { $eq: userId } };
    if (type) {
        filter["type"] = { $eq: type };
    }

    const results = await idx.query({
        vector: queryEmbedding,
        topK,
        includeMetadata: true,
        filter,
    });

    return (results.matches || [])
        .filter((m) => m.score && m.score > 0.3) // relevance threshold
        .map((m) => ({
            id: m.id,
            score: m.score!,
            text: String(m.metadata?.text ?? ""),
            type: String(m.metadata?.type ?? "unknown"),
            timestamp: String(m.metadata?.timestamp ?? ""),
        }));
}

/**
 * Delete a specific memory by ID.
 */
export async function deleteMemory(id: string): Promise<void> {
    const idx = getIndex();
    await idx.deleteOne({ id });
    console.log(`   🗑️ Pinecone delete: ${id}`);
}

/**
 * Delete all memories for a specific user.
 */
export async function deleteUserMemories(userId: number): Promise<void> {
    const idx = getIndex();
    // Pinecone serverless supports delete by metadata filter
    await idx.deleteMany({ userId: { $eq: userId } } as any);
    console.log(`   🗑️ Pinecone: deleted all memories for user ${userId}`);
}

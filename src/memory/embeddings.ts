import OpenAI from "openai";
import { config } from "../config.js";

// ── Embedding client (uses OpenAI API via OpenRouter) ───────────────────

const embeddingClient = new OpenAI({
    apiKey: config.openRouterApiKey,
    baseURL: "https://openrouter.ai/api/v1",
});

const EMBEDDING_MODEL = "openai/text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1024;

/**
 * Generate a vector embedding for a text string.
 * Uses OpenAI's text-embedding-3-small via OpenRouter.
 */
export async function embed(text: string): Promise<number[]> {
    // Truncate to avoid token limits (~8191 tokens ≈ ~30k chars)
    const truncated = text.slice(0, 28000);

    const response = await embeddingClient.embeddings.create({
        model: EMBEDDING_MODEL,
        input: truncated,
        dimensions: EMBEDDING_DIMENSIONS,
    } as any);

    return response.data[0].embedding;
}

/**
 * Generate embeddings for multiple texts in a single batch.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
    const truncated = texts.map((t) => t.slice(0, 28000));

    const response = await embeddingClient.embeddings.create({
        model: EMBEDDING_MODEL,
        input: truncated,
        dimensions: EMBEDDING_DIMENSIONS,
    } as any);

    return response.data.map((d) => d.embedding);
}

export { EMBEDDING_DIMENSIONS };

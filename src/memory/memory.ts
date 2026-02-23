import OpenAI from "openai";
import { config } from "../config.js";
import type { MessageParam } from "../types/index.js";
import {
    saveCoreMemory,
    getCoreMemories,
    saveConversationSummary,
    getRecentSummaries,
    type CoreMemory,
} from "./localStore.js";
import {
    upsertMemory,
    queryMemories,
    type VectorSearchResult,
} from "./vectorStore.js";

// ── LLM client for memory extraction (uses Groq for speed) ─────────────

const llm = new OpenAI({
    apiKey: config.groqApiKey,
    baseURL: "https://api.groq.com/openai/v1",
});

// ── Types ────────────────────────────────────────────────────────────────

interface ExtractedFact {
    fact: string;
    category: "personal" | "preference" | "context" | "instruction" | "relationship" | "event";
    importance: number;
}

export interface MemoryContext {
    coreMemories: CoreMemory[];
    relevantMemories: VectorSearchResult[];
    recentSummaries: string[];
}

// ── Memory Manager ──────────────────────────────────────────────────────

export class MemoryManager {
    /** Per-user short-term message buffer */
    private stm = new Map<number, MessageParam[]>();

    /** Per-user session start timestamps */
    private sessionStarts = new Map<number, string>();

    /** Per-user exchange counters (for triggering periodic summarization) */
    private exchangeCounts = new Map<number, number>();

    private readonly STM_MAX = 20; // messages before triggering summarization
    private readonly SUMMARIZE_EVERY = 10; // exchanges between auto-summarizations

    // ── Short-Term Memory ───────────────────────────────────────────────

    /** Get the current STM buffer for a user. */
    getSTM(userId: number): MessageParam[] {
        if (!this.stm.has(userId)) {
            this.stm.set(userId, []);
            this.sessionStarts.set(userId, new Date().toISOString());
            this.exchangeCounts.set(userId, 0);
        }
        return this.stm.get(userId)!;
    }

    /** Clear STM for a user (e.g. /clear command). */
    async clearSTM(userId: number): Promise<void> {
        const history = this.stm.get(userId) ?? [];
        // Summarize whatever's left before clearing
        if (history.length >= 4) {
            await this.summarizeAndArchive(userId);
        }
        this.stm.set(userId, []);
        this.sessionStarts.set(userId, new Date().toISOString());
        this.exchangeCounts.set(userId, 0);
    }

    // ── Add Exchange ────────────────────────────────────────────────────

    /**
     * Record a user↔assistant exchange. This is the main entry point after
     * each agent loop completes. It:
     * 1. Appends to STM
     * 2. Triggers background memory extraction
     * 3. Auto-summarizes when STM gets too large
     */
    async addExchange(
        userId: number,
        userMessage: string,
        assistantResponse: string,
    ): Promise<void> {
        const history = this.getSTM(userId);

        // Append to STM
        history.push({ role: "user", content: userMessage });
        history.push({ role: "assistant", content: assistantResponse });

        // Increment exchange counter
        const count = (this.exchangeCounts.get(userId) ?? 0) + 1;
        this.exchangeCounts.set(userId, count);

        // ── Background tasks (fire-and-forget, don't block the response) ──
        const exchangeText = `User: ${userMessage}\nAssistant: ${assistantResponse}`;

        // 1. Extract & save core memories
        this.extractAndSaveCoreMemories(userId, exchangeText).catch((err) =>
            console.error("   ⚠️ Core memory extraction failed:", err.message),
        );

        // 2. Upsert exchange into Pinecone for semantic search
        const vectorId = `exchange_${userId}_${Date.now()}`;
        upsertMemory(vectorId, exchangeText, {
            userId,
            text: exchangeText.slice(0, 1000), // metadata size limit
            type: "exchange",
            timestamp: new Date().toISOString(),
        }).catch((err) =>
            console.error("   ⚠️ Pinecone upsert failed:", err.message),
        );

        // 3. Auto-summarize if STM is getting large
        if (history.length > this.STM_MAX * 2) {
            this.summarizeAndArchive(userId).catch((err) =>
                console.error("   ⚠️ Auto-summarization failed:", err.message),
            );
        }
    }

    // ── Retrieve Context ────────────────────────────────────────────────

    /**
     * Assemble all relevant memory context for the current query.
     * This is called BEFORE the agent loop to inject context.
     */
    async getRelevantContext(
        userId: number,
        query: string,
    ): Promise<MemoryContext> {
        // Run all retrievals in parallel for speed
        const [coreMemories, relevantMemories, summaries] = await Promise.all([
            getCoreMemories(userId).catch((err) => {
                console.error("   ⚠️ Core memory retrieval failed:", err.message);
                return [] as CoreMemory[];
            }),
            queryMemories(query, userId, 5).catch((err) => {
                console.error("   ⚠️ Pinecone query failed:", err.message);
                return [] as VectorSearchResult[];
            }),
            getRecentSummaries(userId, 3).catch((err) => {
                console.error("   ⚠️ Summary retrieval failed:", err.message);
                return [];
            }),
        ]);

        return {
            coreMemories,
            relevantMemories,
            recentSummaries: summaries.map((s) => s.summary),
        };
    }

    /**
     * Format memory context into a string block for injection into the system prompt.
     */
    formatContextBlock(ctx: MemoryContext): string {
        const parts: string[] = [];

        if (ctx.coreMemories.length > 0) {
            parts.push("## Core Memories (persistent facts about the user)");
            for (const m of ctx.coreMemories) {
                parts.push(`- [${m.category}] ${m.fact}`);
            }
        }

        if (ctx.recentSummaries.length > 0) {
            parts.push("\n## Recent Conversation Summaries");
            for (const s of ctx.recentSummaries) {
                parts.push(`- ${s}`);
            }
        }

        if (ctx.relevantMemories.length > 0) {
            parts.push("\n## Semantically Relevant Past Exchanges");
            for (const m of ctx.relevantMemories) {
                parts.push(`- (${m.type}, relevance: ${(m.score * 100).toFixed(0)}%) ${m.text}`);
            }
        }

        if (parts.length === 0) {
            return "";
        }

        return (
            "\n\n--- MEMORY CONTEXT (retrieved from your long-term memory) ---\n" +
            parts.join("\n") +
            "\n--- END MEMORY CONTEXT ---\n"
        );
    }

    // ── Core Memory Extraction ──────────────────────────────────────────

    /**
     * Use the LLM to extract key facts from a conversation exchange.
     * Extracted facts are deduplicated and saved to Supabase.
     */
    private async extractAndSaveCoreMemories(
        userId: number,
        exchangeText: string,
    ): Promise<void> {
        const facts = await this.extractCoreMemories(exchangeText);
        if (facts.length === 0) return;

        console.log(`   🧠 Extracted ${facts.length} core memories`);

        for (const fact of facts) {
            await saveCoreMemory(userId, fact.fact, fact.category, fact.importance);
        }
    }

    /**
     * Ask the LLM to identify key facts worth remembering.
     */
    private async extractCoreMemories(text: string): Promise<ExtractedFact[]> {
        try {
            const response = await llm.chat.completions.create({
                model: config.model,
                messages: [
                    {
                        role: "system",
                        content: `You are a memory extraction system. Analyze the conversation exchange and extract key facts worth remembering long-term.

Rules:
- Only extract IMPORTANT, SPECIFIC facts (names, preferences, dates, instructions, relationships, events)
- Do NOT extract generic chitchat, greetings, or obvious context
- Do NOT extract facts about yourself (the AI assistant)
- Each fact should be a concise, self-contained statement
- If there are no notable facts, return an empty array

Respond ONLY with a JSON array. Each element: {"fact": "...", "category": "personal|preference|context|instruction|relationship|event", "importance": 1-10}

Example output: [{"fact": "User's name is Alex", "category": "personal", "importance": 9}, {"fact": "User prefers dark mode", "category": "preference", "importance": 6}]`,
                    },
                    {
                        role: "user",
                        content: text,
                    },
                ],
                temperature: 0,
                max_tokens: 500,
            });

            const content = response.choices[0]?.message?.content ?? "[]";

            // Parse the JSON array from the response
            const jsonMatch = content.match(/\[[\s\S]*\]/);
            if (!jsonMatch) return [];

            const parsed = JSON.parse(jsonMatch[0]);
            if (!Array.isArray(parsed)) return [];

            return parsed.filter(
                (f: any) =>
                    typeof f.fact === "string" &&
                    typeof f.category === "string" &&
                    typeof f.importance === "number",
            ) as ExtractedFact[];
        } catch (err) {
            console.error("   ⚠️ Memory extraction LLM call failed:", (err as Error).message);
            return [];
        }
    }

    // ── Summarization & Archival ─────────────────────────────────────────

    /**
     * Summarize the oldest messages in STM, archive the summary,
     * and trim the STM buffer.
     */
    async summarizeAndArchive(userId: number): Promise<void> {
        const history = this.getSTM(userId);
        if (history.length < 6) return; // not enough to summarize

        // Take the oldest half of messages for summarization
        const cutPoint = Math.floor(history.length / 2);
        const toSummarize = history.slice(0, cutPoint);
        const toKeep = history.slice(cutPoint);

        // Build text from messages
        const conversationText = toSummarize
            .filter((m) => m.role !== "system" && m.role !== "tool")
            .map((m) => `${m.role}: ${typeof m.content === "string" ? m.content : "(non-text)"}`)
            .join("\n");

        if (!conversationText.trim()) return;

        try {
            const response = await llm.chat.completions.create({
                model: config.model,
                messages: [
                    {
                        role: "system",
                        content: `Summarize this conversation segment concisely. Capture key topics, decisions, facts shared, and any important context. Be specific but brief (2-4 sentences). Also list 1-5 topic tags.

Respond as JSON: {"summary": "...", "topics": ["tag1", "tag2"]}`,
                    },
                    {
                        role: "user",
                        content: conversationText,
                    },
                ],
                temperature: 0,
                max_tokens: 300,
            });

            const content = response.choices[0]?.message?.content ?? "";
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (!jsonMatch) return;

            const parsed = JSON.parse(jsonMatch[0]);
            const summary = parsed.summary ?? conversationText.slice(0, 200);
            const topics = Array.isArray(parsed.topics) ? parsed.topics : [];

            // Save to Supabase
            await saveConversationSummary(
                userId,
                summary,
                topics,
                toSummarize.length,
                this.sessionStarts.get(userId) ?? new Date().toISOString(),
            );

            // Also upsert summary into Pinecone
            const summaryVectorId = `summary_${userId}_${Date.now()}`;
            await upsertMemory(summaryVectorId, summary, {
                userId,
                text: summary.slice(0, 1000),
                type: "summary",
                topic: topics.join(", "),
                timestamp: new Date().toISOString(),
            });

            // Trim STM — keep only the recent half
            this.stm.set(userId, toKeep);
            console.log(`   📦 Summarized & archived ${toSummarize.length} messages, kept ${toKeep.length}`);
        } catch (err) {
            console.error("   ⚠️ Summarization failed:", (err as Error).message);
        }
    }
}

// ── Singleton export ────────────────────────────────────────────────────

export const memoryManager = new MemoryManager();

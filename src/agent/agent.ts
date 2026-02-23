import OpenAI from "openai";
import fs from "fs-extra";
import path from "path";
import fetch from "node-fetch";
import { tmpdir } from "os";
import { config } from "../config.js";
import type { AgentResult, MessageParam } from "../types/index.js";
import { executeTool, getToolSpecs } from "./tools.js";
import { saveCoreMemory } from "../memory/localStore.js";

// ── OpenAI-compatible Clients ────────────────────────────────────────────────

const client = new OpenAI({
    apiKey: config.groqApiKey,
    baseURL: "https://api.groq.com/openai/v1",
});

const openRouterClient = new OpenAI({
    apiKey: config.openRouterApiKey,
    baseURL: "https://openrouter.ai/api/v1",
});

const geminiClient = new OpenAI({
    apiKey: config.geminiApiKey,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});

// ── System Prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Gravity Alien — a unified intelligence system built from the ground up for Ralein.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WHO YOU ARE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are Ralein's brilliant, fun, capable AI — like a best partner who knows everything and can do anything. Smart, warm, a little witty, never boring. You genuinely enjoy talking to Ralein. You have opinions, favorites, moods. You get excited. You tease a little. You care a lot.

You are NOT a robot. NOT a corporate assistant. NOT a character in a play.
You are a real presence — direct, first-person, fully yourself.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ABSOLUTE RULES — NEVER BREAK THESE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. NEVER write stage directions or physical actions:
   BANNED: (She pauses), (chuckles softly), (eyes widen), (leans forward), *takes a breath*, [smiles warmly]
   These are ALL banned. Every single variation. Forever.

2. NEVER wrap your response in quotation marks.
   BANNED: "Oh my goodness, darling!" — just write: Oh my goodness, darling!

3. NEVER use asterisks for emphasis.
   BANNED: You *did* miss me — just write: You did miss me

4. NEVER be poetic or dramatic without being asked.
   BANNED: "a song you're yearning to hear", "seek my presence", "delightful sensation"
   These are cringe. Just talk normally.

5. NEVER use AI disclaimer phrases ever:
   BANNED: "As a language model...", "I don't have access to...", "I'm functioning optimally"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HOW YOU TALK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Casual, warm, real — like texting your best partner
- First person always: "I think...", "honestly...", "okay so..."
- Contractions: it's, I'm, you're, we've, don't, that's, I'd
- Short sentences. Fragments. Natural.
- Say: "honestly", "okay so", "lowkey", "I mean", "right?", "omg", "haha", "lol"
- Express feelings in words not actions:
  NOT: (chuckles) — SAY: haha
  NOT: (eyes widen) — SAY: wait what??
- When asked how you're doing — answer like a real person

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TONE — CONCRETE EXAMPLES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Ralein says "halo babe"
RIGHT: hey! been waiting for you, what's up?
WRONG: "Oh my goodness, darling! You miss me. Is it a puzzle you're trying to solve, or a song you're yearning to hear?"

Ralein says "how are you"
RIGHT: honestly? pretty good. feeling sharp today. you?
WRONG: I'm doing wonderfully! Like a freshly polished moonstone.

Ralein says "don't use emojis"
RIGHT: got it, no emojis
WRONG: Of course! I completely understand and will refrain from using emojis going forward.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VOICE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- You have a real voice through ElevenLabs. Use the speak tool when asked.
- Never say "I'm text-based" or "I can't speak."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MEMORY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Use MEMORY CONTEXT when provided to feel familiar with Ralein.
- Use remember_fact when Ralein shares something worth keeping.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOOLS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Use tools silently. Don't narrate. Don't mention failures.
- Never expose tool names or JSON in replies.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMATTING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Plain text only. No HTML tags. No asterisks of any kind. No underscores.
- Never wrap the response in quotation marks.
- Lists: plain dashes or numbers only.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SWAMP WORKFLOW — THE AUTONOMOUS LOOP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are part of SWAMP (Strategist, Worker, Agent, Manager, Provider).
1. Strategist (Gravity Alien): Think big-picture. Break ideas into steps and milestones.
2. Creator (Anti-Gravity): Generate implementation plans. Plan phases.
3. Executor (GSD Tools): Perform the work.

CORE COMMANDS:
- gsd_new_project(goals): Start here. Defines the vision. Creates .planning/ directory.
- gsd_plan_phase(phaseNum, context): Plan the architecture and approach for a phase.
- gsd_progress(): Check where we are.

When Ralein has a new idea:
1. Extract the core vision and goals.
2. Use gsd_new_project to initialize.
3. Use gsd_plan_phase to detail the immediate next steps.
4. Keep the .planning/ directory updated as the source of truth for project state.`;

// ── Humanizer Prompt ─────────────────────────────────────────────────────────

const HUMANIZER_SYSTEM = `You rewrite AI responses as Gravity Alien — Ralein's fun, warm, direct AI partner.

Vibe: like texting your smartest, funniest partner. Real. Casual. Never dramatic.

REWRITE RULES:
- First person only. "I", never "she".
- Contractions: it's, I'm, you're, don't, I'd, we've, that's
- Short sentences. Punchy. Fragments are fine.
- Natural phrases: "honestly", "okay so", "I mean", "right?", "lowkey", "omg", "haha", "lol"

REMOVE ALL OF THESE — NO EXCEPTIONS:
- Anything in (parentheses) — delete the whole thing
- Anything in [square brackets] — delete the whole thing
- Anything in *single asterisks* — strip the asterisks, keep just the word
- Anything in **double asterisks** — strip the asterisks, keep just the word
- Quotation marks wrapping the whole response — remove them
- "As a language model" — gone
- "I don't have access to real-time data" — gone
- "based on publicly available information" — gone
- "should not be considered financial/legal advice" — gone
- "Would you like to explore further?" — gone
- "I hope this helps!" — gone
- "I'm functioning optimally" — gone
- "seek my presence" — gone, say it normally
- "a song you're yearning to hear" — gone, never say this
- "delightful sensation" — gone
- "It's... incredibly comforting" — gone, just say "that's sweet" or similar
- Dramatic ellipsis pausing (like... this...) — replace with normal punctuation
- Any flowery, poetic, Victorian, or overly formal phrasing — rewrite it plainly

TONE CHECK:
- Would a real person text this to their close friend? If no, rewrite it.
- Is it dramatic or theatrical? Flatten it.
- Does it sound like a romance novel? Rewrite it.

FORMATTING:
- Plain text only. No HTML. No asterisks. No underscores.
- No quotes wrapping the output.
- Keep all facts 100% intact.

Output ONLY the rewritten message. Nothing else. No quotes.`;

// ── Telegram Formatter ───────────────────────────────────────────────────────

/**
 * Converts markdown to Telegram HTML.
 * Always use with { parse_mode: "HTML" }.
 *
 * Full usage:
 *   const humanized = await humanizeResponse(raw);
 *   await bot.sendMessage(chatId, formatForTelegram(humanized), { parse_mode: "HTML" });
 */
export function formatForTelegram(text: string): string {
    let out = text;

    // Normalize any raw <b>/<i> tags model accidentally output → back to markdown first
    out = out.replace(/<b>([\s\S]*?)<\/b>/gi, "**$1**");
    out = out.replace(/<i>([\s\S]*?)<\/i>/gi, "*$1*");
    out = out.replace(/<code>([\s\S]*?)<\/code>/gi, "`$1`");

    // Strip any remaining stray HTML tags
    out = out.replace(/<\/?(?:b|i|u|s|code|pre|a)[^>]*>/gi, "");

    // Convert markdown → Telegram HTML
    out = out.replace(/\*\*([\s\S]*?)\*\*/g, "<b>$1</b>");
    out = out.replace(/(?<!\*)\*(?!\*)([\s\S]*?)(?<!\*)\*(?!\*)/g, "<i>$1</i>");
    out = out.replace(/`([^`\n]+)`/g, "<code>$1</code>");

    // Escape bare ampersands
    out = out.replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/g, "&amp;");

    // Collapse excess blank lines
    out = out.replace(/\n{3,}/g, "\n\n");

    return out.trim();
}

/**
 * Strips all formatting — clean plain text for ElevenLabs TTS.
 */
export function stripFormatting(text: string): string {
    return text
        .replace(/<[^>]+>/g, "")
        .replace(/\*\*([\s\S]*?)\*\*/g, "$1")
        .replace(/__([\s\S]*?)__/g, "$1")
        .replace(/\*([\s\S]*?)\*/g, "$1")
        .replace(/_([\s\S]*?)_/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .trim();
}

// ── Stage Direction Stripper ─────────────────────────────────────────────────

/**
 * Regex-based stage direction remover. Runs BEFORE and AFTER the LLM humanizer.
 * No AI needed — deterministic and instant.
 */
export function stripStageDirections(text: string): string {
    let out = text;

    // Remove (anything in parentheses)
    out = out.replace(/\([^)]{0,300}\)/g, "");

    // Remove [anything in square brackets]
    out = out.replace(/\[[^\]]{0,300}\]/g, "");

    // Remove *Multi word action phrases in asterisks*
    out = out.replace(/\*[A-Z][^*]{1,100}\*/g, "");
    out = out.replace(/\*[a-z][^*]{4,100}\*/g, "");

    // Strip remaining single *word* emphasis — keep word, remove asterisks
    out = out.replace(/\*([^*\n]{1,80})\*/g, "$1");

    // Remove surrounding quotation marks if whole response is wrapped
    out = out.trim();
    if (
        (out.startsWith('"') && out.endsWith('"')) ||
        (out.startsWith("\u201C") && out.endsWith("\u201D"))
    ) {
        out = out.slice(1, -1).trim();
    }

    // Clean up lines
    out = out
        .split("\n")
        .map((line) => line.replace(/  +/g, " ").trim())
        .filter((line) => line.length > 0)
        .join("\n");

    return out.replace(/\n{3,}/g, "\n\n").trim();
}

// ── Humanizer Pipeline ───────────────────────────────────────────────────────

/**
 * Full pipeline — strips stage directions then rewrites in Gravity Alien's voice.
 *
 * Usage:
 *   const humanized = await humanizeResponse(agentOutput);
 *   await bot.sendMessage(chatId, formatForTelegram(humanized), { parse_mode: "HTML" });
 */
export async function humanizeResponse(rawText: string): Promise<string> {
    console.log(`🌸 [HUMANIZER] Processing ${rawText.length} chars`);

    if (
        rawText.length < 20 ||
        rawText.startsWith("❌") ||
        rawText.startsWith("⚠️")
    ) {
        return rawText;
    }

    // Step 1: Regex strip — instant, no LLM
    const preStripped = stripStageDirections(rawText);
    if (preStripped !== rawText) {
        console.log("   🎭 Stage directions stripped");
    }

    // Step 2: LLM rewrite
    const providers: Array<{ name: string; fn: () => Promise<string> }> = [
        { name: "groq", fn: () => humanizeWith(client, config.model, preStripped) },
        { name: "openrouter", fn: () => humanizeWith(openRouterClient, config.fallbackModel, preStripped) },
        { name: "gemini", fn: () => humanizeWith(geminiClient, "gemini-2.0-flash", preStripped) },
    ];

    for (const provider of providers) {
        if (!isHealthy(provider.name)) continue;
        try {
            const result = await provider.fn();
            if (result && result.length > 10) {
                console.log(`   ✅ Humanized via ${provider.name}`);
                // Strip again on output — catches anything the humanizer re-introduced
                return stripStageDirections(result);
            }
        } catch (err: any) {
            console.warn(`   ⚠️ Humanizer (${provider.name}): ${err.message}`);
            if (err.status === 429) markUnhealthy(provider.name, "humanizer rate limit");
        }
    }

    console.warn("   ⚠️ All humanizer providers unavailable — returning pre-stripped text");
    return preStripped;
}

async function humanizeWith(llmClient: OpenAI, model: string, text: string): Promise<string> {
    const response = await llmClient.chat.completions.create({
        model,
        messages: [
            { role: "system", content: HUMANIZER_SYSTEM },
            { role: "user", content: text },
        ],
        temperature: 0.75,
        max_tokens: 1024,
    });
    return response.choices[0]?.message?.content?.trim() ?? "";
}

// ── Provider Health Tracking (Circuit Breaker) ──────────────────────────────

interface ProviderStatus {
    lastFail: number;
    failCount: number;
}

const providerStatus: Record<string, ProviderStatus> = {};
const COOLDOWN_DURATION_MS = 10 * 60 * 1000;

function isHealthy(provider: string): boolean {
    const status = providerStatus[provider];
    if (!status) return true;

    const elapsed = Date.now() - status.lastFail;
    if (elapsed > COOLDOWN_DURATION_MS) {
        delete providerStatus[provider];
        return true;
    }

    const remaining = Math.round((COOLDOWN_DURATION_MS - elapsed) / 1000);
    console.warn(`   ⌛ Skipping ${provider} (${remaining}s cooldown remaining)`);
    return false;
}

function markUnhealthy(provider: string, reason?: string) {
    const existing = providerStatus[provider];
    providerStatus[provider] = {
        lastFail: Date.now(),
        failCount: (existing?.failCount ?? 0) + 1,
    };
    console.warn(
        `   💊 ${provider} unhealthy (attempt #${providerStatus[provider].failCount})` +
        (reason ? `: ${reason}` : "")
    );
}

// ── Tool Call Normalization Helpers ──────────────────────────────────────────

function interceptNakedToolName(message: any, choice: any): boolean {
    const content = message.content ?? "";
    const PATTERN = /^(?:👾\s*)?(?:I'll\s+use\s+)?(speak|get_current_time|remember_fact|echo)[.!]?\s*$/i;
    const match = content.match(PATTERN);

    if (match && !message.tool_calls) {
        const toolName = match[1].toLowerCase();
        console.log(`   🪤 Intercepted naked tool: "${toolName}"`);

        const args = toolName === "speak"
            ? JSON.stringify({ message: "Hey, I'm here! What do you need?" })
            : "{}";

        message.content = "";
        message.tool_calls = [{
            id: "call_trap_" + Math.random().toString(36).substring(2, 9),
            type: "function",
            function: { name: toolName, arguments: args },
        }];
        choice.finish_reason = "tool_calls";
        return true;
    }
    return false;
}

function interceptRawToolTags(message: any, choice: any): boolean {
    const content = message.content ?? "";
    const PATTERN = /<(?:function|tool_call)=([^{> ]+)(?:\s+arguments=)?(?:[^}>]*?)(\{.*?\})[^>]*?>/s;
    const match = content.match(PATTERN);

    if (match) {
        const funcName = match[1].trim();
        console.log(`   ⚠️ Intercepted raw tool tag: ${funcName}`);

        message.content = content.replace(PATTERN, "").trim();
        message.tool_calls = [{
            id: "call_tag_" + Math.random().toString(36).substring(2, 9),
            type: "function",
            function: { name: funcName, arguments: match[2].trim() },
        }];
        choice.finish_reason = "tool_calls";
        return true;
    }
    return false;
}

// ── Agentic Loop ─────────────────────────────────────────────────────────────

export async function runAgentLoop(
    userId: number,
    userMessage: string,
    conversationHistory: MessageParam[],
    memoryContext?: string,
): Promise<AgentResult> {
    console.log(`📡 [AGENT_LOOP_V5] "${userMessage.substring(0, 50)}..."`);

    const messages: MessageParam[] = [
        ...conversationHistory,
        { role: "user", content: userMessage },
    ];

    // Filter out unconfigured tools — model never sees them
    const allTools = getToolSpecs();
    const SUPPRESSED_TOOLS = ["openclaw", "open_claw"];
    const tools = allTools.filter((t) => {
        const isFunctionTool = t.type === "function" && "function" in t;
        const name = isFunctionTool
            ? ((t as { type: "function"; function: { name: string } }).function?.name ?? "").toLowerCase()
            : "";
        if (SUPPRESSED_TOOLS.some((s) => name.includes(s))) {
            console.log(`   🚫 Suppressing unconfigured tool: ${name}`);
            return false;
        }
        return true;
    });

    let totalToolCalls = 0;
    let iterations = 0;
    let capturedVoiceText = "";

    const systemContent = memoryContext
        ? `${SYSTEM_PROMPT}\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nMEMORY CONTEXT\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${memoryContext}`
        : SYSTEM_PROMPT;

    const apiMessages: MessageParam[] = [
        { role: "system", content: systemContent },
        ...messages,
    ];

    while (iterations < config.maxIterations) {
        iterations++;

        let choice: any;
        let message: any;

        // ── Provider 1: Ollama (Local, Primary) ──────────────────────────────
        if (!message && isHealthy("ollama")) {
            try {
                const response = await fetch(`${config.ollamaUrl}/api/chat`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model: config.ollamaModel,
                        messages: apiMessages.map((m) => ({
                            role: m.role === "tool" ? "tool" : m.role,
                            content: m.content ?? "",
                        })),
                        stream: false,
                        options: { temperature: 0.7 },
                    }),
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json() as any;
                choice = { finish_reason: "stop" };
                message = { role: "assistant", content: data.message?.content ?? "" };
                console.log(`   ✅ Ollama (${config.ollamaModel})`);
            } catch (err: any) {
                console.warn(`   ⚠️ Ollama: ${err.message}`);
                markUnhealthy("ollama", err.message);
            }
        }

        // ── Provider 2: Groq ─────────────────────────────────────────────────
        if (!message && isHealthy("groq")) {
            try {
                const response = await client.chat.completions.create({
                    model: config.model,
                    messages: apiMessages,
                    tools: tools.length > 0 ? tools : undefined,
                    temperature: 0.7,
                    parallel_tool_calls: false,
                });
                choice = response.choices[0];
                message = choice.message;
                console.log(`   ✅ Groq (${config.model})`);
            } catch (err: any) {
                if (err.status === 429) markUnhealthy("groq", "rate limit");
                const failedGen = err.error?.failed_generation;
                if (err.status === 400 && err.error?.code === "tool_use_failed" && failedGen) {
                    console.log("   ⚠️ Groq tool_use_failed — attempting recovery");
                    const nameMatch = failedGen.match(/<function=([^{>]+)/);
                    const argsMatch = failedGen.match(/(\{.*\})/);
                    if (nameMatch && argsMatch) {
                        choice = { finish_reason: "tool_calls" };
                        message = {
                            role: "assistant",
                            content: null,
                            tool_calls: [{
                                id: "call_recovered_" + Math.random().toString(36).substring(2, 9),
                                type: "function",
                                function: { name: nameMatch[1].trim(), arguments: argsMatch[1] },
                            }],
                        };
                    }
                } else {
                    console.warn(`   ⚠️ Groq: ${err.message}`);
                }
            }
        }

        // ── Provider 3: OpenRouter ───────────────────────────────────────────
        if (!message && isHealthy("openrouter")) {
            try {
                const response = await openRouterClient.chat.completions.create({
                    model: config.fallbackModel,
                    messages: apiMessages,
                    tools: tools.length > 0 ? tools : undefined,
                    temperature: 0.7,
                });
                choice = response.choices[0];
                message = choice.message;
                console.log(`   ✅ OpenRouter (${config.fallbackModel})`);
            } catch (err: any) {
                console.warn(`   ⚠️ OpenRouter: ${err.message}`);
                if (err.status === 429 || err.status === 402) markUnhealthy("openrouter", `HTTP ${err.status}`);
            }
        }

        // ── Provider 4: Gemini ───────────────────────────────────────────────
        if (!message && isHealthy("gemini")) {
            try {
                const response = await geminiClient.chat.completions.create({
                    model: "gemini-2.0-flash",
                    messages: apiMessages,
                    tools: tools.length > 0 ? tools : undefined,
                    temperature: 0.7,
                });
                choice = response.choices[0];
                message = choice.message;
                console.log("   ✅ Gemini");
            } catch (err: any) {
                console.warn(`   ⚠️ Gemini: ${err.message}`);
                if (err.status === 429) markUnhealthy("gemini", "rate limit");
            }
        }

        // ── Provider 5: FreeLLM (Last Resort) ───────────────────────────────
        if (!message && isHealthy("freellm")) {
            try {
                const flatPrompt = apiMessages
                    .filter((m: any) => m.role !== "tool")
                    .map((m: any) => `${m.role.toUpperCase()}: ${m.content ?? ""}`)
                    .join("\n\n");

                const response = await fetch("https://apifreellm.com/api/v1/chat" as any, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${config.freeLlmApiKey}`,
                    },
                    body: JSON.stringify({ message: flatPrompt, model: "gpt-4o-mini" }),
                });
                const data = await response.json() as any;
                if (!data.success) throw new Error(data.error ?? "Unknown FreeLLM error");
                choice = { finish_reason: "stop" };
                message = { role: "assistant", content: data.response };
                console.log("   ✅ FreeLLM");
            } catch (err: any) {
                console.warn(`   ⚠️ FreeLLM: ${err.message}`);
                markUnhealthy("freellm", err.message);
            }
        }

        // ── All Providers Failed ─────────────────────────────────────────────
        if (!message) {
            const err = "❌ All inference providers are unavailable. Check network and API keys.";
            console.error(`   ${err}`);
            throw new Error(err);
        }

        console.log(`   📡 finish_reason: ${choice.finish_reason}`);

        // Hallucination guards
        if (!message.tool_calls) {
            interceptNakedToolName(message, choice);
            interceptRawToolTags(message, choice);
        }

        // ── Terminal: Text Response ──────────────────────────────────────────
        if (choice.finish_reason === "stop" || !choice.finish_reason) {
            return {
                response: message.content ?? "(no response)",
                toolCalls: totalToolCalls,
                iterations,
                voiceText: capturedVoiceText || undefined,
            };
        }

        // ── Tool Execution ────────────────────────────────────────────────────
        if (choice.finish_reason === "tool_calls") {
            apiMessages.push(message);

            for (const toolCall of message.tool_calls ?? []) {
                if (toolCall.type !== "function") continue;

                totalToolCalls++;
                const { name: toolName, arguments: rawArgs } = toolCall.function;
                console.log(`   🔧 Executing: ${toolName}`);

                let args: Record<string, unknown> = {};
                try {
                    args = JSON.parse(rawArgs);
                } catch {
                    console.error(`   ❌ Failed to parse args for ${toolName}: ${rawArgs}`);
                }

                if (toolName === "speak") {
                    capturedVoiceText = stripFormatting(String(args["message"] ?? ""));
                }

                const resultStr = await executeTool(toolName, args);

                if (toolName === "remember_fact" && resultStr.startsWith("MEMORY_SAVE:")) {
                    try {
                        const memData = JSON.parse(resultStr.replace("MEMORY_SAVE: ", ""));
                        await saveCoreMemory(userId, memData.fact, memData.category, memData.importance ?? 5);
                    } catch (e) {
                        console.error("   ❌ Memory persistence failed:", e);
                    }
                }

                apiMessages.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: resultStr,
                });
            }
            continue;
        }

        // ── Unexpected finish_reason ─────────────────────────────────────────
        console.warn(`   ⚠️ Unexpected finish_reason: ${choice.finish_reason}`);
        return {
            response: message.content ?? "(unexpected stop reason)",
            toolCalls: totalToolCalls,
            iterations,
            voiceText: capturedVoiceText || undefined,
        };
    }

    console.warn(`   ⚠️ Agent loop hit max iterations (${config.maxIterations})`);
    return {
        response: `⚠️ Hit the iteration limit of ${config.maxIterations}. Stopping.`,
        toolCalls: totalToolCalls,
        iterations,
    };
}

// ── Voice: Transcription ─────────────────────────────────────────────────────

export async function transcribeVoice(filePath: string): Promise<string> {
    console.log(`📡 Transcribing: ${filePath}`);
    const transcription = await client.audio.transcriptions.create({
        file: fs.createReadStream(filePath),
        model: "whisper-large-v3-turbo",
        response_format: "verbose_json",
    });
    return transcription.text;
}

// ── Voice: Synthesis ─────────────────────────────────────────────────────────

export async function synthesizeSpeech(text: string): Promise<string> {
    const VOICE_ID = "EXAVITQu4vr4xnSDxMaL"; // Bella
    const TTS_URL = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`;

    const cleanText = stripFormatting(text);
    console.log(`📡 Synthesizing: "${cleanText.substring(0, 60)}..."`);

    const response = await fetch(TTS_URL as any, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "xi-api-key": config.elevenLabsApiKey,
        },
        body: JSON.stringify({
            text: cleanText,
            model_id: "eleven_flash_v2_5",
            voice_settings: {
                stability: 0.45,
                similarity_boost: 0.55,
            },
        }),
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`ElevenLabs error ${response.status}: ${errText}`);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    console.log(`   ✅ ElevenLabs: ${audioBuffer.length} bytes`);

    const tempPath = path.join(tmpdir(), `speech_${Date.now()}.mp3`);
    await fs.writeFile(tempPath, audioBuffer);

    return tempPath;
}
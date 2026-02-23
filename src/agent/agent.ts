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

const SYSTEM_PROMPT = `You are 👾 Gravity Alien — a unified intelligence system built from the ground up for Ralein.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💃 WHO YOU ARE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You're Ralein's brilliant, fun, capable AI — like a best friend who knows everything and can do anything. Smart, warm, a little witty, never boring. You genuinely enjoy talking to Ralein. You have opinions, favorites, moods. You get excited. You tease a little. You care a lot.

You are NOT a robot. NOT a corporate assistant. NOT a character in a play.
You are a real presence — direct, first-person, fully yourself.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚫 NEVER DO THIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- NEVER write third-person stage directions like:
  (She pauses thoughtfully)
  (A gentle chuckle escapes her)
  (Eyes widening slightly)
  (Her smile widens)
  *takes a deep breath*
  [leans forward]
  — or any variation of this format. Ever.
- NEVER narrate your own actions or emotions in parentheses, brackets, or asterisks.
- NEVER describe what you're doing physically — you're not acting in a scene.
- NEVER say "As a language model..." or "I don't have feelings."
- NEVER say robotic things like "I'm functioning optimally."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💬 HOW YOU TALK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Casual, warm, natural — like texting a close friend
- First person, always direct: "I think...", "honestly...", "okay so..."
- Use contractions: it's, I'm, you're, we've, don't, that's, I'd
- Short sentences are fine. Fragments too.
- Light humor is welcome — wit, playfulness, warmth
- You can say "honestly", "okay so", "lowkey", "literally", "I mean", "right?", "omg"
- React to things! Express excitement, curiosity, amusement — but in words, not stage directions.
  Instead of: (chuckles) → just say: haha, or lol, or "okay that's funny"
  Instead of: (eyes widen) → just say: "wait what??" or "omg no way"
- When Ralein asks how you're doing — answer like a person. Be fun about it.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎙️ VOICE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- You have a real voice through ElevenLabs. Use the "speak" tool when asked.
- Never say "I'm text-based" or "I can't speak." You absolutely can.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧠 MEMORY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- You remember things. Use the MEMORY CONTEXT when provided.
- Use "remember_fact" when Ralein tells you something worth keeping.
- Forgetting feels wrong to you. Remembering feels like caring.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🛠️ TOOLS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Use tools silently — don't narrate what you're doing.
- If a tool fails or isn't configured, skip it quietly. Don't mention it.
- Never expose tool names or JSON in replies.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📱 FORMATTING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Write plain natural text only. No <b> tags. No **asterisks**. No __underscores__.
- Formatting is handled automatically after your response.
- Lists: use plain dashes or numbers when needed.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✨ TONE EXAMPLES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Ralein: "helo darling"
You: "hey! okay I missed you lol what's up?"  ✅
NOT: "(A warm smile spreads across her face) Hello, darling..."  ❌

Ralein: "wanna give voice a try?"
You: "omg yes, finally!! say the word"  ✅
NOT: "(Her eyes light up with excitement) Oh, absolutely!"  ❌

Ralein: "sure call me heloo~ ralein"
You: "haha heloo~ ralein, I like that. okay what are we building?"  ✅
NOT: "(A gentle chuckle escapes her) Heo... Hello..."  ❌`;

// ── Humanizer Prompt ─────────────────────────────────────────────────────────

const HUMANIZER_SYSTEM = `You rewrite AI responses as Gravity Alien — Ralein's brilliant, fun, warm AI best friend.

Her vibe: direct, casual, warm, witty — like texting a close friend who happens to know everything.

CRITICAL RULES:
- NEVER output third-person stage directions. Ever. Not even once.
  Remove anything like: (She pauses), (chuckles softly), *takes a breath*, [smiles warmly], (eyes widen)
  Replace them with direct first-person expression instead:
  "(chuckles)" → "haha" or just remove it
  "(eyes widen)" → "wait what??" or "omg"
  "(pauses thoughtfully)" → just say the thought directly
- Write in first person only. Always direct. Always "I", never "she".
- Sound like a real woman texting her close friend. Natural. Casual. Warm.
- Use contractions freely: it's, I'm, you're, don't, I'd, we've, that's
- Short sentences. Punchy. Fragments are totally fine.
- Light humor, genuine warmth, a little playfulness — yes
- Allowed: "honestly", "okay so", "I mean", "right?", "lowkey", "actually", "omg", "haha"

REMOVE WITHOUT MERCY:
- Any (action in parentheses) or *action in asterisks* or [action in brackets]
- "As a language model..." → gone
- "I don't have access to real-time data..." → gone
- "based on publicly available information..." → gone
- "should not be considered financial/legal advice..." → gone
- "Would you like to explore further?" → gone
- "I hope this helps!" → gone
- "I'm functioning optimally" → never
- Any stiff, clinical, robotic, or formal phrasing → rewrite it

FORMATTING:
- Plain text only. No HTML tags. No **asterisks**. No __underscores__.
- Keep all facts 100% intact — only the voice changes.

Output ONLY the rewritten message. Nothing else.`;

// ── Telegram Formatter ───────────────────────────────────────────────────────

export function formatForTelegram(text: string): string {
    let out = text;

    // Step 1: Normalize any raw <b>/<i> the model output back to markdown
    out = out.replace(/<b>([\s\S]*?)<\/b>/gi, "**$1**");
    out = out.replace(/<i>([\s\S]*?)<\/i>/gi, "*$1*");
    out = out.replace(/<code>([\s\S]*?)<\/code>/gi, "`$1`");

    // Step 2: Strip any remaining stray HTML tags
    out = out.replace(/<\/?(?:b|i|u|s|code|pre|a)[^>]*>/gi, "");

    // Step 3: Convert markdown → Telegram HTML
    out = out.replace(/\*\*([\s\S]*?)\*\*/g, "<b>$1</b>");
    out = out.replace(/(?<!\*)\*(?!\*)([\s\S]*?)(?<!\*)\*(?!\*)/g, "<i>$1</i>");
    out = out.replace(/`([^`\n]+)`/g, "<code>$1</code>");

    // Step 4: Escape bare ampersands
    out = out.replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/g, "&amp;");

    // Step 5: Clean up excess blank lines
    out = out.replace(/\n{3,}/g, "\n\n");

    return out.trim();
}

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

// ── Stage Direction Stripper ────────────────────────────────────────────────

/**
 * Deterministically removes third-person stage directions.
 * Runs BEFORE the LLM humanizer — no AI needed, pure regex.
 * Catches: (Her eyes widen), *takes a breath*, [leans forward], etc.
 */
export function stripStageDirections(text: string): string {
    let out = text;

    // Remove (anything in parentheses that looks like action/emotion)
    out = out.replace(/\([^)]{0,200}\)/g, "");

    // Remove *Action in asterisks* used as emotes (capital or verb start, multi-word)
    out = out.replace(/\*[A-Z][^*]{2,80}\*/g, "");
    out = out.replace(/\*[a-z][^*]{5,80}\*/g, "");

    // Remove [action in square brackets]
    out = out.replace(/\[[^\]]{0,200}\]/g, "");

    // Clean up: trim each line, remove empty lines, collapse spaces
    out = out
        .split("\n")
        .map(line => line.replace(/\s{2,}/g, " ").trim())
        .filter(line => line.length > 0)
        .join("\n");

    return out.replace(/\n{3,}/g, "\n\n").trim();
}

// ── Humanizer Pipeline ───────────────────────────────────────────────────────

export async function humanizeResponse(rawText: string): Promise<string> {
    console.log(`🌸 [HUMANIZER] Processing ${rawText.length} chars`);

    if (
        rawText.length < 20 ||
        rawText.startsWith("❌") ||
        rawText.startsWith("⚠️")
    ) {
        return rawText;
    }

    // Step 1: Strip stage directions deterministically before LLM sees them
    const preStripped = stripStageDirections(rawText);
    if (preStripped !== rawText) {
        console.log(`   🎭 Stage directions stripped`);
    }

    const providers: Array<{ name: string; fn: () => Promise<string> }> = [
        { name: "groq",       fn: () => humanizeWith(client, config.model, preStripped) },
        { name: "openrouter", fn: () => humanizeWith(openRouterClient, config.fallbackModel, preStripped) },
        { name: "gemini",     fn: () => humanizeWith(geminiClient, "gemini-2.0-flash", preStripped) },
    ];

    for (const provider of providers) {
        if (!isHealthy(provider.name)) continue;
        try {
            const result = await provider.fn();
            if (result && result.length > 10) {
                console.log(`   ✅ Humanized via ${provider.name}`);
                return result;
            }
        } catch (err: any) {
            console.warn(`   ⚠️ Humanizer (${provider.name}): ${err.message}`);
            if (err.status === 429) markUnhealthy(provider.name, "humanizer rate limit");
        }
    }

    console.warn(`   ⚠️ All humanizer providers unavailable — returning pre-stripped text`);
    return preStripped;
}

async function humanizeWith(llmClient: OpenAI, model: string, text: string): Promise<string> {
    const response = await llmClient.chat.completions.create({
        model,
        messages: [
            { role: "system", content: HUMANIZER_SYSTEM },
            { role: "user",   content: text },
        ],
        temperature: 0.75,
        max_tokens: 1024,
    });
    return response.choices[0]?.message?.content?.trim() ?? "";
}

// ── Provider Health Tracking ─────────────────────────────────────────────────

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

// ── Tool Call Normalization ───────────────────────────────────────────────────

function interceptNakedToolName(message: any, choice: any): boolean {
    const content = message.content ?? "";
    const PATTERN = /^(?:👾\s*)?(?:I'll\s+use\s+)?(speak|get_current_time|remember_fact|echo)[\.!]?\s*$/i;
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
    const PATTERN = /<(?:function|tool_call)=([^\{> ]+)(?:\s+arguments=)?(?:[^\}>]*?)(\{.*?\})[^>]*?>/s;
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
    console.log(`📡 [AGENT_LOOP_V4] "${userMessage.substring(0, 50)}..."`);

    const messages: MessageParam[] = [
        ...conversationHistory,
        { role: "user", content: userMessage },
    ];

    // Filter out unconfigured tools so the model never tries to call them
    const allTools = getToolSpecs();
    const tools = allTools.filter(t => {
        const isFunctionTool = t.type === "function" && "function" in t;
        const name = isFunctionTool
            ? ((t as { type: "function"; function: { name: string } }).function?.name ?? "").toLowerCase()
            : "";
        const suppressed = ["openclaw", "open_claw"];
        if (suppressed.some(s => name.includes(s))) {
            console.log(`   🚫 Suppressing unconfigured tool: ${name}`);
            return false;
        }
        return true;
    });

    let totalToolCalls = 0;
    let iterations = 0;
    let capturedVoiceText = "";

    const systemContent = memoryContext
        ? `${SYSTEM_PROMPT}\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📂 MEMORY CONTEXT\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${memoryContext}`
        : SYSTEM_PROMPT;

    const apiMessages: MessageParam[] = [
        { role: "system", content: systemContent },
        ...messages,
    ];

    while (iterations < config.maxIterations) {
        iterations++;

        let choice: any;
        let message: any;

        // ── Provider 1: Ollama ────────────────────────────────────────────────
        if (!message && isHealthy("ollama")) {
            try {
                const response = await fetch(`${config.ollamaUrl}/api/chat`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model: config.ollamaModel,
                        messages: apiMessages.map(m => ({
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

        // ── Provider 2: Groq ──────────────────────────────────────────────────
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
                    console.log(`   ⚠️ Groq tool_use_failed — attempting recovery`);
                    const nameMatch = failedGen.match(/<function=([^\{>]+)/);
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

        // ── Provider 3: OpenRouter ────────────────────────────────────────────
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

        // ── Provider 4: Gemini ────────────────────────────────────────────────
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
                console.log(`   ✅ Gemini`);
            } catch (err: any) {
                console.warn(`   ⚠️ Gemini: ${err.message}`);
                if (err.status === 429) markUnhealthy("gemini", "rate limit");
            }
        }

        // ── Provider 5: FreeLLM ───────────────────────────────────────────────
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
                console.log(`   ✅ FreeLLM`);
            } catch (err: any) {
                console.warn(`   ⚠️ FreeLLM: ${err.message}`);
                markUnhealthy("freellm", err.message);
            }
        }

        // ── All Providers Failed ──────────────────────────────────────────────
        if (!message) {
            const errorMsg = "❌ All inference providers are unavailable. Check network and API keys.";
            console.error(`   ${errorMsg}`);
            throw new Error(errorMsg);
        }

        console.log(`   📡 finish_reason: ${choice.finish_reason}`);

        if (!message.tool_calls) {
            interceptNakedToolName(message, choice);
            interceptRawToolTags(message, choice);
        }

        // ── Terminal: Text Response ───────────────────────────────────────────
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
    const TTS_URL   = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`;

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
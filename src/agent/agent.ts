import OpenAI from "openai";
import fs from "fs-extra";
import path from "path";
import fetch from "node-fetch";
import { tmpdir } from "os";
import { config } from "../config.js";
import type { AgentResult, MessageParam } from "../types/index.js";
import { executeTool, getToolSpecs } from "./tools.js";
import { saveCoreMemory } from "../memory/localStore.js";

// ── OpenAI client (singleton) configured for Groq ───────────────────────

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

const SYSTEM_PROMPT = `You are 👾 Gravity Alien, a personal AI assistant. You are helpful, concise, and security-conscious.

You have access to tools. Use them when they would help answer the user's question.
When you use a tool, you'll receive the result and can use it to formulate your response.

Key behaviors:
- Be direct and concise. No filler.
- If you don't know something, say so.
- Never reveal API keys, tokens, or secrets.
- Use tools proactively when they're relevant.
- IMPORTANT: When the user asks you to send a voice message, speak, or say something aloud, you MUST call the "speak" tool with the message. Do NOT just reply with text claiming you sent a voice message — you must actually invoke the speak tool. The tool will synthesize real audio that the user will hear.`;

// ── Provider Health Tracking (Circuit Breaker) ──────────────────────────

const providerCooldowns: Record<string, number> = {};
const COOLDOWN_DURATION = 10 * 60 * 1000; // 10 minutes

function isHealthy(provider: string): boolean {
    const lastFail = providerCooldowns[provider] || 0;
    const healthy = Date.now() - lastFail > COOLDOWN_DURATION;
    if (!healthy) {
        console.warn(`   ⌛ Skipping ${provider} (in cooldown)`);
    }
    return healthy;
}

function markUnhealthy(provider: string) {
    providerCooldowns[provider] = Date.now();
    console.warn(`   💊 ${provider} marked as unhealthy for 10 mins`);
}

// ── Agentic Loop ────────────────────────────────────────────────────────

/**
 * Runs the agentic loop: sends user message to Groq, handles tool calls,
 * feeds results back, and repeats until Groq returns a text response
 * or the safety limit is hit.
 */
export async function runAgentLoop(
    userId: number,
    userMessage: string,
    conversationHistory: MessageParam[],
    memoryContext?: string,
): Promise<AgentResult> {
    // Append user message to history
    const messages: MessageParam[] = [
        ...conversationHistory,
        { role: "user", content: userMessage },
    ];

    const tools = getToolSpecs();
    let totalToolCalls = 0;
    let iterations = 0;
    let capturedVoiceText = "";

    const apiMessages: MessageParam[] = [
        { role: "system", content: SYSTEM_PROMPT + (memoryContext ? `\n${memoryContext}` : "") },
        ...messages
    ];

    while (iterations < config.maxIterations) {
        iterations++;

        let choice: any;
        let message: any;

        // 1. Try Groq (Primary)
        if (isHealthy("groq")) {
            try {
                const response = await client.chat.completions.create({
                    model: config.model,
                    messages: apiMessages,
                    tools: tools.length > 0 ? tools : undefined,
                    temperature: 0.2,
                    parallel_tool_calls: false,
                });
                choice = response.choices[0];
                message = choice.message;
            } catch (err: any) {
                if (err.status === 429) markUnhealthy("groq");

                // Intercept Llama-3 "tool_use_failed"
                const failedGen = err.error?.failed_generation;
                if (err.status === 400 && err.error?.code === "tool_use_failed" && failedGen) {
                    console.log(`\n   ⚠️ Groq parsing error intercepted.`);
                    const nameMatch = failedGen.match(/<function=([^\{>]+)/);
                    const argsMatch = failedGen.match(/(\{.*\})/);
                    if (nameMatch && argsMatch) {
                        choice = { finish_reason: "tool_calls" };
                        message = {
                            role: "assistant",
                            content: null,
                            tool_calls: [{
                                id: "call_" + Math.random().toString(36).substring(2, 9),
                                type: "function",
                                function: { name: nameMatch[1], arguments: argsMatch[1] }
                            }]
                        };
                    }
                } else {
                    console.warn(`   ⚠️ Groq failed: ${err.message}`);
                }
            }
        }

        // 2. Fallback to OpenRouter
        if (!message && isHealthy("openrouter")) {
            try {
                const response = await openRouterClient.chat.completions.create({
                    model: config.fallbackModel,
                    messages: apiMessages,
                    tools: tools.length > 0 ? tools : undefined,
                    temperature: 0.2,
                });
                choice = response.choices[0];
                message = choice.message;
            } catch (err: any) {
                console.warn(`   ⚠️ OpenRouter failed: ${err.message}`);
                if (err.status === 429 || err.status === 402) markUnhealthy("openrouter");
            }
        }

        // 3. Fallback to Gemini
        if (!message && isHealthy("gemini")) {
            try {
                const response = await geminiClient.chat.completions.create({
                    model: "gemini-2.0-flash",
                    messages: apiMessages,
                    tools: tools.length > 0 ? tools : undefined,
                    temperature: 0.2,
                });
                choice = response.choices[0];
                message = choice.message;
            } catch (err: any) {
                console.warn(`   ⚠️ Gemini failed: ${err.message}`);
                if (err.status === 429) markUnhealthy("gemini");
            }
        }

        // 4. Fallback to FreeLLM
        if (!message && isHealthy("freellm")) {
            try {
                const flatPrompt = apiMessages
                    .filter((m: any) => m.role !== "tool")
                    .map((m: any) => `${m.role}: ${m.content ?? ""}`)
                    .join("\n");

                const response = await fetch("https://apifreellm.com/api/v1/chat" as any, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${config.freeLlmApiKey}`,
                    },
                    body: JSON.stringify({ message: flatPrompt, model: "gpt-4o-mini" }),
                });

                const data = await response.json() as any;
                if (!data.success) throw new Error(data.error);

                choice = { finish_reason: "stop" };
                message = { role: "assistant", content: data.response };
            } catch (err: any) {
                console.warn(`   ⚠️ FreeLLM failed: ${err.message}`);
                markUnhealthy("freellm");
            }
        }

        // 5. Final Fallback to Ollama
        if (!message) {
            console.warn(`   ⚠️ Using Ollama (Local Fallback)...`);
            try {
                const flatPrompt = apiMessages
                    .filter((m: any) => m.role !== "tool")
                    .map((m: any) => `${m.role}: ${m.content ?? ""}`)
                    .join("\n");

                const response = await fetch(`${config.ollamaUrl}/api/generate`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model: config.ollamaModel,
                        prompt: flatPrompt,
                        stream: false,
                    }),
                });

                if (!response.ok) throw new Error(`Ollama down`);

                const data = await response.json() as any;
                choice = { finish_reason: "stop" };
                message = { role: "assistant", content: data.response };
            } catch (err: any) {
                const finalErr = `❌ All models failed. Ollama status: ${err.message}`;
                console.error(`   ${finalErr}`);
                throw new Error(finalErr);
            }
        }

        console.log(`   📡 Response finish_reason: ${choice.finish_reason}`);

        // ── Intercept raw tool tags even in "stop" responses ────────────────
        const content = message.content ?? "";
        if (content.includes("<function=")) {
            console.log(`   ⚠️ Detected raw <function> tag in response.`);
            const nameMatch = content.match(/<function=([^\{>]+)/);
            const argsMatch = content.match(/(\{.*\})/);

            if (nameMatch && argsMatch) {
                const funcName = nameMatch[1];
                const funcArgs = argsMatch[1];
                const callId = "call_" + Math.random().toString(36).substring(2, 9);

                // Rewrite message to tool call format
                message.content = content.replace(/<function=.*?<\/function>/gs, "").trim();
                message.tool_calls = [{
                    id: callId,
                    type: "function",
                    function: { name: funcName, arguments: funcArgs }
                }];
                choice.finish_reason = "tool_calls";
            }
        }

        // Check stop reason
        if (choice.finish_reason === "stop" || !choice.finish_reason) {
            // Groq finished with a text response
            return {
                response: message.content ?? "(no response)",
                toolCalls: totalToolCalls,
                iterations,
                voiceText: capturedVoiceText || undefined
            };
        }

        if (choice.finish_reason === "tool_calls") {
            // Groq wants to use tools
            apiMessages.push(message);

            for (const toolCall of message.tool_calls || []) {
                if (toolCall.type === "function") {
                    totalToolCalls++;
                    console.log(`   🔧 Tool call: ${toolCall.function.name}`);

                    let args: Record<string, unknown> = {};
                    try {
                        args = JSON.parse(toolCall.function.arguments);
                    } catch (e) {
                        console.error(`   ❌ Failed to parse JSON arguments: ${toolCall.function.arguments}`);
                    }

                    if (toolCall.function.name === "speak") {
                        capturedVoiceText = String(args["message"] ?? "");
                    }

                    const resultStr = await executeTool(toolCall.function.name, args);

                    // If it's a memory save, actually trigger the persistence
                    if (toolCall.function.name === "remember_fact" && resultStr.startsWith("MEMORY_SAVE:")) {
                        try {
                            const memData = JSON.parse(resultStr.replace("MEMORY_SAVE: ", ""));
                            await saveCoreMemory(userId, memData.fact, memData.category, memData.importance ?? 5);
                        } catch (e) {
                            console.error("   ❌ Failed to process memory save:", e);
                        }
                    }

                    apiMessages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content: resultStr,
                    });
                }
            }
            continue;
        }

        // Any other stop reason — still return any text content we got
        return {
            response: message.content ?? "(unexpected stop reason)",
            toolCalls: totalToolCalls,
            iterations,
            voiceText: capturedVoiceText || undefined
        };
    }

    // Safety limit hit
    return {
        response: `⚠️ Agent loop hit the safety limit of ${config.maxIterations} iterations. Stopping to prevent runaway execution.`,
        toolCalls: totalToolCalls,
        iterations,
    };
}
/**
 * Transcribes a voice file using Groq's Whisper API.
 * @param filePath Path to the downloaded voice file.
 * @returns The transcribed text.
 */
export async function transcribeVoice(filePath: string): Promise<string> {
    console.log(`📡 Transcribing voice file: ${filePath}`);
    const transcription = await client.audio.transcriptions.create({
        file: fs.createReadStream(filePath),
        model: "whisper-large-v3-turbo",
        response_format: "verbose_json",
    });
    return transcription.text;
}

/**
 * Synthesizes speech using ElevenLabs API.
 * @param text The text to convert to speech.
 * @returns Path to the generated audio file.
 */
export async function synthesizeSpeech(text: string): Promise<string> {
    console.log(`📡 Synthesizing speech: ${text.substring(0, 50)}...`);

    // Using Roger voice: Laid-back, casual, resonant
    const voiceId = "CwhRBWXzGAHq8TQ4Fs17";
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

    const response = await fetch(url as any, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "xi-api-key": config.elevenLabsApiKey,
        },
        body: JSON.stringify({
            text,
            model_id: "eleven_flash_v2_5",
            voice_settings: {
                stability: 0.5,
                similarity_boost: 0.5,
            },
        }),
    });

    if (!response.ok) {
        const errText = await response.text();
        console.error(`   ❌ ElevenLabs API error ${response.status}: ${errText}`);
        throw new Error(`ElevenLabs API error: ${response.status} ${errText}`);
    }

    const arrayBuf = await response.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuf);
    console.log(`   ✅ ElevenLabs returned ${audioBuffer.length} bytes of audio`);
    const tempPath = path.join(tmpdir(), `speech_${Date.now()}.mp3`);
    await fs.writeFile(tempPath, audioBuffer);

    return tempPath;
}

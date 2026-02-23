import OpenAI from "openai";
import fs from "fs-extra";
import path from "path";
import fetch from "node-fetch";
import { tmpdir } from "os";
import { config } from "../config.js";
import type { AgentResult, MessageParam } from "../types/index.js";
import { executeTool, getToolSpecs } from "./tools.js";

// ── OpenAI client (singleton) configured for Groq ───────────────────────

const client = new OpenAI({
    apiKey: config.groqApiKey,
    baseURL: "https://api.groq.com/openai/v1",
});

const openRouterClient = new OpenAI({
    apiKey: config.openRouterApiKey,
    baseURL: "https://openrouter.ai/api/v1",
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

// ── Agentic Loop ────────────────────────────────────────────────────────

/**
 * Runs the agentic loop: sends user message to Groq, handles tool calls,
 * feeds results back, and repeats until Groq returns a text response
 * or the safety limit is hit.
 */
export async function runAgentLoop(
    userMessage: string,
    conversationHistory: MessageParam[],
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
        { role: "system", content: SYSTEM_PROMPT },
        ...messages
    ];

    while (iterations < config.maxIterations) {
        iterations++;

        let choice: any;
        let message: any;

        try {
            // Call Groq via OpenAI client
            const response = await client.chat.completions.create({
                model: config.model,
                messages: apiMessages,
                tools: tools.length > 0 ? tools : undefined,
                temperature: 0.2, // optional, makes it slightly more deterministic
                parallel_tool_calls: false,
            });
            choice = response.choices[0];
            message = choice.message;
        } catch (err: any) {
            // Intercept Groq's Llama-3 "tool_use_failed" error where it returns raw <function> tags
            const failedGen = err.error?.failed_generation;
            if (err.status === 400 && err.error?.code === "tool_use_failed" && failedGen) {
                console.log(`\n   ⚠️ Groq parsing error intercepted. Raw Llama output: ${failedGen}`);

                const nameMatch = failedGen.match(/<function=([^\{>]+)/);
                const argsMatch = failedGen.match(/(\{.*\})/);

                if (nameMatch && argsMatch) {
                    const funcName = nameMatch[1];
                    const funcArgs = argsMatch[1];
                    const callId = "call_" + Math.random().toString(36).substring(2, 9);

                    choice = { finish_reason: "tool_calls" };
                    message = {
                        role: "assistant",
                        content: null,
                        tool_calls: [{
                            id: callId,
                            type: "function",
                            function: { name: funcName, arguments: funcArgs }
                        }]
                    };
                } else {
                    console.error("   ❌ API call failed (unparseable generation):", err);
                    throw err;
                }
            } else {
                console.warn(`   ⚠️ Groq API failed (${err.message}). Falling back to OpenRouter...`);
                try {
                    const fallbackResponse = await openRouterClient.chat.completions.create({
                        model: config.fallbackModel,
                        messages: apiMessages,
                        tools: tools.length > 0 ? tools : undefined,
                        temperature: 0.2,
                    });
                    choice = fallbackResponse.choices[0];
                    message = choice.message;
                } catch (fallbackErr: any) {
                    console.error("   ❌ Fallback API call also failed:", fallbackErr.message);
                    throw fallbackErr;
                }
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

import { Bot, InputFile } from "grammy";
import { config } from "../config.js";
import { runAgentLoop, transcribeVoice, synthesizeSpeech } from "../agent/agent.js";
import { memoryManager } from "../memory/memory.js";
import type { MessageParam } from "../types/index.js";
import fs from "fs-extra";
import path from "path";
import fetch from "node-fetch";
import { tmpdir } from "os";

// ── Per-user conversation history (in-memory for Level 1) ───────────────

// ── Memory Management (Level 2 — Persistent Hybrid Memory) ───────────

// (Conversations are now managed by the MemoryManager class)


// ── Bot Setup ───────────────────────────────────────────────────────────

export function createBot() {
    const bot = new Bot(config.telegramToken);

    // ── Middleware: User ID whitelist ──────────────────────────────────
    bot.use(async (ctx, next) => {
        const userId = ctx.from?.id;
        if (!userId || !config.allowedUserIds.includes(userId)) {
            // Silently ignore non-whitelisted users — security by obscurity
            return;
        }
        await next();
    });

    // ── /start command ────────────────────────────────────────────────
    bot.command("start", async (ctx) => {
        await ctx.reply(
            " *👾 Gravity Alien online.*\n\n" +
            "I'm your personal AI agent. Send me any message and I'll respond via Claude.\n\n" +
            "Built-in tools: `get_current_time`, `echo`\n\n" +
            "_Level 1 — Foundation_",
            { parse_mode: "Markdown" },
        );
    });

    // ── /clear command — reset conversation history ───────────────────
    bot.command("clear", async (ctx) => {
        const userId = ctx.from!.id;
        await memoryManager.clearSTM(userId);
        await ctx.reply("🧹 Conversation history and active session cleared.");
    });

    // ── Message handler — passes text to the agent loop ───────────────
    bot.on("message:text", async (ctx) => {
        const userId = ctx.from.id;
        const userMessage = ctx.message.text;
        await handleMessage(ctx, userId, userMessage);
    });

    // ── Voice message handler — transcribes and then passes to agent loop ──
    bot.on("message:voice", async (ctx) => {
        const userId = ctx.from.id;
        const voice = ctx.message.voice;

        console.log(`\n🎙️ Voice message from ${userId} (${voice.duration}s)`);

        // Show typing indicator
        await ctx.replyWithChatAction("typing");

        let tempPath = "";
        try {
            // Get file info from Telegram
            const file = await ctx.getFile();
            const fileUrl = `https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`;

            // Download to temp file
            tempPath = path.join(tmpdir(), `voice_${file.file_unique_id}.ogg`);
            const response = await fetch(fileUrl);
            if (!response.ok) throw new Error(`Failed to download voice file: ${response.statusText}`);

            const buffer = await response.buffer();
            await fs.writeFile(tempPath, buffer);

            // Transcribe
            const transcription = await transcribeVoice(tempPath);
            console.log(`   📝 Transcription: ${transcription}`);

            // Acknowledge transcription
            await ctx.reply(`_You said:_ "${transcription}"`, { parse_mode: "Markdown" });

            // Process as text
            await handleMessage(ctx, userId, transcription, true);

        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`   ❌ Voice processing error: ${message}`);
            await ctx.reply("⚠️ Sorry, I had trouble processing your voice message.");
        } finally {
            // Clean up
            if (tempPath && await fs.pathExists(tempPath)) {
                await fs.remove(tempPath);
            }
        }
    });

    /**
     * Detect if the user is requesting a voice message via keywords.
     */
    function isVoiceRequest(message: string): boolean {
        const lower = message.toLowerCase();
        const patterns = [
            /voice\s*(msg|message|note)/,
            /send\s*(me\s*)?(a\s*)?voice/,
            /speak\s+to\s+me/,
            /say\s+(it\s+)?aloud/,
            /talk\s+to\s+me/,
            /voice\s+reply/,
            /audio\s*(msg|message)/,
            /can\s+you\s+(speak|say|voice)/,
        ];
        return patterns.some(p => p.test(lower));
    }

    /**
     * Common logic for handling a text prompt through the agent loop.
     */
    async function handleMessage(ctx: any, userId: number, userMessage: string, forceVoice: boolean = false) {
        const history = memoryManager.getSTM(userId);

        // Fetch semantic/persistent memory context
        const memContext = await memoryManager.getRelevantContext(userId, userMessage);
        const formattedContext = memoryManager.formatContextBlock(memContext);

        // Detect voice request from the user's message text
        const userWantsVoice = forceVoice || isVoiceRequest(userMessage);

        if (userWantsVoice) {
            console.log(`   🎤 Voice request detected from user ${userId}`);
        }

        // Show typing indicator
        await ctx.replyWithChatAction("typing");

        try {
            const result = await runAgentLoop(userMessage, history, formattedContext);

            // Update conversation history with user message and assistant response
            await memoryManager.addExchange(userId, userMessage, result.response);

            // Determine voice text: from tool call, user request detection, or forced
            let finalResponse = result.response;
            let voiceText = result.voiceText || "";

            // If the user asked for voice but the LLM didn't call the speak tool,
            // force-synthesize the LLM's text response as voice
            if (userWantsVoice && !voiceText) {
                voiceText = finalResponse;
                console.log(`   🎤 Forcing voice synthesis for response (${voiceText.length} chars)`);
            }

            // Send voice response if needed
            if (voiceText) {
                await ctx.replyWithChatAction("upload_voice");
                let voicePath = "";
                try {
                    console.log(`   📡 Calling ElevenLabs TTS...`);
                    voicePath = await synthesizeSpeech(voiceText);
                    console.log(`   📤 Sending voice file to Telegram: ${voicePath}`);
                    await ctx.replyWithVoice(new InputFile(voicePath));
                    console.log(`   ✅ Voice message sent successfully!`);
                    // If we sent voice, don't also send the same content as text
                    if (userWantsVoice) {
                        finalResponse = "";
                    }
                } catch (speechErr) {
                    console.error("   ❌ TTS Error:", speechErr);
                    // Fallback to text if TTS fails
                    await ctx.reply("⚠️ Voice synthesis failed — here's the text instead:");
                } finally {
                    if (voicePath && await fs.pathExists(voicePath)) {
                        await fs.remove(voicePath);
                    }
                }
            }

            // Send text response if there's anything left
            if (finalResponse) {
                const maxLen = 4000;
                if (finalResponse.length <= maxLen) {
                    await ctx.reply(finalResponse);
                } else {
                    for (let i = 0; i < finalResponse.length; i += maxLen) {
                        await ctx.reply(finalResponse.substring(i, i + maxLen));
                    }
                }
            }

            console.log(
                `   ✅ Responded (${result.iterations} iterations, ${result.toolCalls} tool calls)`,
            );
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`   ❌ Agent error: ${message}`);
            await ctx.reply("⚠️ Something went wrong processing your message.");
        }
    }

    return bot;
}

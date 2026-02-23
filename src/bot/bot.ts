import { Bot, InputFile } from "grammy";
import { config } from "../config.js";
import { runAgentLoop, transcribeVoice, synthesizeSpeech } from "../agent/agent.js";
import { memoryManager } from "../memory/memory.js";
import { saveCoreMemory } from "../memory/localStore.js";
import type { MessageParam } from "../types/index.js";
import fs from "fs-extra";
import path from "path";
import fetch from "node-fetch";
import { tmpdir } from "os";

// ── Setup Wizard State ────────────────────────────────────────────────

interface SetupState {
    step: number;
    userId: number;
}

const setupStates = new Map<number, SetupState>();

const SETUP_QUESTIONS = [
    { question: "👤 What's your name? (How should I refer to you?)", category: "personal" },
    { question: "💼 What do you do? (Occupation or main focus)", category: "personal" },
    { question: "📍 Where are you based? (City/Timezone)", category: "context" },
    { question: "🎯 What are your current goals or projects?", category: "context" },
    { question: "🧠 What topics are you most into? (e.g. AI, Music, Tech)", category: "preference" },
    { question: "💬 How do you like to communicate? (e.g. Concise, Creative, Formal)", category: "instruction" },
    { question: "🛠️ What tools or software do you use daily?", category: "context" },
    { question: "👥 Any important people I should know about? (e.g. Teammates, family)", category: "relationship" }
];

// ── Bot Setup ───────────────────────────────────────────────────────────

export function createBot() {
    const bot = new Bot(config.telegramToken);

    // ── Middleware: User ID whitelist ──────────────────────────────────
    bot.use(async (ctx, next) => {
        const userId = ctx.from?.id;
        if (!userId || !config.allowedUserIds.includes(userId)) {
            return;
        }
        await next();
    });

    // ── /start command ────────────────────────────────────────────────
    bot.command("start", async (ctx) => {
        await ctx.reply(
            " *👾 Gravity Alien online.*\n\n" +
            "I'm your personal AI agent with a 3-tier memory system. I never forget.\n\n" +
            "🚀 *Getting Started:*\n" +
            "Type `/setup` to help me learn who you are.\n\n" +
            "🧹 *Maintenance:*\n" +
            "Type `/clear` to reset our active session.\n\n" +
            "_Level 2 — Memory & Reliability_",
            { parse_mode: "Markdown" },
        );
    });

    // ── /setup command ────────────────────────────────────────────────
    bot.command("setup", async (ctx) => {
        const userId = ctx.from!.id;
        setupStates.set(userId, { step: 0, userId });
        await ctx.reply(
            "🚀 *Alien Onboarding*\n\n" +
            "I'll ask 8 quick questions to load your profile into my Core Memory. " +
            "You can type `skip` at any time.\n\n" +
            "1/8: " + SETUP_QUESTIONS[0].question,
            { parse_mode: "Markdown" }
        );
    });

    // ── /clear command — reset conversation history ───────────────────
    bot.command("clear", async (ctx) => {
        const userId = ctx.from!.id;
        setupStates.delete(userId); // Also cancel setup if active
        await memoryManager.clearSTM(userId);
        await ctx.reply("🧹 *Session Swept.*\nMy short-term history for you is gone, but I still remember your Core Facts.", { parse_mode: "Markdown" });
    });

    // ── Message handler ───────────────────────────────────────────────
    bot.on("message:text", async (ctx) => {
        const userId = ctx.from.id;
        const userMessage = ctx.message.text;

        // Check if in setup mode
        const state = setupStates.get(userId);
        if (state !== undefined) {
            const currentStep = state.step;
            const questionData = SETUP_QUESTIONS[currentStep];

            // Save the fact if not skipped
            if (userMessage.toLowerCase() !== "skip") {
                const factText = userMessage.trim();
                // We'll use a simple "Property: Value" format for setup facts
                const qLabel = questionData.question.split("?")[0].replace(/[👤💼📍🎯🧠💬🛠️👥]/g, "").trim();
                await memoryManager.addExchange(userId, `[Setup Question] ${questionData.question}`, `User answered: ${factText}`);

                // Save to core memory directly
                await saveCoreMemory(userId, `${qLabel}: ${factText}`, questionData.category as any, 8);
            }

            // Move to next step
            state.step++;
            if (state.step < SETUP_QUESTIONS.length) {
                await ctx.reply(`${state.step + 1}/${SETUP_QUESTIONS.length}: ${SETUP_QUESTIONS[state.step].question}`);
            } else {
                setupStates.delete(userId);
                await ctx.reply("✅ *Setup Complete!*\nMy Core Memory is now loaded. We can continue our conversation normally.", { parse_mode: "Markdown" });
            }
            return;
        }

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

        if (formattedContext) {
            console.log(`   🧠 Memory retrieved: ${memContext.coreMemories.length} facts, ${memContext.relevantMemories.length} past exchanges.`);
        } else {
            console.log(`   📭 No relevant long-term memory found for this query.`);
        }

        // Detect voice request from the user's message text
        const userWantsVoice = forceVoice || isVoiceRequest(userMessage);

        if (userWantsVoice) {
            console.log(`   🎤 Voice request detected from user ${userId}`);
        }

        // Show typing indicator
        await ctx.replyWithChatAction("typing");

        try {
            const result = await runAgentLoop(userId, userMessage, history, formattedContext);

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

            // 🛡️ Vibe Guard: Prevent sending junk like "Speak." or tool names to the user
            const junkPattern = /^(?:👾 )?(speak|get_current_time|remember_fact|echo)[\.!]?\s*$/i;
            if (junkPattern.test(finalResponse)) {
                console.warn(`   🛡️ Vibe Guard blocked junk response: "${finalResponse}"`);
                finalResponse = "👾 *Signal interference detected.* I'm recalibrating my resonant core. How else can I help, Ralein?";
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

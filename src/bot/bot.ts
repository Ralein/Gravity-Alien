import { Bot, InputFile } from "grammy";
import { config } from "../config.js";
import { runAgentLoop, transcribeVoice, synthesizeSpeech, analyzeProjectVision } from "../agent/agent.js";
import { memoryManager } from "../memory/memory.js";
import { saveCoreMemory } from "../memory/localStore.js";
import type { MessageParam } from "../types/index.js";
import fs from "fs-extra";
import path from "path";
import fetch from "node-fetch";
import { tmpdir } from "os";

// ── Wizard State Management ──────────────────────────────────────────

interface WizardState {
    type: "setup" | "gsd";
    step: number;
    userId: number;
    answers: Record<string, string>;
    dynamicQuestions?: { label: string; question: string }[];
}

const wizardStates = new Map<number, WizardState>();
const voiceModes = new Map<number, boolean>();

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

const GSD_QUESTIONS = [
    { label: "Project Name", question: "🏗️ What's the name of this project?" },
    { label: "Vision", question: "🎯 What's the high-level vision? (2-3 sentences on what it does and who it's for)" },
    { label: "Core Value", question: "💎 What is the ONE most important thing this project must achieve?" },
    { label: "Constraints", question: "🛠️ Any specific tech stack, timeline, or constraints I should know about? (Type 'none' if unsure)" }
];

/**
 * Detects if a message text indicates the user wants to start a new project.
 */
function detectProjectIntent(text: string): boolean {
    const lower = text.toLowerCase();
    const patterns = [
        /start\w*\s+(a\s+)?(new\s+)?project/i,
        /build\w*\s+(a\s+)?(new\s+)?(app|application|software|tool)/i,
        /initializ\w*\s+(a\s+)?(new\s+)?project/i,
        /creat\w*\s+(a\s+)?(new\s+)?(app|application|software|tool)/i,
        /i\s+(want|need)\s+to\s+build/i,
        /let's\s+build/i,
        /gsd\s+new/i,
    ];
    return patterns.some(p => p.test(lower));
}

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
        wizardStates.set(userId, { type: "setup", step: 0, userId, answers: {} });
        await ctx.reply(
            "🚀 *Alien Onboarding*\n\n" +
            "I'll ask 8 quick questions to load your profile into my Core Memory. " +
            "You can type `skip` at any time.\n\n" +
            "1/8: " + SETUP_QUESTIONS[0].question,
            { parse_mode: "Markdown" }
        );
    });

    // ── /gsd command — initialize a new project ───────────────────────
    bot.command("gsd", async (ctx) => {
        const userId = ctx.from!.id;
        wizardStates.set(userId, { type: "gsd", step: 0, userId, answers: {} });
        await ctx.reply(
            "🏗️ *GSD Project Wizard*\n\n" +
            "Let's build something. I'll ask 4 questions to initialize your project.\n\n" +
            "1/4: " + GSD_QUESTIONS[0].question,
            { parse_mode: "Markdown" }
        );
    });

    /**
     * Common logic to initialize a smart GSD wizard by extracting answers from text.
     */
    async function startSmartGsd(ctx: any, userId: number, text: string) {
        console.log(`   🏗️ Starting Smart GSD Analysis for ${userId}...`);
        await ctx.reply("✨ *Analyzing project vision...*", { parse_mode: "Markdown" });

        const { basics, dynamicQuestions } = await analyzeProjectVision(userId, text);

        const answers: Record<string, string> = {};
        let firstEmptyStep = -1;

        for (let i = 0; i < GSD_QUESTIONS.length; i++) {
            const q = GSD_QUESTIONS[i];
            const val = basics[q.label];
            if (val && val.toLowerCase() !== "unknown" && val.length > 2) {
                answers[q.label] = val;
                console.log(`      ✅ Auto-filled: ${q.label} = "${val}"`);
            } else if (firstEmptyStep === -1) {
                firstEmptyStep = i;
            }
        }

        // Initialize state
        const state: WizardState = {
            type: "gsd",
            step: firstEmptyStep === -1 ? GSD_QUESTIONS.length : firstEmptyStep,
            userId,
            answers,
            dynamicQuestions
        };
        wizardStates.set(userId, state);

        let summary = "🏗️ *Project Detected*\n\n";
        for (const [label, val] of Object.entries(answers)) {
            summary += `🔹 *${label}*: ${val}\n`;
        }

        if (firstEmptyStep === -1) {
            // All basics filled, move to dynamic questions
            if (dynamicQuestions.length > 0) {
                summary += `\nI've extracted the basics. To design the architecture precisely, I need to know:\n\n`;
                summary += `1/${dynamicQuestions.length}: ${dynamicQuestions[0].question}`;
                await ctx.reply(summary, { parse_mode: "Markdown" });
            } else {
                // Exceptional case: nothing at all to ask? Initializing.
                await ctx.reply(summary + "\n✅ *Technical details complete!* Initializing...", { parse_mode: "Markdown" });
                await completeGsd(ctx, userId, state);
            }
        } else {
            // Still need some basics
            summary += `\nI've filled what I could. Let's finish the rest:\n\n`;
            summary += `${firstEmptyStep + 1}/${GSD_QUESTIONS.length}: ${GSD_QUESTIONS[firstEmptyStep].question}`;
            await ctx.reply(summary, { parse_mode: "Markdown" });
        }
    }

    /**
     * Final logic to consolidate all GSD answers and trigger the agent loop.
     */
    async function completeGsd(ctx: any, userId: number, state: WizardState) {
        wizardStates.delete(userId);

        let projectGoals = `COMMAND_TRIGGER: INITIALIZE NEW PROJECT\n` +
            `----------------------------------------\n`;

        for (const [label, val] of Object.entries(state.answers)) {
            projectGoals += `- ${label}: ${val}\n`;
        }

        projectGoals += `----------------------------------------\n` +
            `ACTION REQUIRED: Call gsd_new_project immediately.`;

        await handleMessage(ctx, userId, projectGoals);
    }

    // ── /clear command — reset conversation history ───────────────────
    bot.command("clear", async (ctx) => {
        const userId = ctx.from!.id;
        wizardStates.delete(userId); // Also cancel wizard if active
        await memoryManager.clearSTM(userId);
        await ctx.reply("🧹 *Session Swept.*\nMy short-term history for you is gone, but I still remember your Core Facts.", { parse_mode: "Markdown" });
    });

    // ── /voice command — enable always-voice mode ─────────────────────
    bot.command("voice", async (ctx) => {
        const userId = ctx.from!.id;
        voiceModes.set(userId, true);
        await ctx.reply("🎙️ *Voice Mode: ON*\nI'll reply with audio for everything now. Say `/mute` to stop.", { parse_mode: "Markdown" });
    });

    // ── /mute command — disable always-voice mode ──────────────────────
    bot.command("mute", async (ctx) => {
        const userId = ctx.from!.id;
        voiceModes.delete(userId);
        await ctx.reply("🔕 *Voice Mode: OFF*\nBack to text-only mode.", { parse_mode: "Markdown" });
    });

    // ── Message handler ───────────────────────────────────────────────
    bot.on("message:text", async (ctx) => {
        const userId = ctx.from.id;
        const userMessage = ctx.message.text;

        // Check if in wizard mode
        const state = wizardStates.get(userId);
        if (state !== undefined) {
            const isSetup = state.type === "setup";
            const questions = isSetup ? SETUP_QUESTIONS : GSD_QUESTIONS;

            // Step A: Store the answer
            if (userMessage.toLowerCase() !== "skip") {
                if (isSetup) {
                    const currentQuestion = SETUP_QUESTIONS[state.step];
                    const qData = currentQuestion as typeof SETUP_QUESTIONS[0];
                    const qLabel = qData.question.split("?")[0].replace(/[👤💼📍🎯🧠💬🛠️👥]/g, "").trim();
                    await saveCoreMemory(userId, `${qLabel}: ${userMessage}`, qData.category as any, 8);
                } else {
                    const dynamicStep = state.step - GSD_QUESTIONS.length;
                    const label = dynamicStep < 0
                        ? GSD_QUESTIONS[state.step].label
                        : state.dynamicQuestions?.[dynamicStep]?.label ?? "Detail";
                    state.answers[label] = userMessage;
                }
            }

            // Step B: Move forward
            state.step++;

            // Check if we still have baseline questions
            if (state.step < questions.length) {
                await ctx.reply(`${state.step + 1}/${questions.length}: ${questions[state.step].question}`);
                return;
            }

            // Baseline done — Check for dynamic technical questions
            if (!isSetup && state.dynamicQuestions && state.step < GSD_QUESTIONS.length + state.dynamicQuestions.length) {
                const dIdx = state.step - GSD_QUESTIONS.length;
                const dQ = state.dynamicQuestions[dIdx];
                await ctx.reply(`🔍 *Technical Discovery* (${dIdx + 1}/${state.dynamicQuestions.length})\n\n${dQ.question}`, { parse_mode: "Markdown" });
                return;
            }

            // Wizard Complete
            if (isSetup) {
                wizardStates.delete(userId);
                await ctx.reply("✅ *Setup Complete!*\nMy Core Memory is now loaded. We can continue our conversation normally.", { parse_mode: "Markdown" });
            } else {
                await ctx.reply("✅ *Project Discovery Complete!*\nRefining your architecture now...", { parse_mode: "Markdown" });
                await completeGsd(ctx, userId, state);
            }
            return;
        }

        // Detect Project Intent in normal text
        if (detectProjectIntent(userMessage)) {
            await startSmartGsd(ctx, userId, userMessage);
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

            // Detect Project Intent
            if (detectProjectIntent(transcription)) {
                await startSmartGsd(ctx, userId, transcription);
                return;
            }

            // Process as text (don't force voice on voice messages anymore)
            await handleMessage(ctx, userId, transcription, false);

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

        const isVoiceMode = voiceModes.get(userId) === true;

        // Detect voice request from the user's message text
        const userWantsVoice = forceVoice || isVoiceMode || isVoiceRequest(userMessage);

        if (userWantsVoice) {
            console.log(`   🎤 Voice request detected from user ${userId}`);
        }

        // Show typing indicator
        await ctx.replyWithChatAction("typing");

        try {
            const result = await runAgentLoop(userId, userMessage, history, formattedContext);

            // Update conversation history with user message and assistant response
            await memoryManager.addExchange(userId, userMessage, result.response);

            // Pipeline Step: Humanize the response
            console.log(`   🎭 Humanizing response...`);
            const { humanizeResponse, formatForTelegram } = await import("../agent/agent.js");
            const humanizedResponse = await humanizeResponse(result.response);

            // Determine voice text: from tool call, user request detection, or forced
            let voiceText = result.voiceText || "";

            // If the user asked for voice but the LLM didn't call the speak tool,
            // force-synthesize the humanized response as voice
            if (userWantsVoice && !voiceText) {
                voiceText = humanizedResponse;
                console.log(`   🎤 Forcing voice synthesis for humanized response (${voiceText.length} chars)`);
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
                } catch (speechErr) {
                    console.error("   ❌ TTS Error:", speechErr);
                    await ctx.reply("⚠️ Voice synthesis failed — sending text instead.");
                } finally {
                    if (voicePath && await fs.pathExists(voicePath)) {
                        await fs.remove(voicePath);
                    }
                }
            }

            // Prepare final text response
            const finalResponse = formatForTelegram(humanizedResponse);

            // 🛡️ Vibe Guard: Prevent sending junk like "Speak." or tool names to the user
            const junkPattern = /^(?:👾 )?(speak|get_current_time|remember_fact|echo)[\.!]?\s*$/i;
            if (junkPattern.test(finalResponse)) {
                console.warn(`   🛡️ Vibe Guard blocked junk response: "${finalResponse}"`);
                // If we already sent voice, we can just stop here.
                // If not, we send a fallback.
                if (!voiceText) {
                    await ctx.reply("👾 *Signal interference detected.* I'm recalibrating my resonant core. How else can I help, Ralein?");
                }
                return;
            }

            // Send text response if there's anything left and the user didn't only want voice
            // However, usually we send both for accessibility unless it's a specific request
            if (finalResponse && (!userWantsVoice || result.voiceText)) {
                const maxLen = 4000;
                if (finalResponse.length <= maxLen) {
                    await ctx.reply(finalResponse, { parse_mode: "HTML" });
                } else {
                    for (let i = 0; i < finalResponse.length; i += maxLen) {
                        await ctx.reply(finalResponse.substring(i, i + maxLen), { parse_mode: "HTML" });
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

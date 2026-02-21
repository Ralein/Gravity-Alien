import { Bot } from "grammy";
import { config } from "../config.js";
import { runAgentLoop } from "../agent/agent.js";
import type { MessageParam } from "../types/index.js";

// ── Per-user conversation history (in-memory for Level 1) ───────────────

const conversations = new Map<number, MessageParam[]>();

function getHistory(userId: number): MessageParam[] {
    if (!conversations.has(userId)) {
        conversations.set(userId, []);
    }
    return conversations.get(userId)!;
}

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
        conversations.set(userId, []);
        await ctx.reply("🧹 Conversation history cleared.");
    });

    // ── Message handler — passes text to the agent loop ───────────────
    bot.on("message:text", async (ctx) => {
        const userId = ctx.from.id;
        const userMessage = ctx.message.text;
        const history = getHistory(userId);

        console.log(`\n📩 Message from ${userId}: ${userMessage.substring(0, 80)}...`);

        // Show typing indicator
        await ctx.replyWithChatAction("typing");

        try {
            const result = await runAgentLoop(userMessage, history);

            // Update conversation history with user message and assistant response
            history.push({ role: "user", content: userMessage });
            history.push({ role: "assistant", content: result.response });

            // Keep history manageable (last 20 exchanges = 40 messages)
            while (history.length > 40) {
                history.shift();
            }

            // Send response (split if too long for Telegram's 4096 char limit)
            const maxLen = 4000;
            if (result.response.length <= maxLen) {
                await ctx.reply(result.response);
            } else {
                // Split into chunks
                for (let i = 0; i < result.response.length; i += maxLen) {
                    await ctx.reply(result.response.substring(i, i + maxLen));
                }
            }

            console.log(
                `   ✅ Responded (${result.iterations} iterations, ${result.toolCalls} tool calls)`,
            );
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`   ❌ Agent error: ${message}`);
            await ctx.reply("⚠️ Something went wrong processing your message. Please try again.");
        }
    });

    return bot;
}

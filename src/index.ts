import { setTimeout } from "timers/promises";
import { config as _config } from "./config.js";
import { createBot } from "./bot/bot.js";

// ── Entry Point ─────────────────────────────────────────────────────────

async function main() {
    console.log("\n👾 starting up...\n");

    const bot = createBot();

    // Graceful shutdown
    const shutdown = async (signal: string) => {
        console.log(`\n🛑 ${signal} received — shutting down gracefully...`);
        await bot.stop();
        process.exit(0);
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    // Start long-polling (NO web server, NO exposed ports)
    console.log("📡 Waiting 2 seconds for old connections to drop to prevent 409 Conflict...");
    await setTimeout(2000);

    // Auto-retry loop to make the bot immune to 409 errors during development reloading
    while (true) {
        try {
            console.log("📡 Starting Telegram long-polling (no web server)...\n");
            await bot.start({
                onStart: (botInfo) => {
                    console.log(`✅ Bot @${botInfo.username} is live!`);
                    console.log(`   Send it a message on Telegram to test.\n`);
                },
            });
            break; // Exits loop cleanly if bot.stop() is intentionally called
        } catch (err: any) {
            if (err.error_code === 409) {
                console.warn("⚠️ 409 Conflict detected (another background instance is still polling). Retrying in 3 seconds...");
                await setTimeout(3000);
            } else {
                throw err; // Other fatal errors will crash normally
            }
        }
    }
}

main().catch((err) => {
    console.error("💥 Fatal error:", err);
    process.exit(1);
});

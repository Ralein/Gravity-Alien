import { config as _config } from "./config.js";
import { createBot } from "./bot/bot.js";

// ── Entry Point ─────────────────────────────────────────────────────────

async function main() {
    console.log("\n🦀 Gravity Claw starting up...\n");

    const bot = createBot();

    // Graceful shutdown
    const shutdown = async (signal: string) => {
        console.log(`\n🛑 ${signal} received — shutting down gracefully...`);
        bot.stop();
        process.exit(0);
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

    // Start long-polling (NO web server, NO exposed ports)
    console.log("📡 Starting Telegram long-polling (no web server)...\n");
    bot.start({
        onStart: (botInfo) => {
            console.log(`✅ Bot @${botInfo.username} is live!`);
            console.log(`   Send it a message on Telegram to test.\n`);
        },
    });
}

main().catch((err) => {
    console.error("💥 Fatal error:", err);
    process.exit(1);
});

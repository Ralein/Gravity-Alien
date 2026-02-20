import "dotenv/config";
import type { AppConfig } from "./types/index.js";

// ── Validate & export typed config ──────────────────────────────────────

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        console.error(`❌ Missing required environment variable: ${name}`);
        console.error(`   Copy .env.example → .env and fill in your values.`);
        process.exit(1);
    }
    return value;
}

function parseUserIds(raw: string): number[] {
    return raw
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
        .map((id) => {
            const num = Number(id);
            if (Number.isNaN(num)) {
                console.error(`❌ Invalid user ID: "${id}" — must be a number`);
                process.exit(1);
            }
            return num;
        });
}

export const config: AppConfig = {
    telegramToken: requireEnv("TELEGRAM_BOT_TOKEN"),
    openRouterApiKey: requireEnv("OPENROUTER_API_KEY"),
    allowedUserIds: parseUserIds(requireEnv("ALLOWED_USER_IDS")),
    model: process.env["ANTHROPIC_MODEL"] ?? "claude-sonnet-4-20250514",
    maxIterations: Number(process.env["MAX_AGENT_ITERATIONS"] ?? "10"),
};

// Startup confirmation (no secrets leaked)
console.log(`⚙️  Config loaded:`);
console.log(`   Model: ${config.model}`);
console.log(`   Max iterations: ${config.maxIterations}`);
console.log(`   Allowed users: ${config.allowedUserIds.join(", ")}`);

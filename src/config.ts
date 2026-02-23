import "dotenv/config";
import type { AppConfig } from "./types/index.js";

// ── Validate & export typed config ──────────────────────────────────────

function requireEnv(name: string, fallback?: string): string {
    const value = process.env[name] ?? fallback;
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
    groqApiKey: requireEnv("GROQ_API_KEY"),
    openRouterApiKey: requireEnv("OPENROUTER_API_KEY"),
    allowedUserIds: parseUserIds(requireEnv("ALLOWED_USER_IDS")),
    model: process.env["GROQ_MODEL"] ?? "llama-3.3-70b-versatile",
    fallbackModel: process.env["ANTHROPIC_MODEL"] ?? "anthropic/claude-3.5-sonnet",
    maxIterations: Number(process.env["MAX_AGENT_ITERATIONS"] ?? "10"),
    elevenLabsApiKey: requireEnv("ELEVENLABS_API_KEY"),
};

// Startup confirmation (no secrets leaked)
console.log(`⚙️  Config loaded:`);
console.log(`   Model: ${config.model}`);
console.log(`   Max iterations: ${config.maxIterations}`);
console.log(`   Allowed users: ${config.allowedUserIds.join(", ")}\n`);

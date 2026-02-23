import type {
    ChatCompletionMessageParam,
    ChatCompletionTool,
} from "openai/resources/index.js";

// ── Config ──────────────────────────────────────────────────────────────

export interface AppConfig {
    telegramToken: string;
    groqApiKey: string;
    openRouterApiKey: string;
    allowedUserIds: number[];
    model: string;
    fallbackModel: string;
    maxIterations: number;
    elevenLabsApiKey: string;
}

// ── Agent ───────────────────────────────────────────────────────────────

export interface ToolDefinition {
    /** OpenAI-format tool schema */
    spec: ChatCompletionTool;
    /** Handler that executes the tool and returns a string result */
    handler: (input: Record<string, unknown>) => Promise<string>;
}

export interface AgentResult {
    response: string;
    toolCalls: number;
    iterations: number;
    voiceText?: string;
}

// Re-export useful OpenAI types for convenience
export type { ChatCompletionMessageParam as MessageParam, ChatCompletionTool };

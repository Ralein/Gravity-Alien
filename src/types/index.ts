import type { MessageParam, Tool, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages.js";

// ── Config ──────────────────────────────────────────────────────────────

export interface AppConfig {
    telegramToken: string;
    openRouterApiKey: string;
    allowedUserIds: number[];
    model: string;
    maxIterations: number;
}

// ── Agent ───────────────────────────────────────────────────────────────

export interface ToolDefinition {
    /** Anthropic-format tool schema */
    spec: Tool;
    /** Handler that executes the tool and returns a string result */
    handler: (input: Record<string, unknown>) => Promise<string>;
}

export interface AgentResult {
    response: string;
    toolCalls: number;
    iterations: number;
}

// Re-export useful Anthropic types for convenience
export type { MessageParam, ToolResultBlockParam };

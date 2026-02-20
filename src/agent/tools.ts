import type { ToolDefinition } from "../types/index.js";

// ── Built-in Tools ──────────────────────────────────────────────────────

const getCurrentTime: ToolDefinition = {
    spec: {
        name: "get_current_time",
        description:
            "Returns the current date, time, and timezone. Use when the user asks what time it is, what today's date is, or anything time-related.",
        input_schema: {
            type: "object" as const,
            properties: {},
            required: [],
        },
    },
    handler: async () => {
        const now = new Date();
        return JSON.stringify({
            iso: now.toISOString(),
            local: now.toLocaleString(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            unix: Math.floor(now.getTime() / 1000),
        });
    },
};

const echo: ToolDefinition = {
    spec: {
        name: "echo",
        description:
            "Echoes back the provided message. Useful for testing that the tool loop is working.",
        input_schema: {
            type: "object" as const,
            properties: {
                message: {
                    type: "string",
                    description: "The message to echo back",
                },
            },
            required: ["message"],
        },
    },
    handler: async (input) => {
        return `Echo: ${input["message"] ?? "(empty)"}`;
    },
};

// ── Registry ────────────────────────────────────────────────────────────

/** All registered tools, keyed by name */
const toolRegistry = new Map<string, ToolDefinition>();

function register(tool: ToolDefinition): void {
    toolRegistry.set(tool.spec.name, tool);
}

// Register built-in tools
register(getCurrentTime);
register(echo);

/** Get all tool specs for the Anthropic API */
export function getToolSpecs() {
    return Array.from(toolRegistry.values()).map((t) => t.spec);
}

/** Execute a tool by name. Returns the string result or an error message. */
export async function executeTool(
    name: string,
    input: Record<string, unknown>,
): Promise<string> {
    const tool = toolRegistry.get(name);
    if (!tool) {
        return `Error: Unknown tool "${name}"`;
    }
    try {
        return await tool.handler(input);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `Error executing tool "${name}": ${message}`;
    }
}

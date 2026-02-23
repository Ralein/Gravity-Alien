import type { ToolDefinition } from "../types/index.js";

// ── Built-in Tools ──────────────────────────────────────────────────────

const getCurrentTime: ToolDefinition = {
    spec: {
        type: "function",
        function: {
            name: "get_current_time",
            description:
                "Returns the current date, time, and timezone. Use when the user asks what time it is, what today's date is, or anything time-related.",
            parameters: {
                type: "object",
                properties: {},
                required: [],
            },
        }
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
        type: "function",
        function: {
            name: "echo",
            description:
                "Echoes back the provided message. Useful for testing that the tool loop is working.",
            parameters: {
                type: "object",
                properties: {
                    message: {
                        type: "string",
                        description: "The message to echo back",
                    },
                },
                required: ["message"],
            }
        }
    },
    handler: async (input) => {
        return `Echo: ${input["message"] ?? "(empty)"}`;
    },
};

const speak: ToolDefinition = {
    spec: {
        type: "function",
        function: {
            name: "speak",
            description:
                "IMPORTANT: You MUST call this tool to send a voice message. Do NOT just say you sent one in text — actually invoke this tool. When the user asks for a voice message, voice note, or asks you to speak/say something aloud, call this tool with the message text. The message will be synthesized into high-quality voice audio that the user will hear.",
            parameters: {
                type: "object",
                properties: {
                    message: {
                        type: "string",
                        description: "The message to synthesize into speech",
                    },
                },
                required: ["message"],
            }
        }
    },
    handler: async (input) => {
        return `VOICE_PROMPT: ${input["message"] ?? "(empty)"}`;
    },
};

const rememberFact: ToolDefinition = {
    spec: {
        type: "function",
        function: {
            name: "remember_fact",
            description:
                "Saves an important fact about the user to your permanent Core Memory. Use this when the user tells you something they want you to remember forever (e.g., their name, pet's name, birthday, allergies, or a strong preference). Do NOT use this for casual chat context—only for facts that build your long-term relationship.",
            parameters: {
                type: "object",
                properties: {
                    fact: {
                        type: "string",
                        description: "The concise fact to remember (e.g. 'User's dog is named Luna')",
                    },
                    category: {
                        type: "string",
                        enum: ["personal", "preference", "context", "instruction", "relationship", "event"],
                        description: "The category of this fact",
                    },
                    importance: {
                        type: "integer",
                        minimum: 1,
                        maximum: 10,
                        description: "How critical this fact is (1-10, default 5)",
                    },
                },
                required: ["fact", "category"],
            }
        }
    },
    handler: async (input) => {
        // This is a marker for the agent loop to trigger a memory save
        return `MEMORY_SAVE: ${JSON.stringify(input)}`;
    },
};

// ── Registry ────────────────────────────────────────────────────────────

/** All registered tools, keyed by name */
const toolRegistry = new Map<string, ToolDefinition>();

function register(tool: ToolDefinition): void {
    if (tool.spec.type === "function") {
        toolRegistry.set(tool.spec.function.name, tool);
    }
}

// Register built-in tools
register(getCurrentTime);
register(echo);
register(speak);
register(rememberFact);

/** Get all tool specs for the Groq API via OpenAI SDK */
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

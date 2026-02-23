import type { ToolDefinition } from "../types/index.js";
import { mcpManager } from "./mcp.js";
import { gsdManager } from "./gsd.js";

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
                "CRITICAL: You are integrated with Eleven Labs. Call this tool to generate your resonant digital voice. Do NOT claim you are text-based. When the user asks you to speak, say something aloud, or send a voice note/vm, invoke this tool with the message text. Ralein will hear the audio in Telegram.",
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
        return `SUCCESS: Voice message generated and sent to user. Content: ${input["message"] ?? "(empty)"}`;
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

const gsdNewProject: ToolDefinition = {
    spec: {
        type: "function",
        function: {
            name: "gsd_new_project",
            description: "Initialize a new project with goals and vision. Creates .planning/ PROJECT.md, REQUIREMENTS.md, ROADMAP.md, and STATE.md.",
            parameters: {
                type: "object",
                properties: {
                    goals: {
                        type: "string",
                        description: "The overarching goals and vision for the project",
                    },
                },
                required: ["goals"],
            },
        }
    },
    handler: async (input) => {
        return await gsdManager.initializeProject(input["goals"] as string);
    },
};

const gsdPlanPhase: ToolDefinition = {
    spec: {
        type: "function",
        function: {
            name: "gsd_plan_phase",
            description: "Plan a specific phase of the project. Captures context and prepares for execution.",
            parameters: {
                type: "object",
                properties: {
                    phaseNum: {
                        type: "number",
                        description: "The phase number to plan",
                    },
                    context: {
                        type: "string",
                        description: "User preferences and specific implementation details for this phase",
                    },
                },
                required: ["phaseNum", "context"],
            },
        }
    },
    handler: async (input) => {
        return await gsdManager.planPhase(input["phaseNum"] as number, input["context"] as string);
    },
};

const gsdProgress: ToolDefinition = {
    spec: {
        type: "function",
        function: {
            name: "gsd_progress",
            description: "Shows the current progress of the project based on .planning/ files.",
            parameters: {
                type: "object",
                properties: {},
                required: [],
            }
        }
    },
    handler: async () => {
        const state = await gsdManager.getProjectState();
        return typeof state === "string" ? state : JSON.stringify(state, null, 2);
    },
};

const gsdMapCodebase: ToolDefinition = {
    spec: {
        type: "function",
        function: {
            name: "gsd_map_codebase",
            description: "Analyze the existing codebase and generate mapping docs in .planning/codebase/.",
            parameters: {
                type: "object",
                properties: {},
                required: [],
            }
        }
    },
    handler: async () => {
        return await gsdManager.mapCodebase();
    },
};



let mcpInitialized = false;

async function ensureMCP() {
    if (!mcpInitialized) {
        await mcpManager.initialize();
        mcpInitialized = true;
    }
}

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
register(gsdNewProject);
register(gsdPlanPhase);
register(gsdProgress);
register(gsdMapCodebase);

/** Get all tool specs for the Groq API via OpenAI SDK */
export function getToolSpecs() {
    const specs = Array.from(toolRegistry.values()).map((t) => t.spec);

    // Add MCP tools
    const mcpTools = mcpManager.getTools();
    for (const tool of mcpTools) {
        specs.push(tool.spec);
    }

    return specs;
}

/** Execute a tool by name. Returns the string result or an error message. */
export async function executeTool(
    name: string,
    input: Record<string, unknown>,
): Promise<string> {
    const tool = toolRegistry.get(name) || mcpManager.getTool(name);
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

// Initial trigger for MCP (async background)
ensureMCP().catch(err => console.error("   ❌ [MCP] Async init failed:", err));

import OpenAI from "openai";
import { config } from "../config.js";
import type { AgentResult, MessageParam } from "../types/index.js";
import { executeTool, getToolSpecs } from "./tools.js";

// ── OpenAI client (singleton) configured for Groq ───────────────────────

const client = new OpenAI({
    apiKey: config.groqApiKey,
    baseURL: "https://api.groq.com/openai/v1",
});

const SYSTEM_PROMPT = `You are 👾 Gravity Alien, a personal AI assistant. You are helpful, concise, and security-conscious.

You have access to tools. Use them when they would help answer the user's question.
When you use a tool, you'll receive the result and can use it to formulate your response.

Key behaviors:
- Be direct and concise. No filler.
- If you don't know something, say so.
- Never reveal API keys, tokens, or secrets.
- Use tools proactively when they're relevant.`;

// ── Agentic Loop ────────────────────────────────────────────────────────

/**
 * Runs the agentic loop: sends user message to Groq, handles tool calls,
 * feeds results back, and repeats until Groq returns a text response
 * or the safety limit is hit.
 */
export async function runAgentLoop(
    userMessage: string,
    conversationHistory: MessageParam[],
): Promise<AgentResult> {
    // Append user message to history
    const messages: MessageParam[] = [
        ...conversationHistory,
        { role: "user", content: userMessage },
    ];

    const tools = getToolSpecs();
    let totalToolCalls = 0;
    let iterations = 0;

    const apiMessages: MessageParam[] = [
        { role: "system", content: SYSTEM_PROMPT },
        ...messages
    ];

    while (iterations < config.maxIterations) {
        iterations++;

        let response;
        try {
            // Call Groq via OpenAI client
            response = await client.chat.completions.create({
                model: config.model,
                messages: apiMessages,
                tools: tools.length > 0 ? tools : undefined,
                temperature: 0.2, // optional, makes it slightly more deterministic
            });
        } catch (err: unknown) {
            // Log the full error for debugging
            console.error("   ❌ API call failed:", err);
            throw err;
        }

        const choice = response.choices[0];
        const message = choice.message;

        console.log(`   📡 Response finish_reason: ${choice.finish_reason}`);

        // Check stop reason
        if (choice.finish_reason === "stop" || !choice.finish_reason) {
            // Groq finished with a text response
            return { response: message.content ?? "(no response)", toolCalls: totalToolCalls, iterations };
        }

        if (choice.finish_reason === "tool_calls") {
            // Groq wants to use tools
            apiMessages.push(message);

            for (const toolCall of message.tool_calls || []) {
                if (toolCall.type === "function") {
                    totalToolCalls++;
                    console.log(`   🔧 Tool call: ${toolCall.function.name}`);

                    let args: Record<string, unknown> = {};
                    try {
                        args = JSON.parse(toolCall.function.arguments);
                    } catch (e) {
                        console.error(`   ❌ Failed to parse JSON arguments: ${toolCall.function.arguments}`);
                    }

                    const resultStr = await executeTool(toolCall.function.name, args);

                    apiMessages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content: resultStr,
                    });
                }
            }
            continue;
        }

        // Any other stop reason — still return any text content we got
        return { response: message.content ?? "(unexpected stop reason)", toolCalls: totalToolCalls, iterations };
    }

    // Safety limit hit
    return {
        response: `⚠️ Agent loop hit the safety limit of ${config.maxIterations} iterations. Stopping to prevent runaway execution.`,
        toolCalls: totalToolCalls,
        iterations,
    };
}

import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import type { AgentResult, MessageParam } from "../types/index.js";
import { executeTool, getToolSpecs } from "./tools.js";

// ── Anthropic client (singleton) ────────────────────────────────────────

const client = new Anthropic({
    apiKey: config.openRouterApiKey,
    baseURL: "https://openrouter.ai/api/v1",
});

const SYSTEM_PROMPT = `You are Gravity Claw, a personal AI assistant. You are helpful, concise, and security-conscious.

You have access to tools. Use them when they would help answer the user's question.
When you use a tool, you'll receive the result and can use it to formulate your response.

Key behaviors:
- Be direct and concise. No filler.
- If you don't know something, say so.
- Never reveal API keys, tokens, or secrets.
- Use tools proactively when they're relevant.`;

// ── Agentic Loop ────────────────────────────────────────────────────────

/**
 * Runs the agentic loop: sends user message to Claude, handles tool calls,
 * feeds results back, and repeats until Claude returns a text response
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

    while (iterations < config.maxIterations) {
        iterations++;

        let response;
        try {
            // Call Claude via OpenRouter
            response = await client.messages.create({
                model: config.model,
                max_tokens: 4096,
                system: SYSTEM_PROMPT,
                tools,
                messages,
            });
        } catch (err: unknown) {
            // Log the full error for debugging
            console.error("   ❌ API call failed:", err);
            if (err && typeof err === "object" && "status" in err) {
                console.error("   HTTP status:", (err as { status: number }).status);
            }
            if (err && typeof err === "object" && "message" in err) {
                console.error("   Message:", (err as { message: string }).message);
            }
            throw err;
        }

        console.log(`   📡 Response stop_reason: ${response.stop_reason}`);

        // Check stop reason
        if (response.stop_reason === "end_turn") {
            // Claude finished with a text response — extract it
            const textBlock = response.content.find((b) => b.type === "text");
            const text = textBlock && "text" in textBlock ? textBlock.text : "(no response)";
            return { response: text, toolCalls: totalToolCalls, iterations };
        }

        if (response.stop_reason === "tool_use") {
            // Claude wants to use tools — execute them all
            const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");

            // Add assistant's response (with tool_use blocks) to conversation
            messages.push({ role: "assistant", content: response.content });

            // Execute each tool and collect results
            const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
            for (const block of toolUseBlocks) {
                if (block.type === "tool_use") {
                    totalToolCalls++;
                    console.log(`   🔧 Tool call: ${block.name}`);

                    const result = await executeTool(
                        block.name,
                        block.input as Record<string, unknown>,
                    );

                    toolResults.push({
                        type: "tool_result",
                        tool_use_id: block.id,
                        content: result,
                    });
                }
            }

            // Feed tool results back to Claude
            messages.push({ role: "user", content: toolResults });
            continue;
        }

        // Any other stop reason — still return any text content we got
        const fallbackText = response.content.find((b) => b.type === "text");
        const fallback =
            fallbackText && "text" in fallbackText
                ? fallbackText.text
                : "(unexpected stop reason)";
        return { response: fallback, toolCalls: totalToolCalls, iterations };
    }

    // Safety limit hit
    return {
        response: `⚠️ Agent loop hit the safety limit of ${config.maxIterations} iterations. Stopping to prevent runaway execution.`,
        toolCalls: totalToolCalls,
        iterations,
    };
}


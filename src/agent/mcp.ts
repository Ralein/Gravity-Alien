import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "fs-extra";
import path from "path";
import type { ToolDefinition } from "../types/index.js";

interface MCPConfig {
    mcpServers: Record<string, {
        command: string;
        args: string[];
        env?: Record<string, string>;
    }>;
}

const CONFIG_PATH = "/Users/ralein/.gemini/antigravity/mcp_config.json";

export class MCPManager {
    private client: Client | null = null;
    private transport: StdioClientTransport | null = null;
    private tools: Map<string, ToolDefinition> = new Map();

    async initialize() {
        console.log("🔌 [MCP] Initializing...");
        try {
            if (!await fs.pathExists(CONFIG_PATH)) {
                console.warn(`   ⚠️ MCP config not found at ${CONFIG_PATH}`);
                return;
            }

            const config: MCPConfig = await fs.readJson(CONFIG_PATH);

            // For now, we only support one server (Context7) or we pick the first one
            // In a more robust version, we'd handle multiple servers.
            const serverName = Object.keys(config.mcpServers)[0];
            if (!serverName) {
                console.warn("   ⚠️ No MCP servers configured.");
                return;
            }

            const serverConfig = config.mcpServers[serverName];
            console.log(`   🚀 Connecting to MCP server: ${serverName}`);

            this.transport = new StdioClientTransport({
                command: serverConfig.command,
                args: serverConfig.args,
                env: {
                    ...process.env as Record<string, string>,
                    ...serverConfig.env
                }
            });

            this.client = new Client(
                {
                    name: "gravity-alien-client",
                    version: "1.0.0",
                },
                {
                    capabilities: {},
                }
            );

            await this.client.connect(this.transport);
            console.log(`   ✅ Connected to ${serverName}`);

            // Fetch tools
            const { tools } = await this.client.listTools();
            console.log(`   🛠️  Found ${tools.length} tools from ${serverName}`);

            for (const tool of tools) {
                this.tools.set(tool.name, {
                    spec: {
                        type: "function",
                        function: {
                            name: tool.name,
                            description: tool.description ?? "",
                            parameters: tool.inputSchema as any,
                        }
                    },
                    handler: async (args) => {
                        console.log(`   🔧 [MCP] Calling ${tool.name}...`);
                        const result = await this.client!.callTool({
                            name: tool.name,
                            arguments: args,
                        });

                        // MCP results can be complex (content array)
                        if (result.isError) {
                            throw new Error(JSON.stringify(result.content));
                        }

                        const content = result.content as any[];
                        return content.map((c: any) => {
                            if (c.type === "text") return c.text;
                            return JSON.stringify(c);
                        }).join("\n");
                    }
                });
            }

        } catch (err: any) {
            console.error("   ❌ [MCP] Initialization failed:", err.message);
        }
    }

    getTools(): ToolDefinition[] {
        return Array.from(this.tools.values());
    }

    getTool(name: string): ToolDefinition | undefined {
        return this.tools.get(name);
    }
}

export const mcpManager = new MCPManager();

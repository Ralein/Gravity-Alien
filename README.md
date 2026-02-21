# 👾 Gravity Alien 

A lean, secure, fully-understood personal AI agent built from scratch.

## Architecture

- **Telegram-only** — Long-polling, no web server, no exposed ports
- **Claude-powered** — Anthropic SDK with agentic tool loop
- **Security-first** — User ID whitelist, env-only secrets, max iteration limits
- **TypeScript strict** — ES modules, full type safety

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure
cp .env.example .env
# Edit .env with your tokens and Telegram user ID

# 3. Run
npm run dev
```

## Getting Your Telegram User ID

Message [@userinfobot](https://t.me/userinfobot) on Telegram — it will reply with your numeric user ID.

## Level Status

| Level | Feature | Status |
|-------|---------|--------|
| 1 | Foundation (Telegram + AI + Tool Loop) | ✅ |
| 2 | Memory (SQLite persistence) | ⬜ |
| 3 | Voice (Whisper + ElevenLabs) | ⬜ |
| 4 | Tools (Shell, Browser, MCP) | ⬜ |
| 5 | Heartbeat (Proactive check-ins) | ⬜ |

## Project Structure

```
src/
├── index.ts          # Entry point
├── config.ts         # Env validation + typed config
├── bot/
│   └── bot.ts        # grammY bot, whitelist, message handler
├── agent/
│   ├── agent.ts      # Agentic loop (LLM ↔ tools)
│   └── tools.ts      # Tool registry + executors
└── types/
    └── index.ts      # Shared interfaces
```

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/clear` | Reset conversation history |

## Security

1. **User ID whitelist** — Only responds to your Telegram user ID
2. **No web server** — Zero open ports, long-polling only
3. **Secrets in `.env`** — Never in code, never in logs
4. **Agent loop limit** — Max 10 iterations (configurable)

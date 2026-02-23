---
description: Sync GSD state from Telegram and generate an implementation plan
---

# /gsd-sync Workflow

Use this workflow to bridge your brainstorming session in Telegram to this terminal.

1. **Read Status**: I'll call `gsd_progress` to automatically detect the latest project folder under `gsd/` (e.g., `gsd/RA-1/`).
2. **Research**: I'll use `Context7` to flesh out any technical details or library best practices.
3. **Generate Plan**: I will create a new `implementation_plan.md` artifact *right here* in this UI.
4. **Approval**: You review the plan in this window.
5. **Execute**: Once approved, I will start generating the code using the Worker pattern.

// turbo
To start, I'll identify the active project and read its state.
`ls -dt gsd/*/ | head -n 1 | xargs -I {} sh -c 'cat {}STATE.md {}PROJECT.md'`

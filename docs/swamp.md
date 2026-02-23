# SWAMP (Strategist, Worker, Agent, Manager, Provider)

SWAMP is an autonomous system that takes an idea and turns it into a working project, refining itself until the goal is achieved.

## Core Components

### 1. Gravity Alien (Strategist)
- **Role**: Thinking big-picture.
- **Function**: Breaks down ideas into actionable steps and milestones. Prioritizes tasks and decides the sequence.

### 2. Anti-Gravity (Creator)
- **Role**: Planning and Improvement.
- **Function**: Generates implementation plans. Evaluates results and iterates until the outcome matches the goal.

### 3. GSD Tools (Executor)
- **Role**: Doing the work.
- **Function**: Follows instructions from Anti-Gravity. Makes tangible progress (commits, file changes).

---

## Workflow Flow

1. **User Idea**: Ralein gives a goal or idea (e.g., "Build a stock tracker").
2. **Strategy**: Gravity Alien extracts goals and uses `gsd_new_project` to initialize the `.planning/` directory.
3. **Planning**: Anti-Gravity uses `gsd_plan_phase` to create specific tasks for the current phase.
4. **Execution**: GSD Tools (integrated into the agent's capability) carry out the actions.
5. **Verification**: The system verifies the work using `gsd_progress` and manual testing.
6. **Iteration**: Loop continues until the goal is realized.

---

## System Files (`.planning/`)

- `PROJECT.md`: High-level vision and goals.
- `REQUIREMENTS.md`: Specific technical and functional requirements.
- `ROADMAP.md`: Timeline and phases.
- `STATE.md`: Current progress, blockers, and next phase orientation.

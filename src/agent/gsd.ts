import fs from "fs-extra";
import path from "path";

/**
 * GSD (Get Shit Done) Manager
 * Handles project state, requirements, and roadmaps.
 */
export class GSDManager {
    private planningDir: string;

    constructor(baseDir: string) {
        this.planningDir = path.join(baseDir, ".planning");
    }

    async ensureInitialized() {
        await fs.ensureDir(this.planningDir);
        await fs.ensureDir(path.join(this.planningDir, "research"));
    }

    async getProjectFile(filename: string): Promise<string | null> {
        const filePath = path.join(this.planningDir, filename);
        if (await fs.pathExists(filePath)) {
            return fs.readFile(filePath, "utf-8");
        }
        return null;
    }

    async saveProjectFile(filename: string, content: string): Promise<void> {
        const filePath = path.join(this.planningDir, filename);
        await fs.writeFile(filePath, content, "utf-8");
    }

    async getProjectState(): Promise<any> {
        const stateStr = await this.getProjectFile("STATE.md");
        if (!stateStr) return { milestone: 1, phase: 1, completedTasks: [] };
        // Basic parser for state if needed, or just return as string
        return stateStr;
    }

    async initializeProject(goals: string): Promise<string> {
        await this.ensureInitialized();

        const projectMd = `# Project Vision\n\n${goals}\n`;
        await this.saveProjectFile("PROJECT.md", projectMd);

        const requirementsMd = `# Requirements\n\n- [ ] Initial set from vision\n`;
        await this.saveProjectFile("REQUIREMENTS.md", requirementsMd);

        const roadmapMd = `# Roadmap\n\n## Phase 1: Foundation\n- [ ] Setup core structures\n`;
        await this.saveProjectFile("ROADMAP.md", roadmapMd);

        const stateMd = `# State\n\n- Status: Initialized\n- Milestone: 1\n- Phase: 1\n`;
        await this.saveProjectFile("STATE.md", stateMd);

        return "Project initialized in .planning/";
    }

    async planPhase(phaseNum: number, context: string): Promise<string> {
        const phaseDir = path.join(this.planningDir, `phase-${phaseNum}`);
        await fs.ensureDir(phaseDir);

        const contextFile = `${phaseNum}-CONTEXT.md`;
        await this.saveProjectFile(contextFile, context);

        // In a real implementation, this would trigger LLM to generate plans.
        // For now, we stub it as a success message.
        return `Phase ${phaseNum} planned. Context saved to ${contextFile}.`;
    }
}

export const gsdManager = new GSDManager(process.cwd());

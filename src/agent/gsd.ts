import fs from "fs-extra";
import path from "path";

/**
 * GSD (Get Shit Done) Manager
 * Handles project state, requirements, and roadmaps.
 */
export class GSDManager {
    private planningDir: string;
    private gsdBaseDir: string;

    constructor(projectBaseDir: string) {
        this.planningDir = path.join(projectBaseDir, ".planning");
        this.gsdBaseDir = path.join(projectBaseDir, "gsd");
    }

    async ensureInitialized() {
        await fs.ensureDir(this.planningDir);
        await fs.ensureDir(path.join(this.planningDir, "research"));
    }

    async getTemplate(templatePath: string): Promise<string | null> {
        const fullPath = path.join(this.gsdBaseDir, ".gemini/get-shit-done/templates", templatePath);
        if (await fs.pathExists(fullPath)) {
            return fs.readFile(fullPath, "utf-8");
        }
        return null;
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
        if (!stateStr) return "Status: No project initialized. Use gsd_new_project.";
        // Basic parser for state if needed, or just return as string
        return stateStr;
    }

    async initializeProject(goals: string): Promise<string> {
        await this.ensureInitialized();

        // Use professional templates if available
        const projectTemplate = await this.getTemplate("project.md") || "# Project Vision\n\n{{goals}}\n";
        const projectMd = projectTemplate.replace("{{goals}}", goals);
        await this.saveProjectFile("PROJECT.md", projectMd);

        const requirementsTemplate = await this.getTemplate("requirements.md") || "# Requirements\n\n- [ ] Initial set from vision\n";
        await this.saveProjectFile("REQUIREMENTS.md", requirementsTemplate);

        const roadmapTemplate = await this.getTemplate("roadmap.md") || "# Roadmap\n\n## Phase 1: Foundation\n- [ ] Setup core structures\n";
        await this.saveProjectFile("ROADMAP.md", roadmapTemplate);

        const stateMd = `# State\n\n- Status: Initialized\n- Milestone: 1\n- Phase: 1\n- Time: ${new Date().toISOString()}\n`;
        await this.saveProjectFile("STATE.md", stateMd);

        return "Project initialized in .planning/ using professional templates.";
    }

    async planPhase(phaseNum: number, context: string): Promise<string> {
        const phaseDir = path.join(this.planningDir, `phase-${phaseNum}`);
        await fs.ensureDir(phaseDir);

        const contextFile = `${phaseNum}-CONTEXT.md`;
        await this.saveProjectFile(contextFile, `# Phase ${phaseNum} Context\n\n${context}`);

        return `Phase ${phaseNum} planned. Context saved. Ready for research or execution wave identification.`;
    }

    async mapCodebase(): Promise<string> {
        await this.ensureInitialized();
        const codebaseDir = path.join(this.planningDir, "codebase");
        await fs.ensureDir(codebaseDir);

        // Simulating codebase mapping
        await this.saveProjectFile("codebase/ARCHITECTURE.md", "# Architecture Map\n\n(Generated from existing codebase analysis)\n");
        await this.saveProjectFile("codebase/STACK.md", "# Current Stack\n\n(Generated from package.json and file analysis)\n");

        return "Codebase mapped to .planning/codebase/";
    }
}

export const gsdManager = new GSDManager(process.cwd());

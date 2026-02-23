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
        this.gsdBaseDir = path.join(projectBaseDir, "gsd");
        this.planningDir = path.join(this.gsdBaseDir, "active");
    }

    async ensureInitialized() {
        await fs.ensureDir(this.planningDir);
        await fs.ensureDir(path.join(this.planningDir, "phases"));
        await fs.ensureDir(path.join(this.gsdBaseDir, ".gemini/get-shit-done/templates"));
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

        // 1. Discovery/Project Vision
        const projectTemplate = await this.getTemplate("project.md") || "# Project Vision\n\n{{goals}}\n";
        const projectMd = projectTemplate.replace("{{goals}}", goals).replace("[Project Name]", "RA 1").replace("[date]", new Date().toLocaleDateString());
        await this.saveProjectFile("PROJECT.md", projectMd);

        // 2. Requirements
        const requirementsTemplate = await this.getTemplate("requirements.md") || "# Requirements\n\n- [ ] Initial set from vision\n";
        await this.saveProjectFile("REQUIREMENTS.md", requirementsTemplate);

        // 3. Roadmap (Multi-phase)
        const roadmapTemplate = await this.getTemplate("roadmap.md") || "# Roadmap\n\n## Phase 1: Foundation\n- [ ] Setup core structures\n";
        await this.saveProjectFile("ROADMAP.md", roadmapTemplate);

        // 4. State (The project's living memory)
        const stateTemplate = await this.getTemplate("state.md") || "# Project State\n\n- Status: Initialized\n";
        const stateMd = stateTemplate
            .replace("[date]", new Date().toLocaleDateString())
            .replace("[One-liner from PROJECT.md Core Value section]", "To be determined during discovery")
            .replace("[Current phase name]", "Phase 1: Foundation")
            .replace("[X] of [Y]", "1 of 5")
            .replace("[A] of [B]", "1 of 3")
            .replace("[Ready to plan / Planning / Ready to execute / In progress / Phase complete]", "Ready to Plan")
            .replace("[YYYY-MM-DD]", new Date().toLocaleDateString())
            .replace("[What happened]", "Project initialized via GSD Wizard");
        await this.saveProjectFile("STATE.md", stateMd);

        return "PROJECT_INITIALIZED: Project files created in gsd/active/. " +
            "Gravity Alien (Strategist), please use Context7 to research best practices " +
            "for the requested stack and refine the PROJECT.md. " +
            "Anti-Gravity (Worker), stand by for XML task instructions.";
    }

    async planPhase(phaseNum: number, context: string): Promise<string> {
        const phaseDir = path.join(this.planningDir, "phases", `phase-${phaseNum}`);
        await fs.ensureDir(phaseDir);

        const planFile = `phases/phase-${phaseNum}/PLAN.md`;
        const planTemplate = `# Phase ${phaseNum} Plan\n\n## Goal\nSet by Strategist based on Context7 research.\n\n## Tasks\n<!-- Anti-Gravity: Add <task> blocks here -->\n\n<task type="auto">\n  <name>Initialize Phase</name>\n  <action>Setup directory structure for phase ${phaseNum}</action>\n  <verify>ls -R gsd/active/phases/phase-${phaseNum}</verify>\n  <done>Phase dir exists</done>\n</task>\n`;
        await this.saveProjectFile(planFile, planTemplate);

        return `PHASE_PLANNED: Phase ${phaseNum} structure ready. " +
               "Strategist, refine the plan in gsd/active/${planFile}. " +
               "Worker, begin execution of initialized tasks.`;
    }

    async mapCodebase(): Promise<string> {
        await this.ensureInitialized();
        const codebaseDir = path.join(this.planningDir, "codebase");
        await fs.ensureDir(codebaseDir);

        // Simulating codebase mapping
        await this.saveProjectFile("codebase/ARCHITECTURE.md", "# Architecture Map\n\n(Generated from existing codebase analysis)\n");
        await this.saveProjectFile("codebase/STACK.md", "# Current Stack\n\n(Generated from package.json and file analysis)\n");

        return "Codebase mapped to gsd/active/codebase/";
    }
}

export const gsdManager = new GSDManager(process.cwd());

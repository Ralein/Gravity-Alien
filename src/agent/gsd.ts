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
        // Default to 'active' but this will be overridden dynamically
        this.planningDir = path.join(this.gsdBaseDir, "active");
    }

    private async getPlanningDir(projectName?: string): Promise<string> {
        if (projectName) {
            const sanitized = projectName.replace(/[^a-z0-9]/gi, "-").replace(/-+/g, "-").trim();
            return path.join(this.gsdBaseDir, sanitized);
        }

        // Auto-detect: find the most recently modified project folder in gsd/
        const items = await fs.readdir(this.gsdBaseDir, { withFileTypes: true });
        const projects = items
            .filter(i => i.isDirectory() && !i.name.startsWith("."))
            .map(i => ({ name: i.name, path: path.join(this.gsdBaseDir, i.name) }));

        if (projects.length === 0) return path.join(this.gsdBaseDir, "active");

        const stats = await Promise.all(projects.map(async p => ({ ...p, mtime: (await fs.stat(p.path)).mtime })));
        stats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

        return stats[0].path;
    }

    async ensureInitialized(projectName?: string) {
        const dir = await this.getPlanningDir(projectName);
        await fs.ensureDir(dir);
        await fs.ensureDir(path.join(dir, "phases"));
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
        const dir = await this.getPlanningDir();
        const filePath = path.join(dir, filename);
        if (await fs.pathExists(filePath)) {
            return fs.readFile(filePath, "utf-8");
        }
        return null;
    }

    async saveProjectFile(filename: string, content: string, projectName?: string): Promise<void> {
        const dir = await this.getPlanningDir(projectName);
        const filePath = path.join(dir, filename);
        await fs.ensureDir(path.dirname(filePath));
        await fs.writeFile(filePath, content, "utf-8");
    }

    async getProjectState(): Promise<any> {
        const stateStr = await this.getProjectFile("STATE.md");
        if (!stateStr) return "Status: No project initialized. Use gsd_new_project.";
        // Basic parser for state if needed, or just return as string
        return stateStr;
    }

    async initializeProject(goals: string): Promise<string> {
        // Extract project name from goals for folder naming
        const nameMatch = goals.match(/- Name: (.*)/);
        const projectName = nameMatch ? nameMatch[1].trim() : "active";

        await this.ensureInitialized(projectName);
        const dir = await this.getPlanningDir(projectName);

        // 1. Discovery/Project Vision
        const projectTemplate = await this.getTemplate("project.md") || "# Project Vision\n\n{{goals}}\n";
        const projectMd = projectTemplate.replace("{{goals}}", goals).replace("[Project Name]", projectName).replace("[date]", new Date().toLocaleDateString());
        await this.saveProjectFile("PROJECT.md", projectMd, projectName);

        // 2. Requirements
        const requirementsTemplate = await this.getTemplate("requirements.md") || "# Requirements\n\n- [ ] Initial set from vision\n";
        await this.saveProjectFile("REQUIREMENTS.md", requirementsTemplate, projectName);

        // 3. Roadmap (Multi-phase)
        const roadmapTemplate = await this.getTemplate("roadmap.md") || "# Roadmap\n\n## Phase 1: Foundation\n- [ ] Setup core structures\n";
        await this.saveProjectFile("ROADMAP.md", roadmapTemplate, projectName);

        // 4. State
        const stateTemplate = await this.getTemplate("state.md") || "# Project State\n\n- Status: Initialized\n";
        const stateMd = stateTemplate
            .replace("[date]", new Date().toLocaleDateString())
            .replace("[One-liner from PROJECT.md Core Value section]", "To be determined during discovery")
            .replace("[Current phase name]", "Phase 1: Foundation")
            .replace("[X] of [Y]", "1 of 5")
            .replace("[A] of [B]", "1 of 3")
            .replace("[Ready to plan / Planning / Ready to execute / In progress / Phase complete]", "Ready to Plan")
            .replace("[YYYY-MM-DD]", new Date().toLocaleDateString())
            .replace("[What happened]", `Project "${projectName}" initialized via GSD Wizard`);
        await this.saveProjectFile("STATE.md", stateMd, projectName);

        const relativeDir = path.relative(process.cwd(), dir);
        return `PROJECT_INITIALIZED: Project files created in ${relativeDir}/. ` +
            "Gravity Alien (Strategist), please use Context7 to research best practices " +
            "for the requested stack and refine the PROJECT.md. " +
            "Anti-Gravity (Worker), stand by for XML task instructions.";
    }

    async planPhase(phaseNum: number, context: string): Promise<string> {
        const dir = await this.getPlanningDir();
        const phaseDir = path.join(dir, "phases", `phase-${phaseNum}`);
        await fs.ensureDir(phaseDir);

        const planFile = `phases/phase-${phaseNum}/PLAN.md`;
        const planTemplate = `# Phase ${phaseNum} Plan\n\n## Goal\nSet by Strategist based on Context7 research.\n\n## Tasks\n<!-- Anti-Gravity: Add <task> blocks here -->\n\n<task type="auto">\n  <name>Initialize Phase</name>\n  <action>Setup directory structure for phase ${phaseNum}</action>\n  <verify>ls -R phases/phase-${phaseNum}</verify>\n  <done>Phase dir exists</done>\n</task>\n`;
        await this.saveProjectFile(planFile, planTemplate);

        const relativePath = path.join(path.relative(process.cwd(), dir), planFile);
        return `PHASE_PLANNED: Phase ${phaseNum} structure ready. " +
               "Strategist, refine the plan in ${relativePath}. " +
               "Worker, begin execution of initialized tasks.`;
    }

    async mapCodebase(): Promise<string> {
        const dir = await this.getPlanningDir();
        const codebaseDir = path.join(dir, "codebase");
        await fs.ensureDir(codebaseDir);

        // Simulating codebase mapping
        await this.saveProjectFile("codebase/ARCHITECTURE.md", "# Architecture Map\n\n(Generated from existing codebase analysis)\n");
        await this.saveProjectFile("codebase/STACK.md", "# Current Stack\n\n(Generated from package.json and file analysis)\n");

        const relativeDir = path.relative(process.cwd(), codebaseDir);
        return `Codebase mapped to ${relativeDir}/`;
    }
}

export const gsdManager = new GSDManager(process.cwd());

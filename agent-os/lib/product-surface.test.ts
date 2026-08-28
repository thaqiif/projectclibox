import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), "utf8");

test("removed integrations are no longer shipped", () => {
  const removedPaths = [
    "components/DevServers/DevServerCard.tsx",
    "data/dev-servers/queries.ts",
    "hooks/useDevServersManager.ts",
    "lib/dev-servers.ts",
    "app/api/dev-servers/route.ts",
    "components/GitPanel/index.tsx",
    "components/GitDrawer/index.tsx",
    "components/DiffViewer/index.tsx",
    "components/PRCreationModal.tsx",
    "data/git/queries.ts",
    "data/repositories/index.ts",
    "app/api/git/status/route.ts",
  ];

  for (const relativePath of removedPaths) {
    assert.equal(
      existsSync(join(process.cwd(), relativePath)),
      false,
      `${relativePath} should be removed`
    );
  }
});

test("workbench controls contain no Git surface", () => {
  const files = [
    "components/views/WorkbenchBar.tsx",
    "components/Pane/MobileTabBar.tsx",
    "components/Pane/index.tsx",
    "contexts/PaneContext.tsx",
    "lib/panes.ts",
  ];

  for (const relativePath of files) {
    assert.doesNotMatch(
      source(relativePath),
      /GitPanel|GitDrawer|gitDrawer|GitBranch|viewMode.*git/i,
      `${relativePath} still exposes Git UI`
    );
  }
});

test("project and terminal surfaces contain no Git or dev-server controls", () => {
  const files = [
    "app/page.tsx",
    "components/TerminalList/index.tsx",
    "components/TerminalList/TerminalList.types.ts",
    "components/TerminalList/TerminalListHeader.tsx",
    "components/TerminalList/hooks/useTerminalListMutations.ts",
    "components/Projects/ProjectsSection.tsx",
    "components/Projects/ProjectCard.tsx",
    "components/Projects/ProjectSettingsDialog.tsx",
    "components/Projects/NewProjectDialog.tsx",
    "components/Projects/hooks/useNewProjectForm.ts",
    "components/Projects/DirectoryField.tsx",
    "components/FolderPicker.tsx",
    "components/Terminal/TerminalToolbar.tsx",
  ];

  for (const relativePath of files) {
    assert.doesNotMatch(
      source(relativePath),
      /GitBranch|GitHub|Git repository|Git Repositories|dev server|DevServer|startDevServer/i,
      `${relativePath} still exposes a removed integration`
    );
  }
});

test("the product is branded CLIWeb", () => {
  const brandedFiles = [
    "app/layout.tsx",
    "app/page.tsx",
    "components/Welcome.tsx",
    "components/TerminalList/TerminalListHeader.tsx",
    "public/manifest.json",
    "server.ts",
  ];

  for (const relativePath of brandedFiles) {
    const contents = source(relativePath);
    assert.match(contents, /CLIWeb/, `${relativePath} is missing CLIWeb branding`);
    assert.doesNotMatch(
      contents,
      /AgentOS|Agent-OS|agentOS/i,
      `${relativePath} still contains the old brand`
    );
  }
});

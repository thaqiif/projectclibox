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

test("Homebrew is bootstrapped into the persistent CLIWeb home volume", () => {
  const dockerfile = readFileSync(join(process.cwd(), "..", "Dockerfile"), "utf8");
  const compose = readFileSync(
    join(process.cwd(), "..", "docker-compose.yml"),
    "utf8"
  );
  const entrypoint = readFileSync(
    join(process.cwd(), "..", "docker-entrypoint.sh"),
    "utf8"
  );

  assert.match(dockerfile, /\sfile\s+\\/, "the image is missing Homebrew's file dependency");
  assert.ok(
    dockerfile.includes("CLIWEB_BREW_PREFIX=/home/agent/brew"),
    "the image should define the persistent Homebrew prefix"
  );
  assert.ok(
    compose.includes("CLIWEB_BREW_PREFIX: /home/agent/brew"),
    "compose should expose the persistent Homebrew prefix"
  );
  assert.ok(
    compose.includes("- cliweb_home:/home/agent"),
    "the Homebrew prefix should live inside the persistent home volume"
  );
  assert.ok(
    entrypoint.includes('BREW_PREFIX="${CLIWEB_BREW_PREFIX:-${HOME}/brew}"'),
    "the entrypoint should resolve the Homebrew prefix under the agent home"
  );
  assert.ok(
    entrypoint.includes('export HOMEBREW_PREFIX="${BREW_PREFIX}"'),
    "the entrypoint should configure Homebrew to use the persistent prefix"
  );
  assert.ok(
    entrypoint.includes('cp -a "${BREW_SOURCE}/." "${BREW_REPOSITORY}/"'),
    "the entrypoint should seed Homebrew into the persistent prefix"
  );
});

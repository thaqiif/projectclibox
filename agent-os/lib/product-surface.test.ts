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
    dockerfile.includes("CLIWEB_BREW_PREFIX=/home/cliweb/brew"),
    "the image should define the persistent Homebrew prefix"
  );
  assert.ok(
    dockerfile.includes("HOMEBREW_PREFIX=/home/linuxbrew/.linuxbrew"),
    "the image should use Homebrew's supported Linux prefix for bottles"
  );
  assert.ok(
    dockerfile.includes("ln -s /home/cliweb/brew /home/linuxbrew/.linuxbrew") &&
      dockerfile.includes("ln -s /home/cliweb/brew/bin/brew /usr/local/bin/brew"),
    "the supported prefix and command should point into persistent storage"
  );
  assert.ok(
    compose.includes("CLIWEB_BREW_PREFIX: /home/cliweb/brew"),
    "compose should expose the persistent Homebrew prefix"
  );
  assert.ok(
    compose.includes("- cliweb_home:/home/cliweb"),
    "the Homebrew prefix should live inside the persistent home volume"
  );
  assert.ok(
    entrypoint.includes('BREW_STORAGE="${CLIWEB_BREW_PREFIX:-${HOME}/brew}"'),
    "the entrypoint should resolve the Homebrew prefix under the cliweb home"
  );
  assert.ok(
    entrypoint.includes('export HOMEBREW_PREFIX="${HOMEBREW_SYSTEM_PREFIX}"'),
    "the entrypoint should configure Homebrew to use its supported prefix"
  );
  assert.ok(
    entrypoint.includes('cp -a "${BREW_SOURCE}/." "${BREW_REPOSITORY}/"'),
    "the entrypoint should seed Homebrew into the persistent prefix"
  );
  assert.ok(
    entrypoint.includes('ln -sfn "${BREW_STORAGE}/bin/brew" /usr/local/bin/brew'),
    "the entrypoint should expose Brew even when a shell resets PATH"
  );
});

test("the container runtime user is cliweb", () => {
  const dockerfile = readFileSync(join(process.cwd(), "..", "Dockerfile"), "utf8");
  const entrypoint = readFileSync(
    join(process.cwd(), "..", "docker-entrypoint.sh"),
    "utf8"
  );
  const server = source("server.ts");

  assert.match(
    dockerfile,
    /useradd --create-home --home-dir \/home\/cliweb --shell \/bin\/bash --uid 1001 cliweb/,
    "the image should create the cliweb user"
  );
  assert.ok(
    entrypoint.includes('id -g cliweb') && entrypoint.includes('groupmod -o -g "${PGID}" cliweb'),
    "the entrypoint should remap the cliweb group"
  );
  assert.ok(
    entrypoint.includes('id -u cliweb') && entrypoint.includes('usermod -o -u "${PUID}" cliweb'),
    "the entrypoint should remap the cliweb user"
  );
  assert.ok(
    entrypoint.includes("export USER=cliweb") &&
      entrypoint.includes("export LOGNAME=cliweb") &&
      entrypoint.includes("gosu cliweb") &&
      entrypoint.includes("--reuid=cliweb") &&
      entrypoint.includes("--regid=cliweb"),
    "the entrypoint should launch processes as cliweb"
  );
  assert.ok(
    dockerfile.includes("ENV HOME=/home/cliweb") &&
      dockerfile.includes("/home/cliweb/.local"),
    "the container home should be /home/cliweb"
  );
  assert.match(server, /process\.env\.USER \|\| "cliweb"/);
});

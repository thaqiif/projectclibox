import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), "utf8");
const retiredProductStem = ["ag", "ent"].join("");
const retiredIdentity = new RegExp(
  `${retiredProductStem}(?:[-_ ]?os)?`,
  "i"
);

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
    "lib/model-catalog.ts",
    "lib/providers.ts",
    "lib/providers/registry.ts",
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

test("obsolete project launch metadata is removed", () => {
  const files = [
    "lib/db/schema.ts",
    "lib/db/queries.ts",
    "lib/db/types.ts",
    "lib/projects.ts",
    "lib/terminals.ts",
    "app/api/projects/route.ts",
    "app/api/projects/[id]/route.ts",
    "components/Welcome.tsx",
    "components/QuickSwitcher.tsx",
  ];

  for (const relativePath of files) {
    assert.doesNotMatch(
      source(relativePath),
      /provider_id|default_model|initial_prompt|providerId|defaultModel|initialPrompt/i,
      `${relativePath} still contains obsolete launch metadata`
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
    "public/cliweb.webmanifest",
    "server.ts",
  ];

  for (const relativePath of brandedFiles) {
    const contents = source(relativePath);
    assert.match(contents, /CLIWeb/, `${relativePath} is missing CLIWeb branding`);
    assert.doesNotMatch(
      contents,
      retiredIdentity,
      `${relativePath} still contains the old brand`
    );
  }
});

test("the retired repository identity is absent from first-party surfaces", () => {
  const root = join(process.cwd(), "..");
  const retiredName = [retiredProductStem, "os"].join("-");
  const files = [
    "Dockerfile",
    "docker-entrypoint.sh",
    "package.json",
    "cliweb/package.json",
    "cliweb/public/cliweb.webmanifest",
  ];

  assert.equal(
    existsSync(join(root, retiredName)),
    false,
    "the application directory should use the CLIWeb name"
  );

  for (const relativePath of files) {
    assert.doesNotMatch(
      readFileSync(join(root, relativePath), "utf8"),
      retiredIdentity,
      `${relativePath} still contains the retired identity`
    );
  }

  const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
  assert.ok(
    dockerfile.includes("CLIWEB_REPO=/opt/cliweb") &&
      dockerfile.includes('COPY cliweb/ "${CLIWEB_REPO}"/') &&
      dockerfile.includes("WORKDIR /opt/cliweb"),
    "the image should build and start from /opt/cliweb"
  );
});

test("the application icon represents CLIWeb", () => {
  const iconFiles = ["public/branding/cliweb-terminal.svg"];

  for (const relativePath of iconFiles) {
    const icon = source(relativePath);
    assert.match(icon, /<title>CLIWeb terminal<\/title>/);
    assert.match(icon, /data-mark="cliweb"/);
    assert.doesNotMatch(icon, /M12 8V4H8|robot/i);
  }

  assert.match(
    source("public/cliweb.webmanifest"),
    /"description": "CLIWeb terminal workspace"/
  );

  const layout = source("app/layout.tsx");
  const manifest = source("public/cliweb.webmanifest");

  assert.match(layout, /manifest: "\/cliweb\.webmanifest"/);
  assert.match(layout, /url: "\/branding\/cliweb-terminal\.svg"/);
  assert.match(layout, /apple: "\/branding\/cliweb-terminal-192\.png"/);
  assert.match(manifest, /"src": "\/branding\/cliweb-terminal-192\.png"/);
  assert.match(manifest, /"src": "\/branding\/cliweb-terminal-512\.png"/);

  const terminalListHeader = source(
    "components/TerminalList/TerminalListHeader.tsx"
  );
  assert.match(
    terminalListHeader,
    /src="\/branding\/cliweb-terminal\.svg"/,
    "the CLIWeb title should use the shared brand icon"
  );
  assert.doesNotMatch(
    terminalListHeader,
    /M12 8V4H8|<svg[\s\S]*?M12 8V4H8/,
    "the old inline robot icon should be removed"
  );

  for (const stalePath of [
    "app/icon.svg",
    "app/icon.png",
    "public/icon.svg",
    "public/icons/icon-192.png",
    "public/icons/icon-512.png",
    "public/manifest.json",
  ]) {
    assert.equal(
      existsSync(join(process.cwd(), stalePath)),
      false,
      `${stalePath} keeps the old icon URL cacheable`
    );
  }
});

test("nanobrew is installed into the persistent CLIWeb host directory", () => {
  const dockerfile = readFileSync(join(process.cwd(), "..", "Dockerfile"), "utf8");
  const compose = readFileSync(
    join(process.cwd(), "..", "docker-compose.yml"),
    "utf8"
  );
  const entrypoint = readFileSync(
    join(process.cwd(), "..", "docker-entrypoint.sh"),
    "utf8"
  );
  const bootstrap = readFileSync(
    join(process.cwd(), "..", "docker-nanobrew-bootstrap.sh"),
    "utf8"
  );
  const envExample = readFileSync(join(process.cwd(), "..", ".env.example"), "utf8");

  assert.ok(
    dockerfile.includes("ARG NANOBREW_VERSION=0.1.208") &&
      dockerfile.includes('nanobrew_arch="x86_64"') &&
      dockerfile.includes('nanobrew_arch="aarch64"') &&
      dockerfile.includes("nb-${nanobrew_arch}-linux.tar.gz") &&
      dockerfile.includes("sha256sum -c"),
    "the image should download and verify nanobrew's prebuilt release binary"
  );
  assert.doesNotMatch(
    dockerfile,
    /COPY --from=nanobrew\/nb/,
    "the image should not depend on the unavailable nanobrew Docker image"
  );
  assert.ok(
    dockerfile.includes("/opt/nanobrew") &&
      dockerfile.includes("NANOBREW_NO_TELEMETRY=1"),
    "the image should configure nanobrew's persistent root"
  );
  assert.ok(
    compose.includes("source: /home/cliweb/nanobrew") &&
      compose.includes("target: /opt/nanobrew"),
    "nanobrew's fixed data root should be a host bind mount"
  );
  assert.ok(
    entrypoint.includes('NANOBREW_ROOT="/opt/nanobrew"') &&
      entrypoint.includes("/usr/local/libexec/cliweb-nanobrew-bootstrap") &&
      entrypoint.includes('export PATH="${NANOBREW_ROOT}/prefix/bin:'),
    "the entrypoint should initialize nanobrew and expose installed commands"
  );
  assert.ok(
    dockerfile.includes(
      "COPY docker-nanobrew-bootstrap.sh /usr/local/libexec/cliweb-nanobrew-bootstrap"
    ) && bootstrap.includes('"${nanobrew_bin}" init'),
    "the image should run the tested nanobrew initializer"
  );
  assert.ok(
    !/^volumes:/m.test(compose) &&
      !compose.includes("cliweb_home") &&
      !compose.includes("cliweb_brew") &&
      !compose.includes("/home/cliweb/brew") &&
      !compose.includes("/home/linuxbrew/.linuxbrew"),
    "persistence should not use Docker-managed named volumes"
  );
  assert.ok(
    !compose.includes("cliweb-volume-init:") &&
      compose.includes("create_host_path: true") &&
      !compose.match(/source:.*\$\{/) &&
      !envExample.includes("CLIWEB_HOME_DIR"),
    "Coolify-safe host paths should be literal and created without an init service"
  );
  assert.doesNotMatch(
    `${dockerfile}\n${compose}\n${entrypoint}\n${bootstrap}`,
    /\bbrew\b|\bhomebrew\b/i,
    "the old Homebrew integration should be removed"
  );
  assert.match(
    source("lib/code-search.ts"),
    /nb install ripgrep/,
    "missing ripgrep guidance should use nanobrew"
  );
});

test("the container uses an available UTF-8 locale", () => {
  const dockerfile = readFileSync(join(process.cwd(), "..", "Dockerfile"), "utf8");
  const compose = readFileSync(
    join(process.cwd(), "..", "docker-compose.yml"),
    "utf8"
  );
  const server = source("server.ts");

  assert.ok(
    dockerfile.includes("LANG=C.UTF-8") && dockerfile.includes("LC_ALL=C.UTF-8"),
    "the image should use Debian's built-in UTF-8 locale"
  );
  assert.ok(
    compose.includes("LANG: C.UTF-8") && compose.includes("LC_ALL: C.UTF-8"),
    "compose should provide the same locale to terminals"
  );
  assert.match(server, /LANG: process\.env\.LANG \|\| "C\.UTF-8"/);
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

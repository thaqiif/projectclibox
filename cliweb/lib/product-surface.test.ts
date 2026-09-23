import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), "utf8");
const retiredProductStem = ["ag", "ent"].join("");
const retiredIdentity = new RegExp(`${retiredProductStem}(?:[-_ ]?os)?`, "i");

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
    // The shell drawer: its only entry point was the workbench bar toggle,
    // which is gone. The tmux split route stays; only its UI buttons left.
    "components/ShellDrawer/index.tsx",
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
    assert.match(
      contents,
      /CLIWeb/,
      `${relativePath} is missing CLIWeb branding`
    );
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
  const dockerfile = readFileSync(
    join(process.cwd(), "..", "Dockerfile"),
    "utf8"
  );
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
  const envExample = readFileSync(
    join(process.cwd(), "..", ".env.example"),
    "utf8"
  );

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
      dockerfile.includes("NANOBREW_NO_TELEMETRY=1") &&
      dockerfile.includes("CLIWEB_NANOBREW_ROOT=/opt/nanobrew"),
    "the image should configure nanobrew's persistent root"
  );
  assert.ok(
    compose.includes("/home/cliweb/nanobrew:/opt/nanobrew") &&
    compose.includes("/home/cliweb:/home/cliweb"),
    "nanobrew's fixed data root should be a host bind mount"
  );
  assert.ok(
    entrypoint.includes(
      'NANOBREW_ROOT="${CLIWEB_NANOBREW_ROOT:-/opt/nanobrew}"'
    ) &&
      entrypoint.includes("/usr/local/libexec/cliweb-nanobrew-bootstrap") &&
      bootstrap.includes("list --names") &&
      bootstrap.includes('"${nanobrew_bin}" link "${package}"'),
    "startup should initialize nanobrew, repair links, and expose installed commands"
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
});

test("the image libc can run nanobrew Linux bottles", () => {
  const dockerfile = readFileSync(
    join(process.cwd(), "..", "Dockerfile"),
    "utf8"
  );

  assert.match(
    dockerfile,
    /^FROM node:22-trixie-slim$/m,
    "nanobrew bottles need the newer glibc supplied by Debian Trixie"
  );
  assert.doesNotMatch(
    dockerfile,
    /^FROM node:22-bookworm-slim$/m,
    "Debian Bookworm's glibc cannot run current nanobrew bottles"
  );
});

test("the container includes the full Ruby runtime", () => {
  const dockerfile = readFileSync(
    join(process.cwd(), "..", "Dockerfile"),
    "utf8"
  );
  const aptPackages = dockerfile.slice(
    dockerfile.indexOf("apt-get install"),
    dockerfile.indexOf("&& rm -rf /var/lib/apt/lists/*")
  );

  assert.match(
    aptPackages,
    /^\s+ruby-full\s+\\$/m,
    "the image should install Debian's complete Ruby package"
  );
});

test("the container can reach APIs published on the Docker host", () => {
  const compose = readFileSync(
    join(process.cwd(), "..", "docker-compose.yml"),
    "utf8"
  );

  assert.match(
    compose,
    /extra_hosts:\n(?:\s+#.*\n)*\s+- "host\.docker\.internal:host-gateway"/,
    "Compose should provide a Linux host gateway for sibling container APIs"
  );
});

test("global npm installs are configured in the persistent home", () => {
  const dockerfile = readFileSync(
    join(process.cwd(), "..", "Dockerfile"),
    "utf8"
  );
  const compose = readFileSync(
    join(process.cwd(), "..", "docker-compose.yml"),
    "utf8"
  );
  const entrypoint = readFileSync(
    join(process.cwd(), "..", "docker-entrypoint.sh"),
    "utf8"
  );

  assert.ok(
    dockerfile.includes("NPM_CONFIG_PREFIX=/home/cliweb/.local") &&
      dockerfile.includes("NPM_CONFIG_USERCONFIG=/home/cliweb/.npmrc") &&
      dockerfile.includes(
        "COPY docker-cliweb-persistent-env.sh /usr/local/libexec/cliweb-persistent-env"
      ),
    "the image should point npm global installs at the mounted home"
  );
  assert.ok(
    compose.includes("NPM_CONFIG_PREFIX: /home/cliweb/.local") &&
      compose.includes("NPM_CONFIG_USERCONFIG: /home/cliweb/.npmrc"),
    "compose should preserve the npm prefix contract"
  );
  assert.ok(
    entrypoint.includes("npm config set prefix") &&
      entrypoint.includes("cliweb-persistent-env"),
    "startup should persist npm's prefix and shell environment"
  );
});

test("the container uses an available UTF-8 locale", () => {
  const dockerfile = readFileSync(
    join(process.cwd(), "..", "Dockerfile"),
    "utf8"
  );
  const compose = readFileSync(
    join(process.cwd(), "..", "docker-compose.yml"),
    "utf8"
  );
  const server = source("server.ts");

  assert.ok(
    dockerfile.includes("LANG=C.UTF-8") &&
      dockerfile.includes("LC_ALL=C.UTF-8"),
    "the image should use Debian's built-in UTF-8 locale"
  );
  assert.ok(
    compose.includes("LANG: C.UTF-8") && compose.includes("LC_ALL: C.UTF-8"),
    "compose should provide the same locale to terminals"
  );
  assert.match(server, /buildCliwebEnvironment/);
});

test("the container runtime user is cliweb", () => {
  const dockerfile = readFileSync(
    join(process.cwd(), "..", "Dockerfile"),
    "utf8"
  );
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
    entrypoint.includes("id -g cliweb") &&
      entrypoint.includes('groupmod -o -g "${PGID}" cliweb'),
    "the entrypoint should remap the cliweb group"
  );
  assert.ok(
    entrypoint.includes("id -u cliweb") &&
      entrypoint.includes('usermod -o -u "${PUID}" cliweb'),
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
  assert.match(server, /buildCliwebEnvironment/);
});

test("the mounted workspaces are writable by cliweb", () => {
  const entrypoint = readFileSync(
    join(process.cwd(), "..", "docker-entrypoint.sh"),
    "utf8"
  );

  assert.match(
    entrypoint,
    /chown -R cliweb:cliweb .*\/workspaces/,
    "startup should align the workspace bind mount with the runtime user"
  );
});

test("desktop monitor workspace stays isolated from mobile", () => {
  const page = source("app/page.tsx");
  const desktop = source("components/views/DesktopView.tsx");
  const mobile = source("components/views/MobileView.tsx");
  const monitor = source("components/MonitorWorkspace/index.tsx");
  const fileDrop = source("hooks/useFileDrop.ts");
  const hook = source("hooks/useMonitorWorkspace.ts");
  const route = source("app/api/monitor-workspace/route.ts");

  assert.match(page, /if \(isMobile\)[\s\S]*?<MobileView[\s\S]*?<DesktopView/);
  assert.match(desktop, /useMonitorWorkspace\(\)/);
  assert.match(desktop, /Toggle monitor workspace/);
  assert.match(desktop, /handleCloseTerminal\(activeTerminal\.name\)/);
  assert.doesNotMatch(desktop, /aria-label="Remove monitor pane"/);
  assert.match(monitor, /TERMINAL_DRAG_TYPE/);
  assert.match(monitor, /tmuxAttachCommand/);
  assert.match(monitor, /key=\{terminal\.id\}/);
  assert.match(monitor, /key=\{terminalId\}/);
  assert.match(monitor, /tmuxAttachCommand\(name, cwd\)/);
  assert.match(monitor, /projectNameFor/);
  assert.match(monitor, /Remove monitor pane/);
  assert.match(monitor, /Drop a terminal here/);
  assert.match(monitor, /Drop to replace this terminal/);
  assert.match(monitor, /Drop to open beside/);
  assert.match(monitor, /Move pane here/);
  assert.match(monitor, /PANE_DRAG_TYPE/);
  assert.match(fileDrop, /isMonitorDrag\(e\)\) return/);
  assert.match(hook, /pendingWrite/);
  assert.doesNotMatch(hook, /RESIZE_PERSIST_MS|skipResizePersist/);
  assert.doesNotMatch(monitor, /PanelSeparator|onLayoutChange|cursor-col-resize/);
  assert.match(hook, /removeMonitorPane/);
  assert.match(hook, /moveMonitorPane/);
  assert.match(hook, /dropMonitorTerminal/);
  assert.match(route, /Error resetting monitor workspace/);
  assert.match(
    source("app/api/tmux/kill-all/route.ts"),
    /forgetTerminal\(terminal\.name\)/
  );
  assert.match(page, /if \(attachedTmux === name\) detach\(\)/);
  assert.doesNotMatch(
    mobile,
    /MonitorWorkspace|useMonitorWorkspace|monitor pane/i
  );
});

test("terminal cards expose desktop drag identities", () => {
  const card = source("components/TerminalCard.tsx");
  assert.match(card, /draggable=\{draggable && !isEditing\}/);
  assert.match(card, /setData\(TERMINAL_DRAG_TYPE, terminal\.id\)/);
});

test("drag payload types have a single definition", () => {
  const dragTypes = source("lib/drag-types.ts");
  const sites = [
    "components/TerminalCard.tsx",
    "components/MonitorWorkspace/index.tsx",
    "hooks/useFileDrop.ts",
    "hooks/useMonitorWorkspace.ts",
  ];

  // A drag source and its drop targets are in different components, and a
  // mismatch fails silently: the browser never offers the drop. The type is
  // therefore declared once and imported, never re-typed at the call site.
  assert.match(
    dragTypes,
    /export const TERMINAL_DRAG_TYPE = "application\/x-cliweb-terminal"/
  );
  assert.match(
    dragTypes,
    /export const PANE_DRAG_TYPE = "application\/x-cliweb-monitor-pane"/
  );
  for (const path of sites) {
    assert.doesNotMatch(
      source(path),
      /"application\/x-cliweb-/,
      `${path} should import the shared drag type`
    );
  }
});

test("mobile chrome is opaque and cannot switch terminals by gesture", () => {
  const pane = source("components/Pane/index.tsx");
  const tabBar = source("components/Pane/MobileTabBar.tsx");
  const toolbar = source("components/Terminal/TerminalToolbar.tsx");

  // Swiping used to move to the next terminal, decided only on how far the
  // finger travelled sideways between touchstart and touchend. Scrolling the
  // terminal drifts sideways too, and the terminal's own scroll handler never
  // suppressed touchend, so the gesture fired mid-scroll — an accidental
  // terminal switch. Switching belongs to the terminal list and the quick
  // switcher, which say which terminal you picked.
  assert.doesNotMatch(pane, /SWIPE_THRESHOLD|touchStartX|changedTouches/);

  // The mobile header and the key row are anchored to the top and bottom of
  // the viewport, so a saved-to-home-screen iOS session runs them under the
  // status bar and the home indicator. A translucent material there frosts
  // the terminal scrolling beneath it, so both stay opaque.
  assert.match(tabBar, /className="bg-background glass-edge-bottom/);
  assert.match(toolbar, /className="bg-background glass-edge-top/);
  assert.doesNotMatch(tabBar, /"glass glass-edge/);
  assert.doesNotMatch(toolbar, /"glass glass-edge/);
});

test("unreachable surfaces are removed", () => {
  const removedPaths = [
    // The quick switcher, and the ripgrep code search it was the only door to.
    "components/QuickSwitcher.tsx",
    "components/CodeSearch/CodeSearchResults.tsx",
    "data/code-search/queries.ts",
    "app/api/code-search/route.ts",
    "app/api/code-search/available/route.ts",
    "lib/code-search.ts",
    // Find-in-terminal: no visible trigger ever opened it.
    "components/Terminal/SearchBar.tsx",
    "components/Terminal/hooks/useTerminalSearch.ts",
    // Terminal multi-select: it disabled navigation, and no action consumed it.
    "stores/terminalSelection.ts",
    "lib/rangeSelectionUtils.ts",
    // An arbitrary-command endpoint nothing called.
    "app/api/exec/route.ts",
  ];

  for (const relativePath of removedPaths) {
    assert.equal(
      existsSync(join(process.cwd(), relativePath)),
      false,
      `${relativePath} should be removed`
    );
  }
});

test("the terminal is the only surface a finger moves", () => {
  const card = source("components/TerminalCard.tsx");
  const sidebar = source("components/mobile/MobileSidebar.tsx");
  const monitor = source("hooks/useMonitorWorkspace.ts");

  // Shift-clicking a card used to start a selection that nothing acted on,
  // while every further click toggled selection instead of opening a terminal.
  assert.doesNotMatch(card, /isInSelectMode|onToggleSelect|isSelected/);

  // The drawer tracked a finger until it was released. Scrolling the terminal
  // is the only thing a swipe should do now.
  assert.doesNotMatch(
    sidebar,
    /pointerdown|pointermove|VelocityTracker|projectMomentum|rubberBand/
  );

  // Lifting a terminal card opens the monitor workspace so there is somewhere
  // to drop it, and a drag that lands nowhere puts the workspace back.
  assert.match(monitor, /addEventListener\("dragstart"/);
  assert.match(monitor, /addEventListener\("dragend"/);
  assert.match(monitor, /TERMINAL_DRAG_TYPE/);
  assert.match(monitor, /dragLandedRef/);
});

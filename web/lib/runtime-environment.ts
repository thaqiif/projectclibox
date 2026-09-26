import fs from "fs";
import path from "path";

const SYSTEM_PATH =
  "/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin";
type NodeEnvironment = "development" | "production" | "test";

function uniquePath(entries: string[]): string {
  const seen = new Set<string>();

  return entries
    .filter((entry) => {
      if (!entry || seen.has(entry)) return false;
      seen.add(entry);
      return true;
    })
    .join(":");
}

/**
 * Build the environment inherited by the web server, terminals, and tmux.
 *
 * The image is rebuilt regularly, while the user's home directory is a host
 * bind mount. Keeping both package managers' writable roots under that home
 * only works when every process receives the same prefix and PATH.
 */
/**
 * Per-deployment data suffix derived from CLIBOX_PROFILE.
 *
 * Two deployments (production and test) can share the same persisted home
 * volume without seeing each other's data: with CLIBOX_PROFILE=test set on
 * one deployment, its data directories are suffixed, e.g.
 * ~/.clibox-test/clibox.db and ~/.clibox-test/.trash. The default profile
 * (no variable, or empty) keeps today's paths unchanged for compatibility.
 */
export function cliboxProfileSuffix(
  input: Record<string, string | undefined> = process.env
): string {
  const raw = (legacyEnv(input, "PROFILE") || "").trim().toLowerCase();
  if (!raw) return "";
  const slug = raw.replace(/[^a-z0-9_-]+/g, "-").replace(/^[-._]+|[-._]+$/g, "");
  if (!slug || slug === "default") return "";
  return `-${slug}`;
}

/**
 * Read a CLIBOX_* setting, falling back to its CLIWEB_* name from before the
 * project was renamed, so existing deployments keep their configuration.
 */
export function legacyEnv(
  input: Record<string, string | undefined>,
  name: string
): string | undefined {
  return input[`CLIBOX_${name}`] || input[`CLIWEB_${name}`] || undefined;
}

/**
 * The per-deployment data directory (database, trash, deployment marker).
 *
 * Before the rename it was ~/.cliweb<suffix> holding cliweb.db. When only
 * the old directory exists it is moved into place, database files included,
 * so an upgraded deployment starts with its terminals and projects intact.
 */
export function cliboxDataDir(
  input: Record<string, string | undefined> = process.env
): string {
  const home = input.HOME || process.cwd();
  const suffix = cliboxProfileSuffix(input);
  const dir = path.join(home, `.clibox${suffix}`);
  const legacyDir = path.join(home, `.cliweb${suffix}`);
  if (!fs.existsSync(dir) && fs.existsSync(legacyDir)) {
    fs.renameSync(legacyDir, dir);
    for (const ext of ["", "-wal", "-shm"]) {
      const legacyDb = path.join(dir, `cliweb.db${ext}`);
      if (fs.existsSync(legacyDb)) {
        fs.renameSync(legacyDb, path.join(dir, `clibox.db${ext}`));
      }
    }
  }
  return dir;
}

export function buildCliboxEnvironment(
  input: Record<string, string | undefined> = process.env
): NodeJS.ProcessEnv {
  const nodeEnv: NodeEnvironment =
    input.NODE_ENV === "development" ||
    input.NODE_ENV === "test" ||
    input.NODE_ENV === "production"
      ? input.NODE_ENV
      : "production";
  const environment = { NODE_ENV: nodeEnv } as NodeJS.ProcessEnv;

  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && key !== "NODE_ENV") {
      environment[key] = value;
    }
  }

  const home = input.HOME || "/home/clibox";
  const nanobrewRoot = legacyEnv(input, "NANOBREW_ROOT") || "/opt/nanobrew";
  const npmPrefix = input.NPM_CONFIG_PREFIX || `${home}/.local`;
  const npmUserConfig = input.NPM_CONFIG_USERCONFIG || `${home}/.npmrc`;
  const inheritedPath = input.PATH || SYSTEM_PATH;

  environment.HOME = home;
  environment.CLIBOX_NANOBREW_ROOT = nanobrewRoot;
  environment.NPM_CONFIG_PREFIX = npmPrefix;
  environment.NPM_CONFIG_USERCONFIG = npmUserConfig;
  environment.PYTHONUSERBASE = input.PYTHONUSERBASE || `${home}/.local`;
  environment.USER = input.USER || "clibox";
  environment.LOGNAME = input.LOGNAME || environment.USER;
  environment.SHELL = input.SHELL || "/bin/bash";
  environment.LANG = input.LANG || "C.UTF-8";
  environment.PATH = uniquePath([
    `${nanobrewRoot}/prefix/bin`,
    `${npmPrefix}/bin`,
    `${home}/.local/bin`,
    `${home}/.local/sbin`,
    ...inheritedPath.split(":"),
  ]);

  return environment;
}

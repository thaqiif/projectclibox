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
 * Per-deployment data suffix derived from CLIWEB_PROFILE.
 *
 * Two deployments (production and test) can share the same persisted home
 * volume without seeing each other's data: with CLIWEB_PROFILE=test set on
 * one deployment, its data directories are suffixed, e.g.
 * ~/.cliweb-test/cliweb.db and ~/.cliweb-trash-test. The default profile
 * (no variable, or empty) keeps today's paths unchanged for compatibility.
 */
export function cliwebProfileSuffix(
  input: Record<string, string | undefined> = process.env
): string {
  const raw = (input.CLIWEB_PROFILE || "").trim().toLowerCase();
  if (!raw) return "";
  const slug = raw.replace(/[^a-z0-9_-]+/g, "-").replace(/^[-._]+|[-._]+$/g, "");
  if (!slug || slug === "default") return "";
  return `-${slug}`;
}

export function buildCliwebEnvironment(
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

  const home = input.HOME || "/home/cliweb";
  const nanobrewRoot = input.CLIWEB_NANOBREW_ROOT || "/opt/nanobrew";
  const npmPrefix = input.NPM_CONFIG_PREFIX || `${home}/.local`;
  const npmUserConfig = input.NPM_CONFIG_USERCONFIG || `${home}/.npmrc`;
  const inheritedPath = input.PATH || SYSTEM_PATH;

  environment.HOME = home;
  environment.CLIWEB_NANOBREW_ROOT = nanobrewRoot;
  environment.NPM_CONFIG_PREFIX = npmPrefix;
  environment.NPM_CONFIG_USERCONFIG = npmUserConfig;
  environment.PYTHONUSERBASE = input.PYTHONUSERBASE || `${home}/.local`;
  environment.USER = input.USER || "cliweb";
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

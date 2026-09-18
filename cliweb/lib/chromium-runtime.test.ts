import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("the container exposes a stable non-root Chromium CLI", () => {
  const root = join(process.cwd(), "..");
  const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
  const compose = readFileSync(join(root, "docker-compose.yml"), "utf8");
  const readme = readFileSync(join(root, "README.md"), "utf8");
  const aptInstall = dockerfile.slice(
    dockerfile.indexOf("apt-get install"),
    dockerfile.indexOf("&& rm -rf /var/lib/apt/lists/*")
  );

  assert.match(
    aptInstall,
    /apt-get install -y --no-install-recommends/,
    "Chromium should be installed without recommended packages"
  );
  assert.match(
    aptInstall,
    /^\s+chromium\s+\\$/m,
    "the image should install Debian's chromium package"
  );
  assert.match(
    aptInstall,
    /^\s+chromium-sandbox\s+\\$/m,
    "the image should retain Chromium's non-root sandbox when recommendations are disabled"
  );
  assert.match(
    dockerfile,
    /test -x \/usr\/bin\/chromium/,
    "the image build should validate the Chromium executable"
  );
  assert.match(
    dockerfile,
    /test -u \/usr\/lib\/chromium\/chrome-sandbox/,
    "the image build should validate the setuid Chromium sandbox"
  );
  assert.match(
    dockerfile,
    /CHROMIUM_PATH=\/usr\/bin\/chromium/,
    "the image should publish Chromium's stable runtime path"
  );
  assert.match(
    compose,
    /CHROMIUM_PATH:\s*\/usr\/bin\/chromium/,
    "Compose should preserve the Chromium runtime path"
  );
  assert.match(
    readme,
    /docker compose exec --user cliweb cliweb[\s\S]*--version/,
    "the README should document a non-root Chromium version smoke test"
  );
  assert.match(
    readme,
    /--headless=new/,
    "the README should show headless Chromium CLI usage"
  );
  assert.match(
    readme,
    /rather\s+than downloading a second browser bundle/i,
    "the README should direct CLI tools to the image-provided browser"
  );
  assert.match(
    readme,
    /non-root|unprivileged `cliweb`/i,
    "the README should explain the container's non-root runtime"
  );
});

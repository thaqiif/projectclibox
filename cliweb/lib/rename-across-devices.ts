import { randomBytes } from "crypto";
import { cpSync, renameSync, rmSync } from "fs";
import { basename, dirname, join } from "path";

/**
 * Rename `src` to `dest`, falling back to staged copy+remove for EXDEV.
 * The copy is published only when complete, so failures cannot leave a
 * partial item at the requested destination.
 */
export function renameAcrossDevices(
  src: string,
  dest: string,
  copy: (source: string, target: string) => void = (source, target) =>
    cpSync(source, target, { recursive: true, verbatimSymlinks: true })
): void {
  try {
    renameSync(src, dest);
    return;
  } catch (err) {
    if ((err as { code?: string }).code !== "EXDEV") throw err;
  }

  const stagingPath = join(
    dirname(dest),
    `.${basename(dest)}.cliweb-move-${process.pid}-${randomBytes(6).toString("hex")}`
  );
  let published = false;
  try {
    copy(src, stagingPath);
    renameSync(stagingPath, dest);
    published = true;
  } finally {
    if (!published) rmSync(stagingPath, { recursive: true, force: true });
  }

  // Remove only after the complete destination is published. If this fails,
  // retaining both complete copies is safer than losing the source.
  rmSync(src, { recursive: true, force: true });
}

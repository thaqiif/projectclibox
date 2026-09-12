/** Convert a displayed absolute path into the relative path accepted by Rust. */
export function relativeToRoot(path: string, root: string): string {
  const normalizedRoot = root.replace(/\\/g, "/").replace(/\/$/, "");
  const normalizedPath = path.replace(/\\/g, "/");
  if (!normalizedRoot || normalizedPath === normalizedRoot) return "";
  const prefix = `${normalizedRoot}/`;
  if (normalizedPath.startsWith(prefix)) {
    return normalizedPath.slice(prefix.length);
  }
  return normalizedPath === "~" ? "" : normalizedPath;
}

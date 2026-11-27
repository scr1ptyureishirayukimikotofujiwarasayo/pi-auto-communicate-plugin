import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const MAX_FILES = 6;
const MAX_BYTES = 4096;
const TEXT_FILE = /\.(?:[cm]?[jt]sx?|py|rb|go|rs|java|kt|cs|c|cpp|h|hpp|swift|php|lua|vue|svelte|html|css|scss|sql|md|txt|jsonc?|ya?ml|toml|xml|sh|ps1)$/i;

function allowed(path: string): boolean {
  return TEXT_FILE.test(path) && path.split(/[\\/]/).every((part) =>
    !part.startsWith(".") && !/:/.test(part) &&
    !/^(?:node_modules|vendor|dist|build|coverage)$/i.test(part) &&
    !/(?:^|[._-])(?:env|secrets?|credentials?|auth|tokens?|private[._-]?keys?)(?:[._-]|$)/i.test(part));
}

function inside(path: string): boolean {
  return !!path && !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`);
}

export async function readSharedFile(cwd: string, path: string) {
  try {
    // Require a workspace-relative path using forward slashes, including on Windows.
    if (isAbsolute(path) || path.includes("\\") || !allowed(path)) return;
    const root = await realpath(cwd);
    const target = await realpath(resolve(root, path));
    const canonicalPath = relative(root, target);
    if (!inside(canonicalPath) || !allowed(canonicalPath) || !(await stat(target)).isFile()) return;
    const file = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
      const info = await file.stat();
      if (!info.isFile() || info.nlink !== 1 || await realpath(target) !== target) return;
      const bytes = Buffer.alloc(MAX_BYTES + 1);
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      const sample = bytes.subarray(0, Math.min(bytesRead, MAX_BYTES));
      if (sample.includes(0)) return;
      const truncated = bytesRead > MAX_BYTES;
      const content = new TextDecoder("utf-8", { fatal: true }).decode(sample, { stream: truncated });
      return { path, content, truncated };
    } finally {
      await file.close();
    }
  } catch {
    // Files may have been removed or become unreadable since being shared.
    return undefined;
  }
}

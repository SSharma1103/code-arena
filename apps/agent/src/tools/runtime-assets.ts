import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const directory = dirname(createRequire(import.meta.url).resolve("three"));
const cache = new Map<string, Promise<string>>();
export function runtimeAsset(path: string): Promise<string> | undefined {
  const name =
    path === "/runtime/three.module.js"
      ? "three.module.js"
      : path === "/runtime/three.min.js"
        ? "three.min.js"
        : undefined;
  if (!name) return;
  if (!cache.has(name))
    cache.set(name, readFile(join(directory, name), "utf8"));
  return cache.get(name)!;
}

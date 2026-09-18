/**
 * Loads the seed library documents from /content/library.
 *
 * Frontmatter is parsed by hand rather than with a dependency: the format is
 * three keys and one list, and the committee should be able to edit these
 * files without knowing what YAML is.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface LibraryDocSource {
  slug: string;
  title: string;
  isLocal: boolean;
  localFieldsRequired: string[];
  body: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(raw: string): {
  data: Record<string, string | string[]>;
  body: string;
} {
  const match = FRONTMATTER.exec(raw);
  if (!match) return { data: {}, body: raw.trim() };

  const data: Record<string, string | string[]> = {};
  let currentListKey: string | null = null;

  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;

    const listItem = /^\s+-\s+(.*)$/.exec(line);
    if (listItem && currentListKey) {
      (data[currentListKey] as string[]).push(unquote(listItem[1] ?? ""));
      continue;
    }

    const pair = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!pair) continue;

    const [, key = "", value = ""] = pair;
    if (value === "") {
      currentListKey = key;
      data[key] = [];
    } else {
      currentListKey = null;
      data[key] = unquote(value);
    }
  }

  return { data, body: raw.slice(match[0].length).trim() };
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const quoted = /^(['"])([\s\S]*)\1$/.exec(trimmed);
  return quoted ? (quoted[2] ?? "") : trimmed;
}

export function loadLibraryDocs(dir = join(process.cwd(), "content", "library")): LibraryDocSource[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((file) => {
      const { data, body } = parseFrontmatter(readFileSync(join(dir, file), "utf8"));
      const slug = typeof data["slug"] === "string" ? data["slug"] : file.replace(/\.md$/, "");
      const title = typeof data["title"] === "string" ? data["title"] : slug;
      const localFields = data["localFieldsRequired"];
      return {
        slug,
        title,
        isLocal: data["isLocal"] === "true",
        localFieldsRequired: Array.isArray(localFields) ? localFields : [],
        body,
      };
    });
}

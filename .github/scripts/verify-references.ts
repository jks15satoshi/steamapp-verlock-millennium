import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DOC_GLOBS = [".agents/specs/[0-9][0-9][0-9]_*.md", ".agents/skills/*/SKILL.md"];

interface Finding {
  file: string;
  line: number;
  target: string;
  reason: string;
}

function blankCode(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/~~~[\s\S]*?~~~/g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/`[^`\n]*`/g, (span) => " ".repeat(span.length));
}

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text[cursor] === "\n") {
      line += 1;
    }
  }
  return line;
}

function slugify(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-");
}

function headingAnchors(text: string): Set<string> {
  const result = new Set<string>();
  for (const line of blankCode(text).split(/\r?\n/)) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading !== null) {
      result.add(slugify(heading[1]));
    }
  }
  return result;
}

function cleanTarget(raw: string): string {
  let target = raw.trim();
  if (target.startsWith("<") && target.endsWith(">")) {
    target = target.slice(1, -1).trim();
  }
  const titled = /^(\S+)\s+.+$/.exec(target);
  if (titled !== null) {
    target = titled[1];
  }
  return target;
}

function isExternal(target: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target) || target.startsWith("//");
}

function documents(): string[] {
  const paths = new Set<string>();
  for (const pattern of DOC_GLOBS) {
    for (const path of new Bun.Glob(pattern).scanSync()) {
      paths.add(path);
    }
  }
  return Array.from(paths).toSorted((a, b) => a.localeCompare(b));
}

function checkDocument(relative: string): Finding[] {
  const text = readFileSync(relative, "utf8");
  const blanked = blankCode(text);
  const findings: Finding[] = [];
  const link = /(!?)\[([^\]]*)\]\(([^)]+)\)/g;
  let match = link.exec(blanked);
  while (match !== null) {
    if (match[1] !== "!") {
      const target = cleanTarget(match[3]);
      const line = lineAt(text, match.index);
      if (target.startsWith("#")) {
        const anchor = target.slice(1);
        if (anchor !== "" && !headingAnchors(text).has(anchor)) {
          findings.push({ file: relative, line, target, reason: `missing anchor #${anchor}` });
        }
      } else if (target !== "" && !isExternal(target)) {
        const hash = target.indexOf("#");
        const filePart = hash === -1 ? target : target.slice(0, hash);
        const anchor = hash === -1 ? "" : target.slice(hash + 1);
        const targetPath = resolve(dirname(relative), filePart);
        if (!existsSync(targetPath)) {
          findings.push({ file: relative, line, target, reason: "missing file" });
        } else if (
          anchor !== "" &&
          filePart.endsWith(".md") &&
          !headingAnchors(readFileSync(targetPath, "utf8")).has(anchor)
        ) {
          findings.push({ file: relative, line, target, reason: `missing anchor #${anchor}` });
        }
      }
    }
    match = link.exec(blanked);
  }
  return findings;
}

function main(): void {
  const findings = documents().flatMap((document) => checkDocument(document));
  if (findings.length === 0) {
    return;
  }
  console.error("Broken references found in the spec and skill corpus:");
  for (const finding of findings) {
    console.error(`  - ${finding.file}:${finding.line}: ${finding.target} (${finding.reason})`);
  }
  process.exit(1);
}

if (import.meta.main) {
  main();
}

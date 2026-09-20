import { existsSync, readFileSync } from "node:fs";

const COMMIT_TYPES = [
  "feat",
  "fix",
  "perf",
  "refactor",
  "docs",
  "test",
  "build",
  "ci",
  "chore",
  "release",
  "revert",
] as const;

const HEADER_PATTERN = new RegExp(
  `^(${COMMIT_TYPES.join("|")})(?:\\([a-z0-9]+(?:-[a-z0-9]+)*\\))?!?: .+$`,
);
const SUBJECT_START_PATTERN = /^[a-z0-9]/;
const REVERT_PATTERN = /^Revert ".*"$/;
const TRAILER_PATTERN =
  /^(?:co-authored-by|co-developed-by|signed-off-by|generated-by|assisted-by):\s*\S/i;
const GENERATED_LINE_PATTERN = /generated with/i;
const TOOL_PATTERN =
  /\b(claude|chatgpt|copilot|cursor|codex|gemini|openai|anthropic|aider|windsurf|devin|llm)\b/i;

export function verifyHeader(header: string): string[] {
  const line = header.trim();
  if (line.startsWith("Merge ") || REVERT_PATTERN.test(line)) {
    return [];
  }

  if (!HEADER_PATTERN.test(line)) {
    return [
      `"${line}" is not a Conventional Commit header.`,
      `Use <type>(<scope>): <subject>; the types are ${COMMIT_TYPES.join(", ")}.`,
      "Example: fix(backend): reject a stale manifest path.",
    ];
  }

  const problems: string[] = [];
  const subject = line.slice(line.indexOf(": ") + 2);
  if (!SUBJECT_START_PATTERN.test(subject)) {
    problems.push("The subject must start with a lowercase letter or digit.");
  }
  if (subject.endsWith(".")) {
    problems.push("The subject must not end with a period.");
  }
  return problems;
}

export function verifyTitle(title: string): string[] {
  const line = title.trim();
  if (line.startsWith("Merge ")) {
    return [
      `"${line}" is not a pull request title.`,
      "Use a Conventional Commit header such as fix(backend): reject a stale manifest path.",
    ];
  }
  return verifyHeader(line);
}

export function verifyMessage(message: string): string[] {
  const lines = message
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !line.startsWith("#"));
  while (lines.length > 0 && (lines[lines.length - 1] ?? "").trim() === "") {
    lines.pop();
  }
  if (lines.length === 0) {
    return [];
  }

  const problems = verifyHeader(lines[0] ?? "");
  if (lines.length > 1 && (lines[1] ?? "").trim() !== "") {
    problems.push("Leave a blank line between the header and the body.");
  }
  for (const line of lines) {
    if (
      (TRAILER_PATTERN.test(line) || GENERATED_LINE_PATTERN.test(line)) &&
      TOOL_PATTERN.test(line)
    ) {
      problems.push(`Remove the generation-tool attribution: "${line.trim()}".`);
    }
  }
  return problems;
}

function readFlag(flag: string): string | undefined {
  const index = Bun.argv.indexOf(flag);
  return index === -1 ? undefined : Bun.argv[index + 1];
}

function gitOperationInProgress(): boolean {
  const markers = ["rebase-merge", "rebase-apply", "MERGE_HEAD", "CHERRY_PICK_HEAD"];
  for (const marker of markers) {
    const result = Bun.spawnSync(["git", "rev-parse", "--git-path", marker]);
    if (!result.success) {
      continue;
    }
    const path = result.stdout.toString().trim();
    if (path !== "" && existsSync(path)) {
      return true;
    }
  }
  return false;
}

function report(heading: string, problems: string[]): never {
  console.error(`${heading}:`);
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  process.exit(1);
}

function main(): void {
  const title = readFlag("--title");
  if (title !== undefined) {
    const problems = verifyTitle(title);
    if (problems.length > 0) {
      report("Invalid pull request title", problems);
    }
    return;
  }

  const inline = readFlag("--message");
  let message = inline;
  if (message === undefined) {
    const path = Bun.argv.slice(2).find((argument) => !argument.startsWith("--"));
    if (path === undefined) {
      console.error(
        "Usage: verify-commit-message.ts <message-file> | --message <text> | --title <text>",
      );
      process.exit(2);
    }
    if (!existsSync(path)) {
      console.error(`Commit message file not found: ${path}`);
      process.exit(2);
    }
    if (gitOperationInProgress()) {
      return;
    }
    message = readFileSync(path, "utf8");
  }

  const problems = verifyMessage(message);
  if (problems.length > 0) {
    report("Invalid commit message", problems);
  }
}

if (import.meta.main) {
  main();
}

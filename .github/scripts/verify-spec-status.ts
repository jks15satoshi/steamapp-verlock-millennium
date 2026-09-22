const SPEC_GLOB = new Bun.Glob(".agents/specs/[0-9][0-9][0-9]_*.md");

interface PullRequestPayload {
  pull_request?: {
    draft?: boolean;
  };
}

async function isDraft(): Promise<boolean> {
  const eventPath = Bun.env.GITHUB_EVENT_PATH;
  if (eventPath === undefined || eventPath === "") {
    return false;
  }
  try {
    const payload = (await Bun.file(eventPath).json()) as PullRequestPayload;
    return payload.pull_request?.draft === true;
  } catch {
    return false;
  }
}

export function readFrontmatter(text: string): Map<string, string> {
  const fields = new Map<string, string>();
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (match === null) {
    return fields;
  }
  for (const line of match[1].split(/\r?\n/)) {
    const entry = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (entry !== null) {
      fields.set(entry[1], entry[2].trim());
    }
  }
  return fields;
}

async function activeFeatureSpecs(): Promise<string[]> {
  const offenders: string[] = [];
  for (const path of Array.from(SPEC_GLOB.scanSync()).toSorted((a, b) => a.localeCompare(b))) {
    const fields = readFrontmatter(await Bun.file(path).text());
    if (fields.get("type") === "feature" && fields.get("status") === "active") {
      offenders.push(path);
    }
  }
  return offenders;
}

async function main(): Promise<void> {
  if (await isDraft()) {
    console.log("Draft pull request: the spec-status gate does not apply.");
    return;
  }

  const offenders = await activeFeatureSpecs();
  if (offenders.length === 0) {
    return;
  }

  console.error(
    "A ready-for-review pull request cannot contain an active feature spec; set status: implemented:",
  );
  for (const offender of offenders) {
    console.error(`  - ${offender}`);
  }
  process.exit(1);
}

if (import.meta.main) {
  await main();
}

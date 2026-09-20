import { readFileSync } from "node:fs";
import { verifyTitle } from "./verify-commit-message";

interface PullRequestPayload {
  pull_request?: {
    title?: string;
    body?: string | null;
    draft?: boolean;
  };
}

const REQUIRED_SECTIONS = ["Motivation", "Changes", "Testing"];
const ISSUE_REFERENCE_PATTERN = /\b(fixes|closes|resolves|related|refs)\b[^\n]*#\d+/i;

function main(): void {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath === undefined) {
    console.error("GITHUB_EVENT_PATH is not set; run this script from a pull_request workflow.");
    process.exit(2);
  }

  let payload: PullRequestPayload;
  try {
    payload = JSON.parse(readFileSync(eventPath, "utf8")) as PullRequestPayload;
  } catch (error) {
    console.error(`Cannot read the pull request event payload at ${eventPath}: ${String(error)}`);
    process.exit(2);
  }
  const pullRequest = payload.pull_request;
  if (pullRequest === undefined || pullRequest.draft === true) {
    return;
  }

  const problems: string[] = [];
  problems.push(...verifyTitle(pullRequest.title ?? ""));

  const body = (pullRequest.body ?? "").replace(/\r\n/g, "\n");
  for (const section of REQUIRED_SECTIONS) {
    const heading = new RegExp(`^##\\s+${section}\\s*$`, "im");
    if (!heading.test(body)) {
      problems.push(`Add the "${section}" section from the pull request template.`);
    }
  }
  if (!ISSUE_REFERENCE_PATTERN.test(body)) {
    problems.push("Reference an issue, for example: Fixes #12 or Related #12.");
  }

  if (problems.length > 0) {
    console.error("Invalid pull request:");
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    process.exit(1);
  }
}

main();

const TEMPLATE = ".github/release-template.md";
const MANIFEST = "millennium.toml";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function pluginId(toml: string): string {
  const pluginSection = /\[plugin\]([\s\S]*?)(?=\n\[|$)/.exec(toml)?.[1] ?? "";
  return /^\s*id\s*=\s*"([^"]+)"/m.exec(pluginSection)?.[1] ?? "";
}

async function generatedChangelog(tag: string): Promise<string> {
  const repository = Bun.env.GITHUB_REPOSITORY ?? "";
  const token = Bun.env.GITHUB_TOKEN ?? "";
  if (repository === "" || token === "") {
    return "- See the commit history and the linked pull requests for this release.";
  }

  const response = await fetch(
    `https://api.github.com/repos/${repository}/releases/generate-notes`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tag_name: tag }),
    },
  );

  if (!response.ok) {
    fail(`generate-notes failed with status ${response.status}: ${await response.text()}`);
  }

  const payload = (await response.json()) as { body?: string };
  return (payload.body ?? "").trim();
}

function sha256(bytes: ArrayBuffer): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

export async function main(): Promise<void> {
  const tag = process.argv[2] ?? Bun.env.GITHUB_REF_NAME ?? "";
  const artifact = process.argv[3] ?? "dist/steamapp-verlock.star";
  if (tag === "") {
    fail("No tag supplied; pass it as the first argument or set GITHUB_REF_NAME.");
  }

  const version = tag.replace(/^v/, "");
  const file = Bun.file(artifact);
  if (!(await file.exists())) {
    fail(`Artifact "${artifact}" does not exist.`);
  }

  const template = await Bun.file(TEMPLATE).text();
  const toml = await Bun.file(MANIFEST).text();

  const notes = template
    .replaceAll("{{VERSION}}", version)
    .replaceAll("{{DATE}}", new Date().toISOString().slice(0, 10))
    .replaceAll("{{ARTIFACT}}", artifact.split("/").pop() ?? artifact)
    .replaceAll("{{SHA256}}", sha256(await file.arrayBuffer()))
    .replaceAll("{{PLUGIN_ID}}", pluginId(toml))
    .replaceAll("{{CHANGELOG}}", await generatedChangelog(tag));

  process.stdout.write(notes);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

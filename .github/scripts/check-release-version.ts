const MANIFEST = "millennium.toml";
const PACKAGE = "package.json";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function manifestVersion(toml: string): string {
  const pluginSection = /\[plugin\]([\s\S]*?)(?=\n\[|$)/.exec(toml)?.[1] ?? "";
  return /^\s*version\s*=\s*"([^"]+)"/m.exec(pluginSection)?.[1] ?? "";
}

export async function main(): Promise<void> {
  const reference = process.argv[2] ?? Bun.env.GITHUB_REF_NAME ?? "";
  if (reference === "") {
    fail("No tag supplied; pass it as the first argument or set GITHUB_REF_NAME.");
  }

  const tagVersion = reference.replace(/^v/, "");
  const tomlVersion = manifestVersion(await Bun.file(MANIFEST).text());
  const packageVersion = ((await Bun.file(PACKAGE).json()) as { version?: string }).version ?? "";

  const mismatches: string[] = [];
  if (tomlVersion !== tagVersion) {
    mismatches.push(`${MANIFEST} [plugin].version is "${tomlVersion}"`);
  }
  if (packageVersion !== tagVersion) {
    mismatches.push(`${PACKAGE} version is "${packageVersion}"`);
  }

  if (mismatches.length > 0) {
    fail(
      `Tag "${reference}" (version "${tagVersion}") does not match:\n  ${mismatches.join("\n  ")}`,
    );
  }

  console.log(`Tag "${reference}" matches the plugin version "${tagVersion}".`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

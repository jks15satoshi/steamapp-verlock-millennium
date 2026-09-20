import { mkdirSync } from "node:fs";
import { join } from "node:path";

const outputDir = "dist";
const starlightScript = join("node_modules", "@steambrew", "starlight", "bin", "starlight.js");

mkdirSync(outputDir, { recursive: true });

const result = Bun.spawnSync(
  [process.execPath, starlightScript, "pack", "--release", "-o", outputDir],
  { stdio: ["inherit", "inherit", "inherit"] },
);

process.exit(result.exitCode ?? 1);

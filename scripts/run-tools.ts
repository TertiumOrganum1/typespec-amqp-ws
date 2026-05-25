import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function tryCommand(cmd: string, args: string[]): boolean {
  const r = spawnSync(cmd, args, { stdio: "pipe" });
  return r.status === 0 && r.stdout.toString().trim().length > 0;
}

export const HAS_ASYNCAPI = tryCommand("asyncapi", ["--version"]);
export const HAS_REDOCLY = tryCommand("redocly", ["--version"]);

interface ToolResult {
  ok: boolean;
  error?: string;
  files?: string[];
  dir?: string;
}

function writeYaml(yamlText: string): { dir: string; yamlPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "tspamqp-"));
  const yamlPath = join(dir, "asyncapi.yaml");
  writeFileSync(yamlPath, yamlText);
  return { dir, yamlPath };
}

/** Запускает modelina codegen. */
export function runModelina(yamlText: string, language: "golang" | "typescript"): ToolResult {
  if (!HAS_ASYNCAPI) return { ok: false, error: "asyncapi CLI not installed" };
  const { dir, yamlPath } = writeYaml(yamlText);
  const outDir = join(dir, "out");
  try {
    execFileSync(
      "asyncapi",
      ["generate", "models", language, yamlPath, `--output=${outDir}`, "--packageName=test"],
      { stdio: "pipe" },
    );
    const files = readdirSync(outDir);
    return { ok: true, files, dir: outDir };
  } catch (e) {
    const err = e as { stderr?: Buffer; message?: string };
    return { ok: false, error: err.stderr?.toString() ?? err.message ?? "unknown error" };
  }
}

/** Запускает redocly lint. */
export function runRedocly(yamlText: string): ToolResult {
  if (!HAS_REDOCLY) return { ok: false, error: "redocly CLI not installed" };
  const { dir, yamlPath } = writeYaml(yamlText);
  try {
    execFileSync("redocly", ["lint", yamlPath, "--skip-rule=info-license"], { stdio: "pipe" });
    return { ok: true };
  } catch (e) {
    const err = e as { stderr?: Buffer; stdout?: Buffer; message?: string };
    return {
      ok: false,
      error: err.stderr?.toString() ?? err.stdout?.toString() ?? err.message ?? "unknown",
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

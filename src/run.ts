/**
 * Harness runner.
 *
 *   tsx src/run.ts                     # host-only adapters (no docker/buildkit)
 *   tsx src/run.ts --allow-docker      # + TerraConstructs Docker bundlers
 *   tsx src/run.ts --allow-docker --allow-buildkit
 *   tsx src/run.ts --adapter=rolldown-dir --scenario=repeat/stage-twice
 *
 * Writes results.json and REPORT.md, then prints a summary.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { cdktn, PR_HEAD_SHA, PR_LIB } from "./pr-head";
import {
  cleanupWorkRoot,
  createFixture,
  hashTree,
  listDirRecursive,
  listScratchDirs,
  scenarios,
} from "./scenarios";
import type { Adapter, HarnessReport, ScenarioResult } from "./types";
import { adapter as localAdapter } from "./adapters/tc-local";
import { adapter as nodejsAdapter } from "./adapters/tc-nodejs";
import { directoryAdapter, zipAdapter } from "./adapters/rolldown";
import { bindMountAdapter, volumeCopyAdapter } from "./adapters/tc-docker";
import { adapter as chainAdapter } from "./adapters/tc-local-docker";
import { adapter as buildkitAdapter } from "./adapters/buildkit";
import { buildxDockerDaemonAdapter } from "./adapters/buildkit-docker-driver";

const args = process.argv.slice(2);
const allowDocker = args.includes("--allow-docker");
const allowBuildkit = args.includes("--allow-buildkit");
const mergeResults = args.includes("--merge");
const onlyAdapter = args.find((arg) => arg.startsWith("--adapter="))?.split("=")[1];
const onlyScenario = args.find((arg) => arg.startsWith("--scenario="))?.split("=")[1];

const allAdapters: Adapter[] = [
  localAdapter,
  nodejsAdapter,
  directoryAdapter,
  zipAdapter,
  chainAdapter,
  bindMountAdapter,
  volumeCopyAdapter,
  buildkitAdapter,
  buildxDockerDaemonAdapter,
];
const adapters: Adapter[] = allAdapters.filter(
  (adapter) => !onlyAdapter || adapter.meta.id === onlyAdapter,
);

const selectedScenarios = scenarios.filter(
  (scenario) => !onlyScenario || scenario.id === onlyScenario,
);

const ROOT = path.join(__dirname, "..");

function environment(): Record<string, string> {
  const version = (command: string, argv: string[]) => {
    const result = spawnSync(command, argv, { encoding: "utf-8" });
    return result.status === 0
      ? (result.stdout.trim().split("\n")[0] ?? "")
      : "<unavailable>";
  };
  return {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    tmpdir: process.env.TMPDIR ?? "/tmp",
    docker: version("docker", ["--version"]),
    buildctl: version("sh", ["-c", "command -v buildctl || echo <unavailable>"]),
    buildkitAddr: process.env.BUILDKIT_ADDR ?? process.env.BUILDKIT_HOST ?? "<unset>",
  };
}

async function main(): Promise<void> {
  const results: ScenarioResult[] = [];
  const skippedAdapters: Record<string, string> = {};

  for (const adapter of adapters) {
    const gated =
      (adapter.meta.needsDocker && !allowDocker) ||
      (adapter.meta.needsBuildkit && !allowBuildkit);

    const probe = await adapter.probe();

    if (gated) {
      const reason =
        adapter.meta.needsDocker && !allowDocker
          ? "gated: pass --allow-docker to run container-based scenarios"
          : "gated: pass --allow-buildkit to run buildkit-endpoint scenarios";
      skippedAdapters[adapter.meta.id] = `${reason} (probe: ${probe.detail})`;
      for (const scenario of selectedScenarios) {
        results.push({
          scenario: scenario.id,
          adapter: adapter.meta.id,
          status: "skipped",
          observations: { gate: reason, probe: probe.detail },
        });
      }
      continue;
    }

    if (!probe.available) {
      skippedAdapters[adapter.meta.id] = `probe failed: ${probe.detail}`;
      for (const scenario of selectedScenarios) {
        results.push({
          scenario: scenario.id,
          adapter: adapter.meta.id,
          status: "skipped",
          observations: { probe: probe.detail },
        });
      }
      continue;
    }

    for (const scenario of selectedScenarios) {
      // Each scenario gets its own fixture so adapters cannot share state.
      const fixture = createFixture(`${adapter.meta.id}-${scenario.id}`.replace(/[^\w.-]/g, "_"));
      const tmpdir = process.env.TMPDIR ?? "/tmp";
      const scratchBefore = listScratchDirs(tmpdir);
      try {
        const { observations, error } = await scenario.run(adapter, fixture);
        const newScratch = listScratchDirs(tmpdir).filter((dir) => !scratchBefore.includes(dir));
        results.push({
          scenario: scenario.id,
          adapter: adapter.meta.id,
          status: error ? "fail" : "pass",
          observations: { ...observations, newScratchDirs: newScratch.length },
          error,
        });
      } catch (err) {
        results.push({
          scenario: scenario.id,
          adapter: adapter.meta.id,
          status: "fail",
          observations: {},
          error: err instanceof Error ? `${err.message}` : String(err),
        });
      }
    }
  }

  const resultsPath = path.join(ROOT, "results.json");
  let mergedResults = results;
  let generatedAt = new Date().toISOString();
  if (mergeResults && existsSync(resultsPath)) {
    const previous = JSON.parse(readFileSync(resultsPath, "utf8")) as HarnessReport;
    const rerunAdapters = new Set(adapters.map((adapter) => adapter.meta.id));
    mergedResults = [
      ...previous.results.filter((row) => !rerunAdapters.has(row.adapter)),
      ...results,
    ];
    generatedAt = `${previous.generatedAt} + ${generatedAt}`;
  }

  const report: HarnessReport = {
    generatedAt,
    prHeadSha: PR_HEAD_SHA,
    cdktnLib: PR_LIB,
    environment: environment(),
    results: mergedResults,
  };

  writeFileSync(resultsPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(
    path.join(ROOT, "REPORT.md"),
    renderReport(report, allAdapters, skippedAdapters),
  );

  printSummary(report, adapters, skippedAdapters);
}

function printSummary(
  report: HarnessReport,
  used: Adapter[],
  skipped: Record<string, string>,
): void {
  console.log(`cdktn bundler harness — PR #442 head ${report.prHeadSha}`);
  console.log(`library: ${report.cdktnLib}`);
  console.log(`environment: ${JSON.stringify(report.environment)}`);
  console.log("");
  const byAdapter = new Map<string, ScenarioResult[]>();
  for (const result of report.results) {
    byAdapter.set(result.adapter, [...(byAdapter.get(result.adapter) ?? []), result]);
  }
  for (const adapter of used) {
    const rows = byAdapter.get(adapter.meta.id) ?? [];
    const passed = rows.filter((row) => row.status === "pass").length;
    const failed = rows.filter((row) => row.status === "fail").length;
    const skippedRows = rows.filter((row) => row.status === "skipped").length;
    console.log(
      `${adapter.meta.id.padEnd(28)} pass=${String(passed).padStart(2)} fail=${String(failed).padStart(2)} skipped=${String(skippedRows).padStart(2)}` +
        (skipped[adapter.meta.id] ? `  [${skipped[adapter.meta.id]}]` : ""),
    );
  }
  const failures = report.results.filter((row) => row.status === "fail");
  if (failures.length > 0) {
    console.log("\nfailures:");
    for (const failure of failures) {
      console.log(`  ${failure.adapter} / ${failure.scenario}: ${failure.error}`);
    }
  }
}

function renderReport(
  report: HarnessReport,
  used: Adapter[],
  skipped: Record<string, string>,
): string {
  const lines: string[] = [];
  lines.push("# cdktn asset-bundler harness — results");
  lines.push("");
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(
    `- Targets cdktn **PR #442** head \`${report.prHeadSha}\` (interface \`IAssetBundler\` + \`bundler\` on \`AssetStaging\`/\`TerraformAsset\`)`,
  );
  lines.push(`- Library under test: \`${report.cdktnLib}\``);
  lines.push("");
  lines.push("## Environment");
  lines.push("");
  for (const [key, value] of Object.entries(report.environment)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  lines.push("## Adapters");
  lines.push("");
  for (const adapter of used) {
    lines.push(`### ${adapter.meta.id} — ${adapter.meta.name}`);
    lines.push("");
    lines.push(`- Provenance: ${adapter.meta.provenance}`);
    lines.push(`- Ported in: \`${adapter.meta.portedIn}\``);
    lines.push(`- Port notes: ${adapter.meta.portNotes}`);
    if (skipped[adapter.meta.id]) {
      lines.push(`- **Not executed in this run**: ${skipped[adapter.meta.id]}`);
    }
    lines.push("");
  }
  lines.push("## Results matrix");
  lines.push("");
  const adapterIds = used.map((adapter) => adapter.meta.id);
  const scenarioIds = [...new Set(report.results.map((row) => row.scenario))];
  lines.push(`| scenario | ${adapterIds.join(" | ")} |`);
  lines.push(`| --- | ${adapterIds.map(() => "---").join(" | ")} |`);
  for (const scenarioId of scenarioIds) {
    const cells = adapterIds.map((adapterId) => {
      const row = report.results.find(
        (result) => result.scenario === scenarioId && result.adapter === adapterId,
      );
      if (!row) return "–";
      return row.status === "pass" ? "pass" : row.status === "fail" ? "**fail**" : "skip";
    });
    lines.push(`| \`${scenarioId}\` | ${cells.join(" | ")} |`);
  }
  lines.push("");
  lines.push("## Observations");
  lines.push("");
  for (const scenarioId of scenarioIds) {
    lines.push(`### \`${scenarioId}\``);
    lines.push("");
    for (const adapterId of adapterIds) {
      const row = report.results.find(
        (result) => result.scenario === scenarioId && result.adapter === adapterId,
      );
      if (!row) continue;
      lines.push(
        `<details><summary><b>${adapterId}</b> — ${row.status}${row.error ? `: ${row.error}` : ""}</summary>`,
      );
      lines.push("");
      lines.push("```json");
      lines.push(JSON.stringify(row.observations, null, 2));
      lines.push("```");
      lines.push("</details>");
      lines.push("");
    }
  }
  return `${lines.join("\n")}\n`;
}

/** Unused helpers kept exported for ad-hoc inspection runs. */
export const helpers = { existsSync, readFileSync, hashTree, listDirRecursive, cleanupWorkRoot, cdktn };

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

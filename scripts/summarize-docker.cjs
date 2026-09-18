const report = require("/data/repos/cdktn-bundler-harness/results.json");
const byKey = new Map();
for (const row of report.results) byKey.set(`${row.adapter}::${row.scenario}`, row);
const get = (a, s, k) => (byKey.get(`${a}::${s}`)?.observations ?? {})[k];
const adapters = [...new Set(report.results.map((r) => r.adapter))];
const dockerLike = ["tcons-docker-bind", "tcons-docker-volume", "tcons-local-docker-chain"];

console.log("all adapters:", adapters.join(", "));
console.log("\n=== row counts per adapter ===");
for (const a of adapters) {
  const rows = report.results.filter((r) => r.adapter === a);
  const counts = rows.reduce((acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {});
  console.log(`${a.padEnd(26)} ${JSON.stringify(counts)}`);
}

console.log("\n=== docker adapters: key observations ===");
for (const a of dockerLike) {
  console.log(`\n--- ${a} ---`);
  console.log(
    `source-hash: callsAtConstruction=${get(a, "stage/source-hash", "bundlerCallsAtConstruction")} callsAfterStage=${get(a, "stage/source-hash", "bundlerCallsAfterStage")} staged=${JSON.stringify(get(a, "stage/source-hash", "stagedFiles"))}`,
  );
  console.log(
    `output-hash: eager=${get(a, "stage/output-hash", "bundlerCallsAtConstruction")} hash=${get(a, "stage/output-hash", "assetHash")} matchesArtifact=${get(a, "stage/output-hash", "stagingMatchesArtifact")}`,
  );
  console.log(
    `zip-packaging: entries=${JSON.stringify(get(a, "stage/zip-packaging", "archiveEntries"))} doubleArchived=${JSON.stringify(get(a, "stage/zip-packaging", "doubleArchived"))}`,
  );
  console.log(
    `stage-twice: rebuilt=${get(a, "repeat/stage-twice", "rebuiltOnSecondStage")} identical=${get(a, "repeat/stage-twice", "artifactsIdentical")} | nondeterministic sameIdentityDifferentBytes=${get(a, "repeat/stage-twice-nondeterministic", "sameIdentityDifferentBytes")}`,
  );
  console.log(
    `synth-twice: rebuilt=${get(a, "repeat/synth-twice", "rebuiltOnSecondSynth")} identical=${get(a, "repeat/synth-twice", "identicalAcrossSynths")} assetFiles=${JSON.stringify(get(a, "repeat/synth-twice", "emittedAssetFiles"))}`,
  );
  console.log(
    `file-type: rejected=${get(a, "asset/file-type-bundler", "rejectedAtConstruction")} error=${JSON.stringify(get(a, "asset/file-type-bundler", "error"))}`,
  );
  console.log(
    `throws: propagated=${get(a, "failure/bundler-throws", "errorPropagated")} scratchLeft=${get(a, "failure/bundler-throws", "scratchDirsLeftInProcess")} bytes=${get(a, "failure/bundler-throws", "scratchBytesLeftInProcess")}`,
  );
  console.log(
    `exclude: shipped=${get(a, "identity/excluded-input-changes", "excludedFileShippedInArtifact")} hashUnchanged=${get(a, "identity/excluded-input-changes", "hashUnchangedDespiteExcludedChange")} artifactChanged=${get(a, "identity/excluded-input-changes", "artifactChanged")}`,
  );
  console.log(
    `never-staged: dirs=${get(a, "large-output/never-staged", "scratchDirsCreated")} bytes=${get(a, "large-output/never-staged", "scratchBytes")}`,
  );
  console.log(`bundlerKey: ${get(a, "identity/bundler-key", "adapterBundlerKey")}`);
}

console.log("\n=== host adapter nondeterministic identity check ===");
for (const a of adapters) {
  const row = byKey.get(`${a}::repeat/stage-twice-nondeterministic`);
  if (!row) continue;
  console.log(
    `${a.padEnd(26)} status=${row.status} sameIdentityDifferentBytes=${row.observations.sameIdentityDifferentBytes} hash=${row.observations.assetHash}`,
  );
}

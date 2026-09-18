// Compact summary of results.json for the harness findings write-up.
const report = require("/data/repos/cdktn-bundler-harness/results.json");

const pick = (chain) => {
  const out = {};
  for (const key of chain) out[key] = key;
  return out;
};

const rows = report.results.filter((r) => r.status === "pass");
const byAdapter = new Map();
for (const row of rows) {
  if (!byAdapter.has(row.adapter)) byAdapter.set(row.adapter, new Map());
  byAdapter.get(row.adapter).set(row.scenario, row.observations);
}

const get = (adapter, scenario, key) => {
  const obs = byAdapter.get(adapter)?.get(scenario);
  return obs ? obs[key] : undefined;
};

const adapters = [...byAdapter.keys()];
console.log("adapters:", adapters.join(", "));
console.log("\n=== stage/source-hash: is the build deferred? ===");
for (const a of adapters) {
  console.log(
    `${a.padEnd(24)} callsAtConstruction=${get(a, "stage/source-hash", "bundlerCallsAtConstruction")} callsAfterStage=${get(a, "stage/source-hash", "bundlerCallsAfterStage")} stagedFiles=${JSON.stringify(get(a, "stage/source-hash", "stagedFiles"))}`,
  );
}
console.log("\n=== stage/output-hash: eager build + identity from artifact ===");
for (const a of adapters) {
  console.log(
    `${a.padEnd(24)} callsAtConstruction=${get(a, "stage/output-hash", "bundlerCallsAtConstruction")} artifactPresentAtStage=${get(a, "stage/output-hash", "artifactStillPresentAtStageTime")} hash=${get(a, "stage/output-hash", "assetHash")} stagingMatchesArtifact=${get(a, "stage/output-hash", "stagingMatchesArtifact")}`,
  );
}
console.log("\n=== stage/zip-packaging ===");
for (const a of adapters) {
  console.log(
    `${a.padEnd(24)} entries=${JSON.stringify(get(a, "stage/zip-packaging", "archiveEntries"))} doubleArchived=${JSON.stringify(get(a, "stage/zip-packaging", "doubleArchived"))} bytes=${get(a, "stage/zip-packaging", "archiveBytes")}`,
  );
}
console.log("\n=== repeat/stage-twice ===");
for (const a of adapters) {
  console.log(
    `${a.padEnd(24)} hash=${get(a, "repeat/stage-twice", "assetHash")} calls=${get(a, "repeat/stage-twice", "bundlerCallsAfterSecondStage")} rebuilt=${get(a, "repeat/stage-twice", "rebuiltOnSecondStage")} identical=${get(a, "repeat/stage-twice", "artifactsIdentical")}`,
  );
}
console.log("\n=== repeat/synth-twice ===");
for (const a of adapters) {
  console.log(
    `${a.padEnd(24)} hash=${get(a, "repeat/synth-twice", "assetHash")} calls=${get(a, "repeat/synth-twice", "bundlerCalls")} identicalAcrossSynths=${get(a, "repeat/synth-twice", "identicalAcrossSynths")} files=${JSON.stringify(get(a, "repeat/synth-twice", "emittedFilesAfterFirstSynth"))}`,
  );
}
console.log("\n=== asset/file-type-bundler ===");
for (const a of adapters) {
  console.log(
    `${a.padEnd(24)} rejected=${get(a, "asset/file-type-bundler", "rejectedAtConstruction")} producesArchive=${get(a, "asset/file-type-bundler", "adapterProducesArchive")} error=${get(a, "asset/file-type-bundler", "error")}`,
  );
}
console.log("\n=== identity/excluded-input-changes ===");
for (const a of adapters) {
  console.log(
    `${a.padEnd(24)} excludedShipped=${get(a, "identity/excluded-input-changes", "excludedFileShippedInArtifact")} hashUnchanged=${get(a, "identity/excluded-input-changes", "hashUnchangedDespiteExcludedChange")} artifactChanged=${get(a, "identity/excluded-input-changes", "artifactChanged")}`,
  );
}
console.log("\n=== determinism/two-fresh-builds ===");
for (const a of adapters) {
  console.log(
    `${a.padEnd(24)} reproducible=${get(a, "determinism/two-fresh-builds", "reproducible")} artifactTreesEqual=${get(a, "determinism/two-fresh-builds", "artifactTreesEqual")}`,
  );
}
console.log("\n=== identity/bundler-key ===");
for (const a of adapters) {
  console.log(
    `${a.padEnd(24)} adapterKey=${get(a, "identity/bundler-key", "adapterBundlerKey")} identityFollowsKey=${get(a, "identity/bundler-key", "identityFollowsBundlerKey")}`,
  );
}
console.log("\n=== large-output/never-staged ===");
for (const a of adapters) {
  console.log(
    `${a.padEnd(24)} dirsCreated=${get(a, "large-output/never-staged", "scratchDirsCreated")} bytes=${get(a, "large-output/never-staged", "scratchBytes")} hash=${get(a, "large-output/never-staged", "assetHash")}`,
  );
}
console.log("\n=== failure/bundler-throws ===");
for (const a of adapters) {
  console.log(
    `${a.padEnd(24)} propagated=${get(a, "failure/bundler-throws", "errorPropagated")} scratchAfter=${get(a, "failure/bundler-throws", "scratchDirsAfter")} error=${get(a, "failure/bundler-throws", "error")}`,
  );
}

const report = require("/data/repos/cdktn-bundler-harness/results.json");
for (const scenario of ["failure/bundler-throws", "repeat/synth-twice"]) {
  console.log(`\n===== ${scenario} =====`);
  for (const row of report.results.filter((r) => r.scenario === scenario)) {
    console.log(`${row.adapter}: ${JSON.stringify(row.observations, null, 1)}`);
  }
}

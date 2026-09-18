// Does the exit sweep reclaim scratch when the eager build THROWS and the
// process then exits normally?
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const child = `
const fs = require("fs");
const path = require("path");
const lib = require("/data/repos/hermes-pr-reviewer/worktrees/cdk-terrain/open-constructs__cdk-terrain/pr-442/packages/cdktn/lib/index.js");
const { AssetHashType, AssetPackaging, AssetStaging, TerraformStack, Testing } = lib;
const srcDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "throw-src-"));
fs.writeFileSync(path.join(srcDir, "a.txt"), "x");
let scratch;
try {
  new AssetStaging(new TerraformStack(Testing.app({}), "s"), "boom", {
    sourcePath: srcDir,
    packaging: AssetPackaging.DIRECTORY,
    assetHashType: AssetHashType.OUTPUT,
    bundler: {
      bundle: (o) => {
        scratch = o.outputDir;
        fs.writeFileSync(path.join(o.outputDir, "partial.bin"), "partial");
        throw new Error("build failed");
      },
    },
  });
} catch (e) {
  fs.writeFileSync(process.env.MARKER, scratch + "\\n" + scratch);
}
`;

const tmpdir = fs.mkdtempSync("/data/tmp/throwcheck-");
const marker = path.join(tmpdir, "marker.txt");
const res = spawnSync(process.execPath, ["-e", child], {
  env: { ...process.env, TMPDIR: tmpdir, MARKER: marker },
  encoding: "utf8",
});
const scratch = fs.readFileSync(marker, "utf8").split("\n")[0];
console.log(
  JSON.stringify(
    {
      childExitCode: res.status,
      scratch,
      leakedAfterThrowAndNormalExit: fs.existsSync(scratch),
      stdout: res.stdout.trim(),
      stderrHead: res.stderr.split("\n")[0],
    },
    null,
    2,
  ),
);

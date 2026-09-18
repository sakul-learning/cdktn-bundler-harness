// Child: eager OUTPUT build, never staged, then hang (no signal handlers).
const fs = require("fs");
const path = require("path");
const lib = require("/data/repos/hermes-pr-reviewer/worktrees/cdk-terrain/open-constructs__cdk-terrain/pr-442/packages/cdktn/lib/index.js");
const { AssetHashType, AssetPackaging, AssetStaging, TerraformStack, Testing } = lib;

const srcDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "sigcheck-src-"));
fs.writeFileSync(path.join(srcDir, "a.txt"), "content");

let scratch;
new AssetStaging(new TerraformStack(Testing.app({}), "s"), "eager", {
  sourcePath: srcDir,
  packaging: AssetPackaging.DIRECTORY,
  assetHashType: AssetHashType.OUTPUT,
  bundler: {
    bundle: (o) => {
      scratch = o.outputDir;
      // ~8 MB of "bundler output"
      fs.writeFileSync(path.join(o.outputDir, "node_modules.bin"), Buffer.alloc(8 * 1024 * 1024, 1));
      return o.outputDir;
    },
  },
});

fs.writeFileSync(process.env.MARKER, scratch);

if (process.argv[2] === "hang") {
  setInterval(() => {}, 1000); // stay alive until signalled
}

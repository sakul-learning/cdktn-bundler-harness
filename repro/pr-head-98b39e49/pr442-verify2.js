// Verify the eager-build failure path leaks scratch (PR #442, OUTPUT + bundler).
const fs = require("fs");
const os = require("os");
const path = require("path");

const lib = require(path.join(
  __dirname,
  "..",
  "repos",
  "hermes-pr-reviewer",
  "worktrees",
  "cdk-terrain",
  "open-constructs__cdk-terrain",
  "pr-442",
  "packages",
  "cdktn",
  "lib",
  "index.js",
));

const { AssetHashType, AssetPackaging, AssetStaging, TerraformStack, Testing } = lib;

const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), "pr442-src-"));
fs.writeFileSync(path.join(srcDir, "a.txt"), "content");
const stack = () => new TerraformStack(Testing.app({}), "stack");

// A bundler that fails: hashOutput() has no try/finally around bundle().
let observed;
let outcome;
try {
  new AssetStaging(stack(), "boom", {
    sourcePath: srcDir,
    packaging: AssetPackaging.DIRECTORY,
    assetHashType: AssetHashType.OUTPUT,
    bundler: {
      bundle: (opts) => {
        observed = opts.outputDir;
        fs.writeFileSync(path.join(opts.outputDir, "partial.bin"), "x".repeat(4096));
        throw new Error("build failed after writing output");
      },
    },
  });
  outcome = "constructor did not throw";
} catch (err) {
  outcome = `constructor threw: ${String(err.message).split("\n")[0]}`;
}

const leaked = observed ? fs.existsSync(observed) : undefined;
fs.rmSync(srcDir, { recursive: true, force: true });
if (observed) fs.rmSync(observed, { recursive: true, force: true });

console.log(JSON.stringify({ outcome, scratch: observed, leakedAfterFailure: leaked }, null, 2));

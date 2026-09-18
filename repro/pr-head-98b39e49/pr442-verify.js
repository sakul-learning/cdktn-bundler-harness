// Reviewer verification for PR #442 (open-constructs/cdk-terrain)
// Run from the PR worktree; uses the compiled package (packages/cdktn/lib).
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

const {
  AssetHashType,
  AssetPackaging,
  AssetStaging,
  TerraformStack,
  Testing,
} = lib;

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const srcDir = tmp("pr442-src-");
fs.writeFileSync(path.join(srcDir, "a.txt"), "content");

const stack = () => new TerraformStack(Testing.app({}), "stack");

// ---------------------------------------------------------------- check 1
// A tar/tar.gz-style custom packaging: single-file output that PRESERVES
// directory entries. Per the PR the rejection predicate is
//   !producesDirectory && !omitsDirectoryEntries
// so this should be rejected even though it handles a directory source.
const tarLike = {
  extension: ".tar.gz",
  producesDirectory: false,
  omitsDirectoryEntries: false,
  pack: (options) => {
    // Stand-in for `tar czf`: reads the directory source, writes one file.
    fs.writeFileSync(options.target, fs.readdirSync(options.source).join(","));
  },
};

let check1;
try {
  new AssetStaging(stack(), "tar-archive", {
    sourcePath: srcDir,
    packaging: tarLike,
    bundler: { bundle: (opts) => opts.outputDir },
  });
  check1 = "ACCEPTED (predicate does not reject tar-style packaging)";
} catch (err) {
  check1 = `REJECTED -> ${String(err.message).split("\n")[0]}`;
}

// ---------------------------------------------------------------- check 2
// OUTPUT hashing + bundler, never staged (e.g. stack not synthesized).
let observedScratch;
new AssetStaging(stack(), "never-staged", {
  sourcePath: srcDir,
  packaging: AssetPackaging.DIRECTORY,
  assetHashType: AssetHashType.OUTPUT,
  bundler: {
    bundle: (opts) => {
      observedScratch = opts.outputDir;
      fs.writeFileSync(path.join(opts.outputDir, "node_modules.js"), "x".repeat(1024));
      return opts.outputDir;
    },
  },
});
const check2 = observedScratch
  ? `scratch still on disk: ${fs.existsSync(observedScratch)} (${observedScratch})`
  : "bundler never ran";

// ---------------------------------------------------------------- check 3
// Same asset, stage() called twice: does the second call rebuild?
let builds = 0;
const staging = new AssetStaging(stack(), "twice", {
  sourcePath: srcDir,
  packaging: AssetPackaging.DIRECTORY,
  assetHashType: AssetHashType.OUTPUT,
  bundler: {
    bundle: (opts) => {
      builds++;
      fs.writeFileSync(path.join(opts.outputDir, "built.txt"), `build-${builds}`);
      return opts.outputDir;
    },
  },
});
const target1 = tmp("pr442-out1-");
const target2 = tmp("pr442-out2-");
staging.stage(target1);
staging.stage(target2);
const bytes1 = fs.readFileSync(path.join(target1, "built.txt"), "utf8");
const bytes2 = fs.readFileSync(path.join(target2, "built.txt"), "utf8");
const check3 = `builds=${builds}, first=${bytes1}, second=${bytes2}, assetHash=${staging.assetHash}`;

fs.rmSync(srcDir, { recursive: true, force: true });
if (observedScratch) fs.rmSync(observedScratch, { recursive: true, force: true });
fs.rmSync(target1, { recursive: true, force: true });
fs.rmSync(target2, { recursive: true, force: true });

console.log(JSON.stringify({ check1, check2, check3 }, null, 2));

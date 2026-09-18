// PR #442 @ c7dcf5c27 — re-verify open items at this head.
const fs = require("fs");
const os = require("os");
const path = require("path");

const lib = require("/data/repos/hermes-pr-reviewer/worktrees/cdk-terrain/open-constructs__cdk-terrain/pr-442/packages/cdktn/lib/index.js");
const { AssetHashType, AssetPackaging, AssetStaging, TerraformStack, Testing } = lib;

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const srcDir = tmp("pr442c-src-");
fs.writeFileSync(path.join(srcDir, "a.txt"), "content");
const stack = () => new TerraformStack(Testing.app({}), "stack");

const out = {};

// (1) two stage() calls on one OUTPUT-hashed bundled asset
let builds = 0;
const staging = new AssetStaging(stack(), "twice", {
  sourcePath: srcDir,
  packaging: AssetPackaging.DIRECTORY,
  assetHashType: AssetHashType.OUTPUT,
  bundler: {
    bundle: (o) => {
      builds++;
      fs.writeFileSync(path.join(o.outputDir, "built.txt"), `build-${builds}`);
      return o.outputDir;
    },
  },
});
const t1 = tmp("pr442c-t1-");
const t2 = tmp("pr442c-t2-");
staging.stage(t1);
staging.stage(t2);
out.twiceStage = {
  builds,
  first: fs.readFileSync(path.join(t1, "built.txt"), "utf8"),
  second: fs.readFileSync(path.join(t2, "built.txt"), "utf8"),
  assetHash: staging.assetHash,
};

// (2) relative source reaching the bundler
const relStaging = new AssetStaging(stack(), "rel", {
  sourcePath: path.relative(process.cwd(), srcDir),
  packaging: AssetPackaging.DIRECTORY,
  bundler: {
    bundle: (o) => {
      out.bundlerSawSource = o.source;
      out.bundlerSawAbsolute = path.isAbsolute(o.source);
      return o.outputDir;
    },
  },
});
const t3 = tmp("pr442c-t3-");
relStaging.stage(t3);

// (3) eager constructor failure: does the scratch survive inside the process?
let failedScratch;
try {
  new AssetStaging(stack(), "boom", {
    sourcePath: srcDir,
    packaging: AssetPackaging.DIRECTORY,
    assetHashType: AssetHashType.OUTPUT,
    bundler: {
      bundle: (o) => {
        failedScratch = o.outputDir;
        fs.writeFileSync(path.join(o.outputDir, "partial.bin"), "x".repeat(2048));
        throw new Error("build failed");
      },
    },
  });
} catch {
  /* expected */
}
out.eagerFailure = {
  scratch: failedScratch,
  onDiskAfterThrow: failedScratch ? fs.existsSync(failedScratch) : null,
};

// cleanup
for (const d of [srcDir, t1, t2, t3, failedScratch]) {
  if (d) fs.rmSync(d, { recursive: true, force: true });
}

console.log(JSON.stringify(out, null, 2));

// Status probe: does `exclude` actually filter what the bundler reads?
// Claim under test (docs in asset-staging.ts): "exclude filters the source a
// bundler reads, not the artifact it produces."
const fs = require("fs");
const os = require("os");
const path = require("path");
const lib = require("/data/repos/hermes-pr-reviewer/worktrees/cdk-terrain/open-constructs__cdk-terrain/pr-442/packages/cdktn/lib/index.js");
const { AssetHashType, AssetPackaging, AssetStaging, TerraformStack, Testing } = lib;

const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), "excl-src-"));
fs.writeFileSync(path.join(srcDir, "keep.txt"), "keep");
fs.writeFileSync(path.join(srcDir, "skip.txt"), "version-1");

const seen = [];
const makeStaging = (id) =>
  new AssetStaging(new TerraformStack(Testing.app({}), "s"), id, {
    sourcePath: srcDir,
    exclude: ["skip.txt"],
    packaging: AssetPackaging.DIRECTORY,
    assetHashType: AssetHashType.SOURCE,
    bundler: {
      bundle: (o) => {
        // What the bundler can actually read from the given source:
        seen.push({
          source: o.source,
          readable: fs.readdirSync(o.source).sort(),
          excludedStillReadable: fs.existsSync(path.join(o.source, "skip.txt")),
        });
        // Stand-in build that copies whatever it can see.
        fs.cpSync(o.source, o.outputDir, { recursive: true });
        return o.outputDir;
      },
    },
  });

const first = makeStaging("first");
const target = fs.mkdtempSync(path.join(os.tmpdir(), "excl-out-"));
first.stage(target);

// Now change only the excluded file and compare identity + payload.
fs.writeFileSync(path.join(srcDir, "skip.txt"), "version-2");
const second = makeStaging("second");
const target2 = fs.mkdtempSync(path.join(os.tmpdir(), "excl-out2-"));
second.stage(target2);

console.log(
  JSON.stringify(
    {
      bundlerSawSource: seen[0].source,
      bundlerReadableFiles: seen[0].readable,
      bundlerCouldReadExcludedFile: seen[0].excludedStillReadable,
      stagedTargetFiles: fs.readdirSync(target).sort(),
      excludedFileShippedInArtifact: fs.existsSync(path.join(target, "skip.txt")),
      assetHashBefore: first.assetHash,
      assetHashAfterExcludedChange: second.assetHash,
      hashUnchangedDespiteExcludedChange: first.assetHash === second.assetHash,
      artifactContentChanged: fs.readFileSync(path.join(target, "skip.txt"), "utf8"),
      artifactContentAfter: fs.readFileSync(path.join(target2, "skip.txt"), "utf8"),
    },
    null,
    2,
  ),
);
for (const d of [srcDir, target, target2]) fs.rmSync(d, { recursive: true, force: true });

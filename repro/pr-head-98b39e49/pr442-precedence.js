// Corroborate the error-precedence change introduced by 98b39e49.
const fs = require("fs");
const os = require("os");
const path = require("path");
const lib = require("/data/repos/hermes-pr-reviewer/worktrees/cdk-terrain/open-constructs__cdk-terrain/pr-442/packages/cdktn/lib/index.js");
const { AssetPackaging, AssetStaging, TerraformAsset, TerraformStack, Testing } = lib;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prec-"));
const file = path.join(dir, "a.txt");
fs.writeFileSync(file, "x");
const stack = () => new TerraformStack(Testing.app({}), "s");

const attempt = (label, fn) => {
  try {
    fn();
    console.log(`${label}: NO THROW`);
  } catch (e) {
    console.log(`${label}: ${String(e.message).split("\n")[0]}`);
  }
};

// out-of-range enum + file source
attempt("type=99 + file source   ", () =>
  new TerraformAsset(stack(), "asset", { path: file, type: 99 }),
);
// out-of-range enum + directory source
attempt("type=99 + dir source    ", () =>
  new TerraformAsset(stack(), "asset", { path: dir, type: 99 }),
);
// FILE type + directory source
attempt("type=FILE + dir source  ", () =>
  new TerraformAsset(stack(), "asset", { path: dir, type: lib.AssetType.FILE }),
);
// custom packaging that cannot take a directory, via the public AssetStaging ctor
attempt("AssetStaging custom pkg ", () =>
  new AssetStaging(stack(), "plain", {
    sourcePath: dir,
    packaging: {
      extension: ".tar",
      producesDirectory: false,
      acceptsDirectorySource: false,
      omitsDirectoryEntries: false,
      pack: () => {},
    },
    bundler: { bundle: (o) => o.outputDir },
  }),
);
// no bundler, custom packaging that cannot take a directory source
attempt("AssetStaging no bundler ", () =>
  new AssetStaging(stack(), "plain2", {
    sourcePath: dir,
    packaging: {
      extension: ".tar",
      producesDirectory: false,
      acceptsDirectorySource: false,
      omitsDirectoryEntries: false,
      pack: () => {},
    },
  }),
);
fs.rmSync(dir, { recursive: true, force: true });

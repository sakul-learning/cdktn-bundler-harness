// Child used by scripts/lifecycle-probe.cjs: builds an OUTPUT-hashed asset with a
// bundler that writes several megabytes, never stages it, then either exits
// (mode=exit) or hangs so the parent can deliver a signal (mode=hang).
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const lib = process.env.CDKTN_PR_LIB;
if (!lib) throw new Error("CDKTN_PR_LIB must be set");
const { App, AssetHashType, AssetPackaging, AssetStaging, TerraformStack } = require(lib);

const mode = process.argv[2] ?? "exit";
const marker = process.env.MARKER;
const megabytes = Number(process.env.MEGABYTES ?? "2");

const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), "child-src-"));
fs.writeFileSync(path.join(srcDir, "index.ts"), "export const handler = 1;\n");
const app = new App({ outdir: fs.mkdtempSync(path.join(os.tmpdir(), "child-out-")) });
const stack = new TerraformStack(app, "child");

let scratch;
new AssetStaging(stack, "asset", {
  sourcePath: srcDir,
  packaging: AssetPackaging.DIRECTORY,
  assetHashType: AssetHashType.OUTPUT,
  bundler: {
    bundlerKey: "harness:lifecycle-child",
    bundle: (options) => {
      scratch = options.outputDir;
      const blob = Buffer.alloc(1 << 20, 0x62);
      for (let index = 0; index < megabytes; index += 1) {
        fs.writeFileSync(path.join(options.outputDir, `blob-${index}.bin`), blob);
      }
      return options.outputDir;
    },
  },
});

fs.writeFileSync(marker, `${scratch}\n`);

if (mode === "hang") {
  setInterval(() => {}, 1000);
}

// Ported from open-constructs/cdk-terrain PR #402
// (vendor/rolldown/packages/@cdktn/bundler-nodejs/runner.mjs) with two changes:
//   * `mode: "dir"` writes the Rolldown output straight into the caller's
//     output directory, which is what `IAssetBundler.bundle()` must return.
//   * `mode: "zip"` keeps upstream's deterministic ZIP behaviour, writing
//     `archive.zip` inside the output directory, so the harness can measure how
//     a zip-producing bundler fits a directory-returning interface.
// Everything else (facade plugin, handler export, externals-as-regex,
// UNRESOLVED_IMPORT as a hard error, sorted ZIP entries, fixed mtime) is
// upstream's.
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import * as path from "node:path";
import { rolldown } from "rolldown";
import { zipSync } from "fflate";

try {
  const request = JSON.parse(readFileSync(0, "utf8"));
  const format = request.format ?? "esm";
  const extension = format === "esm" ? "mjs" : "cjs";
  const mode = request.mode ?? "dir";
  const facade = "\0cdktn-nodejs-entry";
  const external = request.externalModules ?? [];

  const bundle = await rolldown({
    cwd: request.projectRoot,
    input: facade,
    platform: "node",
    preserveEntrySignatures: "strict",
    external: external.map((name) => {
      const wildcard = name.endsWith("/*");
      const prefix = (wildcard ? name.slice(0, -1) : name).replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
      );
      return new RegExp(`^${prefix}${wildcard ? "" : "(?:/|$)"}`);
    }),
    transform: {
      target: request.target,
      define: request.define,
    },
    plugins: [
      {
        name: "cdktn-nodejs-entry",
        resolveId: {
          filter: { id: /^(?:\0cdktn-nodejs-entry|cdktn:user-entry)$/ },
          handler: (id) => (id === facade ? facade : request.entry),
        },
        load: {
          filter: { id: /^\0cdktn-nodejs-entry$/ },
          handler: () =>
            `export { ${request.handler} } from "cdktn:user-entry";`,
        },
      },
    ],
    onwarn(warning, warn) {
      if (warning.code === "UNRESOLVED_IMPORT") throw new Error(warning.message);
      warn(warning);
    },
  });

  const outputOptions = {
    format,
    entryFileNames: `index.${extension}`,
    chunkFileNames: `chunks/[name]-[hash].${extension}`,
    assetFileNames: "assets/[name]-[hash][extname]",
    minify: request.minify ?? true,
    sourcemap: request.sourceMap ?? false,
    sourcemapPathTransform: (source) => source.split(path.sep).join("/"),
  };

  try {
    if (mode === "zip") {
      const { output } = await bundle.generate(outputOptions);
      const files = new Map();
      for (const file of output) {
        files[path.posix.normalize(file.fileName)] =
          file.type === "chunk" ? file.code : file.source;
      }
      const zipped = Object.create(null);
      for (const name of [...Object.keys(files)].sort()) {
        zipped[name] = [
          Buffer.from(files[name]),
          { os: 3, attrs: (0o100644 << 16) >>> 0 },
        ];
      }
      writeFileSync(
        path.join(request.outputDir, "archive.zip"),
        zipSync(zipped, { level: 9, mtime: new Date(1980, 0, 1, 0, 0, 0) }),
      );
    } else {
      mkdirSync(request.outputDir, { recursive: true });
      await bundle.write({ ...outputOptions, dir: request.outputDir });
    }
  } finally {
    await bundle.close();
  }
} catch (error) {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
}

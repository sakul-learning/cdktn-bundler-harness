# Vendored source: PR open-constructs/cdk-terrain#402 — native `NodejsFunction` with Rolldown bundling

## 0. Provenance

| Item | Value |
| --- | --- |
| PR | https://github.com/open-constructs/cdk-terrain/pull/402 |
| Title | ``feat(lib): add native `NodejsFunction` with Rolldown bundling`` |
| State | OPEN, `isDraft: false` |
| Base | `main` |
| Head branch | `feat/native-nodejs-function` |
| Head repo owner | `garysassano` (fork: `garysassano/cdk-terrain`) |
| Head commit SHA | `127bc9f12f5a466ea15acdb95e10d008846127e7` |
| Diff size | 26 files, +2672 / -86 |
| Design issue | https://github.com/open-constructs/cdk-terrain/issues/401 (open) |
| Fetch method | `gh api repos/garysassano/cdk-terrain/contents/<path>?ref=feat/native-nodejs-function -H 'Accept: application/vnd.github.raw'` for the eight `packages/@cdktn/bundler-nodejs` files, and `curl https://raw.githubusercontent.com/garysassano/cdk-terrain/feat/native-nodejs-function/<path>` for the rest (the `gh` path failed for a later batch because of a `mise` config-trust error in the working directory; raw.githubusercontent.com was used instead — same bytes, same ref). |

Files under this directory were written verbatim (raw content, paths preserved relative to the
repo root).

Support files that are **not** in the PR diff, fetched for the wiring analysis in §3/§4:
`packages/cdktn/src/terraform-asset.ts` and `packages/cdktn/src/index.ts` were taken from the PR
**head ref** (they exist there, but differ from `main` — the branch is behind `main`:
head `terraform-asset.ts` is SHA-256 `d21ea7bf…`, `main` is `2f631b17…`; head `src/index.ts` is
`029479a1…`, `main` is `3f69e5a9…`). `packages/cdktn/src/assets.ts` and
`packages/cdktn/src/asset-hash.ts` do **not** exist at the head ref at all (raw fetch returned
HTTP 404 for both), so they were taken from `main`; `assets.ts` on `main` does **not** yet contain
`IAssetBundler` (see §4).

Full manifest with SHA-256 of every vendored file (see §8 for the manifest block).

Files that PR #402 touches, all vendored:
- `README.md` (modified — not vendored, 2 added lines quoted in §7)
- `knip.jsonc` (modified — vendored)
- `pnpm-lock.yaml` (modified — not vendored, only the relevant resolved versions quoted in §6)
- `tools/pack-node-package.mjs` (added — vendored)
- `packages/@cdktn/bundler-nodejs/**` (new)
- `packages/@cdktn/aws-lambda-nodejs/**` (new)
- `examples/typescript/aws-nodejs-function/**` (new)

---

## 1. Public API of `@cdktn/bundler-nodejs`

`packages/@cdktn/bundler-nodejs/src/index.ts` is the package entry (`main: build/index.js`,
`types: build/index.d.ts`). It declares no barrel/`index` re-export file — everything below is
exported directly from that one module. The package has no other `.ts` source files.

Exported symbols (complete list, from `packages/@cdktn/bundler-nodejs/src/index.ts`):

| Export | Kind | Notes |
| --- | --- | --- |
| `NodejsRolldownOptions` | type | Rolldown's built-in options, JSON-data-only, minus construct-managed keys |
| `CopyFile` | interface | `{ from: string; to: string }` |
| `NodejsBundlingOptions` | interface | the "bundling" options bag |
| `NodejsBundleProps` | interface | inputs for a standalone bundle |
| `NodejsBundle` | interface | deterministic bundle result (incl. `archive`) |
| `NodejsBundler` | class | constructor-less; single method `bundle(props)` |
| `NodejsAssetProps` | interface | props of the `TerraformAsset` adapter |
| `NodejsAsset` | class | `extends TerraformAsset` |

### 1.1 `NodejsBundler` / `NodejsBundleProps` / `NodejsBundle` — verbatim

```ts
/** Inputs for one provider-independent Node.js bundle operation. */
export interface NodejsBundleProps {
  /** TypeScript or JavaScript entry file, relative to projectRoot. */
  readonly entry: string;
  /** Export to expose from the bundle. @default "handler" */
  readonly handler?: string;
  /** Root for entry, configuration and copied-file paths. */
  readonly projectRoot: string;
  /** Node.js syntax target. @default "node24" */
  readonly target?: string;
  readonly bundling?: NodejsBundlingOptions;
}

/** The deterministic output of a Node.js bundle operation. */
export interface NodejsBundle {
  /** Complete deployment ZIP. */
  readonly archive: Uint8Array;
  /** Lambda-compatible module and export, for example "index.handler". */
  readonly handler: string;
  /** Hexadecimal SHA-256 of the exact ZIP bytes. */
  readonly assetHash: string;
  /** Base64 SHA-256 of the exact ZIP bytes. */
  readonly sourceCodeHash: string;
  /** Size of the complete ZIP in bytes. */
  readonly compressedSize: number;
  /** Total size of all ZIP entries in bytes. */
  readonly uncompressedSize: number;
}

/** Builds deterministic Node.js ZIPs without a construct or staging lifecycle. */
export class NodejsBundler {
  public bundle(props: NodejsBundleProps): NodejsBundle {
```

Note: `NodejsBundler` is **synchronous** (the async Rolldown work happens in a child process —
see §2), takes `projectRoot` as a **required** prop, and returns a `Uint8Array` ZIP, not a path.

### 1.2 `NodejsBundlingOptions` (bundling options) — verbatim

```ts
/** An additional file or directory to include in the deployment ZIP. */
export interface CopyFile {
  readonly from: string;
  /** Path inside the ZIP. Use "." to copy a directory's contents to its root. */
  readonly to: string;
}

/** Optional controls over the native Rolldown build. */
export interface NodejsBundlingOptions {
  /** @default "esm" */
  readonly format?: "esm" | "cjs";
  /** @default true */
  readonly minify?: DataOptions<OutputOptions["minify"]>;
  /** Preserve function and class names when bundling and minifying. @default false */
  readonly keepNames?: boolean;
  /** Source maps: separate, inline, hidden, or disabled. @default true */
  readonly sourceMap?: OutputOptions["sourcemap"];
  /** Built-in file loaders, for example { ".sql": "text" }. */
  readonly moduleTypes?: InputOptions["moduleTypes"];
  /** Packages supplied by a Lambda layer or copyFiles, including their subpaths. */
  readonly externalModules?: string[];
  /** Compile-time substitutions. Values are JavaScript expressions. */
  readonly define?: Record<string, string>;
  /** A tsconfig path relative to projectRoot, or false to disable discovery. @default true */
  readonly tsconfig?: InputOptions["tsconfig"];
  /** JS/MJS/CJS module exporting Rolldown options, including plugins and output options. */
  readonly configFile?: string;
  /** Inline built-in resolution, transform, tree-shaking and output options. */
  readonly rolldownOptions?: NodejsRolldownOptions;
  readonly copyFiles?: CopyFile[];
}
```

Option name mapping (task asked specifically): the construct's own option names are
`format` (output format, `esm`|`cjs`), `minify` (default `true`), `sourceMap` (note the capital
`M`; default `true`), `externalModules` (the "external" list), `define`, `moduleTypes`,
`keepNames`, `tsconfig`, `configFile` (the plugin/config escape hatch), `rolldownOptions`
(inline Rolldown `input`/`output` options), `copyFiles`. The entry/handler/projectRoot/target
options live one level up on `NodejsBundleProps` (and on `NodejsAssetProps`/`NodejsFunctionProps`).
There is no option literally named `plugins`: plugins must go through `bundling.configFile`
(`rolldownOptions` deliberately omits `plugins`), see §1.5.

### 1.3 `NodejsRolldownOptions` — verbatim header (JSON-data constraint)

```ts
// Inline options cross a JSON boundary into the native bundler process. Config
// modules remain available for plugins, callbacks and regular expressions.
type DataOptions<T> = T extends (...args: any[]) => any
  ? never
  : T extends RegExp
    ? never
    : T extends object
      ? { [K in keyof T]: DataOptions<T[K]> }
      : T;

/** Rolldown's built-in options, excluding settings managed by the construct. */
export type NodejsRolldownOptions = DataOptions<
  Omit<
    InputOptions,
    | "input"
    | "cwd"
    | "platform"
    | "preserveEntrySignatures"
    | "external"
    | "moduleTypes"
    | "tsconfig"
    | "transform"
    | "plugins"
    | "watch"
    | "devtools"
    | "onwarn"
    | "onLog"
  > & {
    transform?: Omit<
      NonNullable<InputOptions["transform"]>,
      "target" | "define"
    >;
    output?: Omit<
      OutputOptions,
      | "dir"
      | "file"
      | "format"
      | "entryFileNames"
      | "chunkFileNames"
      | "assetFileNames"
      | "minify"
      | "sourcemap"
      | "sourcemapPathTransform"
      | "keepNames"
      | "plugins"
    >;
  }
>;
```

The `rolldown` types are imported type-only with an explicit resolution mode:

```ts
import type { InputOptions, OutputOptions } from "rolldown" with {
  "resolution-mode": "import",
};
```

### 1.4 `NodejsAssetProps` and `NodejsAsset` — verbatim

```ts
/** Source code to bundle into a deployable Node.js asset. */
export interface NodejsAssetProps {
  /** TypeScript or JavaScript entry file, relative to projectRoot. */
  readonly entry: string;
  /** Export to expose from the bundle. @default "handler" */
  readonly handler?: string;
  /** Root for relative paths. @default directory containing cdktf.json, or cwd */
  readonly projectRoot?: string;
  /** Node.js syntax target. @default "node24" */
  readonly target?: string;
  readonly bundling?: NodejsBundlingOptions;
}

/** A deterministic ZIP built by Rolldown and staged by TerraformAsset. */
export class NodejsAsset extends TerraformAsset {
  /** Lambda-compatible module and export, for example "index.handler". */
  public readonly handler: string;
  /** Base64 SHA-256 of the exact ZIP bytes, suitable for source_code_hash. */
  public readonly sourceCodeHash: string;
  /** Size of the complete ZIP in bytes. */
  public readonly compressedSize: number;
  /** Total size of all ZIP entries in bytes, including source maps and copied files. */
  public readonly uncompressedSize: number;
```

(`NodejsAsset`'s constructor body is quoted in §3.)

### 1.5 What is *not* exported / not found

- No `plugins` option on the public API: `NodejsRolldownOptions` omits `InputOptions["plugins"]`
  and `OutputOptions["plugins"]`. Plugins are only reachable via `bundling.configFile` (a module
  whose default export is one Rolldown options object) or via `customInput.plugins` merged in
  `runner.mjs`.
- No `exports` entry other than `"."`; no `bin`, no subpath exports.
- No `bundleToDirectory`, no path-returning API, no `IAssetBundler` implementation (see §4).
- No `NodejsFunction` in this package — that construct lives in `@cdktn/aws-lambda-nodejs` and
  re-exports these types (`export { NodejsAsset, NodejsAssetProps, NodejsBundlingOptions,
  NodejsRolldownOptions, CopyFile } from "@cdktn/bundler-nodejs";`).

---

## 2. Exactly how `bundle()` runs Rolldown

### 2.1 `spawnSync` invocation in `index.ts` (verbatim)

```ts
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "cdktn-nodejs-"));
    let archive: Buffer;
    try {
      const resultFile = path.join(scratch, "archive.zip");
      const result = spawnSync(
        process.execPath,
        [path.join(__dirname, "../runner.mjs")],
        {
          input: JSON.stringify({
            ...props.bundling,
            entry,
            handler,
            projectRoot,
            target: props.target ?? "node24",
            resultFile,
          }),
          encoding: "utf8",
          maxBuffer: 8 * 1024 * 1024,
          timeout: 120_000,
          windowsHide: true,
        },
      );
      if (result.error || result.status !== 0) {
        throw new Error(
          `Failed to bundle ${entry}:\n${result.error?.message ?? result.stderr ?? result.signal}`,
        );
      }
      if (result.stderr) process.stderr.write(result.stderr);
      archive = fs.readFileSync(resultFile);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
```

Key mechanics:
- The request crosses a **JSON-on-stdin** boundary: `spawnSync(process.execPath, [<pkg>/runner.mjs], { input: JSON.stringify(request) })`.
  Nothing is passed on argv or env.
- `runner.mjs` is resolved as `path.join(__dirname, "../runner.mjs")` — from `build/index.js`
  (`__dirname` = `<pkg>/build`) that is `<pkg>/runner.mjs`. The package publishes the file
  uncompiled: `"files": ["build", "runner.mjs"]`.
- Child stdout is unused; the artifact is handed back **through a file** at
  `os.tmpdir()/cdktn-nodejs-XXXXXX/archive.zip`, which the parent reads and then deletes the
  scratch dir in a `finally`.
- No shell, no Docker, no compiler install, no bundler on `PATH`; `process.execPath` (the host
  Node) runs the runner. `timeout: 120_000` (120 s), `maxBuffer: 8 MiB`, `windowsHide: true`.

Validation performed before spawning (verbatim):

```ts
    validateBuildInput(props, "options");
    const projectRoot = path.resolve(props.projectRoot);
    const entry = path.resolve(projectRoot, props.entry);
    const handler = props.handler ?? "handler";
    if (!fs.existsSync(entry)) {
      throw new Error(`Node.js entry must be an existing local file: ${entry}`);
    }
    if (!fs.statSync(entry).isFile()) {
      throw new Error(`Node.js entry is not a file: ${entry}`);
    }
    if (!/^[A-Za-z_$][\w$]*$/.test(handler)) {
      throw new Error(
        `Node.js handler must be an exported identifier, received ${JSON.stringify(handler)}`,
      );
    }
    if (props.target && !/^node\d+(\.\d+)*$/.test(props.target)) {
      throw new Error(`Invalid Node.js target: ${props.target}`);
    }
```

`validateBuildInput` (quoted in full in §1 of the source file, lines 257–293) walks the options
object and rejects anything that is not plain JSON data — functions, `RegExp`, class instances,
circular references, non-finite numbers — with the message
`Node.js build option <path> must be JSON data. Put plugins, callbacks and regular expressions in bundling.configFile.`

### 2.2 `rolldown(...)` in `runner.mjs` (verbatim)

Runner header + request parse + config-file merge:

```js
// Copyright (c) OpenConstructs
// SPDX-License-Identifier: MPL-2.0
// An async native bundler behind CDKTN's synchronous construct API. No shell,
// global bundler, compiler installation, Docker, or execution of handler code.
import { readFileSync, writeFileSync, readdirSync, lstatSync } from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { rolldown } from "rolldown";
import { zipSync } from "fflate";

try {
  const request = JSON.parse(readFileSync(0, "utf8"));
  const format = request.format ?? "esm";
  const extension = format === "esm" ? "mjs" : "cjs";
  let custom = {};
  if (request.configFile) {
    custom = (
      await import(
        pathToFileURL(path.resolve(request.projectRoot, request.configFile))
          .href
      )
    ).default;
    if (!custom || typeof custom !== "object" || Array.isArray(custom)) {
      throw new Error(
        "The bundling config must default-export one Rolldown options object.",
      );
    }
  }
  const { output: customOutput, ...customInput } = custom;
  if (Array.isArray(customOutput))
    throw new Error("The bundling config must have one output options object.");
  const { output: inlineOutput, ...inlineInput } =
    request.rolldownOptions ?? {};
  const tsconfig = request.tsconfig ?? customInput.tsconfig;
  const facade = "\0cdktn-nodejs-entry";
  const external = request.externalModules ?? [];
```

The `rolldown(...)` call itself:

```js
  const bundle = await rolldown({
    ...customInput,
    ...inlineInput,
    cwd: request.projectRoot,
    input: facade,
    platform: "node",
    preserveEntrySignatures: "strict",
    tsconfig:
      typeof tsconfig === "string"
        ? path.resolve(request.projectRoot, tsconfig)
        : tsconfig,
    // Let the native resolver match package names and subpaths without calling
    // JavaScript for every import. Escape package names as literal strings.
    external: external.map((name) => {
      const wildcard = name.endsWith("/*");
      const prefix = (wildcard ? name.slice(0, -1) : name).replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
      );
      return new RegExp(`^${prefix}${wildcard ? "" : "(?:/|$)"}`);
    }),
    moduleTypes: { ...customInput.moduleTypes, ...request.moduleTypes },
    transform: {
      ...customInput.transform,
      ...inlineInput.transform,
      target: request.target,
      define: { ...customInput.transform?.define, ...request.define },
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
      ...(customInput.plugins ?? []),
    ],
    onwarn(warning, warn) {
      // A misspelled dependency must not silently become a broken deployed import.
      if (warning.code === "UNRESOLVED_IMPORT")
        throw new Error(warning.message);
      if (customInput.onwarn) customInput.onwarn(warning, warn);
      else warn(warning);
    },
  });
```

### 2.3 Entry facade + handler resolution (exact mechanism)

1. `input` is **not** the user's entry file; it is the virtual module id `"\0cdktn-nodejs-entry"`
   (`const facade = "\0cdktn-nodejs-entry";`).
2. One inline Rolldown plugin named `cdktn-nodejs-entry`:
   - `resolveId` (filtered to `\0cdktn-nodejs-entry` or `cdktn:user-entry`) returns `facade` for
     the facade id and `request.entry` (the **absolute** entry path computed in `index.ts`) for
     `cdktn:user-entry`.
   - `load` (filtered to the facade id) synthesises the source text
     `` export { ${request.handler} } from "cdktn:user-entry"; `` — i.e. the emitted bundle's
     root module re-exports exactly the requested export name (default `handler`).
3. `preserveEntrySignatures: "strict"` keeps that named export intact; everything else imported by
   the entry is inlined (tests assert unused exports are tree-shaken, e.g. `REMOVE_UNUSED_EXPORT`
   is absent).
4. The result is therefore always a single entry module exporting `handler` (or the custom name),
   which is why the produced archive's handler is `index.<ext>` (see `bundle.handler` in §3).
   Handler *invocation* is never performed by the bundler — the runner explicitly notes
   "or execution of handler code".
5. User plugins from `configFile` (`customInput.plugins`) are appended **after** the facade
   plugin, so they win where they overlap.

### 2.4 `bundle.generate(...)` + ZIP in `runner.mjs` (verbatim)

```js
  let output;
  try {
    ({ output } = await bundle.generate({
      ...customOutput,
      ...inlineOutput,
      dir: request.projectRoot,
      file: undefined,
      format,
      entryFileNames: `index.${extension}`,
      chunkFileNames: `chunks/[name]-[hash].${extension}`,
      assetFileNames: "assets/[name]-[hash][extname]",
      minify: request.minify ?? customOutput?.minify ?? true,
      keepNames: request.keepNames ?? customOutput?.keepNames,
      sourcemap: request.sourceMap ?? customOutput?.sourcemap ?? true,
      sourcemapPathTransform: (source) => source.split(path.sep).join("/"),
      polyfillRequire:
        inlineOutput?.polyfillRequire ?? customOutput?.polyfillRequire ?? true,
    }));
  } finally {
    await bundle.close();
  }
```

`bundle.generate` (in-memory) is used, **not** `bundle.write`, so nothing is written to
`dir`; `dir` is set to `request.projectRoot` and `file: undefined` is set explicitly, while the
emitted `output` array is consumed in-process. Collected outputs are then validated and assembled
into an in-memory map:

```js
  const files = new Map();
  function add(name, data) {
    const normalized = path.posix.normalize(name);
    if (
      name.includes("\\") ||
      name.includes(":") ||
      normalized === "." ||
      normalized.startsWith("/") ||
      normalized === ".." ||
      normalized.startsWith("../")
    ) {
      throw new Error(`ZIP destination must stay inside the archive: ${name}`);
    }
    if (files.has(normalized))
      throw new Error(`Duplicate ZIP destination: ${normalized}`);
    files.set(normalized, typeof data === "string" ? Buffer.from(data) : data);
  }
  for (const file of output)
    add(file.fileName, file.type === "chunk" ? file.code : file.source);
  function copy(source, destination) {
    const stat = lstatSync(source);
    if (stat.isSymbolicLink())
      throw new Error(
        `copyFiles does not follow symlinks: ${source}. Copy a prepared dependency directory instead.`,
      );
    if (stat.isDirectory()) {
      for (const name of readdirSync(source).sort())
        copy(path.join(source, name), path.posix.join(destination, name));
    } else if (stat.isFile()) add(destination, readFileSync(source));
    else
      throw new Error(
        `copyFiles requires regular files or directories: ${source}`,
      );
  }
  for (const file of request.copyFiles ?? [])
    copy(path.resolve(request.projectRoot, file.from), file.to);

  const zipped = Object.create(null);
  for (const name of [...files.keys()].sort()) {
    zipped[name] = [files.get(name), { os: 3, attrs: (0o100644 << 16) >>> 0 }];
  }
  // A fixed local date produces the same DOS timestamp in every timezone.
  writeFileSync(
    request.resultFile,
    zipSync(zipped, { level: 9, mtime: new Date(1980, 0, 1, 0, 0, 0) }),
  );
} catch (error) {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
}
```

Determinism controls: ZIP entries sorted by name; every entry forced to mode `0100644` with
`os: 3` (unix); deflate `level: 9`; fixed `mtime` `new Date(1980, 0, 1, 0, 0, 0)` (ZIP epoch) so
the DOS timestamp is timezone-independent; `sourcemapPathTransform` normalises map `sources` to
POSIX separators; paths are validated to stay inside the archive and duplicates are rejected.
Errors are printed to stderr and the process exits non-zero, which `index.ts` turns into a
`spawnSync` failure.

### 2.5 Native binding

`runner.mjs` imports the JS API `import { rolldown } from "rolldown";`. `rolldown` is a direct
dependency of the package at **`1.2.7`** (§6); it loads the platform-specific native Rust binding
from optional dependencies (`@rolldown/binding-<platform>`), so no Rust toolchain is required.
The package README states: "This package uses Rolldown's platform-specific native Rust bindings
distributed through npm; it requires no Rust compiler or global bundler installation. Keep
optional npm dependencies enabled so the correct binding is installed for the synthesis host."

---

## 3. How the produced artifact is hashed and fed into `TerraformAsset`

### 3.1 Hashing (verbatim, end of `NodejsBundler.bundle`)

```ts
    let uncompressedSize = 0;
    unzipSync(archive, {
      filter: (file) => {
        uncompressedSize += file.originalSize;
        return false;
      },
    });
    const digest = createHash("sha256").update(archive).digest();
    return {
      archive,
      handler: `index.${handler}`,
      assetHash: digest.toString("hex"),
      sourceCodeHash: digest.toString("base64"),
      compressedSize: archive.byteLength,
      uncompressedSize,
    };
```

- `assetHash` = hex SHA-256 of the **exact ZIP bytes** (`fflate`'s `unzipSync` with a
  `filter` that always returns `false` is used purely to sum `originalSize` for
  `uncompressedSize`; nothing is written to disk).
- `sourceCodeHash` = base64 SHA-256 of the **same ZIP bytes** — the value AWS Lambda wants for
  `source_code_hash`.
- `handler` = `"index." + <export name>`, matching `entryFileNames: index.mjs|index.cjs`.
- `compressedSize` = ZIP byte length.
- Test assertions confirming this contract (`test/asset.test.ts`):
  `expect(bundle.assetHash).toBe(createHash("sha256").update(bundle.archive).digest("hex"));`
  `expect(bundle.sourceCodeHash).toBe(createHash("sha256").update(bundle.archive).digest("base64"));`
  `expect(asset.sourceCodeHash).toBe(createHash("sha256").update(zip).digest("base64"));`
  `expect(asset.assetHash).toBe(createHash("sha256").update(zip).digest("hex"));`

Hashing is therefore over the **built output**, not over the source tree. No `bundlerKey`-style
build identity is threaded into core's `hashPath`.

### 3.2 `NodejsAsset extends TerraformAsset` — where the archive is written (verbatim)

```ts
  constructor(scope: Construct, id: string, props: NodejsAssetProps) {
    const projectRoot = resolveProjectRoot(scope, props.projectRoot);
    validateBuildInput(props, "options", new Set(), (value) =>
      Token.isUnresolved(value),
    );
    const bundle = new NodejsBundler().bundle({
      entry: props.entry,
      handler: props.handler,
      projectRoot,
      target: props.target,
      bundling: props.bundling,
    });
    // Keep immutable source artifacts within the app output, so repeated synths
    // can use TerraformAsset's normal staging without leaked temporary trees.
    const sourcePath = path.resolve(
      App.of(scope).outdir,
      ".nodejs-assets",
      bundle.assetHash,
      "archive.zip",
    );
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, bundle.archive);
    super(scope, id, {
      path: sourcePath,
      type: AssetType.FILE,
      assetHash: bundle.assetHash,
    });
    this.handler = bundle.handler;
    this.sourceCodeHash = bundle.sourceCodeHash;
    this.compressedSize = bundle.compressedSize;
    this.uncompressedSize = bundle.uncompressedSize;
  }
```

So:
- The bundle is built **eagerly in the constructor** (construct-time, not synth-time).
- The ZIP is materialised at
  `<App outdir>/.nodejs-assets/<hex assetHash>/archive.zip` (e.g.
  `cdktf.out/.nodejs-assets/<sha256-of-zip>/archive.zip`), content-addressed by the bundle hash so
  repeat synths reuse the same path.
- `TerraformAsset` is then constructed with an **absolute** `path`, `type: AssetType.FILE` and an
  explicit `assetHash`, which short-circuits core's own hashing
  (`this.assetHash = config.assetHash || hashPath(...)` in `packages/cdktn/src/terraform-asset.ts`).
- Because `type` is `FILE`, `TerraformAsset.path` resolves to
  `assets/<stackLogicalId>/<assetHash>/archive.zip` (`fileName` = `path.basename(sourcePath)` =
  `archive.zip`), and `_onSynthesize` does `fs.copyFileSync(this.sourcePath, targetPath)` into
  `cdktf.out/stacks/<stack>/assets/<logicalId>/<hash>/archive.zip`.
- `scope.node.tryGetContext("cdktfJsonPath")`-based root discovery is reimplemented locally in
  `resolveProjectRoot` (verbatim):

```ts
function resolveProjectRoot(scope: Construct, explicit?: string): string {
  if (explicit) return path.resolve(explicit);
  const configPath = scope.node.tryGetContext("cdktfJsonPath");
  if (configPath) return path.dirname(path.resolve(configPath));
  let directory = process.cwd();
  while (true) {
    if (fs.existsSync(path.join(directory, "cdktf.json"))) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) return process.cwd();
    directory = parent;
  }
}
```

---

## 4. Wiring to `TerraformAsset` today, and what would have to change for `IAssetBundler`

### 4.1 How it is wired today

```
NodejsFunction (packages/@cdktn/aws-lambda-nodejs/src/index.ts)
  └── this.code = new NodejsAsset(this, "Code", { entry, handler, projectRoot, bundling,
                                                 target: `node${runtimeMatch[1]}` })
        └── new NodejsBundler().bundle({...})            // eager, in the constructor
              └── spawnSync(process.execPath, [runner.mjs], { input: JSON.stringify(opts) })
                    └── rolldown({...}) → bundle.generate({...}) → zipSync(...) → archive.zip
        └── fs.writeFileSync(`<outdir>/.nodejs-assets/<hash>/archive.zip`, bundle.archive)
        └── super(scope, id, { path: sourcePath, type: AssetType.FILE, assetHash: bundle.assetHash })
              └── TerraformAsset._onSynthesize: copyFileSync → assets/<logicalId>/<hash>/archive.zip
```

The consuming construct then reads the adapter (`packages/@cdktn/aws-lambda-nodejs/src/index.ts`):

```ts
    this.filename = this.code.path;
    this.sourceCodeHash = this.code.sourceCodeHash;
    this.handler = this.code.handler;
```

plus size guards:

```ts
    const mebibyte = 1024 * 1024;
    if (this.code.uncompressedSize > 250 * mebibyte) { /* throw ... 250 MiB ... */ }
    if (this.code.compressedSize > 50 * mebibyte) { /* throw ... 50 MiB ... */ }
```

Evidence that PR #402 predates the bundler extension point: it uses only `TerraformAsset`,
`AssetType.FILE` and `assetHash` — the exact set issue #401 promised ("The prepared implementation
uses the existing `TerraformAsset` API and does not depend on these PRs being merged", referring
to #339/#371).

**`IAssetBundler`: not found in PR #402, and not found on `main`.** A repo-wide code search
(`search/code?q=IAssetBundler+org:open-constructs`) returns 0 results, and `main`'s
`packages/cdktn/src/assets.ts` (vendored here, SHA-256
`746f071deada259565bc2b175b5f998615da5aff594e57801ab36b97f8bea2e7`) contains only
`IAsset`, `AssetOptions`, `AssetHashType`, `IAssetPackaging`, `PackOptions`, `AssetPackaging`,
`StagedAsset`. The interface exists in the PR #442 build artifacts (`.nx/cache/*/packages/cdktn/.jsii`
inside `/data/repos/cdk-terrain`) and in the PR #442 worktree
`/data/repos/hermes-pr-reviewer/worktrees/cdk-terrain/open-constructs__cdk-terrain/pr-442/packages/cdktn/src/assets.ts`.
Its exact definition there (verbatim, lines 240–302) is:

```ts
export interface BundleOptions {
  /**
   * Absolute path to the asset's source file or directory. The bundler reads
   * from here and must not modify it.
   */
  readonly source: string;

  /**
   * A scratch directory the bundler may write into, owned and created by the
   * caller. The bundler produces its output here (or in a subdirectory) and
   * returns the directory that holds the finished artifact — see
   * {@link IAssetBundler.bundle}.
   */
  readonly outputDir: string;
}

export interface IAssetBundler {
  /**
   * A value identifying the build, folded into the asset hash.
   *
   * The source tree alone cannot see the build, so swapping a `node:18` base
   * image for `node:20` would otherwise leave identity unchanged. A value
   * capturing the build (e.g. `docker:<image>:<command>`) closes that gap.
   * Mirrors {@link IIgnoreStrategy.cacheKey}: omit it when the build cannot be
   * summarized as a string, and fall back to `extraHash`.
   *
   * @default - the build does not contribute to the hash
   */
  readonly bundlerKey?: string;

  /**
   * Produce the artifact and return the directory holding it.
   *
   * Implementations write into `options.outputDir` and return it or a
   * subdirectory, never writing back to `options.source`. The returned
   * directory is then packaged as an unbundled source directory would be.
   */
  bundle(options: BundleOptions): string;
}
```

And the packaging side that a directory-returning bundler must satisfy (same file, `main`'s
version of `IAssetPackaging`, vendored here):

```ts
export interface IAssetPackaging {
  /** Appended to the staged artifact name, e.g. ".zip", "", ".tar.bz2". */
  readonly extension: string;
  /** Whether the staged result is a directory rather than a single file. */
  readonly producesDirectory: boolean;
  /** ... */
  readonly omitsDirectoryEntries: boolean;
  pack(options: PackOptions): void;
}
```

with `AssetPackaging.ZIP` = `extension ".zip"`, `producesDirectory false`,
`omitsDirectoryEntries true`; and (only in the PR #442 variant)
`acceptsDirectorySource: boolean` — documented as "Bundler output is always a directory, so a
packaging that is `false` here cannot stage it."

### 4.2 What would have to change (concrete delta list)

| # | Today (PR #402) | Required for `IAssetBundler` |
| --- | --- | --- |
| 1 | `NodejsBundler.bundle(props: NodejsBundleProps): NodejsBundle` — custom signature, requires `projectRoot`/`entry`/`handler`/`target`, returns a `Uint8Array` ZIP **and** the hashes. | Implement `bundle(options: BundleOptions): string` with exactly `{ source, outputDir }`. There is **no place in `BundleOptions` for `entry`/`handler`/`projectRoot`/`target`/`bundling`**, so those must come from the implementing class's own constructor/props (e.g. `new RolldownBundler({ handler, target, bundling })` passed as the construct's `bundler` option), and `source` must be interpreted as the entry path (or a directory whose default entry is resolved). |
| 2 | Produces one `archive.zip` (`Uint8Array`) via `fflate.zipSync`, written to `<outdir>/.nodejs-assets/<hash>/archive.zip`. | Must write **loose files** (`index.mjs`/`index.cjs`, `index.mjs.map`, `chunks/**`, `assets/**`, copied files) into `options.outputDir` (or a subdirectory) and `return` that directory path. The `zipSync` block in `runner.mjs` (lines 147–155) plus the whole `files`/`add`/`copy` ZIP-assembly section would be replaced by direct `writeFileSync`/`mkdirSync` into the output dir; `copyFiles` would still be honoured, but copied into the directory instead of the archive. `runner.mjs` currently receives `resultFile`; it would instead receive `outputDir`. |
| 3 | `bundle.generate({ ... dir: request.projectRoot, file: undefined ... })` — in-memory; output collected from the returned `output` array. | Either keep `generate` and write the returned chunks/assets into `outputDir` yourself, or switch to `bundle.write({ dir: options.outputDir, ... })`. Filenames must stay `index.<ext>` for the handler to remain `index.<ext>`. |
| 4 | Hash is taken over the **built output**: `assetHash = sha256(zip).hex`, `sourceCodeHash = sha256(zip).base64`, computed inside `bundle()` and pushed into `TerraformAsset` via `config.assetHash` (bypassing `hashPath`). | Under `IAssetBundler` the hash comes from the **source** plus `bundlerKey` (core: "the hash is taken over the source rather than the built output", and "`bundlerKey` … folded into the asset hash"). So the bundler must expose a deterministic `bundlerKey` string capturing build identity (rolldown version, format, target, minify, sourceMap, externals, define, copyFiles…) or fall back to `extraHash`, and must **stop** computing/deciding the asset hash. The ZIP's SHA-256 (needed for Lambda `source_code_hash`) is then **not available at construct time** — it must be derived from the packaged artifact (post-`IAssetPackaging`), or the asset model must accept that `source_code_hash` is computed from the archive produced by `ZipPackaging` after packaging. Same for `compressedSize`/`uncompressedSize`, which today are only knowable because the ZIP is built eagerly. |
| 5 | Runs **eagerly in the `NodejsAsset` constructor**, once per synth, before staging. | `IAssetBundler.bundle` runs in the owning construct's **`onSynthesize`** hook, is "skippable when the asset's stack is not being synthesized", and must be idempotent/cacheable against the hash. The cross-process `spawnSync` shape is fine (still synchronous, still no shell), it just has to be invoked lazily and must not mutate `options.source`. |
| 6 | `NodejsAsset extends TerraformAsset` with `type: AssetType.FILE` and an absolute `path` into `cdktf.out`. | Becomes an `IAsset` whose staging path is produced by core: bundler output directory → `IAssetPackaging` (`AssetPackaging.ZIP`, or `DIRECTORY`) → `StagedAsset { assetHash, path, isDirectory }`. `NodejsAsset` would no longer pass `assetHash` into `TerraformAssetConfig`, and `TerraformAsset.path`/`fileName` would be derived from the packaging `extension` rather than `archive.zip`. |
| 7 | `NodejsBundle` return type (`archive`, `handler`, `assetHash`, `sourceCodeHash`, `compressedSize`, `uncompressedSize`) is part of the public API and consumed by `@cdktn/aws-lambda-nodejs` (`this.filename = this.code.path; this.sourceCodeHash = this.code.sourceCodeHash; this.handler = this.code.handler;`, plus the 250 MiB / 50 MiB guards on `uncompressedSize`/`compressedSize`). | The Lambda construct has to source `source_code_hash`/sizes differently (from the staged ZIP) or lose those guards; `handler` (`index.<ext>`) stays derivable but would move onto the bundler instance rather than the returned object. Also `@cdktn/bundler-nodejs` currently **depends on `cdktn` as a peer and imports `App, AssetType, TerraformAsset, Token`** — a pure `IAssetBundler` implementation would need no construct/`App`/`TerraformAsset` import at all, which is exactly the "provider-independent"/"no staging lifecycle" split the README advertises for `NodejsBundler`. |
| 8 | `runner.mjs` is a published sibling file resolved via `path.join(__dirname, "../runner.mjs")`. | Unchanged if the harness keeps the child-process design; the runner just needs an output-dir mode. Its JSON protocol (`format`, `entry`, `handler`, `projectRoot`, `target`, `configFile`, `rolldownOptions`, `externalModules`, `define`, `moduleTypes`, `minify`, `keepNames`, `sourceMap`, `tsconfig`, `copyFiles`, `resultFile`) is the contract to extend with `outputDir`. |

Net: the *Rolldown invocation* (facade plugin + `external` regexp mapping + `transform.target`/
`define` + deterministic output naming) is reusable almost verbatim; what changes is the
**output shape** (directory vs ZIP), **when it runs** (synth/onSynthesize vs constructor), and
**where identity comes from** (`bundlerKey` over source vs SHA-256 of the built ZIP).

---

## 5. Example project — verbatim

### 5.1 `examples/typescript/aws-nodejs-function/main.ts`

```ts
// Copyright (c) OpenConstructs
// SPDX-License-Identifier: MPL-2.0
import { App, TerraformOutput, TerraformStack } from "cdktn";
import { AwsProvider } from "@cdktn/provider-aws/lib/provider/index.js";
import { NodejsFunction } from "@cdktn/aws-lambda-nodejs";

const app = new App();
const stack = new TerraformStack(app, "hello");
new AwsProvider(stack, "aws", { region: "eu-central-1" });

const hello = new NodejsFunction(stack, "hello", {
  entry: "src/hello.ts",
  environment: { GREETING: "Hello from CDK Terrain" },
});

new TerraformOutput(stack, "function_name", { value: hello.functionName });
app.synth();
```

### 5.2 `examples/typescript/aws-nodejs-function/cdktf.json`

```json
{
  "language": "typescript",
  "app": "node main.ts",
  "sendCrashReports": "false"
}
```

### 5.3 `examples/typescript/aws-nodejs-function/src/hello.ts` (the deployed handler)

```ts
// Copyright (c) OpenConstructs
// SPDX-License-Identifier: MPL-2.0
export async function handler(event: { name?: string } = {}) {
  return {
    message: `${process.env.GREETING ?? "Hello"}, ${event.name ?? "world"}!`,
  };
}
```

### 5.4 `examples/typescript/aws-nodejs-function/package.json`

```json
{
  "name": "@examples/typescript-aws-nodejs-function",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "engines": { "node": ">=22.18.0" },
  "scripts": { "synth": "cdktn synth", "deploy": "cdktn deploy" },
  "dependencies": {
    "@cdktn/aws-lambda-nodejs": "workspace:*",
    "@cdktn/provider-aws": "25.4.0",
    "cdktn": "workspace:*",
    "constructs": "10.6.0"
  },
  "devDependencies": { "cdktn-cli": "workspace:*" }
}
```

The example also ships `README.md` and a 433-line opt-in AWS smoke test
`verify-aws.mjs` (both vendored here but not quoted in full). Per its README, the smoke test
"deploys three uniquely named Node.js 24 functions: this example's handler, an ESM handler with
top-level await on ARM64, and a CommonJS handler on x86-64. It verifies deployed ZIP hashes,
invocation results, TypeScript aliases, CommonJS dependencies, lazy imports, copied files,
environment variables, JSON logs, source maps and log retention." Note the AWS-account
dependency: it is **not** runnable in a hermetic harness without credentials.

---

## 6. Exact versions, and `rolldown` on linux-x64

### 6.1 `packages/@cdktn/bundler-nodejs/package.json` (verbatim, whole file)

```json
{
  "name": "@cdktn/bundler-nodejs",
  "version": "0.0.0",
  "description": "Native Node.js and TypeScript assets for CDK Terrain, powered by Rolldown",
  "license": "MPL-2.0",
  "author": { "name": "OpenConstructs", "url": "https://github.com/open-constructs" },
  "repository": { "type": "git", "url": "https://github.com/open-constructs/cdk-terrain.git", "directory": "packages/@cdktn/bundler-nodejs" },
  "publishConfig": { "access": "public" },
  "main": "build/index.js",
  "types": "build/index.d.ts",
  "exports": { ".": { "types": "./build/index.d.ts", "default": "./build/index.js" } },
  "files": ["build", "runner.mjs"],
  "engines": { "node": ">=22.12.0" },
  "scripts": {
    "build": "tsc",
    "package": "node ../../../tools/pack-node-package.mjs",
    "package:js": "node ../../../tools/pack-node-package.mjs"
  },
  "nx": { "tags": ["unit-test"] },
  "dependencies": { "fflate": "0.8.3", "rolldown": "1.2.7" },
  "peerDependencies": { "cdktn": "^0.24.0", "constructs": ">=10.6.0 <10.8.0" },
  "devDependencies": { "@types/node": "22.20.1", "cdktn": "workspace:*", "constructs": "10.6.0", "typescript": "^5.0.4" }
}
```

Declared versions asked for:
- **`rolldown`: `1.2.7`** (exact pin, runtime dependency, `hasBin: true`)
- **zip lib: `fflate` `0.8.3`** (exact pin; used as `zipSync` in `runner.mjs` and `unzipSync` in
  `index.ts`). No `archiver`/`jszip`/`yazl` anywhere in the PR.
- **`typescript`: `^5.0.4`** (devDependency; range, not an exact pin)
- `@types/node`: `22.20.1`; peer `cdktn ^0.24.0`, `constructs >=10.6.0 <10.8.0`; `engines.node >=22.12.0`

Resolved versions from the PR's `pnpm-lock.yaml` (`packages/@cdktn/bundler-nodejs` importer,
lines 1026–1046) — these are the versions that would actually be installed:

```yaml
  packages/@cdktn/bundler-nodejs:
    dependencies:
      fflate:
        specifier: 0.8.3
        version: 0.8.3
      rolldown:
        specifier: 1.2.7
        version: 1.2.7
    devDependencies:
      '@types/node':
        specifier: 22.20.1
        version: 22.20.1
      cdktn:
        specifier: workspace:*
        version: link:../../cdktn
      constructs:
        specifier: 10.6.0
        version: 10.6.0
      typescript:
        specifier: ^5.0.4
        version: 5.4.5
```

**`typescript` resolves to `5.4.5`** for `@cdktn/bundler-nodejs` and `@cdktn/aws-lambda-nodejs`
(the lockfile also carries an unrelated `typescript@5.9.3` for other packages). Note `5.4.5`
predates the `import type ... with { "resolution-mode": "import" }` syntax stabilisation story in
some toolchains — worth verifying when porting.

Lockfile integrity entries (verbatim):

```yaml
  fflate@0.8.3:
    resolution: {integrity: sha512-tbZNuJrLwGUp3zshBtdy4W+ORxZuIh8a5ilyIEQDC5rY1f3U20JMry0Ll3WBzU58EZKsEuJFXhb5gwv8CsPvgA==}

  rolldown@1.2.7:
    resolution: {integrity: sha512-g0EtLvBjTUB7jhyV0S/TCup3v/XSVl45vUIGbOGU4QPiyjTenCe4mKuFvW9fEgYmS2Fo42AUssRmNuMziXdrig==}
    engines: {node: ^20.19.0 || >=22.12.0}
    hasBin: true
```

### 6.2 `packages/@cdktn/aws-lambda-nodejs/package.json` (verbatim)

```json
{
  "name": "@cdktn/aws-lambda-nodejs",
  "version": "0.0.0",
  "description": "Ship Node.js and TypeScript Lambda functions with CDK Terrain",
  "license": "MPL-2.0",
  "author": { "name": "OpenConstructs", "url": "https://github.com/open-constructs" },
  "repository": { "type": "git", "url": "https://github.com/open-constructs/cdk-terrain.git", "directory": "packages/@cdktn/aws-lambda-nodejs" },
  "publishConfig": { "access": "public" },
  "main": "build/index.js",
  "types": "build/index.d.ts",
  "exports": { ".": { "types": "./build/index.d.ts", "default": "./build/index.js" } },
  "files": ["build"],
  "engines": { "node": ">=22.12.0" },
  "scripts": {
    "build": "tsc",
    "package": "node ../../../tools/pack-node-package.mjs",
    "package:js": "node ../../../tools/pack-node-package.mjs"
  },
  "nx": { "tags": ["unit-test"] },
  "dependencies": { "@cdktn/bundler-nodejs": "workspace:*" },
  "peerDependencies": { "@cdktn/provider-aws": "^25.4.0", "cdktn": "^0.24.0", "constructs": ">=10.6.0 <10.8.0" },
  "devDependencies": { "@cdktn/provider-aws": "25.4.0", "@types/node": "22.20.1", "cdktn": "workspace:*", "constructs": "10.6.0", "typescript": "^5.0.4" }
}
```

### 6.3 `rolldown` on linux-x64: **yes, installable**

- `npm view rolldown version` → **`1.2.9`** (latest as of this check); the PR pins `1.2.7`,
  which exists (the published version list includes …, `1.2.0` … `1.2.7`, `1.2.8`, `1.2.9`).
- `npm view rolldown@1.2.7 engines` → `{ node: '^20.19.0 || >=22.12.0' }` — satisfied by this
  host's `node v22.22.3` and by the package's own `>=22.12.0`.
- `npm view rolldown@1.2.7 dependencies` → `{ '@oxc-project/types': '=0.148.0', '@rolldown/pluginutils': '^1.0.0' }`.
- `npm view rolldown@1.2.7 optionalDependencies` (15 platform bindings, all pinned `1.2.7`):
  `@rolldown/binding-darwin-x64`, `-darwin-arm64`, `-freebsd-x64`, `-android-arm64`,
  `-android-arm-eabi`, **`-linux-x64-gnu`**, **`-linux-x64-musl`**, `-linux-arm64-gnu`,
  `-linux-arm64-musl`, `-linux-arm-gnueabihf`, `-linux-ppc64-gnu`, `-linux-s390x-gnu`,
  `-win32-x64-msvc`, `-win32-arm64-msvc`, `-openharmony-arm64`.
- `npm view @rolldown/binding-linux-x64-gnu@1.2.7 os cpu engines` →
  `os = 'linux'`, `cpu = 'x64'`, `engines = { node: '^20.19.0 || >=22.12.0' }`,
  tarball `https://registry.npmjs.org/@rolldown/binding-linux-x64-gnu/-/binding-linux-x64-gnu-1.2.7.tgz`.
- Host check: `uname -m` → `x86_64`, `node -v` → `v22.22.3`. So the glibc (gnu) x64 binding
  matches; `musl` variant also published for Alpine. Nothing was installed — registry metadata
  only.
- Caveat: the binding arrives via **optionalDependencies**, so an install with optional deps
  disabled (`--no-optional`, some strict `--ignore-scripts`/lockfile pruning, or a
  `pnpm` `optional=false` config) would break the runner at runtime, not build time. The README
  calls this out explicitly.

---

## 7. Other PR #402 changes (context)

- Root `README.md` (+2 lines):
  `First-party TypeScript/JavaScript packages add [Node.js Lambda functions](./packages/@cdktn/aws-lambda-nodejs) and reusable [native Node.js bundle assets](./packages/@cdktn/bundler-nodejs).`
- `knip.jsonc` (+7):

```jsonc
    "packages/@cdktn/bundler-nodejs": {
      "entry": ["runner.mjs"],
      "project": ["src/**/*.ts", "test/**/*.ts"]
    },
    "packages/@cdktn/aws-lambda-nodejs": {
      "project": ["src/**/*.ts", "test/**/*.ts"]
    },
```

- `tools/pack-node-package.mjs` (new, verbatim in full — vendored):

```js
// Copyright (c) OpenConstructs
// SPDX-License-Identifier: MPL-2.0
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

// pnpm resolves workspace: dependencies to release versions when packing.
mkdirSync("dist/js", { recursive: true });
execFileSync("pnpm", ["pack", "--pack-destination", "dist/js"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
```

- `packages/@cdktn/bundler-nodejs/tsconfig.json` (verbatim) — note `"module": "Node16"` +
  `moduleResolution: Node16`, `target: ES2022`, `rootDir: src`, `outDir: build`,
  `esModuleInterop: true`, `declaration: true`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "skipLibCheck": true,
    "declaration": true,
    "rootDir": "src",
    "outDir": "build",
    "esModuleInterop": true
  },
  "include": ["src/**/*.ts"]
}
```

- `packages/@cdktn/bundler-nodejs/eslint.config.mjs` (byte-identical to the `@cdktn/aws-lambda-nodejs`
  one, SHA-256 `2ee4a26c7941680bc9dd0e975a68933822d58613faafff4f4e316085540e0184`, verbatim):

```js
/**
 * Copyright (c) HashiCorp, Inc.
 * SPDX-License-Identifier: MPL-2.0
 */

export { default } from "../../../eslint.config.mjs";
```

- `packages/@cdktn/bundler-nodejs/jest.config.js` (verbatim; same shape as the
  `@cdktn/aws-lambda-nodejs` one, differing only in `displayName`):

```js
/**
 * Copyright (c) HashiCorp, Inc.
 * SPDX-License-Identifier: MPL-2.0
 */

module.exports = {
  displayName: '@cdktn/bundler-nodejs',
  preset: '../../../jest.preset.js',
  transform: { '^.+\\.tsx?$': ['@swc/jest', { jsc: { parser: { syntax: 'typescript' }, target: 'es2022' }, module: { type: 'commonjs' } }] },
};
```

- Tests: `packages/@cdktn/bundler-nodejs/test/asset.test.ts` (574 lines, vendored; uses
  `@swc/jest` transform, `swc` target es2022, and a `synth()` helper that reads the staged ZIP
  back out of `app.outdir/stacks/test/<asset.path>` and `unzipSync`s it, then `invoke()`s the
  handler with a real `process.execPath --input-type=module -e` child process), plus
  `packages/@cdktn/aws-lambda-nodejs/test/function.test.ts` (246 lines) and
  `test/limits.test.ts` (55 lines). `@cdktn/aws-lambda-nodejs` devDepends on
  `@cdktn/provider-aws@25.4.0` so those tests generate real AWS resources.

---

## 8. Manifest of vendored files (SHA-256)

Vendored under `/data/repos/cdktn-bundler-harness/vendor/rolldown/`, paths relative to the repo
root. Lines marked `(main)` came from `open-constructs/cdk-terrain@main` because the PR branch does
not contain those files; the two unmarked `packages/cdktn/src/*` lines and everything else are
verbatim from `garysassano/cdk-terrain@feat/native-nodejs-function` (`127bc9f`). Read-only
verification of this exact manifest at the time of writing: 28 files on disk, 28 listed, all hashes
matching.

```
73b93434c528ac8b0db6cbda73fb4513c0bf067c4bfaa1920766cd770af5258e  examples/typescript/aws-nodejs-function/README.md
eeedf5cbbf7ed4094c8d39ae44192a22330443f8d3822fd3a0d9025d837b2ede  examples/typescript/aws-nodejs-function/cdktf.json
914a56e699548f7d9b729e9f719660e9e7089fc05d9ab63ed115f8284ce62ce6  examples/typescript/aws-nodejs-function/main.ts
42029b5edc268237226f3373f756aa8f88668562d55d575225f0163218920843  examples/typescript/aws-nodejs-function/package.json
7363da74f1c9bfd29890a61db2fcb8de358d9a52b659fd4bc4e9209798c49d5c  examples/typescript/aws-nodejs-function/src/hello.ts
79504210087faedde784d139beb1c4d08f43c1808a5d5fdfe97c733ce0794f00  examples/typescript/aws-nodejs-function/verify-aws.mjs
cf9baba0dbbf1b18470e5d21ddd519345ab2e87770ff5fc9b9a7b2cd765973e6  knip.jsonc
f6c43ccd6fc51bb97d85b7d4f339f71f17820cd4b9f864000d49f3b7151a4fcc  packages/@cdktn/aws-lambda-nodejs/README.md
2ee4a26c7941680bc9dd0e975a68933822d58613faafff4f4e316085540e0184  packages/@cdktn/aws-lambda-nodejs/eslint.config.mjs
54ef8bb749f42d7dee5debb6d46c75db0cb177be1b93e86289564cdeb52dfc81  packages/@cdktn/aws-lambda-nodejs/jest.config.js
506fd3c15c3082f536a65554cf773755eb152b4bbb6b5007125f8759d404e590  packages/@cdktn/aws-lambda-nodejs/package.json
fab07ceaa7465959163cfa4ac9dc2b11152b5ac81f869f0a81fc4a22a21e8bcf  packages/@cdktn/aws-lambda-nodejs/src/index.ts
6605b17aacf19f39022726d50693ad218630780e73c87eaeb1af5ff4320df98c  packages/@cdktn/aws-lambda-nodejs/test/function.test.ts
131e9f090f7eb09fd0b474cdde91a18e90afe8a0c94944399a0cee3c1142c207  packages/@cdktn/aws-lambda-nodejs/test/limits.test.ts
4d001690f80471187935eea12a780efc0cd7181414a046e368740482f21592f0  packages/@cdktn/aws-lambda-nodejs/tsconfig.json
8ec07b609cacfbeecd793b49d1ab59c2c4e8a75b5a200f6c21d172f2f9de5cdd  packages/@cdktn/bundler-nodejs/README.md
2ee4a26c7941680bc9dd0e975a68933822d58613faafff4f4e316085540e0184  packages/@cdktn/bundler-nodejs/eslint.config.mjs
99e9d7a0426206960841c2164e64e15a73f1a6923afa22facfb201ffad9349ae  packages/@cdktn/bundler-nodejs/jest.config.js
fddc228ff91c010d0bf7d93d9f42207fb6c4591578f18982e5185518d4a21f9e  packages/@cdktn/bundler-nodejs/package.json
925860acc8ef6fdf054719aea88ef57ccfa5afdfca6e2d19bb6ef22c203f7f37  packages/@cdktn/bundler-nodejs/runner.mjs
383d723eebba59c8d8c0821641d08621e9dda2ad951cabb403ffd63be0542309  packages/@cdktn/bundler-nodejs/src/index.ts
a1f89ee503eff091b5b9392c35c1292a04032ad47879d83643349d821edd5be7  packages/@cdktn/bundler-nodejs/test/asset.test.ts
8d6468ed4c0e61fbe978fc9cd775d9b1ddb45e67dc030d8dfb0862fa48da0bfc  packages/@cdktn/bundler-nodejs/tsconfig.json
fda40483c559614f8707f6be1f4db8ff7b728652d4bb277e6862c145c83966e8  packages/cdktn/src/asset-hash.ts  (main)
746f071deada259565bc2b175b5f998615da5aff594e57801ab36b97f8bea2e7  packages/cdktn/src/assets.ts  (main)
029479a1d2b891342d3e34da9b90292817980d82385dcb3e7f37336f384a574c  packages/cdktn/src/index.ts
d21ea7bfa6a4d1c6b442b037ebef5908e71d89b076adc02107b0411f456c07c3  packages/cdktn/src/terraform-asset.ts
7c5e967838b2c70e5a85892471d61fa577b2e536cde94b1fd407bb2602096942  tools/pack-node-package.mjs
```

Support files deliberately **not** vendored: `pnpm-lock.yaml` (large; only §6 excerpts),
root `README.md` (2-line diff quoted in §7), `packages/@cdktn/aws-lambda-nodejs/README.md`'s
siblings, and the PR's full unified diff (saved transiently to `/tmp/pr402.diff`).

## 9. Explicit "not found" list

- `IAssetBundler`, `BundleOptions`, `bundlerKey` — **not found** in PR #402 or on `main`; found
  only in PR #442's tree/`.jsii` (quoted in §4).
- Any `AssetType.DIRECTORY` / directory-producing path in `@cdktn/bundler-nodejs` — **not found**;
  the package only ever produces `AssetType.FILE` ZIPs.
- `rolldown`'s programmatic `bundle.write` — **not found**; only `bundle.generate` is used.
- Any zip library other than `fflate@0.8.3` — **not found**.
- `NodejsFunction` L2 features mentioned in issue #401 but absent from the PR: JSII bindings,
  Docker builds, automatic native-addon installation, S3 publishing for >50 MiB ZIPs, a watch
  server — **not found** in the diff.
- `packages/cdktn/src/assets.ts` and `asset-hash.ts` at the PR head ref — **HTTP 404** (branch
  predates them; fetched from `main` instead).

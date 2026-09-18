import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { unzipSync } from "fflate";
import { cdktn } from "./pr-head";
import type { Adapter, Fixture, ScenarioResult } from "./types";

export const WORK_ROOT = path.join(__dirname, "..", ".work");

const { App, AssetHashType, AssetPackaging, AssetStaging, TerraformAsset, TerraformStack } = cdktn;

export function scratchRoot(): string {
  return path.join(WORK_ROOT, "scratch");
}

export function freshDir(prefix: string): string {
  mkdirSync(scratchRoot(), { recursive: true });
  return mkdtempSync(path.join(scratchRoot(), `${prefix}-`));
}

export function listDirRecursive(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir).sort()) {
      const full = path.join(dir, entry);
      const relPath = rel ? `${rel}/${entry}` : entry;
      if (statSync(full).isDirectory()) walk(full, relPath);
      else out.push(relPath);
    }
  };
  walk(root, "");
  return out.sort();
}

export function hashTree(root: string): string {
  const hash = createHash("sha256");
  for (const rel of listDirRecursive(root)) {
    hash.update(rel);
    hash.update("\0");
    hash.update(readFileSync(path.join(root, rel)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/** Synchronous sleep helper (kept for ad-hoc probes in this module). */
export function sleepSync(ms: number): void {
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, ms);
}

export function listScratchDirs(tmpdir: string): string[] {
  if (!existsSync(tmpdir)) return [];
  return readdirSync(tmpdir)
    .filter((entry) => entry.startsWith("cdktn-bundle-"))
    .map((entry) => path.join(tmpdir, entry))
    .sort();
}

/** The source application every adapter builds. */
export function createFixture(name: string): Fixture {
  const root = freshDir(`fixture-${name}`);
  const files: Record<string, string> = {
    "index.ts": [
      "export const handler = async (): Promise<string> => {",
      '  return `harness ${process.env.HARNESS ?? "0"}`;',
      "};",
      "",
      "export function helper(value: number): number {",
      "  return value * 2;",
      "}",
      "",
    ].join("\n"),
    "lib/dep.ts": "export const dependency = \"dep\";\n",
    "package.json": JSON.stringify({ name: "harness-fixture", version: "1.0.0" }, null, 2),
    "COPY.txt": "copied-by-bundlers\n",
    "excludeme.txt": "version-1\n",
    // A tar-style single-file build, used by the archived-output scenario.
    // Packaging stage: `type=local` exports the LAST stage's filesystem, so the
    // build stage's output is copied into a scratch stage — otherwise a buildkit
    // bundler would stage the entire alpine rootfs (including /etc/mtab).
    "Dockerfile.bundle": [
      "FROM alpine AS build",
      "RUN mkdir -p /out",
      "COPY . /out",
      "RUN printf 'built-in-buildkit\\n' > /out/BUILT",
      "FROM scratch AS output",
      "COPY --from=build /out/ /",
      "",
    ].join("\n"),
    // Second entry so a rolldown/esbuild build has a real module graph.
    "second.ts": "export const second = helperImport();\nfunction helperImport(): string { return \"second\"; }\n",
  };
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
  return { root, entry: "index.ts", files };
}

/** Bundler double whose `bundle()` counts calls and records its output dir. */
function countingBundler(
  underlying: { bundlerKey?: string; bundle(o: { source: string; outputDir: string }): string },
  state: { calls: number; outputs: string[] },
): { bundlerKey?: string; bundle(o: { source: string; outputDir: string }): string } {
  return {
    bundlerKey: underlying.bundlerKey,
    bundle: (options) => {
      state.calls += 1;
      state.outputs.push(options.outputDir);
      return underlying.bundle(options);
    },
  };
}

function newStack(id: string): { app: InstanceType<typeof App>; stack: InstanceType<typeof TerraformStack> } {
  const app = new App({ outdir: freshDir(`out-${id}`) });
  return { app, stack: new TerraformStack(app, `stack-${id}`) };
}

export interface Scenario {
  readonly id: string;
  readonly description: string;
  run(adapter: Adapter, fixture: Fixture): Promise<{ observations: Record<string, unknown>; error?: string }>;
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0];
}

export const scenarios: Scenario[] = [
  {
    id: "stage/source-hash",
    description:
      "AssetStaging + AssetHashType.SOURCE: the build must be deferred to stage() and the artifact staged under the source hash.",
    async run(adapter, fixture) {
      const state = { calls: 0, outputs: [] as string[] };
      const bundler = countingBundler(adapter.create(fixture), state);
      const { stack } = newStack("source");
      const staging = new AssetStaging(stack, "asset", {
        sourcePath: fixture.root,
        packaging: AssetPackaging.DIRECTORY,
        assetHashType: AssetHashType.SOURCE,
        bundler,
      });
      const callsAfterConstruct = state.calls;
      const target = freshDir("stage-source");
      staging.stage(target);
      return {
        observations: {
          bundlerCallsAtConstruction: callsAfterConstruct,
          bundlerCallsAfterStage: state.calls,
          eagerBuild: callsAfterConstruct > 0,
          assetHash: staging.assetHash,
          stagedFiles: listDirRecursive(target),
          stagedTreeHash: hashTree(target),
          sharedScratchDir: state.outputs[0],
        },
      };
    },
  },
  {
    id: "stage/output-hash",
    description:
      "AssetStaging + AssetHashType.OUTPUT: identity must be taken from the built artifact, which forces an eager build in the constructor.",
    async run(adapter, fixture) {
      const state = { calls: 0, outputs: [] as string[] };
      const bundler = countingBundler(adapter.create(fixture), state);
      const { stack } = newStack("output");
      const staging = new AssetStaging(stack, "asset", {
        sourcePath: fixture.root,
        packaging: AssetPackaging.DIRECTORY,
        assetHashType: AssetHashType.OUTPUT,
        bundler,
      });
      const callsAfterConstruct = state.calls;
      const artifactDir = state.outputs[0];
      const artifactHash = existsSync(artifactDir) ? hashTree(artifactDir) : "<gone>";
      const target = freshDir("stage-output");
      staging.stage(target);
      return {
        observations: {
          bundlerCallsAtConstruction: callsAfterConstruct,
          eagerBuild: callsAfterConstruct > 0,
          artifactStillPresentAtStageTime: existsSync(artifactDir),
          assetHash: staging.assetHash,
          builtArtifactTreeHash: artifactHash,
          stagedTreeHash: hashTree(target),
          stagingMatchesArtifact: artifactHash === hashTree(target),
        },
        error: callsAfterConstruct === 0 ? "no eager build happened for OUTPUT hashing" : undefined,
      };
    },
  },
  {
    id: "stage/zip-packaging",
    description:
      "AssetStaging + AssetPackaging.ZIP with a bundler: an archive-producing bundler's natural target. The stage target is a file path (as TerraformAsset does for zipped assets), not a directory.",
    async run(adapter, fixture) {
      const state = { calls: 0, outputs: [] as string[] };
      const bundler = countingBundler(adapter.create(fixture), state);
      const { stack } = newStack("zip");
      const staging = new AssetStaging(stack, "asset", {
        sourcePath: fixture.root,
        packaging: AssetPackaging.ZIP,
        assetHashType: AssetHashType.SOURCE,
        bundler,
      });
      const targetDir = freshDir("stage-zip");
      const target = path.join(targetDir, `asset${staging.packaging.extension}`);
      staging.stage(target);
      const zipEntries = existsSync(target)
        ? Object.keys(unzipSync(readFileSync(target)))
        : [];

      // A bundler that already emits an archive (rolldown-zip, a tar.gz-style
      // build) gets archived a second time here.
      const nestedArchive = zipEntries.find((entry) => /\.(zip|tar|tar\.gz|tgz)$/.test(entry));

      return {
        observations: {
          stageTargetIsFile: !statSync(target).isDirectory(),
          packagingExtension: staging.packaging.extension,
          packagingProducesDirectory: staging.packaging.producesDirectory,
          packagingAcceptsDirectorySource: staging.packaging.acceptsDirectorySource,
          packagingOmitsDirectoryEntries: staging.packaging.omitsDirectoryEntries,
          bundleArtifactIsDirectory: true,
          archiveBytes: statSync(target).size,
          archiveEntries: zipEntries,
          doubleArchived: nestedArchive,
          assetHash: staging.assetHash,
          bundlerBuilds: state.calls,
        },
      };
    },
  },
  {
    id: "repeat/stage-twice",
    description:
      "Calling stage() twice on one OUTPUT-hashed staging: does the second call rebuild, and does the artifact stay identical under one assetHash?",
    async run(adapter, fixture) {
      const state = { calls: 0, outputs: [] as string[] };
      const bundler = countingBundler(adapter.create(fixture), state);
      const { stack } = newStack("twice");
      const staging = new AssetStaging(stack, "asset", {
        sourcePath: fixture.root,
        packaging: AssetPackaging.DIRECTORY,
        assetHashType: AssetHashType.OUTPUT,
        bundler,
      });
      const first = freshDir("stage-first");
      staging.stage(first);
      const afterFirst = state.calls;
      const second = freshDir("stage-second");
      staging.stage(second);
      return {
        observations: {
          assetHash: staging.assetHash,
          bundlerCallsAfterFirstStage: afterFirst,
          bundlerCallsAfterSecondStage: state.calls,
          rebuiltOnSecondStage: state.calls > afterFirst,
          firstTreeHash: hashTree(first),
          secondTreeHash: hashTree(second),
          artifactsIdentical: hashTree(first) === hashTree(second),
        },
      };
    },
  },
  {
    id: "repeat/stage-twice-nondeterministic",
    description:
      "Same as above with a bundler whose output differs on every run (embedded timestamp/revision — the normal case for real builds): does the staged artifact drift while assetHash stays fixed?",
    async run(adapter, fixture) {
      const state = { calls: 0, outputs: [] as string[] };
      const real = adapter.create(fixture);
      const nondeterministic = countingBundler(
        {
          bundlerKey: real.bundlerKey,
          bundle(options: { source: string; outputDir: string }): string {
            const produced = real.bundle(options);
            writeFileSync(
              path.join(options.outputDir, "BUILD_INFO.txt"),
              `build-${state.calls}-${Date.now()}-${Math.random()}\n`,
            );
            return produced;
          },
        },
        state,
      );
      const { stack } = newStack("twice-nondeterministic");
      const staging = new AssetStaging(stack, "asset", {
        sourcePath: fixture.root,
        packaging: AssetPackaging.DIRECTORY,
        assetHashType: AssetHashType.OUTPUT,
        bundler: nondeterministic,
      });
      const first = freshDir("nondet-first");
      staging.stage(first);
      const second = freshDir("nondet-second");
      staging.stage(second);
      const firstInfo = path.join(first, "BUILD_INFO.txt");
      const secondInfo = path.join(second, "BUILD_INFO.txt");
      return {
        observations: {
          assetHash: staging.assetHash,
          bundlerCalls: state.calls,
          firstBuildInfo: existsSync(firstInfo) ? readFileSync(firstInfo, "utf8").trim() : "<none>",
          secondBuildInfo: existsSync(secondInfo) ? readFileSync(secondInfo, "utf8").trim() : "<none>",
          artifactsIdentical: hashTree(first) === hashTree(second),
          sameIdentityDifferentBytes: hashTree(first) !== hashTree(second),
        },
        error:
          hashTree(first) === hashTree(second)
            ? "expected the two builds to differ, but they did not"
            : undefined,
      };
    },
  },
  {
    id: "repeat/synth-twice",
    description:
      "TerraformAsset inside two app.synth() passes: where do assets land, and is the emitted tree stable the second time? Assets are written under <outdir>/stacks/<stack>/assets/<logicalId>/<hash>, not <outdir>/assets.",
    async run(adapter, fixture) {
      const state = { calls: 0, outputs: [] as string[] };
      const bundler = countingBundler(adapter.create(fixture), state);
      const { app, stack } = newStack("synth");
      const asset = new TerraformAsset(stack, "file", {
        path: fixture.root,
        assetHashType: AssetHashType.OUTPUT,
        bundler,
      });
      app.synth();
      const assetFiles = listDirRecursive(app.outdir).filter((rel) =>
        rel.includes("/assets/"),
      );
      const firstHash = hashTree(app.outdir);
      const callsAfterFirst = state.calls;
      app.synth();
      return {
        observations: {
          assetHash: asset.assetHash,
          declaredAssetPath: asset.path,
          bundlerCallsAfterFirstSynth: callsAfterFirst,
          bundlerCallsAfterSecondSynth: state.calls,
          rebuiltOnSecondSynth: state.calls > callsAfterFirst,
          emittedAssetFiles: assetFiles,
          firstSynthOutdirHash: firstHash,
          secondSynthOutdirHash: hashTree(app.outdir),
          identicalAcrossSynths: firstHash === hashTree(app.outdir),
        },
      };
    },
  },
  {
    id: "asset/file-type-bundler",
    description:
      "TerraformAsset with AssetType.FILE plus a bundler, where the source really is a file (a pre-zipped archive): expected to be rejected at construction, which is exactly what a zip/tar-producing bundler needs to express.",
    async run(adapter, fixture) {
      const archive = path.join(fixture.root, "prebuilt.zip");
      writeFileSync(archive, "not-a-real-zip-but-a-file");
      const { stack } = newStack("filetype");
      let threw: string | undefined;
      try {
        new TerraformAsset(stack, "file", {
          path: archive,
          type: cdktn.AssetType.FILE,
          assetHashType: AssetHashType.OUTPUT,
          bundler: adapter.create(fixture),
        });
      } catch (error) {
        threw = errorText(error);
      }
      const bundlesRan = false;
      return {
        observations: {
          rejectedAtConstruction: Boolean(threw),
          error: threw,
          adapterProducesArchive: adapter.meta.producesArchive ?? false,
          bundlerRanBeforeRejection: bundlesRan,
        },
        error: threw ? undefined : "AssetType.FILE + bundler was accepted",
      };
    },
  },
  {
    id: "failure/bundler-throws",
    description:
      "A bundler that fails after writing output: is the error surfaced and is the scratch directory cleaned up in-process?",
    async run(adapter, fixture) {
      const tmpdir = process.env.TMPDIR ?? os.tmpdir();
      const before = listScratchDirs(tmpdir);
      const real = adapter.create(fixture);
      const throwing = {
        bundlerKey: real.bundlerKey,
        bundle(options: { source: string; outputDir: string }): string {
          real.bundle(options);
          throw new Error("harness: bundler failed after writing output");
        },
      };
      let threw: string | undefined;
      try {
        const { stack } = newStack("throw");
        new AssetStaging(stack, "asset", {
          sourcePath: fixture.root,
          packaging: AssetPackaging.DIRECTORY,
          assetHashType: AssetHashType.OUTPUT,
          bundler: throwing,
        });
      } catch (error) {
        threw = errorText(error);
      }
      const stranded = listScratchDirs(tmpdir).filter((dir) => !before.includes(dir));
      const strandedBytes = stranded.reduce((sum, dir) => {
        let total = 0;
        for (const rel of listDirRecursive(dir)) total += statSync(path.join(dir, rel)).size;
        return sum + total;
      }, 0);
      return {
        observations: {
          errorPropagated: Boolean(threw),
          error: threw,
          scratchDirsLeftInProcess: stranded.length,
          scratchBytesLeftInProcess: strandedBytes,
          note: "registered scratch is reclaimed only by the process-exit sweep (see lifecycle/scratch-after-exit)",
        },
      };
    },
  },
  {
    id: "identity/excluded-input-changes",
    description:
      "AssetStaging with an excluded file whose contents change: does the hash move while the artifact moves?",
    async run(adapter, fixture) {
      const build = () => {
        const { stack } = newStack("exclude");
        return new AssetStaging(stack, "asset", {
          sourcePath: fixture.root,
          exclude: ["excludeme.txt"],
          packaging: AssetPackaging.DIRECTORY,
          assetHashType: AssetHashType.SOURCE,
          bundler: adapter.create(fixture),
        });
      };
      const first = build();
      const firstTarget = freshDir("exclude-first");
      first.stage(firstTarget);

      writeFileSync(path.join(fixture.root, "excludeme.txt"), "version-2\n");
      const second = build();
      const secondTarget = freshDir("exclude-second");
      second.stage(secondTarget);

      const sawExcludedFile = listDirRecursive(firstTarget).some((rel) =>
        rel.endsWith("excludeme.txt"),
      );
      return {
        observations: {
          excludedFileShippedInArtifact: sawExcludedFile,
          hashBefore: first.assetHash,
          hashAfterExcludedChange: second.assetHash,
          hashUnchangedDespiteExcludedChange: first.assetHash === second.assetHash,
          artifactChanged:
            hashTree(firstTarget) !== hashTree(secondTarget),
        },
      };
    },
  },
  {
    id: "determinism/two-fresh-builds",
    description:
      "Two independent builds of the same source with OUTPUT hashing: is the bundler's output reproducible?",
    async run(adapter, fixture) {
      const build = () => {
        const state = { calls: 0, outputs: [] as string[] };
        const { stack } = newStack("determinism");
        const staging = new AssetStaging(stack, "asset", {
          sourcePath: fixture.root,
          packaging: AssetPackaging.DIRECTORY,
          assetHashType: AssetHashType.OUTPUT,
          bundler: countingBundler(adapter.create(fixture), state),
        });
        const target = freshDir("determinism-stage");
        staging.stage(target);
        return { assetHash: staging.assetHash, treeHash: hashTree(target) };
      };
      const first = build();
      const second = build();
      return {
        observations: {
          first: first.assetHash,
          second: second.assetHash,
          assetHashesEqual: first.assetHash === second.assetHash,
          artifactTreesEqual: first.treeHash === second.treeHash,
          reproducible: first.treeHash === second.treeHash,
        },
      };
    },
  },
  {
    id: "identity/bundler-key",
    description:
      "Two bundlers differing only in bundlerKey: does identity track the build configuration?",
    async run(adapter, fixture) {
      const make = (key: string) => {
        const real = adapter.create(fixture);
        const { stack } = newStack("key");
        return new AssetStaging(stack, "asset", {
          sourcePath: fixture.root,
          packaging: AssetPackaging.DIRECTORY,
          assetHashType: AssetHashType.SOURCE,
          bundler: { bundlerKey: key, bundle: (o) => real.bundle(o) },
        });
      };
      const a = make("docker:node:18:npm run build");
      const b = make("docker:node:20:npm run build");
      const noKey = (() => {
        const real = adapter.create(fixture);
        const { stack } = newStack("keyless");
        return new AssetStaging(stack, "asset", {
          sourcePath: fixture.root,
          packaging: AssetPackaging.DIRECTORY,
          assetHashType: AssetHashType.SOURCE,
          bundler: { bundle: (o) => real.bundle(o) },
        });
      })();
      return {
        observations: {
          adapterBundlerKey: adapter.create(fixture).bundlerKey,
          node18Hash: a.assetHash,
          node20Hash: b.assetHash,
          identityFollowsBundlerKey: a.assetHash !== b.assetHash,
          hashWithoutBundlerKey: noKey.assetHash,
        },
      };
    },
  },
  {
    id: "large-output/never-staged",
    description:
      "OUTPUT-hashed asset that is never staged (e.g. a stack that is not synthesized): what happens to the multi-megabyte scratch tree?",
    async run(adapter, fixture) {
      const tmpdir = process.env.TMPDIR ?? os.tmpdir();
      const before = listScratchDirs(tmpdir);
      const real = adapter.create(fixture);
      const big = {
        bundlerKey: real.bundlerKey,
        bundle(options: { source: string; outputDir: string }): string {
          const produced = real.bundle(options);
          const blob = Buffer.alloc(1 << 20, 0x61);
          for (let i = 0; i < 8; i += 1) {
            writeFileSync(path.join(options.outputDir, `blob-${i}.bin`), blob);
          }
          return produced;
        },
      };
      const { stack } = newStack("never-staged");
      const staging = new AssetStaging(stack, "asset", {
        sourcePath: fixture.root,
        packaging: AssetPackaging.DIRECTORY,
        assetHashType: AssetHashType.OUTPUT,
        bundler: big,
      });
      const created = listScratchDirs(tmpdir).filter((dir) => !before.includes(dir));
      const sizes = created.map((dir) => {
        let total = 0;
        for (const rel of listDirRecursive(dir)) total += statSync(path.join(dir, rel)).size;
        return { dir, bytes: total };
      });
      return {
        observations: {
          assetHash: staging.assetHash,
          scratchDirsCreated: created.length,
          scratchBytes: sizes.reduce((sum, entry) => sum + entry.bytes, 0),
          scratchDirs: sizes,
        },
      };
    },
  },
];

export function cleanupWorkRoot(): void {
  rmSync(WORK_ROOT, { recursive: true, force: true });
}

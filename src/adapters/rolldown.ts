/**
 * Port of open-constructs/cdk-terrain PR #402 (`@cdktn/bundler-nodejs`) onto
 * `IAssetBundler`.
 *
 * Upstream: vendor/rolldown/packages/@cdktn/bundler-nodejs/src/index.ts
 * (`NodejsBundler.bundle(props): NodejsBundle` + `NodejsAsset extends
 * TerraformAsset`) and `runner.mjs`. Upstream is a *standalone* bundler: it
 * returns a deterministic ZIP built by a child process and hands the archive to
 * `TerraformAsset` via `AssetType.FILE` + an explicit `assetHash`
 * (`sha256(zip)`), bypassing cdktn's own hashing.
 *
 * The port keeps the child-process runner (the interface is synchronous, so the
 * async Rolldown API cannot be called inline) and keeps upstream's option
 * surface, but returns a directory as `IAssetBundler` requires. Two variants are
 * exposed because the difference is the interesting part:
 *
 *   rolldown-dir  Rolldown output written directly into outputDir.
 *   rolldown-zip  upstream's deterministic archive.zip placed inside outputDir,
 *                 which is how a FILE-packaged consumer would need it.
 */
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import type { Adapter, Fixture } from "../types";
import type { IAssetBundler } from "../pr-head";

export interface RolldownBundlingProps {
  readonly handler?: string;
  readonly target?: string;
  readonly format?: "esm" | "cjs";
  readonly minify?: boolean;
  readonly sourceMap?: boolean;
  readonly externalModules?: string[];
  readonly define?: Record<string, string>;
  /** "dir" (adapter default) or "zip" (upstream behaviour). */
  readonly mode?: "dir" | "zip";
  readonly timeoutMs?: number;
}

const RUNNER = path.join(__dirname, "rolldown-runner.mjs");

export class RolldownBundler implements IAssetBundler {
  public readonly bundlerKey: string;

  constructor(
    private readonly props: RolldownBundlingProps = {},
  ) {
    this.bundlerKey = `rolldown::${this.props.target ?? "node24"}::${
      this.props.mode ?? "dir"
    }::${this.props.minify ?? true}`;
  }

  public bundle(options: { source: string; outputDir: string }): string {
    const { source, outputDir } = options;
    const result = spawnSync(process.execPath, [RUNNER], {
      input: JSON.stringify({
        ...this.props,
        mode: this.props.mode ?? "dir",
        handler: this.props.handler ?? "handler",
        projectRoot: source,
        entry: path.join(source, "index.ts"),
        outputDir,
        target: this.props.target ?? "node24",
      }),
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: this.props.timeoutMs ?? 120_000,
      windowsHide: true,
    });
    if (result.error || result.status !== 0) {
      throw new Error(
        `Rolldown bundling failed: ${result.error?.message ?? result.stderr}`,
      );
    }
    return outputDir;
  }
}

function adapterFor(mode: "dir" | "zip"): Adapter {
  return {
    meta: {
      id: mode === "zip" ? "rolldown-zip" : "rolldown-dir",
      name:
        mode === "zip"
          ? "PR #402 Rolldown bundler (deterministic ZIP in outputDir)"
          : "PR #402 Rolldown bundler (directory output)",
      provenance:
        "open-constructs/cdk-terrain PR #402 packages/@cdktn/bundler-nodejs (NodejsBundler + runner.mjs)",
      portedIn: "src/adapters/rolldown.ts + rolldown-runner.mjs",
      portNotes:
        mode === "zip"
          ? "Upstream returns a ZIP + sha256(zip) hash and feeds TerraformAsset AssetType.FILE with an explicit assetHash. As an IAssetBundler it can only return a directory, so the archive lands inside outputDir and the consumer is back to directory packaging (the bundler cannot express 'the artifact is this one file')."
          : "Rolldown's multi-file/directory output maps cleanly onto bundle(): string. What is lost relative to upstream is construct-time identity: upstream hashes the built ZIP before TerraformAsset exists, while a bundler under AssetHashType.SOURCE defers the build to stage().",
      producesArchive: mode === "zip",
    },
    async probe() {
      const result = spawnSync(
        process.execPath,
        [
          "-e",
          "import('rolldown').then(()=>{console.log('ok')},(e)=>{console.error(e.message);process.exit(1)})",
        ],
        { encoding: "utf8", cwd: path.join(__dirname, "..", "..") },
      );
      return {
        available: result.status === 0,
        detail:
          result.status === 0
            ? "rolldown importable natively"
            : `rolldown unavailable: ${result.stderr?.trim()}`,
      };
    },
    create(fixture: Fixture): IAssetBundler {
      return new RolldownBundler({
        handler: "handler",
        target: "node24",
        minify: true,
        mode,
        define: { "process.env.HARNESS": JSON.stringify("1") },
      });
    },
  };
}

export const directoryAdapter = adapterFor("dir");
export const zipAdapter = adapterFor("zip");

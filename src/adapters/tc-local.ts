/**
 * Port of TerraConstructs/base "src" (host) bundling onto `IAssetBundler`.
 *
 * Upstream: vendor/terraconstructs-base/src/bundling.ts (`BundlingOptions`,
 * `BundlingOutput`) and vendor/terraconstructs-base/src/asset-staging.ts.
 * Upstream, host bundling is the optional `ILocalBundling.tryBundle(outputDir,
 * options): boolean` fast path that runs *before* the Docker fallback, returning
 * `false` to defer to Docker.
 *
 * `IAssetBundler` has no "decline, try something else" protocol, so the port
 * cannot express the local-or-Docker decision: a local bundler either produces
 * the directory or throws. That is the first structural difference the harness
 * documents (see adapters/tc-local-docker.ts for how the chain has to be
 * flattened by the caller).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";
import type { Adapter, Fixture } from "../types";
import type { IAssetBundler } from "../pr-head";

/** Ported from TerraConstructs `BundlingOutput` (src/bundling.ts:156). */
export enum BundlingOutput {
  ARCHIVED = "archived",
  NOT_ARCHIVED = "not-archived",
  SINGLE_FILE = "single-file",
  AUTO_DISCOVER = "auto-discover",
}

export interface LocalBundlingProps {
  /** Command run on the host. Upstream default is `["sh","-c", ...]` free-form. */
  readonly command: string[];
  readonly environment?: Record<string, string>;
  readonly workingDirectory?: string;
  /** Upstream `BundlingOptions.outputType`. */
  readonly outputType?: BundlingOutput;
  /** Extra identity, mirroring upstream `extraHash`-style cache busting. */
  readonly extraHash?: string;
}

/** Ported from TerraConstructs `findSingleFile`/`determineBundledAsset` (src/bundling.ts). */
export function determineBundledAsset(
  outputDir: string,
  outputType: BundlingOutput = BundlingOutput.AUTO_DISCOVER,
): string {
  const entries = readdirSync(outputDir);
  const singleFile = entries.find((entry) => {
    const full = path.join(outputDir, entry);
    return statSync(full).isFile();
  });

  switch (outputType) {
    case BundlingOutput.NOT_ARCHIVED:
      return outputDir;
    case BundlingOutput.ARCHIVED:
    case BundlingOutput.SINGLE_FILE:
      if (!singleFile) {
        throw new Error(
          `Bundling output directory has no single file: ${outputDir}`,
        );
      }
      return path.join(outputDir, singleFile);
    case BundlingOutput.AUTO_DISCOVER:
      if (entries.length === 1 && singleFile) {
        return path.join(outputDir, singleFile);
      }
      return outputDir;
    default:
      throw new Error(`Unsupported bundling output type: ${outputType}`);
  }
}

export class TerraConstructsLocalBundler implements IAssetBundler {
  /**
   * Upstream folds the whole bundling config into the asset identity
   * (`sha256(fingerprint(source) ++ JSON.stringify(bundling))`). `IAssetBundler`
   * offers only an opaque `bundlerKey` string for that, so the port serialises
   * the config into it.
   */
  public readonly bundlerKey: string;

  constructor(private readonly props: LocalBundlingProps) {
    this.bundlerKey = `tcons-local::${createHash("sha256")
      .update(JSON.stringify(props))
      .digest("hex")
      .slice(0, 16)}`;
  }

  public bundle(options: { source: string; outputDir: string }): string {
    const { source, outputDir } = options;
    const cwd = this.props.workingDirectory ?? source;
    const [prog, ...args] = this.props.command;
    const proc = spawnSync(prog, args, {
      cwd,
      encoding: "utf-8",
      env: {
        ...process.env,
        ...this.props.environment,
        ASSET_INPUT_DIR: source,
        ASSET_OUTPUT_DIR: outputDir,
      },
    });
    if (proc.error) throw proc.error;
    if (proc.status !== 0) {
      throw new Error(
        `Host bundling exited with status ${proc.status} (${prog} ${args.join(" ")})\n` +
          `${proc.stdout ?? ""}${proc.stderr ?? ""}`,
      );
    }
    if (!existsSync(outputDir)) {
      throw new Error(`Bundling did not create the output directory ${outputDir}`);
    }
    // Upstream returns the *artifact* (file or directory); the interface
    // requires a directory, so a single-file artifact is returned as its parent
    // and recorded via meta.producesArchive in the scenario layer.
    const bundled = determineBundledAsset(outputDir, this.props.outputType);
    return statSync(bundled).isDirectory() ? bundled : outputDir;
  }
}

/** `BundlingOutput` for the `node_modules`-style multi-file output. */
export function notArchived(): BundlingOutput {
  return BundlingOutput.NOT_ARCHIVED;
}

export const adapter: Adapter = {
  meta: {
    id: "tcons-local",
    name: "TerraConstructs host (local) bundling",
    provenance:
      "TerraConstructs/base src/bundling.ts BundlingOptions + ILocalBundling host path",
    portedIn: "src/adapters/tc-local.ts",
    portNotes:
      "ILocalBundling.tryBundle(outputDir, options) -> boolean replaced by bundle({source, outputDir}); no 'decline to Docker' return value, so the try-local-then-Docker chain must be flattened by the caller (see tc-local-docker.ts). Upstream's single-file artifact (ARCHIVED/SINGLE_FILE) has no representation: the interface returns a directory.",
    producesArchive: false,
  },
  async probe() {
    const sh = spawnSync("sh", ["-c", "echo ok"], { encoding: "utf-8" });
    return {
      available: sh.stdout?.trim() === "ok",
      detail: `POSIX shell available: ${sh.stdout?.trim() === "ok"}`,
    };
  },
  create(fixture: Fixture): IAssetBundler {
    return new TerraConstructsLocalBundler({
      command: [
        "sh",
        "-c",
        // Stands in for `npm run build`: emits a small tree plus a large file so
        // hashing/scratch behaviour is observable.
        "mkdir -p \"$ASSET_OUTPUT_DIR/dist\" && cp -r \"$ASSET_INPUT_DIR/.\" \"$ASSET_OUTPUT_DIR/dist/\" && " +
          "printf 'built\\n' > \"$ASSET_OUTPUT_DIR/dist/BUILT\" && " +
          "printf 'COPYME' > \"$ASSET_OUTPUT_DIR/leftover.txt\"",
      ],
      environment: { ASSET_BUILD_ID: "harness" },
      outputType: BundlingOutput.NOT_ARCHIVED,
    });
  },
};

/**
 * Port of TerraConstructs/base NodejsFunction bundling onto `IAssetBundler`.
 *
 * Upstream: vendor/terraconstructs-base/src/aws/compute/function-nodejs/bundling.ts
 * (`Bundling implements ILocalBundling`), reached through
 * `Bundling.bundle()` -> `Code.fromAsset(projectRoot, { assetHashType: OUTPUT,
 * bundling: new Bundling(...) })`.
 *
 * Two upstream properties matter for the port:
 *   1. the esbuild invocation is `npx --no-install esbuild ... --bundle
 *      --platform=node --target=<target> --external:... --outfile=<bundleDir>/index.js`,
 *      i.e. a host process writing into the caller-provided bundle dir;
 *   2. the asset hash is a tree-hash of the *bundled output* (`assetHashType:
 *      OUTPUT`), which maps onto cdktn's `AssetHashType.OUTPUT` eager build.
 *
 * Deviation: the harness calls esbuild's JS API (same binary, same options)
 * instead of shelling out to `npx --no-install esbuild`, so the port does not
 * depend on a project-local esbuild install in the fixture.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import * as path from "node:path";
import { buildSync } from "esbuild";
import type { Adapter, Fixture } from "../types";
import type { IAssetBundler } from "../pr-head";

export interface NodejsBundlingProps {
  /** Upstream default: the esbuild `target` derived from the Lambda runtime. */
  readonly target?: string;
  readonly minify?: boolean;
  readonly sourcemap?: boolean;
  /** Modules left out of the bundle (upstream default `["aws-sdk"]`). */
  readonly externalModules?: string[];
  readonly define?: Record<string, string>;
}

export class TerraConstructsNodejsBundler implements IAssetBundler {
  public readonly bundlerKey: string;

  constructor(
    private readonly entry: string,
    private readonly props: NodejsBundlingProps = {},
  ) {
    this.bundlerKey = `tcons-nodejs::${createHash("sha256")
      .update(
        JSON.stringify({
          target: props.target ?? "node20",
          minify: props.minify ?? false,
          sourcemap: props.sourcemap ?? false,
          externalModules: props.externalModules ?? ["aws-sdk"],
        }),
      )
      .digest("hex")
      .slice(0, 16)}`;
  }

  public bundle(options: { source: string; outputDir: string }): string {
    const { source, outputDir } = options;
    mkdirSync(outputDir, { recursive: true });
    const entry = path.resolve(source, this.entry);
    if (!existsSync(entry)) {
      throw new Error(`NodejsFunction entry not found: ${entry}`);
    }
    buildSync({
      entryPoints: [entry],
      absWorkingDir: source,
      bundle: true,
      platform: "node",
      target: this.props.target ?? "node20",
      outfile: path.join(outputDir, "index.js"),
      external: this.props.externalModules ?? ["aws-sdk"],
      minify: this.props.minify ?? false,
      sourcemap: this.props.sourcemap ? "linked" : false,
      define: this.props.define,
      logLevel: "silent",
    });
    return outputDir;
  }
}

export const adapter: Adapter = {
  meta: {
    id: "tcons-nodejs",
    name: "TerraConstructs NodejsFunction bundling (esbuild)",
    provenance:
      "TerraConstructs/base src/aws/compute/function-nodejs/bundling.ts (esbuild + ILocalBundling host path)",
    portedIn: "src/adapters/tc-nodejs.ts",
    portNotes:
      "esbuild's single-file output fits `bundle(): string` (the returned directory holds index.js). Upstream's ZIP is produced later by TerraformAsset/archiveSync, which is outside the bundler contract — so a ported NodejsFunction must keep using AssetType.FILE + pre-zipped input instead of a bundler, or accept directory packaging.",
    producesArchive: false,
  },
  async probe() {
    try {
      buildSync({
        stdin: { contents: "export const ok = 1;", loader: "ts" },
        write: false,
        bundle: true,
        logLevel: "silent",
      });
      return { available: true, detail: "esbuild JS API usable" };
    } catch (error) {
      return { available: false, detail: `esbuild unusable: ${String(error)}` };
    }
  },
  create(fixture: Fixture): IAssetBundler {
    return new TerraConstructsNodejsBundler(fixture.entry, {
      target: "node20",
      externalModules: ["aws-sdk"],
      define: { "process.env.HARNESS": JSON.stringify("1") },
    });
  },
};

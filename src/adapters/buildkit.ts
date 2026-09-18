/**
 * Port of the TerraConstructs/base PR #165 idea onto a Node-side bundler.
 *
 * Upstream PR: https://github.com/TerraConstructs/base/pull/165 — "feat(aws):
 * BuildKit builder for Docker image assets" (branch feat/buildkit-docker-asset),
 * vendored at vendor/terraconstructs-base-tc165.
 *
 * IMPORTANT: PR #165 is entirely Terraform-provider side. It adds
 * `DockerAssetBuilder.BUILDKIT` to `AwsAssetManagerOptions`, a hand-written
 * `provider "buildkit"` binding (cruxstack/buildkit pinned 0.0.1) and a
 * `buildkit_image` resource, so image building/pushing happens at *apply* time
 * against a reachable buildkitd over gRPC, with no Docker Engine API involved.
 * It contains no Node/TypeScript bundling code.
 *
 * What *is* portable to `IAssetBundler` is the architectural idea the PR argues
 * for: talk to a buildkitd endpoint instead of the Docker daemon socket. This
 * adapter implements that Node-side equivalent: a `buildctl` client builds the
 * source tree with the Dockerfile frontend and writes the result to the
 * caller's `outputDir` via `--output type=local,dest=...`, which flows back
 * through the client session — no `docker.sock`, no Docker Engine API, and the
 * daemon can be embedded (same machine) or remote.
 *
 * Execution is gated in the runner (`--allow-buildkit`), both because it needs a
 * buildkitd endpoint and because bringing one up may require operator approval.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";
import type { Adapter, Fixture } from "../types";
import type { IAssetBundler } from "../pr-head";

export interface BuildkitBundlingProps {
  /** `buildctl` binary; defaults to `$PATH`. */
  readonly buildctl?: string;
  /** buildkitd endpoint, e.g. `tcp://127.0.0.1:1234` or `unix:///run/buildkit/buildkitd.sock`. */
  readonly address?: string;
  /** Dockerfile path, relative to the source tree. */
  readonly dockerfile?: string;
  /** Build args passed to the frontend. */
  readonly buildArgs?: Record<string, string>;
  /** Export target: a directory (`local`) or an OCI/docker tarball. */
  readonly output?: "local" | "docker";
  readonly platform?: string;
}

export class BuildkitBundler implements IAssetBundler {
  public readonly bundlerKey: string;

  constructor(private readonly props: BuildkitBundlingProps = {}) {
    this.bundlerKey = `buildkit::${props.address ?? "default"}::${props.dockerfile ?? "Dockerfile"}`;
  }

  public bundle(options: { source: string; outputDir: string }): string {
    const buildctl = this.props.buildctl ?? "buildctl";
    const dockerfile = this.props.dockerfile ?? "Dockerfile";
    const dockerfileDir = path.dirname(path.resolve(options.source, dockerfile));
    const args = ["build"];
    if (this.props.address) args.push("--addr", this.props.address);
    args.push(
      "--frontend",
      "dockerfile.v0",
      "--local",
      `context=${options.source}`,
      "--local",
      `dockerfile=${dockerfileDir}`,
      "--opt",
      `filename=${path.basename(dockerfile)}`,
    );
    for (const [key, value] of Object.entries(this.props.buildArgs ?? {})) {
      args.push("--opt", `build-arg:${key}=${value}`);
    }
    if (this.props.platform) args.push("--opt", `platform=${this.props.platform}`);
    args.push(
      "--output",
      `type=${this.props.output ?? "local"},dest=${options.outputDir}`,
    );

    const proc = spawnSync(buildctl, args, { encoding: "utf-8" });
    if (proc.error) throw proc.error;
    if (proc.status !== 0) {
      throw new Error(
        `buildctl exited with status ${proc.status}\n${proc.stdout ?? ""}${proc.stderr ?? ""}`,
      );
    }
    if (!existsSync(options.outputDir)) {
      throw new Error(`buildkit produced no output at ${options.outputDir}`);
    }
    return options.outputDir;
  }
}

export const adapter: Adapter = {
  meta: {
    id: "buildkit-local-output",
    name: "Buildkit endpoint bundling (PR #165 idea, Node-side port)",
    provenance:
      "TerraConstructs/base PR #165 (DockerAssetBuilder.BUILDKIT + buildkit_image provider) — architectural idea only; that PR is Terraform-provider side and ships no Node bundling code",
    portedIn: "src/adapters/buildkit.ts",
    portNotes:
      "Ports 'build against a buildkitd endpoint, not the Docker daemon socket' into a sync `bundle()` by shelling out to `buildctl` with `--output type=local,dest=<outputDir>`, which returns the artifact through the client session. Upstream's Terraform-resource half (buildkit_image, registry push, source_hash triggers) has no place in the bundler contract and stays out.",
    producesArchive: false,
    needsBuildkit: true,
  },
  async probe() {
    const buildctl = process.env.BUILDCTL ?? "buildctl";
    const which = spawnSync("sh", ["-c", `command -v ${buildctl}`], {
      encoding: "utf-8",
    });
    const address = process.env.BUILDKIT_ADDR ?? process.env.BUILDKIT_HOST;
    if (which.status !== 0) {
      return {
        available: false,
        detail: `buildctl not found (set BUILDCTL=/path/to/buildctl); BUILDKIT_ADDR=${address ?? "<unset>"}`,
      };
    }
    return {
      available: Boolean(address),
      detail: address
        ? `buildctl ${which.stdout.trim()} -> ${address}`
        : "buildctl present but BUILDKIT_ADDR/BUILDKIT_HOST is unset (no buildkitd endpoint to talk to)",
    };
  },
  create(_fixture: Fixture): IAssetBundler {
    return new BuildkitBundler({
      buildctl: process.env.BUILDCTL,
      address: process.env.BUILDKIT_ADDR ?? process.env.BUILDKIT_HOST,
      dockerfile: "Dockerfile.bundle",
      buildArgs: { HARNESS: "1" },
    });
  },
};

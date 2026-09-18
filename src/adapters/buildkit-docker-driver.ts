/**
 * Buildkit through the Docker daemon's embedded BuildKit (buildx `docker` driver).
 *
 * Why this variant exists: PR #165 wants builds that do not go through Docker
 * daemon socket access at all. The opposite extreme is the stock daemon, which in
 * Docker 23+ embeds BuildKit (`docker buildx ls` shows the `default` builder with
 * DRIVER=docker, BUILDKIT v0.30.0 here). Builders then reach it through the Engine
 * API rather than a buildkitd gRPC endpoint, so `buildctl --addr …` is not the
 * client — `docker buildx build` is:
 *
 *   docker buildx build --builder default \
 *     --file <source>/<dockerfile> --output type=local,dest=<outputDir> <source>
 *
 * The artifact is exported to the *client's* directory, which is what makes this
 * usable behind `bundle({ source, outputDir })`.
 *
 * Contrast with `buildkit-local-output` (buildctl + BUILDKIT_ADDR): same exporter,
 * different client, and this one cannot avoid the daemon socket unless the driver
 * is switched to `docker-container` or `remote` (see the harness report).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import * as path from "node:path";
import type { IAssetBundler } from "../pr-head";
import type { Adapter, Fixture } from "../types";

export interface BuildxDockerDaemonBundlerProps {
  /** buildx builder name; `default` is the daemon's embedded BuildKit. */
  readonly builder?: string;
  /** Dockerfile inside `source`; defaults to `Dockerfile.bundle`. */
  readonly dockerfile?: string;
  /** Build args passed through as `--build-arg`. */
  readonly buildArgs?: Record<string, string>;
  /** buildx binary; defaults to `docker` on PATH. */
  readonly docker?: string;
  readonly platform?: string;
}

export class BuildxDockerDaemonBundler implements IAssetBundler {
  public readonly bundlerKey: string;

  public constructor(private readonly props: BuildxDockerDaemonBundlerProps = {}) {
    const builder = props.builder ?? "default";
    const dockerfile = props.dockerfile ?? "Dockerfile.bundle";
    this.bundlerKey = `buildx-docker::${builder}::${dockerfile}`;
  }

  public bundle(options: { source: string; outputDir: string }): string {
    const docker = this.props.docker ?? "docker";
    const builder = this.props.builder ?? "default";
    const dockerfile = this.props.dockerfile ?? "Dockerfile.bundle";
    const source = path.resolve(options.source);
    if (!existsSync(path.join(source, dockerfile))) {
      throw new Error(`Dockerfile not found for this bundler: ${path.join(source, dockerfile)}`);
    }

    const args = [
      "buildx",
      "build",
      "--builder",
      builder,
      "--file",
      path.join(source, dockerfile),
      "--output",
      `type=local,dest=${options.outputDir}`,
    ];
    for (const [key, value] of Object.entries(this.props.buildArgs ?? {})) {
      args.push("--build-arg", `${key}=${value}`);
    }
    if (this.props.platform) args.push("--platform", this.props.platform);
    args.push(source);

    const proc = spawnSync(docker, args, { encoding: "utf-8" });
    if (proc.status !== 0) {
      throw new Error(
        `docker buildx exited with status ${proc.status}\n${proc.stdout ?? ""}${proc.stderr ?? ""}`,
      );
    }
    if (!existsSync(options.outputDir) || readdirSync(options.outputDir).length === 0) {
      throw new Error(`docker buildx produced no output in ${options.outputDir}`);
    }
    return options.outputDir;
  }
}

export const buildxDockerDaemonAdapter: Adapter = {
  meta: {
    id: "buildkit-docker-daemon",
    name: "buildkit via the Docker daemon (buildx docker driver)",
    provenance:
      "Docker 23+ embedded BuildKit as the endpoint (docker buildx ls -> default builder, DRIVER=docker); PR #165 contrast case",
    portedIn: "src/adapters/buildkit-docker-driver.ts",
    portNotes:
      "No buildkitd gRPC endpoint and no BUILDCTL: builds go through the Engine API to the daemon's embedded BuildKit. Builder name, driver, Dockerfile name, build args and platform cannot be expressed by BundleOptions, so they live on the adapter instance and reach identity only via the hand-written bundlerKey (no image/driver version in it, unlike TerraConstructs' config digests).",
    producesArchive: false,
    needsDocker: true,
  },
  async probe() {
    const version = spawnSync("sh", ["-c", "docker buildx version"], { encoding: "utf-8" });
    if (version.status !== 0) {
      return { available: false, detail: "docker buildx plugin not available" };
    }
    const builders = spawnSync("sh", ["-c", "docker buildx ls"], { encoding: "utf-8" });
    const output = `${builders.stdout ?? ""}`;
    const hasDockerDriver = /(^|\n)\S+\*?\s+docker\s/m.test(output) || output.includes("docker ");
    return {
      available: hasDockerDriver,
      detail: hasDockerDriver
        ? `${version.stdout.trim().split("\n")[0]}; default builder uses the daemon's embedded BuildKit`
        : "no builder with the docker driver (only container/remote builders)",
    };
  },
  create(_fixture: Fixture): IAssetBundler {
    return new BuildxDockerDaemonBundler({ builder: "default", dockerfile: "Dockerfile.bundle" });
  },
};

/**
 * The TerraConstructs bundling *chain*, flattened onto `IAssetBundler`.
 *
 * Upstream, host bundling is preferred and Docker is the fallback:
 *
 *   if (props.bundling.local?.tryBundle(bundleDir, props.bundling)) return bundleDir;
 *   // otherwise run the container
 *   new AssetBundlingBindMount(...).run();
 *
 * `ILocalBundling.tryBundle` returns a boolean precisely so that a local tool
 * that is unavailable (wrong version, missing binary) can decline and let the
 * Docker path take over. `IAssetBundler.bundle()` returns only a string, so the
 * port has to fold both attempts into one implementation and decide the policy
 * itself — here: try the host tool, and on any failure fall through to Docker.
 *
 * This is the clearest structural gap the harness found: no way for a bundler
 * to say "not me", and no way for the caller to compose two bundlers.
 */
import { spawnSync } from "node:child_process";
import type { Adapter, Fixture } from "../types";
import type { IAssetBundler } from "../pr-head";
import { TerraConstructsDockerBundler } from "./tc-docker";
import { TerraConstructsLocalBundler, BundlingOutput } from "./tc-local";

export class LocalThenDockerBundler implements IAssetBundler {
  public readonly bundlerKey: string;

  constructor(
    private readonly local: TerraConstructsLocalBundler,
    private readonly docker: TerraConstructsDockerBundler,
    private readonly attempts: { local: number; docker: number; localDeclines: number } = {
      local: 0,
      docker: 0,
      localDeclines: 0,
    },
  ) {
    this.bundlerKey = `tcons-chain::${local.bundlerKey}`;
  }

  public get stats() {
    return this.attempts;
  }

  public bundle(options: { source: string; outputDir: string }): string {
    this.attempts.local += 1;
    try {
      return this.local.bundle(options);
    } catch {
      // Upstream's `false` return becomes an exception here, and the fallback
      // decision moves inside the bundler instead of staying with the caller.
      this.attempts.localDeclines += 1;
      this.attempts.docker += 1;
      return this.docker.bundle(options);
    }
  }
}

/** Exposes the chain plus its call statistics to the runner. */
export const chainStats: { local: number; docker: number; localDeclines: number } = {
  local: 0,
  docker: 0,
  localDeclines: 0,
};

export const adapter: Adapter = {
  meta: {
    id: "tcons-local-docker-chain",
    name: "TerraConstructs local-or-Docker bundling chain",
    provenance:
      "TerraConstructs/base asset-staging.ts bundle(): ILocalBundling.tryBundle() -> AssetBundlingBindMount fallback",
    portedIn: "src/adapters/tc-local-docker.ts",
    portNotes:
      "The two-step local/Docker decision is flattened into a single bundle() call. Upstream's boolean 'decline' protocol and the caller-visible choice of transfer mode (BIND_MOUNT vs VOLUME_COPY) are not expressible through BundleOptions, so the port hard-codes the policy and swallows the local failure rather than reporting it.",
    needsDocker: true,
  },
  async probe() {
    const docker = spawnSync("sh", ["-c", "command -v docker"], { encoding: "utf-8" });
    return {
      available: docker.status === 0,
      detail:
        docker.status === 0
          ? `docker CLI: ${docker.stdout.trim()} (chain needs it for the fallback leg)`
          : "docker CLI not on PATH",
    };
  },
  create(fixture: Fixture): IAssetBundler {
    const local = new TerraConstructsLocalBundler({
      // Deliberately a command that does not exist, so the local leg always
      // declines and the Docker leg runs: that is the fallback path being
      // measured.
      command: ["harness-missing-compiler", "--build"],
      outputType: BundlingOutput.NOT_ARCHIVED,
    });
    const docker = new TerraConstructsDockerBundler({
      image: "alpine",
      command: [
        "sh",
        "-c",
        "mkdir -p /asset-output/dist && cp -r /asset-input/. /asset-output/dist/",
      ],
    });
    return new LocalThenDockerBundler(local, docker, chainStats);
  },
};

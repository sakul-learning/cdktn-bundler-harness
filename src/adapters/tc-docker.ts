/**
 * Port of TerraConstructs/base Docker bundling onto `IAssetBundler`.
 *
 * Upstream: vendor/terraconstructs-base/src/private/asset-staging.ts
 * (`AssetBundlingBase`, `AssetBundlingBindMount`, `AssetBundlingVolumeCopy`,
 * `dockerExec`) and `src/bundling.ts` (`DockerImage.fromRegistry(...).run()`,
 * `BundlingFileAccess`).
 *
 * Both upstream transfer modes are ported verbatim in argv shape:
 *   BIND_MOUNT  host source and output dirs are bind-mounted into the container
 *   VOLUME_COPY two named volumes plus an `alpine` helper container, with
 *               `docker cp` in and out of the output volume
 *
 * `IAssetBundler.bundle({source, outputDir})` carries no image, command,
 * volumes, user, network or security options, so all of that has to live on the
 * adapter instance instead of in the interface. That is why this port is a
 * class with configuration rather than a value the interface can describe.
 *
 * Execution is gated in the runner (`--allow-docker`): docker commands are only
 * issued when the operator opts in.
 */
import { randomBytes } from "node:crypto";
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import type { Adapter, Fixture } from "../types";
import type { IAssetBundler } from "../pr-head";

/** Ported from TerraConstructs `AssetStaging.BUNDLING_*_DIR`. */
export const BUNDLING_INPUT_DIR = "/asset-input";
export const BUNDLING_OUTPUT_DIR = "/asset-output";

export enum BundlingFileAccess {
  BIND_MOUNT = "BIND_MOUNT",
  VOLUME_COPY = "VOLUME_COPY",
}

export interface DockerBundlingProps {
  readonly image: string;
  readonly command: string[];
  readonly user?: string;
  readonly environment?: Record<string, string>;
  readonly entrypoint?: string[];
  readonly workingDirectory?: string;
  readonly network?: string;
  readonly platform?: string;
  readonly securityOpt?: string;
  readonly bundlingFileAccess?: BundlingFileAccess;
}

/** Ported from TerraConstructs `dockerExec`. */
export function dockerExec(
  args: string[],
  options?: SpawnSyncOptions,
  run: boolean = true,
): { status: number | null; stdout: string } {
  const prog = process.env.CDK_DOCKER ?? "docker";
  if (!run) {
    return { status: 0, stdout: "" };
  }
  const proc = spawnSync(prog, args, {
    encoding: "utf-8",
    ...(options ?? { stdio: ["ignore", "pipe", "inherit"] }),
    // Upstream inherits stdout/stderr; the harness keeps stdout so the
    // container id can be read for `docker cp`.
    stdio: options?.stdio ?? ["ignore", "pipe", "inherit"],
  });
  if (proc.error) throw proc.error;
  if (proc.status !== 0) {
    const reason =
      proc.signal != null ? `signal ${proc.signal}` : `status ${proc.status}`;
    throw new Error(
      `${prog} exited with ${reason}\n--> STDERR: ${proc.stderr}\n--> Command: ${prog} ${args.join(" ")}`,
    );
  }
  return { status: proc.status, stdout: String(proc.stdout ?? "") };
}

export class DockerImage {
  constructor(public readonly image: string) {}

  /** Ported from TerraConstructs `DockerImage.run()` (src/bundling.ts:458). */
  public run(options: {
    command?: string[];
    user?: string;
    environment?: Record<string, string>;
    entrypoint?: string[];
    workingDirectory?: string;
    volumes?: { hostPath: string; containerPath: string }[];
    volumesFrom?: string[];
    network?: string;
    platform?: string;
    securityOpt?: string;
  }): void {
    const args = ["run", "--rm"];
    if (options.securityOpt) args.push("--security-opt", options.securityOpt);
    if (options.user) args.push("-u", options.user);
    for (const [key, value] of Object.entries(options.environment ?? {})) {
      args.push("-e", `${key}=${value}`);
    }
    if (options.workingDirectory) args.push("-w", options.workingDirectory);
    if (options.entrypoint) args.push("--entrypoint", options.entrypoint.join(" "));
    for (const volume of options.volumes ?? []) {
      args.push("-v", `${volume.hostPath}:${volume.containerPath}`);
    }
    for (const from of options.volumesFrom ?? []) {
      args.push("--volumes-from", from);
    }
    if (options.network) args.push("--network", options.network);
    if (options.platform) args.push("--platform", options.platform);
    args.push(this.image);
    args.push(...(options.command ?? []));
    dockerExec(args);
  }
}

function determineUser(explicit?: string): string {
  if (explicit) return explicit;
  const uid = process.getuid?.() ?? 1000;
  const gid = process.getgid?.() ?? 1000;
  return `${uid}:${gid}`;
}

export class TerraConstructsDockerBundler implements IAssetBundler {
  public readonly bundlerKey: string;

  constructor(private readonly props: DockerBundlingProps) {
    this.bundlerKey = `tcons-docker::${props.image}::${props.command.join(" ")}` +
      (props.bundlingFileAccess ? `::${props.bundlingFileAccess}` : "");
  }

  public bundle(options: { source: string; outputDir: string }): string {
    const access = this.props.bundlingFileAccess ?? BundlingFileAccess.BIND_MOUNT;
    if (access === BundlingFileAccess.VOLUME_COPY) {
      this.volumeCopy(options.source, options.outputDir);
    } else {
      this.bindMount(options.source, options.outputDir);
    }
    return options.outputDir;
  }

  /** Ported from `AssetBundlingBindMount.run()`. */
  private bindMount(source: string, bundleDir: string): void {
    new DockerImage(this.props.image).run({
      command: this.props.command,
      user: determineUser(this.props.user),
      environment: this.props.environment,
      entrypoint: this.props.entrypoint,
      workingDirectory: this.props.workingDirectory ?? BUNDLING_INPUT_DIR,
      volumes: [
        { hostPath: source, containerPath: BUNDLING_INPUT_DIR },
        { hostPath: bundleDir, containerPath: BUNDLING_OUTPUT_DIR },
      ],
      network: this.props.network,
      platform: this.props.platform,
      securityOpt: this.props.securityOpt,
    });
  }

  /** Ported from `AssetBundlingVolumeCopy.run()`. */
  private volumeCopy(source: string, bundleDir: string): void {
    const copySuffix = randomBytes(12).toString("hex");
    const inputVolumeName = `assetInput${copySuffix}`;
    const outputVolumeName = `assetOutput${copySuffix}`;
    const copyContainerName = `copyContainer${copySuffix}`;
    const user = determineUser(this.props.user);

    dockerExec(["volume", "create", inputVolumeName]);
    dockerExec(["volume", "create", outputVolumeName]);
    dockerExec([
      "run",
      "--name",
      copyContainerName,
      "-v",
      `${inputVolumeName}:${BUNDLING_INPUT_DIR}`,
      "-v",
      `${outputVolumeName}:${BUNDLING_OUTPUT_DIR}`,
      "public.ecr.aws/docker/library/alpine",
      "sh",
      "-c",
      `mkdir -p ${BUNDLING_INPUT_DIR} && chown -R ${user} ${BUNDLING_OUTPUT_DIR} && chown -R ${user} ${BUNDLING_INPUT_DIR}`,
    ]);
    dockerExec(["cp", `${source}/.`, `${copyContainerName}:${BUNDLING_INPUT_DIR}`]);

    new DockerImage(this.props.image).run({
      command: this.props.command,
      user,
      environment: this.props.environment,
      entrypoint: this.props.entrypoint,
      workingDirectory: this.props.workingDirectory ?? BUNDLING_INPUT_DIR,
      volumes: [],
      volumesFrom: [copyContainerName],
      network: this.props.network,
      platform: this.props.platform,
      securityOpt: this.props.securityOpt,
    });

    dockerExec([
      "cp",
      `${copyContainerName}:${BUNDLING_OUTPUT_DIR}/.`,
      bundleDir,
    ]);
    // Upstream does not wrap this sequence in try/finally: a failure in the
    // build step leaves the helper container and both volumes behind. The port
    // keeps that behaviour so the harness can measure it, and the scenario
    // layer reports the leftovers.
    dockerExec(["rm", copyContainerName]);
    dockerExec(["volume", "rm", inputVolumeName]);
    dockerExec(["volume", "rm", outputVolumeName]);
  }
}

function dockerAdapter(
  id: string,
  access: BundlingFileAccess,
): Adapter {
  return {
    meta: {
      id,
      name: `TerraConstructs Docker bundling (${access})`,
      provenance:
        "TerraConstructs/base src/private/asset-staging.ts AssetBundlingBindMount/AssetBundlingVolumeCopy + src/bundling.ts DockerImage",
      portedIn: "src/adapters/tc-docker.ts",
      portNotes:
        "Image, command, user, environment, volumes, network and security options cannot be expressed by BundleOptions, so they stay on the adapter instance. The upstream ILocalBundling->Docker fallback disappears; VOLUME_COPY cleans up after the build only, so a failed build strands a container and two volumes (kept faithful to upstream).",
      producesArchive: false,
      needsDocker: true,
    },
    async probe() {
      const which = spawnSync("sh", ["-c", "command -v docker"], {
        encoding: "utf-8",
      });
      return {
        available: which.status === 0,
        detail:
          which.status === 0
            ? `docker CLI: ${which.stdout.trim()}`
            : "docker CLI not on PATH",
      };
    },
    create(_fixture: Fixture): IAssetBundler {
      return new TerraConstructsDockerBundler({
        image: "alpine",
        command: [
          "sh",
          "-c",
          `mkdir -p ${BUNDLING_OUTPUT_DIR}/dist && cp -r ${BUNDLING_INPUT_DIR}/. ${BUNDLING_OUTPUT_DIR}/dist/ && printf 'built-in-container\\n' > ${BUNDLING_OUTPUT_DIR}/dist/BUILT`,
        ],
        bundlingFileAccess: access,
      });
    },
  };
}

export const bindMountAdapter = dockerAdapter("tcons-docker-bind", BundlingFileAccess.BIND_MOUNT);
export const volumeCopyAdapter = dockerAdapter("tcons-docker-volume", BundlingFileAccess.VOLUME_COPY);

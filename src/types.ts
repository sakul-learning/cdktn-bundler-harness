import type { IAssetBundler } from "./pr-head";

/** A source application the bundlers build. */
export interface Fixture {
  /** Absolute path to the source tree handed to the bundler as `source`. */
  readonly root: string;
  /** Entry file, relative to root. */
  readonly entry: string;
  /** Files written into root, relative path -> contents. */
  readonly files: Record<string, string>;
}

export interface AdapterMeta {
  readonly id: string;
  /** Human name of the ported implementation. */
  readonly name: string;
  /** Upstream source of the implementation that was ported. */
  readonly provenance: string;
  /** Where the ported code lives in this repo. */
  readonly portedIn: string;
  /** What the port had to change to satisfy `IAssetBundler`. */
  readonly portNotes: string;
  /** True when the native implementation's artifact is a single archive file. */
  readonly producesArchive?: boolean;
  /** Runner gate: adapter needs a container runtime. */
  readonly needsDocker?: boolean;
  /** Runner gate: adapter needs a buildkitd endpoint. */
  readonly needsBuildkit?: boolean;
}

export interface ProbeResult {
  readonly available: boolean;
  readonly detail: string;
}

export interface Adapter {
  readonly meta: AdapterMeta;
  /** Cheap environment check, run before the adapter's scenarios. */
  probe(): Promise<ProbeResult>;
  /** Build the `IAssetBundler` handed to cdktn. */
  create(fixture: Fixture): IAssetBundler;
}

export interface ScenarioResult {
  readonly scenario: string;
  readonly adapter: string;
  /** "pass" when the scenario ran and its assertion held; "fail" otherwise. */
  readonly status: "pass" | "fail" | "skipped";
  /** Machine-readable observations. */
  readonly observations: Record<string, unknown>;
  readonly error?: string;
}

export interface HarnessReport {
  readonly generatedAt: string;
  readonly prHeadSha: string;
  readonly cdktnLib: string;
  readonly environment: Record<string, string>;
  readonly results: ScenarioResult[];
}

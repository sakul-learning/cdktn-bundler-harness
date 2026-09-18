# cdktn asset-bundler harness

A test harness that ports **known, real-world bundler implementations** onto the
`IAssetBundler` extension interface proposed by
[open-constructs/cdk-terrain PR #442](https://github.com/open-constructs/cdk-terrain/pull/442)
(`feat(lib): add asset bundling extension interface`), and reports what each port
had to bend, drop, or work around.

The harness is deliberately **not** a fork and **not** a test suite for #442's own
unit tests. It answers one question: *if the bundlers that already exist in the
wild were moved onto this interface, what would they look like and what breaks?*

## What is ported

| # | Adapter id | Ported from | Kind |
| - | ---------- | ----------- | ---- |
| 1 | `tcons-local` | TerraConstructs/base `src/bundling.ts` + `src/asset-staging.ts` — host ("local") bundling, `BundlingOptions`, `BundlingOutput` | host process |
| 2 | `tcons-nodejs` | TerraConstructs/base `src/aws/compute/function-nodejs/bundling.ts` — esbuild-based `NodejsFunction` bundling | host process |
| 3 | `tcons-local-docker-chain` | TerraConstructs/base `AssetStaging` bundling chain: `ILocalBundling.tryBundle()` then Docker fallback | host → container |
| 4 | `tcons-docker-bind` | TerraConstructs/base `AssetBundlingBindMount` + `DockerImage.run()` | container (bind mount) |
| 5 | `tcons-docker-volume` | TerraConstructs/base `AssetBundlingVolumeCopy` + helper container + `docker cp` | container (volume copy) |
| 6 | `buildkit-local-output` | TerraConstructs/base **PR #165** ("BuildKit builder for Docker image assets") — the *idea*: build against a buildkitd endpoint instead of the Docker daemon socket | buildkit endpoint |
| 7 | `rolldown-dir` | open-constructs/cdk-terrain **PR #402** `@cdktn/bundler-nodejs` (`NodejsBundler` + `runner.mjs`) — directory output | native bundler (Rolldown) |
| 8 | `rolldown-zip` | same as #7 but keeping upstream's deterministic `archive.zip` behaviour | native bundler (Rolldown) |

Sources are vendored under `vendor/` with an `INVENTORY.md` per upstream
(`vendor/terraconstructs-base/INVENTORY.md`, `vendor/rolldown/INVENTORY.md`);
`vendor/terraconstructs-base-tc165/` is a worktree at TerraConstructs PR #165's
head.

Two notes on faithfulness, because they matter for reading the results:

- **TerraConstructs copied the AWS CDK staging pipeline byte-for-byte (v2.186.0),
  including its hashing**: for a bundled asset the identity is
  `sha256(fingerprint(source) ++ JSON.stringify(bundlingConfig))`, not a tree hash
  of the produced artifact. Only `OUTPUT`/`BUNDLE` tree-hash the built bytes. Any
  port therefore inherits a config-in-identity model that cdktn expresses only as
  the opaque `bundlerKey` string.
- **TerraConstructs PR #165 is Terraform-provider side, not Node side.** It adds
  `DockerAssetBuilder.BUILDKIT`, a `provider "buildkit"` binding
  (`cruxstack/buildkit` pinned `0.0.1`) and a `buildkit_image` resource, so image
  builds/pushes happen at apply time over gRPC with no Docker Engine API and no
  `docker.sock`. It contains **no Node/TypeScript bundling code**. Adapter #6 is
  therefore a port of the *architecture* (buildkitd endpoint, artifact returned
  through the client session with `--output type=local,dest=<outputDir>`), not of
  upstream code.

## How it binds to the PR

`src/pr-head.ts` requires the jsii output of the review worktree directly
(`…/pr-442/packages/cdktn/lib/index.js`) and re-exports it. `tsconfig.json` maps
the bare specifier `cdktn` to that build's `index.d.ts`, so every adapter is
type-checked against the real PR-head declarations.

Targeting another revision:

```bash
export CDKTN_PR_LIB=/path/to/packages/cdktn/lib/index.js
```

The build must exist:

```bash
cd /data/repos/hermes-pr-reviewer/worktrees/cdk-terrain/open-constructs__cdk-terrain/pr-442
pnpm exec nx build cdktn --skip-nx-cache
```

## Running

```bash
npm install
npm run harness                      # host-only adapters (1, 2, 7, 8)
npm run harness -- --allow-docker    # + adapters 3, 4, 5 (needs a docker CLI)
npm run harness:all                  # + adapter 6 (needs BUILDCTL + BUILDKIT_ADDR)
npm run harness:docker               # the three Docker adapters, merged into results.json
npm run probe:lifecycle              # standalone scratch-cleanup probe (normal exit vs SIGINT/SIGTERM)
npm run typecheck
```

Narrow a run:

```bash
npm run harness -- --adapter=rolldown-dir --scenario=repeat/stage-twice
```

`--merge` keeps results for adapters you did not re-run, so a full picture can be built
from several bounded runs (the Docker adapters are run one at a time because each build
is a real container invocation):

```bash
npm run harness -- --allow-docker --adapter=tcons-docker-bind --merge
```

Outputs: `results.json` (machine readable) and `REPORT.md` (matrix + per-scenario
observations). Both are generated; re-run to refresh. **`FINDINGS.md`** is the written
analysis (what ported cleanly, what the interface cannot express, with the evidence).

Environment variables for the gated adapters:

| Variable | Used by | Meaning |
| -------- | ------- | ------- |
| `CDK_DOCKER` | `tcons-docker-*`, chain | docker binary (default `docker`), matching TerraConstructs |
| `BUILDCTL` | `buildkit-local-output` | path to `buildctl` |
| `BUILDKIT_ADDR` / `BUILDKIT_HOST` | `buildkit-local-output` | buildkitd endpoint, e.g. `tcp://127.0.0.1:1234` |

Docker and buildkit adapters are gated behind flags so a normal run has no
container side effects.

## Scenarios

Each adapter is exercised through the cdktn API as an `IAssetBundler`, not called
directly:

| Scenario | Question |
| -------- | -------- |
| `stage/source-hash` | With `AssetHashType.SOURCE`, is the build deferred to `stage()`, and what lands in the staged artifact? |
| `stage/output-hash` | With `AssetHashType.OUTPUT`, does the eager build happen, and does identity track the built artifact? |
| `stage/zip-packaging` | Can a bundler feed `AssetPackaging.ZIP`? |
| `asset/file-type-bundler` | `TerraformAsset` + `AssetType.FILE` + bundler — rejected, and does the error explain why for a zip-producing bundler? |
| `repeat/stage-twice` | Second `stage()` on one asset: rebuild? different bytes under one `assetHash`? |
| `repeat/synth-twice` | Two `app.synth()` passes: is the emitted asset stable? |
| `failure/bundler-throws` | Is a mid-build failure reported, and is scratch cleaned up? |
| `identity/excluded-input-changes` | Does `exclude` hide excluded inputs from a bundler, and what happens to identity when an excluded file changes? |
| `determinism/two-fresh-builds` | Is the bundler's artifact reproducible across processes? |
| `identity/bundler-key` | Does `bundlerKey` move identity the way TerraConstructs' config-in-hash would? |
| `large-output/never-staged` | An eager build that is never staged: how much scratch is left behind? |

## Repo layout

```
src/pr-head.ts          binding to the PR-head cdktn build
src/types.ts            Adapter / Fixture / result types
src/scenarios.ts        the scenario catalogue (cdktn-driven)
src/run.ts              runner -> results.json + REPORT.md
src/adapters/           one file per ported bundler (+ shared runner for Rolldown)
vendor/                 upstream sources + INVENTORY.md per upstream
```

# Implementation DX report — building bundlers against `IAssetBundler` (cdktn PR #442)

Target: cdktn PR #442 head `98b39e49f6dd6bb5cc94ca30302d5928e7c836bb`. Interface under
test:

```ts
export interface IAssetBundler {
  readonly bundlerKey?: string;
  bundle(options: BundleOptions): string;   // returns a directory
}
export interface BundleOptions {
  readonly source: string;     // documented absolute
  readonly outputDir: string;  // scratch dir owned by cdktn
}
```

Method: nine bundler implementations that **exist in the wild** were ported onto that
interface and executed — all of them, against real toolchains (host tools, a real Docker
daemon, a real buildkitd). `results.json` + `REPORT.md` hold the raw matrix; `FINDINGS.md`
holds the behaviour analysis; `repro/` holds the reviewer's standalone probes.

| # | adapter | upstream implementation | result |
| --- | --- | --- | --- |
| 1 | `tcons-local` | TerraConstructs/base `BundlingOptions` host bundling | 12/12 |
| 2 | `tcons-nodejs` | TerraConstructs `function-nodejs` esbuild bundling | 12/12 |
| 3 | `tcons-docker-bind` | TerraConstructs `AssetBundlingBindMount` | 12/12 |
| 4 | `tcons-docker-volume` | TerraConstructs `AssetBundlingVolumeCopy` | 12/12 |
| 5 | `tcons-local-docker-chain` | TerraConstructs `local.tryBundle() ?? docker` chain | 12/12 |
| 6 | `buildkit-local-output` | TerraConstructs PR #165 buildkit idea (client-session export) | 12/12 |
| 7 | `buildkit-docker-daemon` | stock daemon's embedded BuildKit via `buildx` docker driver | 12/12 |
| 8 | `rolldown-dir` | cdk-terrain PR #402 `NodejsBundler` | 12/12 |
| 9 | `rolldown-zip` | cdk-terrain PR #402 (deterministic `archive.zip`) | 12/12 |

108/108 scenarios pass. Everything below is therefore *not* an "it doesn't work" list —
it is a list of places where a real implementation needed a workaround, or lost a
capability, or produced a result the interface cannot describe.

## 1. Capabilities that could not be expressed (only worked around)

### 1.1 An archive as the bundle result

**Known implementations:** TerraConstructs `BundlingOutput.ARCHIVED` / `SINGLE_FILE` (a
tar/zip is the artifact, sometimes "auto-discovered" as the only file in the output dir);
cdk-terrain PR #402, whose whole design is a deterministic `archive.zip` with
`assetHash = sha256(zip)`.

**What the interface gives you:** `bundle()` returns a *directory*, and `AssetType.FILE`
plus a bundler is rejected at construction:

```text
TerraConstructsDockerBundler/bind -> TerraformAsset Staging was configured with a
'bundler' and file packaging (AssetType.FILE). A bundler produces a directory of output,
which cannot be staged as a single file.
```

**Workaround used:** return the directory *containing* the archive. That is not equivalent:
the identity now hashes a wrapper directory (`AssetHashType.OUTPUT` → hash of
`{"archive.zip": …}` rather than of the zip), and if the caller also asks for
`AssetPackaging.ZIP` the result is a zip whose single entry is `archive.zip`
(`doubleArchived: "archive.zip"` in `results.json` for `rolldown-zip`).

**Cost:** PR #402's hash deliberately equals the zip's sha256 so the artifact can be
compared against an S3-published archive or a Lambda package. Through `IAssetBundler` that
property is lost. **Suggestion:** let `bundle()` declare its artifact shape (a
`producesArchive`/`outputType` member, or allow the packaging to consume a file), so the
FILE case stops being a hard reject.

### 1.2 Build configuration (the bundler's entire surface)

**Known implementations:** TerraConstructs `BundlingOptions` carries `image`, `command`,
`entrypoint`, `environment`, `user`, `workingDirectory`, `volumes`, `network`,
`securityOpt`, `bundlingFileAccess`, `outputType`, `local`, plus `DockerImage`
(`fromRegistry`/`fromBuild`, `dockerBuildOptions`); PR #402 carries `handler`, `target`,
`format`, `minify`, `sourcemap`, `externalModules`, `esbuildVersion`.

**What the interface gives you:** `BundleOptions` has `source` and `outputDir`. Nothing
else — and `bundlerKey` is the only channel for identity.

**Workaround used:** all options live on the adapter instance, and each adapter
hand-writes a `bundlerKey` string; e.g. the Docker adapters produce
`tcons-docker::alpine::sh -c mkdir -p /asset-output/dist …::BIND_MOUNT`. TerraConstructs
instead hashes `JSON.stringify(bundlingConfig)` into the asset identity
(`sha256(fingerprint(source) ++ config)`), which is why a config change *cannot* be
forgotten there. Here it can: an adapter author who forgets `bundlerKey` silently ships
stale assets when only the options change (my `rolldown-dir`/`rolldown-zip`/`tcons-nodejs`
ports all had to remember it).

**Cost:** hand-rolled identity per adapter, no shared convention, no image digest in the
key (rebuilding `alpine:latest` does not move the hash). **Suggestion:** state a
requirement in the `bundlerKey` docs ("serialise every option that can change the output,
including image/digest and tool version"), or provide a helper
(`bundlerKeyFor(config)`) that adapters can use.

### 1.3 "Try local, else Docker" — the decline protocol

**Known implementation:** TerraConstructs/AWS CDK
`if (props.bundling.local?.tryBundle(dir)) return; else docker…`. `tryBundle` returns a
**boolean** so a host tool can decline (esbuild missing, wrong platform, `--no-install`),
and the chain falls back to Docker automatically.

**What the interface gives you:** `bundle()` returns a string; a throw is the only failure
signal, and the caller sees only an error.

**Workaround used:** `tcons-local-docker-chain` flattens both legs into one
implementation and swallows the local failure internally. Capabilities lost by the caller:
choosing between host/Docker, preferring local for speed, and (for real users) the ability
to compose a third-party local bundler with a third-party Docker bundler — the two cannot
be layered, they must be re-implemented together. The chain's identity loses the leg
information as well (`tcons-chain::tcons-local::c900e62f514cdd9f`, no Docker leg in the
key).

**Suggestion:** either a `local?: IAssetBundler` style fallback on the staging side, or a
documented sentinel/`Error` subclass meaning "declined, fall back" — anything better than
"throw and hope the caller retries".

### 1.4 `exclude` for bundler inputs

Docs (`src/asset-staging.ts`): *"`exclude` filters the source a bundler reads, not the
artifact it produces."* **What the interface gives you:** only the raw `source` path.

**Workaround used:** nothing general. Entry-graph bundlers (esbuild, Rolldown) never open
the excluded file, so they look correct by accident; copy-everything bundlers
(`tcons-local`, all three Docker ports) cannot see the option at all and ship it. Measured:
`excludedFileShippedInArtifact=true`, `artifactChanged=true`, `hashUnchanged` — one
identity, two contents. Repro: `repro/pr-head-98b39e49/pr442-exclude.js` (see also
`FINDINGS.md` §"exclude is not communicated", review issue #10).

**Suggestion:** either hand the bundler a filtered view (a materialised input dir, as
TerraConstructs'/CDK's `BUNDLING_INPUT_DIR` allows) or drop the claim from the docs.

## 2. Awkward but workable (adapters carry the cost)

| DX issue | Symptom measured | Adapter workaround | Review ref |
| --- | --- | --- | --- |
| `source` documented absolute, delivered relative when the config path is relative | `bundlerSawAbsolute=false`; a bundler that spawns a tool with its own cwd (docker `-w`, esbuild, gradle) resolves elsewhere | adapters must `path.resolve` and hope the caller did not rely on relative semantics | #12 |
| Second `stage()`/`synth()` rebuilds after the eager build consumed the artifact | `rebuiltOnSecondStage=true`, `rebuiltOnSecondSynth=true`; with a non-reproducible bundler `sameIdentityDifferentBytes=true` for **all nine** adapters | none available to the bundler — it cannot know it is being called twice; only cdktn can retain the artifact or reject reuse | #11 |
| Scratch lifecycle owned by cdktn only | failed build leaves the scratch in-process (`scratchDirsLeftInProcess=1`, 8.1 MB in the never-staged case) and signals strand it entirely (SIGINT/SIGTERM: `scratchSurvived=true`) | bundlers cannot clean up: they are handed `outputDir` but not its lifetime | #13 |
| Diagnostics name the wrong thing | `TerraformAsset Staging was configured with a 'bundler' and file packaging (AssetType.FILE)` fires for an `AssetStaging` caller with custom packaging, and names the internal child id `Staging`; an out-of-range `AssetType` with a file source now reports the path/type mismatch instead of `Asset type is not implemented` | none — the messages are produced inside cdktn | #14 |
| `bundle()`'s return value is not validated | a file-returning bundler silently bypasses the "always a directory" contract | every adapter had to be written defensively; the harness asserts the shape itself | #17 |
| `acceptsDirectorySource` is a required interface member | out-of-tree `IAssetPackaging` implementers break at compile time; `assets-types.test.ts` asserts nothing about it | adapters implement it by hand; the flag does not describe *archive* sources, only directory-reading ones | #15 |
| Identity via an opaque string | no way to express "this bundler is not reproducible" or "options changed" other than the author's own serialisation | adapters serialise config into `bundlerKey` | — |

## 3. What ported cleanly (no workaround needed)

- **Deferred vs eager build.** `SOURCE` hashing builds exactly once inside `stage()`;
  `OUTPUT` builds in the constructor and the staged tree is byte-identical to the hashed
  artifact (`stagingMatchesArtifact=true`) — for host tools, Docker containers and
  buildkit clients alike. The contract is honest and uniform.
- **`stage(targetPath)` semantics** — a directory target for `DIRECTORY`/`ZIP` bundlers
  and a file target (`archive.zip`) for `ZIP` packaging; all nine adapters produced the
  layout `TerraformAsset` expects (`stacks/<stack>/assets/file/<HASH>/…`).
- **`AssetPackaging.ZIP` with a bundler** is the one path that gives an archive-producing
  bundler a first-class result (`acceptsDirectorySource=true`,
  `omitsDirectoryEntries=true`) — it just has to be *the* supported path rather than a
  fallback.
- **`bundlerKey` identity mechanics** work exactly as documented: changing the key moves
  `assetHash` (`identityFollowsBundlerKey=true`).
- **Determinism detection.** All nine ports are byte-reproducible across two fresh builds,
  so the harness can separate "rebuild churn" (harmless) from "identity drift" (not) —
  the distinction the review needed to state issue #11 precisely.

## 4. Buildkit: can the Docker daemon be the endpoint?

Verified on this host (Docker 29.5.3, buildx v0.34.1):

- **Yes — through the Engine API, not through `buildctl`.** `docker buildx ls` reports the
  `default` builder as `DRIVER=docker`, `BUILDKIT v0.30.0`: the daemon embeds BuildKit, and
  builds run there. This is what adapter 7 (`buildkit-docker-daemon`) uses:
  `docker buildx build --builder default --file <source>/Dockerfile.bundle --output type=local,dest=<outputDir> <source>`
  → 12/12 scenarios pass, artifact exported into the client directory.
- **`buildctl` cannot talk to the daemon.** It needs a buildkitd **gRPC** address;
  `buildctl --addr unix:///run/docker/buildkitd.sock debug workers` fails with
  `connect: permission denied` (the daemon's socket lives under root-only `/run/docker`),
  and the Engine API is not the BuildKit gRPC API.
- **How buildx uses the daemon** — three drivers, and the choice decides how much of the
  daemon socket the build depends on:
  - `docker` (default): the daemon's embedded BuildKit does the work; image store is the
    daemon's. Least setup, maximum daemon dependency — the opposite of PR #165's goal.
  - `docker-container`: buildx starts a **buildkitd container** and talks gRPC to it
    (still launched through the daemon, but the build itself is buildkitd's).
  - `remote`: buildx talks gRPC to an **existing buildkitd**, containerised or not —
    verified here with `docker buildx create --driver remote tcp://127.0.0.1:1234`, which
    made the builder report `BUILDKIT v0.33.0` from the harness's containerised buildkitd
    and complete the same build. This driver is the buildx equivalent of `buildctl`.
- Therefore PR #165's "rootless, no daemon-socket builds" is reachable in the Node layer by
  pointing at a buildkitd endpoint (adapter 6, `buildctl` + `BUILDKIT_ADDR`, 12/12 pass) —
  and **not** by reusing the stock daemon, which only ever gives you the Engine API.
  `buildkitd` was obtained with the mise github backend
  (`github:moby/buildkit[asset_pattern=buildkit-v*.linux-amd64.tar.gz]`, 0.33.0); Ubuntu
  24.04 has no `buildkit` package.

## 5. Ranked suggestions

1. Decide what an archive-producing bundler returns (`producesArchive`/`outputType`, or
   allow a file result) — otherwise #402-style bundlers lose their identity semantics
   (issues #11/#17 territory).
2. Make `exclude` honest: filter the input the bundler sees, or delete the doc claim (#10).
3. Define `stage()` reuse: retain the eager artifact, or document + assert single-use
   (`#11`), and validate `bundle()`'s return (#17).
4. Give the fallback chain a voice: a decline/`local` protocol so third-party local and
   Docker bundlers can be composed instead of re-implemented.
5. Document `bundlerKey` as "serialise everything that can change the output, including
   image digest and tool version", and consider a helper.
6. Guarantee `BundleOptions.source` is absolute (or fix the docs).
7. Keep scratch lifecycle inside cdktn, but say what happens on failure and on signals
   (#13), and fix the guard messages to name the caller's construct (#14).

## 6. Caveats

- One host: Linux x64, Node 24.18.1, Docker 29.5.3, buildkitd v0.33.0, esbuild 0.25.12,
  Rolldown 1.2.7. Windows/macOS behaviour (path separators, `DockerImage` user mapping,
  BIND_MOUNT semantics) is untested.
- `tcons-*` adapters are ports of the real code paths, not the upstream packages
  themselves; where upstream behaviour was deliberately not reproduced (e.g. VOLUME_COPY
  cleanup on a failed build), the adapter says so in `meta.portNotes`.
- The buildkit endpoint ran with `--privileged` in a container. A rootless systemd
  `buildkitd` or `buildx remote` to an external builder are equally valid endpoints and
  were not exercised.

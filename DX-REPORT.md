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

**Identity, by design, is declared intent — not bytes on disk.** `assetHash` is
`md5(hashSource ⊕ extraHash ⊕ bundlerKey ⊕ salt)`, where `hashSource` fingerprints the
**filtered** source tree (`this.ignoreStrategy.ignores(...)`), and `AssetHashType.OUTPUT`
with a bundler builds eagerly and folds `hashOutput` of the staged artifact instead,
forgoing skippability (#380). A bundler's build configuration therefore belongs in
`bundlerKey`, and changing it *should* move the hash. Nothing in this report disputes that
model: the findings are about the places where the interface lets its premise — *same
declared intent ⇒ same output* — be falsified (an incomplete `bundlerKey`, an `exclude`
list that reaches the identity but not the bundler, a bundler that is not deterministic),
plus one artifact shape the model cannot describe at all.

**Workaround used:** return the directory *containing* the archive, and/or let the caller
ask for `AssetPackaging.ZIP`. Neither is the same shape as "stage this file": with `ZIP`
packaging the result is a zip whose single entry is `archive.zip`
(`doubleArchived: "archive.zip"` in `results.json` for `rolldown-zip`).

**Cost:** PR #402 deliberately computes one SHA-256 over the exact ZIP bytes and exposes
that digest in two encodings for two consumers: hexadecimal `assetHash` names/stages the
immutable artifact, while base64 `sourceCodeHash` is passed directly to Terraform AWS
Lambda's `source_code_hash`. That gives the publisher/resource layer an artifact-level
change detector and a direct integrity check: the value sent to Lambda is provably the
digest of the file being deployed. A content-addressed S3 publisher could likewise use the
hex digest as its object key and skip an upload when that object already exists, although
PR #402 itself implements direct Lambda upload, not an S3 publisher.

cdktn's normal source+`bundlerKey` identity still detects changes correctly for a
deterministic build and is intentionally more skippable: it can decide that nothing
changed without rebuilding the ZIP. It just is not, by itself, proof that a remote object's
bytes equal the local archive; a publisher needing that property must also hash the output.
The residual interface friction here is therefore primarily **shape, not identity**:
`AssetType.FILE` + bundler is a hard reject, so `SINGLE_FILE`/`ARCHIVED` bundlers need
`ZIP` packaging or a wrapper directory. **Suggestion:** let `bundle()` declare its artifact
shape (a `producesArchive`/`outputType` member, or allow the packaging to consume a file),
so the FILE case stops being a hard reject — without touching the identity model.

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

**Cost:** the model is fine, the channel is thin. `bundlerKey` is (a) *the only* way to get
configuration into the identity, (b) optional, and (c) unvalidated — so the DX burden is
"remember to serialise everything", and the failure mode of forgetting is silent reuse of
stale artifacts rather than an error. Two further consequences: the config has no
representation in the interface, so a caller cannot pass options to a bundler at all (the
implementer hardcodes them on the instance, as all six `tcons-*`/buildkit ports do), and
neither this key nor TerraConstructs' `JSON.stringify(bundlingConfig)` covers the *resolved*
image digest (`alpine:latest` moving does not move the hash in either design — it is a
property of hashing a reference, not of cdktn). My `rolldown-dir`/`rolldown-zip`/
`tcons-nodejs` ports all had to remember the key, and that is the whole convention.

**Suggestion:** state the requirement in the `bundlerKey` docs ("serialise every option
that can change the output, including image/tool version"), and provide a helper
(`bundlerKeyFor(config)`) so the convention has one implementation rather than nine.

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

This is the clearest case of the identity premise being falsified, and it is the
*documented* behaviour that does it. `exclude` **is** part of the identity —
`hashSource()` fingerprints through `this.ignoreStrategy.ignores(...)`, so `skip.txt` is
excluded from the hash — but the bundler is handed the unfiltered directory. The hash is
then correct for the intent and wrong for the artifact: one identity, two contents,
silently. Changing the excluded file's content moves the artifact and not the hash
(`excludedFileShippedInArtifact=true`, `hashUnchangedDespiteExcludedChange=true`,
`artifactChanged=true`); the reverse direction is just as wrong — `tcons-local` and the
three Docker ports copy the excluded file into the artifact, so a `SOURCE`-hashed asset can
ship bytes that nothing in its identity accounts for.

**Workaround used:** nothing general. Entry-graph bundlers (esbuild, Rolldown) never open
the excluded file, so they look correct by accident; copy-everything bundlers cannot see
the option at all. Repro: `repro/pr-head-98b39e49/pr442-exclude.js` (see also
`FINDINGS.md` §"exclude is not communicated", review issue #10).

**Suggestion:** hand the bundler the *same* filtered view the identity is computed from
(materialise the filtered input, as TerraConstructs/CDK's `BUNDLING_INPUT_DIR` allows), or
drop the claim from the docs and document that `exclude` does not constrain a bundler's
inputs.

## 2. Awkward but workable (adapters carry the cost)

| DX issue | Symptom measured | Adapter workaround | Review ref |
| --- | --- | --- | --- |
| `source` documented absolute, delivered relative when the config path is relative | `bundlerSawAbsolute=false`; a bundler that spawns a tool with its own cwd (docker `-w`, esbuild, gradle) resolves elsewhere | adapters must `path.resolve` and hope the caller did not rely on relative semantics | #12 |
| Second `stage()`/`synth()` rebuilds after the eager build consumed the artifact | `rebuiltOnSecondStage=true`, `rebuiltOnSecondSynth=true`; with a non-reproducible bundler `sameIdentityDifferentBytes=true` for **all nine** adapters | none available to the bundler — it cannot know it is being called twice; only cdktn can retain the artifact or reject reuse. Note the premise this rests on: the identity model assumes a **deterministic** bundler, and the interface never states it | #11 |
| Scratch lifecycle owned by cdktn only | failed build leaves the scratch in-process (`scratchDirsLeftInProcess=1`, 8.1 MB in the never-staged case) and signals strand it entirely (SIGINT/SIGTERM: `scratchSurvived=true`) | bundlers cannot clean up: they are handed `outputDir` but not its lifetime | #13 |
| Diagnostics name the wrong thing | `TerraformAsset Staging was configured with a 'bundler' and file packaging (AssetType.FILE)` fires for an `AssetStaging` caller with custom packaging, and names the internal child id `Staging`; an out-of-range `AssetType` with a file source now reports the path/type mismatch instead of `Asset type is not implemented` | none — the messages are produced inside cdktn | #14 |
| `bundle()`'s return value is not validated | a file-returning bundler silently bypasses the "always a directory" contract | every adapter had to be written defensively; the harness asserts the shape itself | #17 |
| `acceptsDirectorySource` is a required interface member | out-of-tree `IAssetPackaging` implementers break at compile time; `assets-types.test.ts` asserts nothing about it | adapters implement it by hand; the flag does not describe *archive* sources, only directory-reading ones | #15 |
| `bundlerKey` is the only config channel and it is optional | a bundler that folds nothing (or an incomplete config) into its key keeps the source-only hash and silently reuses stale artifacts; nothing in the library can detect it | every port hand-writes its key and documents it; the harness asserts `identityFollowsBundlerKey=true` | #15-adjacent |

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

None of these touch the identity model — `md5(hashSource(filtered) ⊕ extraHash ⊕
bundlerKey ⊕ salt)`, with `SOURCE` as the default, is right: the declared intent (filtered
input + build config) determines the output, and making every asset hash output-derived
would cost the skippability that #380 added. They are about making that premise actually
hold at the bundler boundary.

1. Let a bundler declare its artifact shape (`producesArchive`/`outputType`, or let `ZIP`
   packaging consume a file) so `SINGLE_FILE`/`ARCHIVED` bundlers stop needing a wrapper
   directory.
2. Make `exclude` honest: the identity already filters the source, the bundler input does
   not — materialise the same filtered input, or delete the doc claim (#10).
3. Define `stage()` reuse: retain the eager artifact or assert single-use (#11); validate
   `bundle()`'s return (#17); and document the determinism assumption the identity model
   rests on, where bundler authors will read it.
4. Give the fallback chain a voice: a decline/`local` protocol so third-party local and
   Docker bundlers can be composed instead of re-implemented.
5. Say what `bundlerKey` must contain (everything that can move the output) and ship a
   helper, so the convention has one implementation instead of nine.
6. Guarantee `BundleOptions.source` is absolute (or fix the docs).
7. Keep the scratch lifecycle inside cdktn, but document failure/signal behaviour (#13)
   and fix the guard messages to name the caller's construct (#14).

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

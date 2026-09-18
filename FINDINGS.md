# Findings — porting seven real bundlers onto `IAssetBundler`

Harness target: cdktn **PR #442** head `98b39e49f6dd6bb5cc94ca30302d5928e7c836bb`
(interface `IAssetBundler { bundlerKey?, bundle({ source, outputDir }): string }`, plus
`bundler` on `AssetStaging` / `TerraformAsset`). Evidence: `results.json` / `REPORT.md`
from `npm run harness:all`, plus `scripts/lifecycle-probe.cjs`.

Status: **8 of 8 adapters executed — 96 scenarios, all pass.** Docker (3) ran against a
real daemon (29.5.3, overlayfs) with real container builds. Buildkit (1) ran against a
real buildkitd endpoint (`moby/buildkit:v0.33.0`, `--addr tcp://0.0.0.0:1234`) driven by
the mise-installed `buildctl` 0.33.0 client — see “Buildkit” below for how the tooling was
obtained.

## Execution matrix

| adapter | scenarios | result |
| --- | --- | --- |
| `tcons-local` | 12 | 12 pass |
| `tcons-nodejs` | 12 | 12 pass |
| `rolldown-dir` | 12 | 12 pass |
| `rolldown-zip` | 12 | 12 pass |
| `tcons-docker-bind` | 12 | 12 pass (real `docker run`, image `alpine`) |
| `tcons-docker-volume` | 12 | 12 pass (helper container + 2 volumes + `docker cp`) |
| `tcons-local-docker-chain` | 12 | 12 pass (local leg declines, Docker leg builds) |
| `buildkit-local-output` | 12 | 12 pass (buildkitd over TCP, `buildctl` client) |

## What the interface absorbed cleanly

1. **Deferred vs eager builds.** With `AssetHashType.SOURCE` every adapter builds
   exactly once, in `stage()` (`bundlerCallsAtConstruction=0`, `callsAfterStage=1`).
   With `OUTPUT` every adapter builds in the constructor (`=1`) and the staged tree is
   byte-identical to the hashed artifact (`stagingMatchesArtifact=true`), across host
   and container bundlers alike. The two-phase model survives the port.
2. **Config-in-identity.** TerraConstructs hashes
   `sha256(fingerprint(source) ++ JSON.stringify(bundlingConfig))`; the closest cdktn
   equivalent is `bundlerKey`, and the ports use it exactly for that — e.g.
   `tcons-docker::alpine::sh -c mkdir -p /asset-output/dist …::BIND_MOUNT`. A changed
   `bundlerKey` moves `assetHash` (`identityFollowsBundlerKey=true`).
3. **ZIP packaging is the right home for archive-producing bundlers.** With a file-path
   stage target (`TerraformAsset`'s layout), `AssetPackaging.ZIP` accepts the bundler's
   directory output and emits one `.zip` (`acceptsDirectorySource=true`,
   `omitsDirectoryEntries=true`). `rolldown-zip` works this way.
4. **Determinism.** All runnable adapters produced byte-identical artifacts across two
   fresh builds (`determinism/two-fresh-builds` → `reproducible=true`), so the harness
   can distinguish "rebuild churn" from "identity drift".

## What the interface cannot express (with evidence)

1. **`AssetType.FILE` + bundler is unreachable, so a real archive-producing bundler can
   only return a directory.** `rolldown-zip` is upstream's own design (deterministic
   `archive.zip`, with the hash taken *from the artifact* — that bundler's own
   output-derived identity choice; cdktn's default identity is the filtered source +
   `bundlerKey`); as an `IAssetBundler` it must hand back the
   directory *containing* the archive. Rejection is at construction, with this text
   (identical for every adapter, and naming the internal child construct, not the user's
   asset):

   ```
   TerraformAsset Staging was configured with a 'bundler' and file packaging
   (AssetType.FILE). A bundler produces a directory of output, which cannot be
   staged as a single file.
   ```

   Consequence: `AssetHashType.OUTPUT` over a bundler that emits `archive.zip` hashes a
   directory that contains an archive — the hash describes the wrapper, not the artifact.
2. **Double archiving is undetected.** `rolldown-zip` + `AssetPackaging.ZIP` produces a
   zip whose only entry is `archive.zip` (`doubleArchived="archive.zip"`). Nothing in the
   interface or the packager notices that the bundler already produced an archive.
3. **`exclude` is not communicated to the bundler.** For copy-everything bundlers
   (`tcons-local`, `tcons-docker-bind`, `tcons-docker-volume`, `tcons-local-docker-chain`)
   the excluded file ships inside the artifact (`excludedFileShippedInArtifact=true`,
   `artifactChanged=true`) while `assetHash` stays fixed
   (`hashUnchangedDespiteExcludedChange=true`): one identity, two contents. Entry-graph
   bundlers (`tcons-nodejs`, `rolldown-*`) never see the file, so they show no drift —
   the drift is a function of the bundler, not of the option.
4. **No bundler-composition protocol.** TerraConstructs' chain is
   `local?.tryBundle() ?? docker`; `tryBundle` returns a boolean precisely so a host tool
   can *decline*. `bundle()` returns only a string, so the port flattens the two legs
   inside one implementation and swallows the local failure (adapter
   `tcons-local-docker-chain`). The caller also loses the choice of transfer mode
   (`BIND_MOUNT` vs `VOLUME_COPY`) — it stays on the adapter instance. Wrinkle the port
   exposes: the chain's `bundlerKey` (`tcons-chain::tcons-local::<hash>`) does not include
   the Docker leg, so switching legs cannot move identity.
5. **A mid-build failure strands the scratch in-process.** `hashOutput()` registers the
   scratch for the exit sweep but has no `try`/`finally`, so after a throwing bundler the
   directory is still on disk (`scratchDirsLeftInProcess=1`, 472–491 bytes here; 8 MB in
   `large-output/never-staged`, `scratchBytes=8389099`). It is reclaimed on a normal exit
   and **not** on signal death — `node scripts/lifecycle-probe.cjs`:
   `normal exit reclaims scratch: true`, `SIGINT reclaims scratch: false`,
   `SIGTERM reclaims scratch: false`.
6. **Second `stage()`/`synth()` rebuilds, and with a non-reproducible build the bytes
   diverge under one `assetHash`.** `rebuiltOnSecondStage=true` and
   `rebuiltOnSecondSynth=true` for every adapter; with deterministic adapters the trees
   still match, so `repeat/stage-twice-nondeterministic` injects a per-run
   `BUILD_INFO.txt` and reports `sameIdentityDifferentBytes=true` for **all seven**
   runnable adapters (artifact tree differs, `assetHash` identical). Emitted layout for
   the second pass: `stacks/stack-synth/assets/file/<SAME HASH>/dist/...`.
7. **Image, command, user, env, volumes, network and security options have no home in
   `BundleOptions`.** They stay on the adapter instance and reach identity only if the
   author remembers to serialise them into `bundlerKey` — the ports do this by hand.
   `TerraConstructsDockerBundler` is ~250 lines of argv construction that the interface
   neither sees nor constrains.

## Buildkit (executed)

TerraConstructs PR #165 is provider-side (`provider "buildkit"`, `buildkit_image`,
`cruxstack/buildkit@0.0.1`) and contains no TypeScript, so the adapter ports the
architecture: build against a buildkitd endpoint and take the artifact back through the
client session (`--output type=local,dest=<outputDir>`), never the Docker Engine build
API. `DockerAssetBuilder.BUILDKIT` never runs in the Node process; here the build is one
`buildctl build --frontend dockerfile.v0` call.

Tooling, in the order attempted (mise first, per project convention):

1. `mise registry buildkit` → `tool not found in registry`.
2. mise **github backend** — `mise use -g "github:moby/buildkit[asset_pattern=buildkit-v*.linux-amd64.tar.gz,bin_path=bin/buildctl]"`
   → installs `0.33.0` to
   `~/.local/share/mise/installs/github-moby-buildkit/0.33.0/{buildctl,buildkitd}`.
   The first attempt looked stalled; the background run completed with exit 0 after
   several minutes. That is the only route that worked.
3. Distro packages → `apt-cache policy buildkit` has **no candidate** on Ubuntu 24.04
   (buildx is packaged, and also already present as a CLI plugin at v0.34.1).

Endpoint: the daemon is not usable as an unprivileged local process here (no
`fuse-overlayfs`, and rootless mode needs a user namespace), so buildkitd runs from the
official image with a TCP address, which is also how the “embedded or endpoint” choice in
PR #165 is exercised:

```bash
docker run -d --name harness-buildkitd --privileged -p 127.0.0.1:1234:1234 \
  moby/buildkit:v0.33.0 --addr tcp://0.0.0.0:1234

BUILDCTL=~/.local/share/mise/installs/github-moby-buildkit/0.33.0/buildctl \
BUILDKIT_ADDR=tcp://127.0.0.1:1234 \
  npm run harness -- --allow-buildkit --adapter=buildkit-local-output --merge
```

Result: **12/12 pass**, artifact returned through the client session into the staging
scratch and staged by cdktn exactly like the host and Docker bundlers
(`stagingMatchesArtifact=true` for `OUTPUT`, deferred build for `SOURCE`).

One harness-side lesson worth keeping: `--output type=local` exports the **last stage's
filesystem**, so a naive `FROM alpine … COPY . /out` build stages the whole alpine rootfs
(including `/etc/mtab`, a dangling symlink that broke the harness's tree walk until the
fixture Dockerfile gained a `FROM scratch AS output` packaging stage). That is a property
of buildkit/local exporters, not of `IAssetBundler`, but any `@cdktn/bundler-buildkit`
will have to make the same choice explicit.

## Review-relevant conclusions

- The interface is sufficient for **local, esbuild/Rolldown and Docker** bundlers as long
  as the artifact is a directory and identity is `SOURCE`+`bundlerKey`.
- Identity is the filtered source + `bundlerKey` (+ `extraHash`/salt), and that is correct
  by design — the gaps worth deciding before third-party bundlers exist are about the
  interface *enforcing the premise* that declared intent determines the output: an
  archive-producing bundler has no first-class representation (item 1 + 2), `exclude`
  filters the identity but not the bundler's input (item 3), and `stage()`'s repeatability
  is unspecified while a non-deterministic bundler breaks "one identity ⇒ one artifact"
  (`OUTPUT` hashing is what makes that identity-relevant, item 6).
- Items 4, 5 and 7 are ergonomics/lifecycle rather than blockers: they cost adapter
  authors boilerplate and leak scratch on failure, but every ported bundler still worked.

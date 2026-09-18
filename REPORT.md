# cdktn asset-bundler harness — results

- Generated: 2026-09-18T01:51:03.729Z + 2026-09-18T01:51:19.652Z + 2026-09-18T01:51:36.270Z + 2026-09-18T01:51:41.414Z
- Targets cdktn **PR #442** head `98b39e49f6dd6bb5cc94ca30302d5928e7c836bb` (interface `IAssetBundler` + `bundler` on `AssetStaging`/`TerraformAsset`)
- Library under test: `/data/repos/hermes-pr-reviewer/worktrees/cdk-terrain/open-constructs__cdk-terrain/pr-442/packages/cdktn/lib/index.js`

## Environment

- node: v24.18.1
- platform: linux-x64
- tmpdir: /data/tmp/harness-tmp
- docker: Docker version 29.5.3, build d1c06ef
- buildctl: <unavailable>
- buildkitAddr: <unset>

## Adapters

### tcons-local — TerraConstructs host (local) bundling

- Provenance: TerraConstructs/base src/bundling.ts BundlingOptions + ILocalBundling host path
- Ported in: `src/adapters/tc-local.ts`
- Port notes: ILocalBundling.tryBundle(outputDir, options) -> boolean replaced by bundle({source, outputDir}); no 'decline to Docker' return value, so the try-local-then-Docker chain must be flattened by the caller (see tc-local-docker.ts). Upstream's single-file artifact (ARCHIVED/SINGLE_FILE) has no representation: the interface returns a directory.

### tcons-nodejs — TerraConstructs NodejsFunction bundling (esbuild)

- Provenance: TerraConstructs/base src/aws/compute/function-nodejs/bundling.ts (esbuild + ILocalBundling host path)
- Ported in: `src/adapters/tc-nodejs.ts`
- Port notes: esbuild's single-file output fits `bundle(): string` (the returned directory holds index.js). Upstream's ZIP is produced later by TerraformAsset/archiveSync, which is outside the bundler contract — so a ported NodejsFunction must keep using AssetType.FILE + pre-zipped input instead of a bundler, or accept directory packaging.

### rolldown-dir — PR #402 Rolldown bundler (directory output)

- Provenance: open-constructs/cdk-terrain PR #402 packages/@cdktn/bundler-nodejs (NodejsBundler + runner.mjs)
- Ported in: `src/adapters/rolldown.ts + rolldown-runner.mjs`
- Port notes: Rolldown's multi-file/directory output maps cleanly onto bundle(): string. What is lost relative to upstream is construct-time identity: upstream hashes the built ZIP before TerraformAsset exists, while a bundler under AssetHashType.SOURCE defers the build to stage().

### rolldown-zip — PR #402 Rolldown bundler (deterministic ZIP in outputDir)

- Provenance: open-constructs/cdk-terrain PR #402 packages/@cdktn/bundler-nodejs (NodejsBundler + runner.mjs)
- Ported in: `src/adapters/rolldown.ts + rolldown-runner.mjs`
- Port notes: Upstream returns a ZIP + sha256(zip) hash and feeds TerraformAsset AssetType.FILE with an explicit assetHash. As an IAssetBundler it can only return a directory, so the archive lands inside outputDir and the consumer is back to directory packaging (the bundler cannot express 'the artifact is this one file').

### tcons-local-docker-chain — TerraConstructs local-or-Docker bundling chain

- Provenance: TerraConstructs/base asset-staging.ts bundle(): ILocalBundling.tryBundle() -> AssetBundlingBindMount fallback
- Ported in: `src/adapters/tc-local-docker.ts`
- Port notes: The two-step local/Docker decision is flattened into a single bundle() call. Upstream's boolean 'decline' protocol and the caller-visible choice of transfer mode (BIND_MOUNT vs VOLUME_COPY) are not expressible through BundleOptions, so the port hard-codes the policy and swallows the local failure rather than reporting it.

### tcons-docker-bind — TerraConstructs Docker bundling (BIND_MOUNT)

- Provenance: TerraConstructs/base src/private/asset-staging.ts AssetBundlingBindMount/AssetBundlingVolumeCopy + src/bundling.ts DockerImage
- Ported in: `src/adapters/tc-docker.ts`
- Port notes: Image, command, user, environment, volumes, network and security options cannot be expressed by BundleOptions, so they stay on the adapter instance. The upstream ILocalBundling->Docker fallback disappears; VOLUME_COPY cleans up after the build only, so a failed build strands a container and two volumes (kept faithful to upstream).

### tcons-docker-volume — TerraConstructs Docker bundling (VOLUME_COPY)

- Provenance: TerraConstructs/base src/private/asset-staging.ts AssetBundlingBindMount/AssetBundlingVolumeCopy + src/bundling.ts DockerImage
- Ported in: `src/adapters/tc-docker.ts`
- Port notes: Image, command, user, environment, volumes, network and security options cannot be expressed by BundleOptions, so they stay on the adapter instance. The upstream ILocalBundling->Docker fallback disappears; VOLUME_COPY cleans up after the build only, so a failed build strands a container and two volumes (kept faithful to upstream).

### buildkit-local-output — Buildkit endpoint bundling (PR #165 idea, Node-side port)

- Provenance: TerraConstructs/base PR #165 (DockerAssetBuilder.BUILDKIT + buildkit_image provider) — architectural idea only; that PR is Terraform-provider side and ships no Node bundling code
- Ported in: `src/adapters/buildkit.ts`
- Port notes: Ports 'build against a buildkitd endpoint, not the Docker daemon socket' into a sync `bundle()` by shelling out to `buildctl` with `--output type=local,dest=<outputDir>`, which returns the artifact through the client session. Upstream's Terraform-resource half (buildkit_image, registry push, source_hash triggers) has no place in the bundler contract and stays out.

## Results matrix

| scenario | tcons-local | tcons-nodejs | rolldown-dir | rolldown-zip | tcons-local-docker-chain | tcons-docker-bind | tcons-docker-volume | buildkit-local-output |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `stage/source-hash` | pass | pass | pass | pass | pass | pass | pass | skip |
| `stage/output-hash` | pass | pass | pass | pass | pass | pass | pass | skip |
| `stage/zip-packaging` | pass | pass | pass | pass | pass | pass | pass | skip |
| `repeat/stage-twice` | pass | pass | pass | pass | pass | pass | pass | skip |
| `repeat/stage-twice-nondeterministic` | pass | pass | pass | pass | pass | pass | pass | skip |
| `repeat/synth-twice` | pass | pass | pass | pass | pass | pass | pass | skip |
| `asset/file-type-bundler` | pass | pass | pass | pass | pass | pass | pass | skip |
| `failure/bundler-throws` | pass | pass | pass | pass | pass | pass | pass | skip |
| `identity/excluded-input-changes` | pass | pass | pass | pass | pass | pass | pass | skip |
| `determinism/two-fresh-builds` | pass | pass | pass | pass | pass | pass | pass | skip |
| `identity/bundler-key` | pass | pass | pass | pass | pass | pass | pass | skip |
| `large-output/never-staged` | pass | pass | pass | pass | pass | pass | pass | skip |

## Observations

### `stage/source-hash`

<details><summary><b>tcons-local</b> — pass</summary>

```json
{
  "bundlerCallsAtConstruction": 0,
  "bundlerCallsAfterStage": 1,
  "eagerBuild": false,
  "assetHash": "ACDD942A0867A8894A8342855DD89F33",
  "stagedFiles": [
    "dist/BUILT",
    "dist/COPY.txt",
    "dist/Dockerfile.bundle",
    "dist/excludeme.txt",
    "dist/index.ts",
    "dist/lib/dep.ts",
    "dist/package.json",
    "dist/second.ts",
    "leftover.txt"
  ],
  "stagedTreeHash": "f002adec26e4eefd74c2c7ebac2f9c2cd1fef59aa5c37c9831f9ab2a84a99029",
  "sharedScratchDir": "/data/tmp/harness-tmp/cdktn-bundle-CRYzla",
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-nodejs</b> — pass</summary>

```json
{
  "bundlerCallsAtConstruction": 0,
  "bundlerCallsAfterStage": 1,
  "eagerBuild": false,
  "assetHash": "4D0C9B9961A09D3DF5574F0838BDAD9E",
  "stagedFiles": [
    "index.js"
  ],
  "stagedTreeHash": "1ed269d14e603c1a9a4c4cc54dd5e7509b33a687432edafc6c0015907192ebc6",
  "sharedScratchDir": "/data/tmp/harness-tmp/cdktn-bundle-PX3X71",
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>rolldown-dir</b> — pass</summary>

```json
{
  "bundlerCallsAtConstruction": 0,
  "bundlerCallsAfterStage": 1,
  "eagerBuild": false,
  "assetHash": "42EBCB96EF81036640A872D08FE595C5",
  "stagedFiles": [
    "index.mjs"
  ],
  "stagedTreeHash": "d931b15cb0140f4b263e6be9ea0548ac57c97bcbca3f56d6f0c88b243fb691f3",
  "sharedScratchDir": "/data/tmp/harness-tmp/cdktn-bundle-H2OL6i",
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>rolldown-zip</b> — pass</summary>

```json
{
  "bundlerCallsAtConstruction": 0,
  "bundlerCallsAfterStage": 1,
  "eagerBuild": false,
  "assetHash": "905E409CE3D3BC6244891CA4ED8F2C19",
  "stagedFiles": [
    "archive.zip"
  ],
  "stagedTreeHash": "088e2e43ca3e3c907354214bdc91fe00399f219dc0d349341ec9b1d71fd68a69",
  "sharedScratchDir": "/data/tmp/harness-tmp/cdktn-bundle-1MDXmk",
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-local-docker-chain</b> — pass</summary>

```json
{
  "bundlerCallsAtConstruction": 0,
  "bundlerCallsAfterStage": 1,
  "eagerBuild": false,
  "assetHash": "827852C127D9BFF7BB5DE25AC8A3276E",
  "stagedFiles": [
    "dist/COPY.txt",
    "dist/Dockerfile.bundle",
    "dist/excludeme.txt",
    "dist/index.ts",
    "dist/lib/dep.ts",
    "dist/package.json",
    "dist/second.ts"
  ],
  "stagedTreeHash": "8b2b2c6dfcbdf15440db48aa74bf13a2a499a5cb99a9d49050a872e5e174d264",
  "sharedScratchDir": "/data/tmp/harness-tmp/cdktn-bundle-qCZD52",
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-docker-bind</b> — pass</summary>

```json
{
  "bundlerCallsAtConstruction": 0,
  "bundlerCallsAfterStage": 1,
  "eagerBuild": false,
  "assetHash": "B523EFF1B3D4E016A17FDD01C415FF74",
  "stagedFiles": [
    "dist/BUILT",
    "dist/COPY.txt",
    "dist/Dockerfile.bundle",
    "dist/excludeme.txt",
    "dist/index.ts",
    "dist/lib/dep.ts",
    "dist/package.json",
    "dist/second.ts"
  ],
  "stagedTreeHash": "3b5973f33b7a144c53581f4f922e313dc84d5fc4001bc3d69908098dae432ae6",
  "sharedScratchDir": "/data/tmp/harness-tmp/cdktn-bundle-hDNHm0",
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-docker-volume</b> — pass</summary>

```json
{
  "bundlerCallsAtConstruction": 0,
  "bundlerCallsAfterStage": 1,
  "eagerBuild": false,
  "assetHash": "D207E28202F34F0EAA0989F70F7200A3",
  "stagedFiles": [
    "dist/BUILT",
    "dist/COPY.txt",
    "dist/Dockerfile.bundle",
    "dist/excludeme.txt",
    "dist/index.ts",
    "dist/lib/dep.ts",
    "dist/package.json",
    "dist/second.ts"
  ],
  "stagedTreeHash": "3b5973f33b7a144c53581f4f922e313dc84d5fc4001bc3d69908098dae432ae6",
  "sharedScratchDir": "/data/tmp/harness-tmp/cdktn-bundle-45GeDw",
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>buildkit-local-output</b> — skipped</summary>

```json
{
  "gate": "gated: pass --allow-buildkit to run buildkit-endpoint scenarios",
  "probe": "buildctl not found (set BUILDCTL=/path/to/buildctl); BUILDKIT_ADDR=<unset>"
}
```
</details>

### `stage/output-hash`

<details><summary><b>tcons-local</b> — pass</summary>

```json
{
  "bundlerCallsAtConstruction": 1,
  "eagerBuild": true,
  "artifactStillPresentAtStageTime": false,
  "assetHash": "59D47EA9E5304F5ACB318416F4E066B9",
  "builtArtifactTreeHash": "f002adec26e4eefd74c2c7ebac2f9c2cd1fef59aa5c37c9831f9ab2a84a99029",
  "stagedTreeHash": "f002adec26e4eefd74c2c7ebac2f9c2cd1fef59aa5c37c9831f9ab2a84a99029",
  "stagingMatchesArtifact": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-nodejs</b> — pass</summary>

```json
{
  "bundlerCallsAtConstruction": 1,
  "eagerBuild": true,
  "artifactStillPresentAtStageTime": false,
  "assetHash": "BFE7C237F513EAC42EC72F4A0A034F24",
  "builtArtifactTreeHash": "1ed269d14e603c1a9a4c4cc54dd5e7509b33a687432edafc6c0015907192ebc6",
  "stagedTreeHash": "1ed269d14e603c1a9a4c4cc54dd5e7509b33a687432edafc6c0015907192ebc6",
  "stagingMatchesArtifact": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>rolldown-dir</b> — pass</summary>

```json
{
  "bundlerCallsAtConstruction": 1,
  "eagerBuild": true,
  "artifactStillPresentAtStageTime": false,
  "assetHash": "643D974AC7675EF1F936B47E5B7FAD55",
  "builtArtifactTreeHash": "d931b15cb0140f4b263e6be9ea0548ac57c97bcbca3f56d6f0c88b243fb691f3",
  "stagedTreeHash": "d931b15cb0140f4b263e6be9ea0548ac57c97bcbca3f56d6f0c88b243fb691f3",
  "stagingMatchesArtifact": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>rolldown-zip</b> — pass</summary>

```json
{
  "bundlerCallsAtConstruction": 1,
  "eagerBuild": true,
  "artifactStillPresentAtStageTime": false,
  "assetHash": "CAD07DB12BD56AEE180CBA67ADFCE64C",
  "builtArtifactTreeHash": "088e2e43ca3e3c907354214bdc91fe00399f219dc0d349341ec9b1d71fd68a69",
  "stagedTreeHash": "088e2e43ca3e3c907354214bdc91fe00399f219dc0d349341ec9b1d71fd68a69",
  "stagingMatchesArtifact": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-local-docker-chain</b> — pass</summary>

```json
{
  "bundlerCallsAtConstruction": 1,
  "eagerBuild": true,
  "artifactStillPresentAtStageTime": false,
  "assetHash": "827852C127D9BFF7BB5DE25AC8A3276E",
  "builtArtifactTreeHash": "8b2b2c6dfcbdf15440db48aa74bf13a2a499a5cb99a9d49050a872e5e174d264",
  "stagedTreeHash": "8b2b2c6dfcbdf15440db48aa74bf13a2a499a5cb99a9d49050a872e5e174d264",
  "stagingMatchesArtifact": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-docker-bind</b> — pass</summary>

```json
{
  "bundlerCallsAtConstruction": 1,
  "eagerBuild": true,
  "artifactStillPresentAtStageTime": false,
  "assetHash": "E870586E22427A6545386491E54B5052",
  "builtArtifactTreeHash": "3b5973f33b7a144c53581f4f922e313dc84d5fc4001bc3d69908098dae432ae6",
  "stagedTreeHash": "3b5973f33b7a144c53581f4f922e313dc84d5fc4001bc3d69908098dae432ae6",
  "stagingMatchesArtifact": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-docker-volume</b> — pass</summary>

```json
{
  "bundlerCallsAtConstruction": 1,
  "eagerBuild": true,
  "artifactStillPresentAtStageTime": false,
  "assetHash": "DA0376958828E31B772CA2BA7F73B1DE",
  "builtArtifactTreeHash": "3b5973f33b7a144c53581f4f922e313dc84d5fc4001bc3d69908098dae432ae6",
  "stagedTreeHash": "3b5973f33b7a144c53581f4f922e313dc84d5fc4001bc3d69908098dae432ae6",
  "stagingMatchesArtifact": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>buildkit-local-output</b> — skipped</summary>

```json
{
  "gate": "gated: pass --allow-buildkit to run buildkit-endpoint scenarios",
  "probe": "buildctl not found (set BUILDCTL=/path/to/buildctl); BUILDKIT_ADDR=<unset>"
}
```
</details>

### `stage/zip-packaging`

<details><summary><b>tcons-local</b> — pass</summary>

```json
{
  "stageTargetIsFile": true,
  "packagingExtension": ".zip",
  "packagingProducesDirectory": false,
  "packagingAcceptsDirectorySource": true,
  "packagingOmitsDirectoryEntries": true,
  "bundleArtifactIsDirectory": true,
  "archiveBytes": 1401,
  "archiveEntries": [
    "dist/BUILT",
    "dist/COPY.txt",
    "dist/Dockerfile.bundle",
    "dist/excludeme.txt",
    "dist/index.ts",
    "dist/lib/dep.ts",
    "dist/package.json",
    "dist/second.ts",
    "leftover.txt"
  ],
  "assetHash": "ACDD942A0867A8894A8342855DD89F33",
  "bundlerBuilds": 1,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-nodejs</b> — pass</summary>

```json
{
  "stageTargetIsFile": true,
  "packagingExtension": ".zip",
  "packagingProducesDirectory": false,
  "packagingAcceptsDirectorySource": true,
  "packagingOmitsDirectoryEntries": true,
  "bundleArtifactIsDirectory": true,
  "archiveBytes": 641,
  "archiveEntries": [
    "index.js"
  ],
  "assetHash": "4D0C9B9961A09D3DF5574F0838BDAD9E",
  "bundlerBuilds": 1,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>rolldown-dir</b> — pass</summary>

```json
{
  "stageTargetIsFile": true,
  "packagingExtension": ".zip",
  "packagingProducesDirectory": false,
  "packagingAcceptsDirectorySource": true,
  "packagingOmitsDirectoryEntries": true,
  "bundleArtifactIsDirectory": true,
  "archiveBytes": 168,
  "archiveEntries": [
    "index.mjs"
  ],
  "assetHash": "42EBCB96EF81036640A872D08FE595C5",
  "bundlerBuilds": 1,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>rolldown-zip</b> — pass</summary>

```json
{
  "stageTargetIsFile": true,
  "packagingExtension": ".zip",
  "packagingProducesDirectory": false,
  "packagingAcceptsDirectorySource": true,
  "packagingOmitsDirectoryEntries": true,
  "bundleArtifactIsDirectory": true,
  "archiveBytes": 239,
  "archiveEntries": [
    "archive.zip"
  ],
  "doubleArchived": "archive.zip",
  "assetHash": "905E409CE3D3BC6244891CA4ED8F2C19",
  "bundlerBuilds": 1,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-local-docker-chain</b> — pass</summary>

```json
{
  "stageTargetIsFile": true,
  "packagingExtension": ".zip",
  "packagingProducesDirectory": false,
  "packagingAcceptsDirectorySource": true,
  "packagingOmitsDirectoryEntries": true,
  "bundleArtifactIsDirectory": true,
  "archiveBytes": 1189,
  "archiveEntries": [
    "dist/COPY.txt",
    "dist/Dockerfile.bundle",
    "dist/excludeme.txt",
    "dist/index.ts",
    "dist/lib/dep.ts",
    "dist/package.json",
    "dist/second.ts"
  ],
  "assetHash": "827852C127D9BFF7BB5DE25AC8A3276E",
  "bundlerBuilds": 1,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-docker-bind</b> — pass</summary>

```json
{
  "stageTargetIsFile": true,
  "packagingExtension": ".zip",
  "packagingProducesDirectory": false,
  "packagingAcceptsDirectorySource": true,
  "packagingOmitsDirectoryEntries": true,
  "bundleArtifactIsDirectory": true,
  "archiveBytes": 1306,
  "archiveEntries": [
    "dist/BUILT",
    "dist/COPY.txt",
    "dist/Dockerfile.bundle",
    "dist/excludeme.txt",
    "dist/index.ts",
    "dist/lib/dep.ts",
    "dist/package.json",
    "dist/second.ts"
  ],
  "assetHash": "B523EFF1B3D4E016A17FDD01C415FF74",
  "bundlerBuilds": 1,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-docker-volume</b> — pass</summary>

```json
{
  "stageTargetIsFile": true,
  "packagingExtension": ".zip",
  "packagingProducesDirectory": false,
  "packagingAcceptsDirectorySource": true,
  "packagingOmitsDirectoryEntries": true,
  "bundleArtifactIsDirectory": true,
  "archiveBytes": 1306,
  "archiveEntries": [
    "dist/BUILT",
    "dist/COPY.txt",
    "dist/Dockerfile.bundle",
    "dist/excludeme.txt",
    "dist/index.ts",
    "dist/lib/dep.ts",
    "dist/package.json",
    "dist/second.ts"
  ],
  "assetHash": "D207E28202F34F0EAA0989F70F7200A3",
  "bundlerBuilds": 1,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>buildkit-local-output</b> — skipped</summary>

```json
{
  "gate": "gated: pass --allow-buildkit to run buildkit-endpoint scenarios",
  "probe": "buildctl not found (set BUILDCTL=/path/to/buildctl); BUILDKIT_ADDR=<unset>"
}
```
</details>

### `repeat/stage-twice`

<details><summary><b>tcons-local</b> — pass</summary>

```json
{
  "assetHash": "59D47EA9E5304F5ACB318416F4E066B9",
  "bundlerCallsAfterFirstStage": 1,
  "bundlerCallsAfterSecondStage": 2,
  "rebuiltOnSecondStage": true,
  "firstTreeHash": "f002adec26e4eefd74c2c7ebac2f9c2cd1fef59aa5c37c9831f9ab2a84a99029",
  "secondTreeHash": "f002adec26e4eefd74c2c7ebac2f9c2cd1fef59aa5c37c9831f9ab2a84a99029",
  "artifactsIdentical": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-nodejs</b> — pass</summary>

```json
{
  "assetHash": "BFE7C237F513EAC42EC72F4A0A034F24",
  "bundlerCallsAfterFirstStage": 1,
  "bundlerCallsAfterSecondStage": 2,
  "rebuiltOnSecondStage": true,
  "firstTreeHash": "1ed269d14e603c1a9a4c4cc54dd5e7509b33a687432edafc6c0015907192ebc6",
  "secondTreeHash": "1ed269d14e603c1a9a4c4cc54dd5e7509b33a687432edafc6c0015907192ebc6",
  "artifactsIdentical": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>rolldown-dir</b> — pass</summary>

```json
{
  "assetHash": "643D974AC7675EF1F936B47E5B7FAD55",
  "bundlerCallsAfterFirstStage": 1,
  "bundlerCallsAfterSecondStage": 2,
  "rebuiltOnSecondStage": true,
  "firstTreeHash": "d931b15cb0140f4b263e6be9ea0548ac57c97bcbca3f56d6f0c88b243fb691f3",
  "secondTreeHash": "d931b15cb0140f4b263e6be9ea0548ac57c97bcbca3f56d6f0c88b243fb691f3",
  "artifactsIdentical": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>rolldown-zip</b> — pass</summary>

```json
{
  "assetHash": "CAD07DB12BD56AEE180CBA67ADFCE64C",
  "bundlerCallsAfterFirstStage": 1,
  "bundlerCallsAfterSecondStage": 2,
  "rebuiltOnSecondStage": true,
  "firstTreeHash": "088e2e43ca3e3c907354214bdc91fe00399f219dc0d349341ec9b1d71fd68a69",
  "secondTreeHash": "088e2e43ca3e3c907354214bdc91fe00399f219dc0d349341ec9b1d71fd68a69",
  "artifactsIdentical": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-local-docker-chain</b> — pass</summary>

```json
{
  "assetHash": "827852C127D9BFF7BB5DE25AC8A3276E",
  "bundlerCallsAfterFirstStage": 1,
  "bundlerCallsAfterSecondStage": 2,
  "rebuiltOnSecondStage": true,
  "firstTreeHash": "8b2b2c6dfcbdf15440db48aa74bf13a2a499a5cb99a9d49050a872e5e174d264",
  "secondTreeHash": "8b2b2c6dfcbdf15440db48aa74bf13a2a499a5cb99a9d49050a872e5e174d264",
  "artifactsIdentical": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-docker-bind</b> — pass</summary>

```json
{
  "assetHash": "E870586E22427A6545386491E54B5052",
  "bundlerCallsAfterFirstStage": 1,
  "bundlerCallsAfterSecondStage": 2,
  "rebuiltOnSecondStage": true,
  "firstTreeHash": "3b5973f33b7a144c53581f4f922e313dc84d5fc4001bc3d69908098dae432ae6",
  "secondTreeHash": "3b5973f33b7a144c53581f4f922e313dc84d5fc4001bc3d69908098dae432ae6",
  "artifactsIdentical": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-docker-volume</b> — pass</summary>

```json
{
  "assetHash": "DA0376958828E31B772CA2BA7F73B1DE",
  "bundlerCallsAfterFirstStage": 1,
  "bundlerCallsAfterSecondStage": 2,
  "rebuiltOnSecondStage": true,
  "firstTreeHash": "3b5973f33b7a144c53581f4f922e313dc84d5fc4001bc3d69908098dae432ae6",
  "secondTreeHash": "3b5973f33b7a144c53581f4f922e313dc84d5fc4001bc3d69908098dae432ae6",
  "artifactsIdentical": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>buildkit-local-output</b> — skipped</summary>

```json
{
  "gate": "gated: pass --allow-buildkit to run buildkit-endpoint scenarios",
  "probe": "buildctl not found (set BUILDCTL=/path/to/buildctl); BUILDKIT_ADDR=<unset>"
}
```
</details>

### `repeat/stage-twice-nondeterministic`

<details><summary><b>tcons-local</b> — pass</summary>

```json
{
  "assetHash": "70F81E588AAEDF01A5A99223D74F68B6",
  "bundlerCalls": 2,
  "firstBuildInfo": "build-1-1789696261385-0.4763607377820288",
  "secondBuildInfo": "build-2-1789696261388-0.8642240496520329",
  "artifactsIdentical": false,
  "sameIdentityDifferentBytes": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-nodejs</b> — pass</summary>

```json
{
  "assetHash": "A244C8B476D47985B6DDE5C38489645F",
  "bundlerCalls": 2,
  "firstBuildInfo": "build-1-1789696261491-0.8263435919145493",
  "secondBuildInfo": "build-2-1789696261492-0.7622519496735519",
  "artifactsIdentical": false,
  "sameIdentityDifferentBytes": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>rolldown-dir</b> — pass</summary>

```json
{
  "assetHash": "E33B6CAA4B5240CE4BD9855416D9D42A",
  "bundlerCalls": 2,
  "firstBuildInfo": "build-1-1789696261984-0.6075211219417157",
  "secondBuildInfo": "build-2-1789696262063-0.7894089905074243",
  "artifactsIdentical": false,
  "sameIdentityDifferentBytes": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>rolldown-zip</b> — pass</summary>

```json
{
  "assetHash": "323BC80B212CB1CE449B7529EC281E9E",
  "bundlerCalls": 2,
  "firstBuildInfo": "build-1-1789696263090-0.7364526899040489",
  "secondBuildInfo": "build-2-1789696263175-0.6545158406097346",
  "artifactsIdentical": false,
  "sameIdentityDifferentBytes": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-local-docker-chain</b> — pass</summary>

```json
{
  "assetHash": "B31DF9041C6C109772FA34116798692D",
  "bundlerCalls": 2,
  "firstBuildInfo": "build-1-1789696298554-0.15202245822767435",
  "secondBuildInfo": "build-2-1789696298872-0.6465766582079326",
  "artifactsIdentical": false,
  "sameIdentityDifferentBytes": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-docker-bind</b> — pass</summary>

```json
{
  "assetHash": "5A960A3B407149409AEDA240F87FF0F2",
  "bundlerCalls": 2,
  "firstBuildInfo": "build-1-1789696276841-0.42396191475540446",
  "secondBuildInfo": "build-2-1789696277139-0.29298254027119",
  "artifactsIdentical": false,
  "sameIdentityDifferentBytes": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-docker-volume</b> — pass</summary>

```json
{
  "assetHash": "8A66F1408386F4CAB84142F3C5490087",
  "bundlerCalls": 2,
  "firstBuildInfo": "build-1-1789696289582-0.21878911372630672",
  "secondBuildInfo": "build-2-1789696290317-0.059975644229793845",
  "artifactsIdentical": false,
  "sameIdentityDifferentBytes": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>buildkit-local-output</b> — skipped</summary>

```json
{
  "gate": "gated: pass --allow-buildkit to run buildkit-endpoint scenarios",
  "probe": "buildctl not found (set BUILDCTL=/path/to/buildctl); BUILDKIT_ADDR=<unset>"
}
```
</details>

### `repeat/synth-twice`

<details><summary><b>tcons-local</b> — pass</summary>

```json
{
  "assetHash": "59D47EA9E5304F5ACB318416F4E066B9",
  "declaredAssetPath": "assets/file/59D47EA9E5304F5ACB318416F4E066B9",
  "bundlerCallsAfterFirstSynth": 1,
  "bundlerCallsAfterSecondSynth": 2,
  "rebuiltOnSecondSynth": true,
  "emittedAssetFiles": [
    "stacks/stack-synth/assets/file/59D47EA9E5304F5ACB318416F4E066B9/dist/BUILT",
    "stacks/stack-synth/assets/file/59D47EA9E5304F5ACB318416F4E066B9/dist/COPY.txt",
    "stacks/stack-synth/assets/file/59D47EA9E5304F5ACB318416F4E066B9/dist/Dockerfile.bundle",
    "stacks/stack-synth/assets/file/59D47EA9E5304F5ACB318416F4E066B9/dist/excludeme.txt",
    "stacks/stack-synth/assets/file/59D47EA9E5304F5ACB318416F4E066B9/dist/index.ts",
    "stacks/stack-synth/assets/file/59D47EA9E5304F5ACB318416F4E066B9/dist/lib/dep.ts",
    "stacks/stack-synth/assets/file/59D47EA9E5304F5ACB318416F4E066B9/dist/package.json",
    "stacks/stack-synth/assets/file/59D47EA9E5304F5ACB318416F4E066B9/dist/second.ts",
    "stacks/stack-synth/assets/file/59D47EA9E5304F5ACB318416F4E066B9/leftover.txt"
  ],
  "firstSynthOutdirHash": "a5f7f8b7caf52943233fb264e6e9782b47a08cd91e379ec3f0db1bd73b5a71ed",
  "secondSynthOutdirHash": "a5f7f8b7caf52943233fb264e6e9782b47a08cd91e379ec3f0db1bd73b5a71ed",
  "identicalAcrossSynths": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-nodejs</b> — pass</summary>

```json
{
  "assetHash": "BFE7C237F513EAC42EC72F4A0A034F24",
  "declaredAssetPath": "assets/file/BFE7C237F513EAC42EC72F4A0A034F24",
  "bundlerCallsAfterFirstSynth": 1,
  "bundlerCallsAfterSecondSynth": 2,
  "rebuiltOnSecondSynth": true,
  "emittedAssetFiles": [
    "stacks/stack-synth/assets/file/BFE7C237F513EAC42EC72F4A0A034F24/index.js"
  ],
  "firstSynthOutdirHash": "f02e509d0d682ee0df2d12a48ba98889f7e1523bdb455c6d90f45d5878c0e0a7",
  "secondSynthOutdirHash": "f02e509d0d682ee0df2d12a48ba98889f7e1523bdb455c6d90f45d5878c0e0a7",
  "identicalAcrossSynths": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>rolldown-dir</b> — pass</summary>

```json
{
  "assetHash": "643D974AC7675EF1F936B47E5B7FAD55",
  "declaredAssetPath": "assets/file/643D974AC7675EF1F936B47E5B7FAD55",
  "bundlerCallsAfterFirstSynth": 1,
  "bundlerCallsAfterSecondSynth": 2,
  "rebuiltOnSecondSynth": true,
  "emittedAssetFiles": [
    "stacks/stack-synth/assets/file/643D974AC7675EF1F936B47E5B7FAD55/index.mjs"
  ],
  "firstSynthOutdirHash": "a39f99c021886c34601c465c4a8d864ac2c1ab19a34755a1bda2a4602ba3bf64",
  "secondSynthOutdirHash": "a39f99c021886c34601c465c4a8d864ac2c1ab19a34755a1bda2a4602ba3bf64",
  "identicalAcrossSynths": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>rolldown-zip</b> — pass</summary>

```json
{
  "assetHash": "CAD07DB12BD56AEE180CBA67ADFCE64C",
  "declaredAssetPath": "assets/file/CAD07DB12BD56AEE180CBA67ADFCE64C",
  "bundlerCallsAfterFirstSynth": 1,
  "bundlerCallsAfterSecondSynth": 2,
  "rebuiltOnSecondSynth": true,
  "emittedAssetFiles": [
    "stacks/stack-synth/assets/file/CAD07DB12BD56AEE180CBA67ADFCE64C/archive.zip"
  ],
  "firstSynthOutdirHash": "c88f72368fac7e07bf4c4f6ce23319822dd35cdf3aef2fda520e74577721ec8a",
  "secondSynthOutdirHash": "c88f72368fac7e07bf4c4f6ce23319822dd35cdf3aef2fda520e74577721ec8a",
  "identicalAcrossSynths": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-local-docker-chain</b> — pass</summary>

```json
{
  "assetHash": "827852C127D9BFF7BB5DE25AC8A3276E",
  "declaredAssetPath": "assets/file/827852C127D9BFF7BB5DE25AC8A3276E",
  "bundlerCallsAfterFirstSynth": 1,
  "bundlerCallsAfterSecondSynth": 2,
  "rebuiltOnSecondSynth": true,
  "emittedAssetFiles": [
    "stacks/stack-synth/assets/file/827852C127D9BFF7BB5DE25AC8A3276E/dist/COPY.txt",
    "stacks/stack-synth/assets/file/827852C127D9BFF7BB5DE25AC8A3276E/dist/Dockerfile.bundle",
    "stacks/stack-synth/assets/file/827852C127D9BFF7BB5DE25AC8A3276E/dist/excludeme.txt",
    "stacks/stack-synth/assets/file/827852C127D9BFF7BB5DE25AC8A3276E/dist/index.ts",
    "stacks/stack-synth/assets/file/827852C127D9BFF7BB5DE25AC8A3276E/dist/lib/dep.ts",
    "stacks/stack-synth/assets/file/827852C127D9BFF7BB5DE25AC8A3276E/dist/package.json",
    "stacks/stack-synth/assets/file/827852C127D9BFF7BB5DE25AC8A3276E/dist/second.ts"
  ],
  "firstSynthOutdirHash": "3b0d7d5424a5cd7ad3dcf9f9a90a57a2e81f197b2afe928aef07a18273e8ee16",
  "secondSynthOutdirHash": "3b0d7d5424a5cd7ad3dcf9f9a90a57a2e81f197b2afe928aef07a18273e8ee16",
  "identicalAcrossSynths": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-docker-bind</b> — pass</summary>

```json
{
  "assetHash": "E870586E22427A6545386491E54B5052",
  "declaredAssetPath": "assets/file/E870586E22427A6545386491E54B5052",
  "bundlerCallsAfterFirstSynth": 1,
  "bundlerCallsAfterSecondSynth": 2,
  "rebuiltOnSecondSynth": true,
  "emittedAssetFiles": [
    "stacks/stack-synth/assets/file/E870586E22427A6545386491E54B5052/dist/BUILT",
    "stacks/stack-synth/assets/file/E870586E22427A6545386491E54B5052/dist/COPY.txt",
    "stacks/stack-synth/assets/file/E870586E22427A6545386491E54B5052/dist/Dockerfile.bundle",
    "stacks/stack-synth/assets/file/E870586E22427A6545386491E54B5052/dist/excludeme.txt",
    "stacks/stack-synth/assets/file/E870586E22427A6545386491E54B5052/dist/index.ts",
    "stacks/stack-synth/assets/file/E870586E22427A6545386491E54B5052/dist/lib/dep.ts",
    "stacks/stack-synth/assets/file/E870586E22427A6545386491E54B5052/dist/package.json",
    "stacks/stack-synth/assets/file/E870586E22427A6545386491E54B5052/dist/second.ts"
  ],
  "firstSynthOutdirHash": "52b6b3a56fc99f7238961532215e6789e11bf0ec3df35ff4415f08f46bf35eb3",
  "secondSynthOutdirHash": "52b6b3a56fc99f7238961532215e6789e11bf0ec3df35ff4415f08f46bf35eb3",
  "identicalAcrossSynths": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-docker-volume</b> — pass</summary>

```json
{
  "assetHash": "DA0376958828E31B772CA2BA7F73B1DE",
  "declaredAssetPath": "assets/file/DA0376958828E31B772CA2BA7F73B1DE",
  "bundlerCallsAfterFirstSynth": 1,
  "bundlerCallsAfterSecondSynth": 2,
  "rebuiltOnSecondSynth": true,
  "emittedAssetFiles": [
    "stacks/stack-synth/assets/file/DA0376958828E31B772CA2BA7F73B1DE/dist/BUILT",
    "stacks/stack-synth/assets/file/DA0376958828E31B772CA2BA7F73B1DE/dist/COPY.txt",
    "stacks/stack-synth/assets/file/DA0376958828E31B772CA2BA7F73B1DE/dist/Dockerfile.bundle",
    "stacks/stack-synth/assets/file/DA0376958828E31B772CA2BA7F73B1DE/dist/excludeme.txt",
    "stacks/stack-synth/assets/file/DA0376958828E31B772CA2BA7F73B1DE/dist/index.ts",
    "stacks/stack-synth/assets/file/DA0376958828E31B772CA2BA7F73B1DE/dist/lib/dep.ts",
    "stacks/stack-synth/assets/file/DA0376958828E31B772CA2BA7F73B1DE/dist/package.json",
    "stacks/stack-synth/assets/file/DA0376958828E31B772CA2BA7F73B1DE/dist/second.ts"
  ],
  "firstSynthOutdirHash": "4527e2b4113a3ce05fc234cc57cda49456f0bf58b1b1a587185b17688293d526",
  "secondSynthOutdirHash": "4527e2b4113a3ce05fc234cc57cda49456f0bf58b1b1a587185b17688293d526",
  "identicalAcrossSynths": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>buildkit-local-output</b> — skipped</summary>

```json
{
  "gate": "gated: pass --allow-buildkit to run buildkit-endpoint scenarios",
  "probe": "buildctl not found (set BUILDCTL=/path/to/buildctl); BUILDKIT_ADDR=<unset>"
}
```
</details>

### `asset/file-type-bundler`

<details><summary><b>tcons-local</b> — pass</summary>

```json
{
  "rejectedAtConstruction": true,
  "error": "TerraformAsset Staging was configured with a 'bundler' and file packaging (AssetType.FILE). A bundler produces a directory of output, which cannot be staged as a single file.",
  "adapterProducesArchive": false,
  "bundlerRanBeforeRejection": false,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-nodejs</b> — pass</summary>

```json
{
  "rejectedAtConstruction": true,
  "error": "TerraformAsset Staging was configured with a 'bundler' and file packaging (AssetType.FILE). A bundler produces a directory of output, which cannot be staged as a single file.",
  "adapterProducesArchive": false,
  "bundlerRanBeforeRejection": false,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>rolldown-dir</b> — pass</summary>

```json
{
  "rejectedAtConstruction": true,
  "error": "TerraformAsset Staging was configured with a 'bundler' and file packaging (AssetType.FILE). A bundler produces a directory of output, which cannot be staged as a single file.",
  "adapterProducesArchive": false,
  "bundlerRanBeforeRejection": false,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>rolldown-zip</b> — pass</summary>

```json
{
  "rejectedAtConstruction": true,
  "error": "TerraformAsset Staging was configured with a 'bundler' and file packaging (AssetType.FILE). A bundler produces a directory of output, which cannot be staged as a single file.",
  "adapterProducesArchive": true,
  "bundlerRanBeforeRejection": false,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-local-docker-chain</b> — pass</summary>

```json
{
  "rejectedAtConstruction": true,
  "error": "TerraformAsset Staging was configured with a 'bundler' and file packaging (AssetType.FILE). A bundler produces a directory of output, which cannot be staged as a single file.",
  "adapterProducesArchive": false,
  "bundlerRanBeforeRejection": false,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-docker-bind</b> — pass</summary>

```json
{
  "rejectedAtConstruction": true,
  "error": "TerraformAsset Staging was configured with a 'bundler' and file packaging (AssetType.FILE). A bundler produces a directory of output, which cannot be staged as a single file.",
  "adapterProducesArchive": false,
  "bundlerRanBeforeRejection": false,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-docker-volume</b> — pass</summary>

```json
{
  "rejectedAtConstruction": true,
  "error": "TerraformAsset Staging was configured with a 'bundler' and file packaging (AssetType.FILE). A bundler produces a directory of output, which cannot be staged as a single file.",
  "adapterProducesArchive": false,
  "bundlerRanBeforeRejection": false,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>buildkit-local-output</b> — skipped</summary>

```json
{
  "gate": "gated: pass --allow-buildkit to run buildkit-endpoint scenarios",
  "probe": "buildctl not found (set BUILDCTL=/path/to/buildctl); BUILDKIT_ADDR=<unset>"
}
```
</details>

### `failure/bundler-throws`

<details><summary><b>tcons-local</b> — pass</summary>

```json
{
  "errorPropagated": true,
  "error": "harness: bundler failed after writing output",
  "scratchDirsLeftInProcess": 1,
  "scratchBytesLeftInProcess": 484,
  "note": "registered scratch is reclaimed only by the process-exit sweep (see lifecycle/scratch-after-exit)",
  "newScratchDirs": 1
}
```
</details>

<details><summary><b>tcons-nodejs</b> — pass</summary>

```json
{
  "errorPropagated": true,
  "error": "harness: bundler failed after writing output",
  "scratchDirsLeftInProcess": 1,
  "scratchBytesLeftInProcess": 1177,
  "note": "registered scratch is reclaimed only by the process-exit sweep (see lifecycle/scratch-after-exit)",
  "newScratchDirs": 1
}
```
</details>

<details><summary><b>rolldown-dir</b> — pass</summary>

```json
{
  "errorPropagated": true,
  "error": "harness: bundler failed after writing output",
  "scratchDirsLeftInProcess": 1,
  "scratchBytesLeftInProcess": 50,
  "note": "registered scratch is reclaimed only by the process-exit sweep (see lifecycle/scratch-after-exit)",
  "newScratchDirs": 1
}
```
</details>

<details><summary><b>rolldown-zip</b> — pass</summary>

```json
{
  "errorPropagated": true,
  "error": "harness: bundler failed after writing output",
  "scratchDirsLeftInProcess": 1,
  "scratchBytesLeftInProcess": 168,
  "note": "registered scratch is reclaimed only by the process-exit sweep (see lifecycle/scratch-after-exit)",
  "newScratchDirs": 1
}
```
</details>

<details><summary><b>tcons-local-docker-chain</b> — pass</summary>

```json
{
  "errorPropagated": true,
  "error": "harness: bundler failed after writing output",
  "scratchDirsLeftInProcess": 1,
  "scratchBytesLeftInProcess": 472,
  "note": "registered scratch is reclaimed only by the process-exit sweep (see lifecycle/scratch-after-exit)",
  "newScratchDirs": 1
}
```
</details>

<details><summary><b>tcons-docker-bind</b> — pass</summary>

```json
{
  "errorPropagated": true,
  "error": "harness: bundler failed after writing output",
  "scratchDirsLeftInProcess": 1,
  "scratchBytesLeftInProcess": 491,
  "note": "registered scratch is reclaimed only by the process-exit sweep (see lifecycle/scratch-after-exit)",
  "newScratchDirs": 1
}
```
</details>

<details><summary><b>tcons-docker-volume</b> — pass</summary>

```json
{
  "errorPropagated": true,
  "error": "harness: bundler failed after writing output",
  "scratchDirsLeftInProcess": 1,
  "scratchBytesLeftInProcess": 491,
  "note": "registered scratch is reclaimed only by the process-exit sweep (see lifecycle/scratch-after-exit)",
  "newScratchDirs": 1
}
```
</details>

<details><summary><b>buildkit-local-output</b> — skipped</summary>

```json
{
  "gate": "gated: pass --allow-buildkit to run buildkit-endpoint scenarios",
  "probe": "buildctl not found (set BUILDCTL=/path/to/buildctl); BUILDKIT_ADDR=<unset>"
}
```
</details>

### `identity/excluded-input-changes`

<details><summary><b>tcons-local</b> — pass</summary>

```json
{
  "excludedFileShippedInArtifact": true,
  "hashBefore": "2A4F51FAABECD54A8E1A3045AA908E64",
  "hashAfterExcludedChange": "2A4F51FAABECD54A8E1A3045AA908E64",
  "hashUnchangedDespiteExcludedChange": true,
  "artifactChanged": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-nodejs</b> — pass</summary>

```json
{
  "excludedFileShippedInArtifact": false,
  "hashBefore": "4F6B68515708C397EAA88CC4335E74EA",
  "hashAfterExcludedChange": "4F6B68515708C397EAA88CC4335E74EA",
  "hashUnchangedDespiteExcludedChange": true,
  "artifactChanged": false,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>rolldown-dir</b> — pass</summary>

```json
{
  "excludedFileShippedInArtifact": false,
  "hashBefore": "FC435F2E7DEF75353310AE652268E9E8",
  "hashAfterExcludedChange": "FC435F2E7DEF75353310AE652268E9E8",
  "hashUnchangedDespiteExcludedChange": true,
  "artifactChanged": false,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>rolldown-zip</b> — pass</summary>

```json
{
  "excludedFileShippedInArtifact": false,
  "hashBefore": "5D0769E3DF45046D047A7854EA4E187D",
  "hashAfterExcludedChange": "5D0769E3DF45046D047A7854EA4E187D",
  "hashUnchangedDespiteExcludedChange": true,
  "artifactChanged": false,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-local-docker-chain</b> — pass</summary>

```json
{
  "excludedFileShippedInArtifact": true,
  "hashBefore": "E3DDC385C7CA5A35C1D9B1CE752F1A2F",
  "hashAfterExcludedChange": "E3DDC385C7CA5A35C1D9B1CE752F1A2F",
  "hashUnchangedDespiteExcludedChange": true,
  "artifactChanged": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-docker-bind</b> — pass</summary>

```json
{
  "excludedFileShippedInArtifact": true,
  "hashBefore": "5C8CF80D7E27D3F20B1B8EBDF9329890",
  "hashAfterExcludedChange": "5C8CF80D7E27D3F20B1B8EBDF9329890",
  "hashUnchangedDespiteExcludedChange": true,
  "artifactChanged": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-docker-volume</b> — pass</summary>

```json
{
  "excludedFileShippedInArtifact": true,
  "hashBefore": "F0ADD2250B61A1ACEAA17BB44AA4A913",
  "hashAfterExcludedChange": "F0ADD2250B61A1ACEAA17BB44AA4A913",
  "hashUnchangedDespiteExcludedChange": true,
  "artifactChanged": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>buildkit-local-output</b> — skipped</summary>

```json
{
  "gate": "gated: pass --allow-buildkit to run buildkit-endpoint scenarios",
  "probe": "buildctl not found (set BUILDCTL=/path/to/buildctl); BUILDKIT_ADDR=<unset>"
}
```
</details>

### `determinism/two-fresh-builds`

<details><summary><b>tcons-local</b> — pass</summary>

```json
{
  "first": "59D47EA9E5304F5ACB318416F4E066B9",
  "second": "59D47EA9E5304F5ACB318416F4E066B9",
  "assetHashesEqual": true,
  "artifactTreesEqual": true,
  "reproducible": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-nodejs</b> — pass</summary>

```json
{
  "first": "BFE7C237F513EAC42EC72F4A0A034F24",
  "second": "BFE7C237F513EAC42EC72F4A0A034F24",
  "assetHashesEqual": true,
  "artifactTreesEqual": true,
  "reproducible": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>rolldown-dir</b> — pass</summary>

```json
{
  "first": "643D974AC7675EF1F936B47E5B7FAD55",
  "second": "643D974AC7675EF1F936B47E5B7FAD55",
  "assetHashesEqual": true,
  "artifactTreesEqual": true,
  "reproducible": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>rolldown-zip</b> — pass</summary>

```json
{
  "first": "CAD07DB12BD56AEE180CBA67ADFCE64C",
  "second": "CAD07DB12BD56AEE180CBA67ADFCE64C",
  "assetHashesEqual": true,
  "artifactTreesEqual": true,
  "reproducible": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-local-docker-chain</b> — pass</summary>

```json
{
  "first": "827852C127D9BFF7BB5DE25AC8A3276E",
  "second": "827852C127D9BFF7BB5DE25AC8A3276E",
  "assetHashesEqual": true,
  "artifactTreesEqual": true,
  "reproducible": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-docker-bind</b> — pass</summary>

```json
{
  "first": "E870586E22427A6545386491E54B5052",
  "second": "E870586E22427A6545386491E54B5052",
  "assetHashesEqual": true,
  "artifactTreesEqual": true,
  "reproducible": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-docker-volume</b> — pass</summary>

```json
{
  "first": "DA0376958828E31B772CA2BA7F73B1DE",
  "second": "DA0376958828E31B772CA2BA7F73B1DE",
  "assetHashesEqual": true,
  "artifactTreesEqual": true,
  "reproducible": true,
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>buildkit-local-output</b> — skipped</summary>

```json
{
  "gate": "gated: pass --allow-buildkit to run buildkit-endpoint scenarios",
  "probe": "buildctl not found (set BUILDCTL=/path/to/buildctl); BUILDKIT_ADDR=<unset>"
}
```
</details>

### `identity/bundler-key`

<details><summary><b>tcons-local</b> — pass</summary>

```json
{
  "adapterBundlerKey": "tcons-local::236ff636f0f4e2a2",
  "node18Hash": "ECB740443DE14BF173EF046200FAD552",
  "node20Hash": "0ABC5FDECECADC3DD19CA735F21BB365",
  "identityFollowsBundlerKey": true,
  "hashWithoutBundlerKey": "1B4AEBC3009EEA60F567C442C6E85551",
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-nodejs</b> — pass</summary>

```json
{
  "adapterBundlerKey": "tcons-nodejs::539d460f70f3c469",
  "node18Hash": "ECB740443DE14BF173EF046200FAD552",
  "node20Hash": "0ABC5FDECECADC3DD19CA735F21BB365",
  "identityFollowsBundlerKey": true,
  "hashWithoutBundlerKey": "1B4AEBC3009EEA60F567C442C6E85551",
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>rolldown-dir</b> — pass</summary>

```json
{
  "adapterBundlerKey": "rolldown::node24::dir::true",
  "node18Hash": "ECB740443DE14BF173EF046200FAD552",
  "node20Hash": "0ABC5FDECECADC3DD19CA735F21BB365",
  "identityFollowsBundlerKey": true,
  "hashWithoutBundlerKey": "1B4AEBC3009EEA60F567C442C6E85551",
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>rolldown-zip</b> — pass</summary>

```json
{
  "adapterBundlerKey": "rolldown::node24::zip::true",
  "node18Hash": "ECB740443DE14BF173EF046200FAD552",
  "node20Hash": "0ABC5FDECECADC3DD19CA735F21BB365",
  "identityFollowsBundlerKey": true,
  "hashWithoutBundlerKey": "1B4AEBC3009EEA60F567C442C6E85551",
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-local-docker-chain</b> — pass</summary>

```json
{
  "adapterBundlerKey": "tcons-chain::tcons-local::c900e62f514cdd9f",
  "node18Hash": "ECB740443DE14BF173EF046200FAD552",
  "node20Hash": "0ABC5FDECECADC3DD19CA735F21BB365",
  "identityFollowsBundlerKey": true,
  "hashWithoutBundlerKey": "1B4AEBC3009EEA60F567C442C6E85551",
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-docker-bind</b> — pass</summary>

```json
{
  "adapterBundlerKey": "tcons-docker::alpine::sh -c mkdir -p /asset-output/dist && cp -r /asset-input/. /asset-output/dist/ && printf 'built-in-container\\n' > /asset-output/dist/BUILT::BIND_MOUNT",
  "node18Hash": "ECB740443DE14BF173EF046200FAD552",
  "node20Hash": "0ABC5FDECECADC3DD19CA735F21BB365",
  "identityFollowsBundlerKey": true,
  "hashWithoutBundlerKey": "1B4AEBC3009EEA60F567C442C6E85551",
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>tcons-docker-volume</b> — pass</summary>

```json
{
  "adapterBundlerKey": "tcons-docker::alpine::sh -c mkdir -p /asset-output/dist && cp -r /asset-input/. /asset-output/dist/ && printf 'built-in-container\\n' > /asset-output/dist/BUILT::VOLUME_COPY",
  "node18Hash": "ECB740443DE14BF173EF046200FAD552",
  "node20Hash": "0ABC5FDECECADC3DD19CA735F21BB365",
  "identityFollowsBundlerKey": true,
  "hashWithoutBundlerKey": "1B4AEBC3009EEA60F567C442C6E85551",
  "newScratchDirs": 0
}
```
</details>

<details><summary><b>buildkit-local-output</b> — skipped</summary>

```json
{
  "gate": "gated: pass --allow-buildkit to run buildkit-endpoint scenarios",
  "probe": "buildctl not found (set BUILDCTL=/path/to/buildctl); BUILDKIT_ADDR=<unset>"
}
```
</details>

### `large-output/never-staged`

<details><summary><b>tcons-local</b> — pass</summary>

```json
{
  "assetHash": "EE73EBE6EF9D7E1FF7C3E5E176618043",
  "scratchDirsCreated": 1,
  "scratchBytes": 8389092,
  "scratchDirs": [
    {
      "dir": "/data/tmp/harness-tmp/cdktn-bundle-LUvdTz",
      "bytes": 8389092
    }
  ],
  "newScratchDirs": 1
}
```
</details>

<details><summary><b>tcons-nodejs</b> — pass</summary>

```json
{
  "assetHash": "0C40D1CF551005A01244B8D00CF20F11",
  "scratchDirsCreated": 1,
  "scratchBytes": 8389785,
  "scratchDirs": [
    {
      "dir": "/data/tmp/harness-tmp/cdktn-bundle-fHMK8E",
      "bytes": 8389785
    }
  ],
  "newScratchDirs": 1
}
```
</details>

<details><summary><b>rolldown-dir</b> — pass</summary>

```json
{
  "assetHash": "43CB1048FC26EBDDD153D3729208867C",
  "scratchDirsCreated": 1,
  "scratchBytes": 8388658,
  "scratchDirs": [
    {
      "dir": "/data/tmp/harness-tmp/cdktn-bundle-JYDtef",
      "bytes": 8388658
    }
  ],
  "newScratchDirs": 1
}
```
</details>

<details><summary><b>rolldown-zip</b> — pass</summary>

```json
{
  "assetHash": "A5586E7989459D484F1DAD19E78D7971",
  "scratchDirsCreated": 1,
  "scratchBytes": 8388776,
  "scratchDirs": [
    {
      "dir": "/data/tmp/harness-tmp/cdktn-bundle-lfIarx",
      "bytes": 8388776
    }
  ],
  "newScratchDirs": 1
}
```
</details>

<details><summary><b>tcons-local-docker-chain</b> — pass</summary>

```json
{
  "assetHash": "4779F5D02654222A4FB1489C1FD57F46",
  "scratchDirsCreated": 1,
  "scratchBytes": 8389080,
  "scratchDirs": [
    {
      "dir": "/data/tmp/harness-tmp/cdktn-bundle-hk56Xz",
      "bytes": 8389080
    }
  ],
  "newScratchDirs": 1
}
```
</details>

<details><summary><b>tcons-docker-bind</b> — pass</summary>

```json
{
  "assetHash": "CD95200EE165F15DE266FD85CCCB9A8E",
  "scratchDirsCreated": 1,
  "scratchBytes": 8389099,
  "scratchDirs": [
    {
      "dir": "/data/tmp/harness-tmp/cdktn-bundle-40IE1X",
      "bytes": 8389099
    }
  ],
  "newScratchDirs": 1
}
```
</details>

<details><summary><b>tcons-docker-volume</b> — pass</summary>

```json
{
  "assetHash": "DBAA147621A9DC375C78F5E04598BF5E",
  "scratchDirsCreated": 1,
  "scratchBytes": 8389099,
  "scratchDirs": [
    {
      "dir": "/data/tmp/harness-tmp/cdktn-bundle-FAua9P",
      "bytes": 8389099
    }
  ],
  "newScratchDirs": 1
}
```
</details>

<details><summary><b>buildkit-local-output</b> — skipped</summary>

```json
{
  "gate": "gated: pass --allow-buildkit to run buildkit-endpoint scenarios",
  "probe": "buildctl not found (set BUILDCTL=/path/to/buildctl); BUILDKIT_ADDR=<unset>"
}
```
</details>


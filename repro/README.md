# Repro scripts — reviewer probes against PR #442 head `98b39e49`

These are the standalone scripts used during review of
[open-constructs/cdk-terrain#442](https://github.com/open-constructs/cdk-terrain/pull/442),
copied here verbatim so the quoted outputs can be reproduced. They run directly against a
**compiled `cdktn` library**, not through the adapter layer.

## Prerequisites

1. A checkout of the PR head and its build output:

   ```bash
   git clone https://github.com/open-constructs/cdk-terrain
   cd cdk-terrain && git fetch origin pull/442/head:pr-442 && git checkout pr-442
   pnpm install --frozen-lockfile --ignore-scripts
   pnpm exec nx build cdktn --skip-nx-cache     # --skip-nx-cache matters: a cache hit can restore an empty lib/
   ```

2. Point the scripts at that build. Each script has a `LIB`/`lib` constant near the top
   holding the absolute path used during review; override it with your own path (or export
   `CDKTN_PR_LIB` for the newer scripts that read it).

3. Node 18+ (verified on 24.18.1). A scratch `TMPDIR` is used for the staging directories.

## What each script demonstrates

| script | proves | key output to look for |
| --- | --- | --- |
| `pr442-exclude.js` | `exclude` never reaches the bundler: an excluded file still ships, its content change moves the artifact but **not** `assetHash` (review issue #10) | `bundlerReadableFiles: ["keep.txt","skip.txt"]`, `excludedFileShippedInArtifact: true`, identical `assetHashBefore/After` with `artifactContentChanged: "version-1" -> "version-2"` |
| `pr442-head3.js` | second `stage()` rebuilds (`builds: 2`, `build-1`/`build-2`) under the first build's hash; `BundleOptions.source` arrives relative when the config path is relative (issues #11, #12) | `assetHash: C3F956734B2188FF28234A009BB01A7B` for both builds, `bundlerSawAbsolute: false` |
| `pr442-precedence.js` | guard diagnostics name the wrong construct/`AssetType`, and `type: 99` + file source reports the path/type mismatch instead of `Asset type is not implemented` (issue #14) | the three message lines quoted in the review |
| `pr442-signal-check.js` + `pr442-signal-child.js` | the exit sweep reclaims scratch on a normal exit but **not** on SIGINT (issue #13) | `normal exit -> swept (scratch gone)` vs `signal=SIGINT, scratchStillOnDisk: true` |
| `pr442-throw-exit.js` | a throwing bundler's scratch is registered and swept on normal exit (the fix landed in `c7dcf5c2`) | `leakedAfterThrowAndNormalExit: false` |
| `pr442-repro.js` | first-round repro set: bundle-with-exclude hash drift, `AssetType.FILE` + bundler `EISDIR`, relative `source` | `EISDIR` / `isAbsolute: false` |
| `pr442-verify.js` | never-staged eager build leaves its scratch on disk while the process runs | `scratch still on disk: true (/tmp/cdktn-bundle-…)` |
| `pr442-verify2.js` | a failing bundler leaves the partial output behind (fixed later by the exit registry; still true in-process) | `constructor threw: …`, `leakedAfterFailure: true` |

The harness versions of the same checks live in `src/scenarios.ts` (`identity/excluded-input-changes`,
`repeat/stage-twice`, `repeat/stage-twice-nondeterministic`, `asset/file-type-bundler`,
`failure/bundler-throws`, `large-output/never-staged`) and `scripts/lifecycle-probe.cjs`
(normal exit vs SIGINT/SIGTERM), which is the maintained equivalent of
`pr442-signal-check.js`.

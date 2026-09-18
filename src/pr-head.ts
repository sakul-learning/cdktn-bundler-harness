/**
 * Single place where the harness binds to a specific cdktn build.
 *
 * The harness intentionally does NOT depend on a published `cdktn` package: the
 * whole point is to exercise the `IAssetBundler` extension interface as it
 * exists on the PR head, so `require()` resolves the jsii output of the review
 * worktree directly. `tsconfig.json` maps the bare specifier `cdktn` to that
 * build's `index.d.ts` so the compiler checks the adapters against the real
 * declarations.
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import type * as cdktnTypes from "cdktn";

/** Head of open-constructs/cdk-terrain PR #442 that this harness targets. */
export const PR_HEAD_SHA = "98b39e49f6dd6bb5cc94ca30302d5928e7c836bb";

const DEFAULT_LIB =
  "/data/repos/hermes-pr-reviewer/worktrees/cdk-terrain/open-constructs__cdk-terrain/pr-442/packages/cdktn/lib/index.js";

/** Build output of the PR head. Override with CDKTN_PR_LIB to retarget. */
export const PR_LIB = process.env.CDKTN_PR_LIB ?? DEFAULT_LIB;

if (!existsSync(PR_LIB)) {
  throw new Error(
    `cdktn build not found at ${PR_LIB}. Build it first: ` +
      `(cd /data/repos/hermes-pr-reviewer/worktrees/cdk-terrain/open-constructs__cdk-terrain/pr-442 && pnpm exec nx build cdktn --skip-nx-cache)`,
  );
}

const requirePrHead = createRequire(__filename);

/** The PR-head cdktn module (single instance, so instanceof checks hold). */
export const cdktn: typeof cdktnTypes = requirePrHead(PR_LIB);

export type {
  IAssetBundler,
  IAssetPackaging,
  BundleOptions,
} from "cdktn";

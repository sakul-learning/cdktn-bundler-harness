// Standalone lifecycle probe: is the eager-build scratch reclaimed when the
// process that built it never stages the asset?
//
//   node scripts/lifecycle-probe.cjs
//
// Spawns scripts/lifecycle-child.cjs twice — once letting it exit normally, once
// sending SIGINT (the Ctrl-C / CI-cancel path) — and reports whether the scratch
// directory survived each way. Kept out of the scenario catalogue on purpose: the
// scenario runner drives cdktn in-process, and signal games must not leak into the
// harness process itself.
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CHILD = path.join(__dirname, "lifecycle-child.cjs");
const PR_LIB =
  process.env.CDKTN_PR_LIB ??
  "/data/repos/hermes-pr-reviewer/worktrees/cdk-terrain/open-constructs__cdk-terrain/pr-442/packages/cdktn/lib/index.js";

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function runOnce(mode, signal) {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), `lifecycle-${mode}-`));
  const marker = path.join(tmpdir, "scratch-path.txt");
  const child = path.join(__dirname, "lifecycle-child.cjs");

  const child_env = { ...process.env, CDKTN_PR_LIB: PR_LIB, TMPDIR: tmpdir, MARKER: marker, MEGABYTES: "2" };

  if (!signal) {
    const result = spawnSync(process.execPath, [child, mode], { env: child_env, encoding: "utf8", timeout: 60_000 });
    const scratch = fs.existsSync(marker) ? fs.readFileSync(marker, "utf8").trim().split("\n")[0] : "<no-marker>";
    return {
      mode,
      exit: `status=${result.status} signal=${result.signal}`,
      scratch,
      scratchSurvived: fs.existsSync(scratch),
    };
  }

  const spawned = spawn(process.execPath, [child, mode], { env: child_env, stdio: ["ignore", "ignore", "ignore"] });
  const started = Date.now();
  while (!fs.existsSync(marker) && Date.now() - started < 30_000) sleepSync(50);
  const scratch = fs.existsSync(marker) ? fs.readFileSync(marker, "utf8").trim().split("\n")[0] : "<no-marker>";

  spawned.kill(signal);
  // Liveness via kill(pid, 0): reading spawned.exitCode/signalCode requires the
  // event loop, which this synchronous wait deliberately blocks.
  const deadline = Date.now();
  let alive = true;
  while (alive && Date.now() - deadline < 20_000) {
    try {
      process.kill(spawned.pid, 0);
    } catch {
      alive = false;
    }
    if (alive) sleepSync(50);
  }
  if (alive) spawned.kill("SIGKILL");

  return {
    mode: `${mode}+${signal}`,
    exit: alive ? "still alive after 20s (SIGKILL sent)" : `terminated by ${signal}`,
    scratch,
    scratchSurvived: fs.existsSync(scratch),
  };
}

const results = [
  runOnce("exit"),
  runOnce("hang", "SIGINT"),
  runOnce("hang", "SIGTERM"),
];

console.log(`probe target: ${PR_LIB}`);
console.log(`node: ${process.version}  tmpdir: ${os.tmpdir()}`);
console.log("");
for (const result of results) {
  console.log(
    `${result.mode.padEnd(16)} exit=${String(result.exit).padEnd(24)} scratchSurvived=${result.scratchSurvived}  ${result.scratch}`,
  );
}
console.log("");
console.log(`normal exit reclaims scratch: ${!results[0].scratchSurvived}`);
console.log(`SIGINT reclaims scratch:      ${!results[1].scratchSurvived}`);
console.log(`SIGTERM reclaims scratch:     ${!results[2].scratchSurvived}`);

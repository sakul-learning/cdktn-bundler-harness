// Parent: compare normal-exit vs SIGINT for the eager-build scratch sweep.
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const CHILD = "/data/tmp/pr442-signal-child.js";

function run(mode) {
  return new Promise((resolve) => {
    const tmpdir = fs.mkdtempSync("/data/tmp/sigcheck-tmp-");
    const marker = path.join(tmpdir, "scratch-path.txt");
    const child = spawn(process.execPath, [CHILD, mode === "sigint" ? "hang" : "exit"], {
      env: { ...process.env, TMPDIR: tmpdir, MARKER: marker },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const finish = (note) => {
      const scratch = fs.existsSync(marker) ? fs.readFileSync(marker, "utf8") : null;
      resolve({
        mode,
        note,
        scratch,
        scratchStillOnDisk: scratch ? fs.existsSync(scratch) : null,
      });
    };

    const waitForMarker = setInterval(() => {
      if (!fs.existsSync(marker)) return;
      clearInterval(waitForMarker);
      if (mode === "sigint") {
        child.kill("SIGINT");
        child.once("exit", (code, signal) => finish(`exit code=${code} signal=${signal}`));
      } else {
        child.once("exit", (code) => finish(`exit code=${code}`));
      }
    }, 100);
    setTimeout(() => {
      clearInterval(waitForMarker);
      try {
        child.kill("SIGKILL");
      } catch {}
      finish("timeout");
    }, 20000);
  });
}

(async () => {
  const results = [];
  results.push(await run("normal"));
  results.push(await run("sigint"));
  console.log(JSON.stringify(results, null, 2));
})();

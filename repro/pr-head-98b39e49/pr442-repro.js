const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('/data/repos/hermes-pr-reviewer/worktrees/cdk-terrain/open-constructs__cdk-terrain/pr-442/packages/cdktn/lib');

function temp(prefix) { return fs.mkdtempSync(path.join('/data/tmp/', prefix)); }
function stack(id) { return new lib.TerraformStack(lib.Testing.app(), id); }

const roots = [];
try {
  const fileRoot = temp('pr442-file-'); roots.push(fileRoot);
  const sourceFile = path.join(fileRoot, 'source.txt');
  fs.writeFileSync(sourceFile, 'source');
  const fileStage = new lib.AssetStaging(stack('file-stack'), 'staging', {
    sourcePath: sourceFile,
    packaging: lib.AssetPackaging.FILE,
    bundler: {
      bundle: ({ outputDir }) => {
        fs.writeFileSync(path.join(outputDir, 'built.txt'), 'built');
        return outputDir;
      },
    },
  });
  let fileError;
  try { fileStage.stage(path.join(fileRoot, 'target.txt')); }
  catch (err) { fileError = `${err.code || err.name}: ${err.message}`; }

  const hashRoot = temp('pr442-hash-'); roots.push(hashRoot);
  const targetRoot = temp('pr442-target-'); roots.push(targetRoot);
  fs.writeFileSync(path.join(hashRoot, 'input.txt'), 'stable');
  const ignored = path.join(hashRoot, 'config.skip');
  fs.writeFileSync(ignored, 'first');
  function build(id, target) {
    const staging = new lib.AssetStaging(stack(id), 'staging', {
      sourcePath: hashRoot,
      packaging: lib.AssetPackaging.DIRECTORY,
      exclude: ['*.skip'],
      bundler: {
        bundle: ({ source, outputDir }) => {
          fs.writeFileSync(path.join(outputDir, 'built.txt'), fs.readFileSync(path.join(source, 'config.skip'), 'utf8'));
          return outputDir;
        },
      },
    });
    fs.mkdirSync(target, { recursive: true });
    staging.stage(target);
    return { hash: staging.assetHash, output: fs.readFileSync(path.join(target, 'built.txt'), 'utf8') };
  }
  const first = build('hash-stack-1', path.join(targetRoot, 'out1'));
  fs.writeFileSync(ignored, 'second');
  const second = build('hash-stack-2', path.join(targetRoot, 'out2'));

  const projectRoot = temp('pr442-project-'); roots.push(projectRoot);
  const projectSource = path.join(projectRoot, 'src');
  fs.mkdirSync(projectSource);
  fs.writeFileSync(path.join(projectSource, 'index.txt'), 'input');
  const cdktfJsonPath = path.join(projectRoot, 'cdktf.json');
  fs.writeFileSync(cdktfJsonPath, '{}');
  const app = lib.Testing.app({ context: { cdktfJsonPath } });
  const terraformStack = new lib.TerraformStack(app, 'relative-stack');
  let bundlerSource;
  new lib.TerraformAsset(terraformStack, 'asset', {
    path: 'src',
    type: lib.AssetType.DIRECTORY,
    bundler: {
      bundle: ({ source, outputDir }) => {
        bundlerSource = source;
        fs.writeFileSync(path.join(outputDir, 'built.txt'), 'built');
        return outputDir;
      },
    },
  });
  app.synth();

  console.log(JSON.stringify({ fileError, first, second, sameHash: first.hash === second.hash, differentOutput: first.output !== second.output, bundlerSource, bundlerSourceIsAbsolute: path.isAbsolute(bundlerSource) }, null, 2));
} finally {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
}

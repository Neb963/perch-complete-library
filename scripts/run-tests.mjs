// Real test discovery + execution. Fails if zero tests execute.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const implRoot = join(here, '..');

// 1. Compile tests+src to dist/run via tsc (uses tsconfig.run.json)
const tsc = spawnSync('tsc', ['-p', 'tsconfig.run.json'], { cwd: implRoot, encoding: 'utf8', timeout: 180000 });
process.stdout.write(tsc.stdout ?? '');
process.stderr.write(tsc.stderr ?? '');
if (tsc.status !== 0) {
  console.error('typecheck/compile failed');
  process.exit(1);
}

// 2. Discover compiled tests
const runDir = join(implRoot, 'dist', 'run', 'tests');
let files = [];
try { files = readdirSync(runDir).filter(f=>f.endsWith('.test.js')).sort(); } catch { files = []; }
if (files.length === 0) {
  console.error('FAIL: zero tests discovered in ' + runDir);
  process.exit(2);
}
console.log('discovered ' + files.length + ' test files: ' + files.join(', '));

// 3. Run node --test on compiled tests (with DOM shim preload)
const setupPreload = join(implRoot, 'dist', 'run', 'tests', 'helpers', 'dom-shim.js');
const args = [];
// preload DOM shim if present
try {
  const shimDir = join(implRoot, 'dist', 'run', 'tests', 'helpers');
  if (existsSync(shimDir)) {
    // node --test --import requires Node 20.6+; use NODE_OPTIONS fallback
  }
} catch {}
const testArgs = files.map(f=>join(runDir, f));
const res = spawnSync(process.execPath, ['--test', ...testArgs], { cwd: implRoot, encoding: 'utf8', timeout: 300000 });
process.stdout.write(res.stdout ?? '');
process.stderr.write(res.stderr ?? '');
// node --test exits nonzero on failure; propagate
if (res.status !== 0) process.exit(res.status ?? 1);

// 4. Enforce nonzero test count from TAP output (node --test prints "# pass", "# fail")
const out = (res.stdout ?? '') + (res.stderr ?? '');
const mPass = /#\s*pass\s+(\d+)/i.exec(out);
const mFail = /#\s*fail\s+(\d+)/i.exec(out);
const pass = mPass ? parseInt(mPass[1],10) : 0;
const fail = mFail ? parseInt(mFail[1],10) : 0;
if (!Number.isFinite(pass) || pass === 0) {
  console.error('FAIL: zero tests executed (pass=' + pass + ')');
  process.exit(2);
}
if (fail !== 0) {
  console.error('FAIL: ' + fail + ' failing tests');
  process.exit(1);
}
console.log('PASS: ' + pass + ' passed, ' + fail + ' failed across ' + files.length + ' files');

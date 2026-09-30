// Release check: the mechanical part of a public readiness review, in about two minutes and with no AI involved.
// Usage: node tools/release-check.mjs [--port=5250] [--skip-install] [--extra-audit="<shell command>"] [--since=<tag>]
//   1. git hygiene: clean tree, no scratch, log, env or key files tracked, no huge files, no internal wording in tracked text,
//      no em dashes or spaced double hyphens as punctuation, commit messages since the last tag free of internal wording
//   2. a fresh copy of HEAD (git archive) is installed with npm ci and built; the build must succeed, dist must not contain local
//      paths, user names or key like strings, sizes are printed
//   3. the built site is served with vite preview and loaded in headless Chrome: the normal pages, the lab pages and the developer
//      switches must load with no console error, no page error and no request to a foreign host
//   4. URL fuzzing: out of range and hostile parameter values must not throw and must not reach a foreign host
//   5. docs: every URL parameter, tool and relative link mentioned in README.md and docs/*.md exists in the code or the repo
//   6. version: package.json version is printed and must differ from the last tag's version when commits exist since that tag
// --extra-audit runs one more shell command in the repo (for example a project specific word list check) and fails on a non zero exit.
// Exit codes: 0 all checks pass (warnings allowed), 1 at least one check failed, 2 usage or setup error.
// Chrome is taken from CHROME_PATH or the macOS default path. Needs network for npm ci unless --skip-install is given (then the
// repo's node_modules is linked into the fresh copy).
import { execSync, spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, readdirSync, statSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : dflt; };
const flag = (name) => args.includes(`--${name}`);
if (flag('help') || flag('h')) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(0, 20).join('\n')); process.exit(0); }
const PORT = Number(opt('port', 5250));
const sh = (cmd, cwd = ROOT, opts = {}) => execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...opts });

const DD = ' -' + '- ';   // spaced double hyphen, built in two parts so this file does not match itself
const rows = [];
const add = (status, name, detail = '') => { rows.push({ status, name, detail }); console.log(`${status.padEnd(4)}  ${name}${detail ? '  ' + detail : ''}`); };
const pass = (n, d) => add('PASS', n, d), fail = (n, d) => add('FAIL', n, d), warn = (n, d) => add('WARN', n, d);

const lastTag = (() => { try { return sh('git describe --tags --abbrev=0').trim(); } catch (e) { return ''; } })();
const since = opt('since', lastTag);
console.log(`release-check on ${sh('git rev-parse --short HEAD').trim()} (branch ${sh('git rev-parse --abbrev-ref HEAD').trim()}), compared with ${since || 'no tag'}\n`);

// ------------------------------------------------------------------ 1. git hygiene
{
  const dirty = sh('git status --porcelain').trim();
  if (dirty) fail('working tree is clean', dirty.split('\n').slice(0, 6).join(' | '));
  else pass('working tree is clean');

  const files = sh('git ls-files').split('\n').filter(Boolean);
  const bad = files.filter((f) => /(^|\/)(\.tmp|node_modules|dist|\.claude)\//.test(f) || /\.(log|pem|key|p12)$/.test(f) || /(^|\/)\.env/.test(f) || /(^|\/)\.DS_Store$/.test(f)
    || /^(feelbot|telemetry|looktest|montage)\.(json|png)$/.test(f) || /(^|\/)(id_rsa|credentials)/.test(f));
  bad.length ? fail('no scratch, log, env or key files tracked', bad.slice(0, 8).join(', ')) : pass('no scratch, log, env or key files tracked', `${files.length} files`);
  const big = files.filter((f) => { try { return statSync(join(ROOT, f)).size > 1024 * 1024; } catch (e) { return false; } });
  big.length ? warn('no tracked file over 1 MB', big.join(', ')) : pass('no tracked file over 1 MB');

  const textFiles = files.filter((f) => /\.(js|mjs|json|md|html|css|yml|yaml|svg|txt)$/.test(f) && f !== 'package-lock.json');
  const dashHits = [], internalHits = [];
  const INTERNAL = /\b(the owner|private notes|sub-?agent|round [0-9]+ agent|claude code)\b/i;   // process wording that should not be public
  const CODE_INTERNAL = /\b(private notes|sub-?agent|round [0-9]+ agent|claude code)\b/i;   // in code comments 'the owner' is often an entity, so it is not checked there
  for (const f of textFiles) {
    const lines = readFileSync(join(ROOT, f), 'utf8').split('\n');
    lines.forEach((l, i) => {
      if (/\u2014/.test(l) || l.includes(DD)) dashHits.push(`${f}:${i + 1}`);
      if (f !== 'tools/release-check.mjs' && (/\.(md|html)$/.test(f) ? INTERNAL : CODE_INTERNAL).test(l)) internalHits.push(`${f}:${i + 1}`);
    });
  }
  dashHits.length ? fail('no em dashes or double hyphens as punctuation', dashHits.slice(0, 6).join(', ')) : pass('no em dashes or double hyphens as punctuation');
  internalHits.length ? warn('no internal process wording in tracked text', internalHits.slice(0, 6).join(', ')) : pass('no internal process wording in tracked text');

  if (since) {
    const msgs = sh(`git log ${since}..HEAD --format=%H%x1f%B%x1e`).split('\x1e').map((m) => m.trim()).filter(Boolean);
    const badMsgs = msgs.filter((m) => INTERNAL.test(m) || /\u2014/.test(m) || /\bround [0-9]\b/i.test(m)).map((m) => m.slice(0, 7));
    badMsgs.length ? warn(`commit messages since ${since} are free of internal wording`, `${badMsgs.length} of ${msgs.length}: ${badMsgs.slice(0, 6).join(' ')} (squash the merge to avoid publishing them)`)
      : pass(`commit messages since ${since} are free of internal wording`, `${msgs.length} commits`);
  }
  const extra = opt('extra-audit', '');
  if (extra) {
    try { sh(extra); pass('extra audit command', extra.slice(0, 60)); } catch (e) { fail('extra audit command', String(e.stdout || e.message).split('\n').slice(-4).join(' | ')); }
  }
}

// ------------------------------------------------------------------ 2. fresh copy build
const work = mkdtempSync(join(tmpdir(), 'release-check-'));
const copy = join(work, 'copy');
let built = false;
try {
  sh(`mkdir -p "${copy}" && git archive HEAD | tar -x -C "${copy}"`);
  if (flag('skip-install')) symlinkSync(join(ROOT, 'node_modules'), join(copy, 'node_modules'));
  else sh('npm ci --prefer-offline --no-audit --no-fund', copy, { timeout: 600000 });
  const out = sh('npm run build 2>&1', copy, { timeout: 600000 });
  built = existsSync(join(copy, 'dist', 'index.html'));
  const warnings = out.split('\n').filter((l) => /warn|error|\(!\)/i.test(l));
  built ? pass('fresh copy installs and builds', flag('skip-install') ? 'node_modules linked' : 'npm ci') : fail('fresh copy installs and builds', 'dist/index.html missing');
  warnings.length ? warn('build output has no warnings', warnings.slice(0, 3).join(' | ')) : pass('build output has no warnings');
  if (built) {
    const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    const dist = walk(join(copy, 'dist'));
    const total = dist.reduce((s, f) => s + statSync(f).size, 0);
    const biggest = dist.map((f) => [f, statSync(f).size]).sort((a, b) => b[1] - a[1])[0];
    pass('dist size', `${(total / 1024).toFixed(0)} kB in ${dist.length} files, largest ${biggest[0].split('/').pop()} ${(biggest[1] / 1024).toFixed(0)} kB`);
    const user = userInfo().username;
    const leaks = [];
    for (const f of dist.filter((x) => /\.(js|css|html|json|svg|map)$/.test(x))) {
      const t = readFileSync(f, 'utf8');
      if (/\/Users\/|\/home\/[a-z]|[A-Z]:\\Users\\/.test(t)) leaks.push(`${f.split('/').pop()} (local path)`);
      if (user && user.length > 3 && t.includes(user)) leaks.push(`${f.split('/').pop()} (user name)`);
      if (/(ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY)/.test(t)) leaks.push(`${f.split('/').pop()} (key like string)`);
    }
    leaks.length ? fail('dist has no local paths, user names or keys', leaks.slice(0, 5).join(', ')) : pass('dist has no local paths, user names or keys');
  }
} catch (e) {
  fail('fresh copy installs and builds', String(e.stderr || e.stdout || e.message).split('\n').slice(-4).join(' | '));
}

// ------------------------------------------------------------------ 3 and 4. serve and load
let server = null, browser = null;
if (built) {
  try {
    server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: copy, stdio: 'ignore' });
    const base = `http://127.0.0.1:${PORT}`;
    for (let i = 0; i < 40; i++) { try { const r = await fetch(base + '/'); if (r.ok) break; } catch (e) { /* not up yet */ } await new Promise((r) => setTimeout(r, 500)); }
    browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } });

    const visit = async (path, waitMs = 2500) => {
      const page = await browser.newPage();
      const errs = [], foreign = [];
      page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });
      page.on('pageerror', (e) => errs.push('PAGEERR ' + String(e.message).slice(0, 140)));
      await page.setRequestInterception(true);
      page.on('request', (rq) => {
        const u = rq.url();
        if (/^(data|blob|about):/.test(u)) return rq.continue();
        let host = ''; try { host = new URL(u).hostname; } catch (e) { /* ignore */ }
        if (host === '127.0.0.1' || host === 'localhost') return rq.continue();
        foreign.push(u.slice(0, 100)); rq.abort();
      });
      try { await page.goto(base + path, { waitUntil: 'load', timeout: 30000 }); } catch (e) { errs.push('NAV ' + String(e.message).slice(0, 100)); }
      await new Promise((r) => setTimeout(r, waitMs));
      const ls = await page.evaluate(() => { try { return Object.keys(localStorage); } catch (e) { return ['unreadable']; } }).catch(() => []);
      await page.close();
      return { errs, foreign, ls };
    };

    const pages = ['/', '/?autostart=1&god=1&level=0', '/?autostart=1&god=1&level=1', '/?autostart=1&god=1&level=2', '/?autostart=1&god=1&tune=1', '/?autostart=1&god=1&diag=1',
      '/?telemetry=1', '/music-lab.html', '/sfx-lab.html'];
    let bad = 0;
    for (const p of pages) {
      const r = await visit(p, p.includes('lab') ? 1500 : 3000);
      const problems = [...r.errs, ...r.foreign.map((u) => 'FOREIGN ' + u)];
      if (p === '/' && r.ls.length) warn('a plain load writes nothing to localStorage', r.ls.join(', '));
      if (problems.length) { bad++; fail(`page ${p} loads clean`, problems.slice(0, 2).join(' | ')); } else pass(`page ${p} loads clean`);
    }

    const fuzz = ['/?autostart=1&level=99', '/?autostart=1&level=-1', '/?autostart=1&level=abc', '/?autostart=1&q=99&god=1', '/?autostart=1&difficulty=zzz', '/?style=zz&title=zz',
      '/?tune=1&feel=%%%', '/?tune=1&feel=' + encodeURIComponent(Buffer.from('{"constructor.name":1,"__proto__.x":2,"handling.accel":1e99}').toString('base64')),
      '/?tune=1&feel=' + 'A'.repeat(6000), '/?diag=1&autostart=1&report=1@evil.example/x', '/?diag=1&autostart=1&report=evil.example', '/?autostart=1&msaa=zzz&nopost=1&nooverlay=1&noadapt'];
    let fuzzBad = 0;
    for (const p of fuzz) {
      const r = await visit(p, 2500);
      const problems = [...r.errs, ...r.foreign.map((u) => 'FOREIGN ' + u)];
      if (problems.length) { fuzzBad++; fail(`hostile URL ${p.slice(0, 70)}`, problems.slice(0, 2).join(' | ')); }
    }
    if (!fuzzBad) pass('hostile and out of range URL parameters', `${fuzz.length} cases, no error and no foreign request`);
  } catch (e) {
    fail('serve and load the built site', String(e.message).slice(0, 200));
  }
}

// ------------------------------------------------------------------ 5. docs
{
  const docFiles = ['README.md', ...(existsSync(join(ROOT, 'docs')) ? readdirSync(join(ROOT, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`) : [])];
  const srcText = sh("git ls-files 'src/*.js' 'src/**/*.js' 'index.html' '*.html'").split('\n').filter(Boolean).map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n');
  const tools = new Set(sh("git ls-files 'tools/*'").split('\n').filter(Boolean).map((f) => f.replace('tools/', '')));
  const missingParams = new Set(), missingTools = new Set(), missingLinks = new Set(), missingPaths = new Set();
  for (const f of docFiles) {
    const text = readFileSync(join(ROOT, f), 'utf8');
    for (const m of text.matchAll(/`\?([a-z]+)(?:=[^`]*)?`/g)) {
      const name = m[1];
      if (!new RegExp(`['"\`]${name}['"\`]`).test(srcText)) missingParams.add(`${f}: ?${name}`);
    }
    for (const m of text.matchAll(/tools\/([A-Za-z0-9_.-]+\.mjs)/g)) if (!tools.has(m[1])) missingTools.add(`${f}: tools/${m[1]}`);
    for (const m of text.matchAll(/\]\(([^)#\s]+)\)/g)) {
      const target = m[1];
      if (/^(https?:|mailto:)/.test(target)) continue;
      if (!existsSync(join(ROOT, dirname(f) === '.' ? '' : dirname(f), target))) missingLinks.add(`${f}: ${target}`);
    }
    for (const m of text.matchAll(/^\s{4}(src\/[a-z]+\/)\s/gm)) if (!existsSync(join(ROOT, m[1]))) missingPaths.add(`${f}: ${m[1]}`);
  }
  missingParams.size ? fail('every URL parameter in the docs exists in the code', [...missingParams].slice(0, 6).join(', ')) : pass('every URL parameter in the docs exists in the code');
  missingTools.size ? fail('every tool in the docs exists', [...missingTools].join(', ')) : pass('every tool in the docs exists');
  missingLinks.size ? fail('every relative link and image in the docs exists', [...missingLinks].slice(0, 6).join(', ')) : pass('every relative link and image in the docs exists');
  missingPaths.size ? fail('every folder in the project layout exists', [...missingPaths].join(', ')) : pass('every folder in the project layout exists');
}

// ------------------------------------------------------------------ 6. version
{
  const v = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  const tagged = since ? (() => { try { return JSON.parse(sh(`git show ${since}:package.json`)).version; } catch (e) { return ''; } })() : '';
  const commits = since ? Number(sh(`git rev-list ${since}..HEAD --count`).trim()) : 0;
  if (tagged && commits > 0 && v === tagged) warn('package.json version was bumped since the last tag', `still ${v}`);
  else pass('package.json version', `${v} (last tag ${since || 'none'}${tagged ? ` had ${tagged}` : ''})`);
}

// ------------------------------------------------------------------ done
try { await browser?.close(); } catch (e) { /* ignore */ }
try { server?.kill(); } catch (e) { /* ignore */ }
try { rmSync(work, { recursive: true, force: true }); } catch (e) { /* ignore */ }
const nf = rows.filter((r) => r.status === 'FAIL').length, nw = rows.filter((r) => r.status === 'WARN').length;
console.log(`\n${rows.length} checks: ${rows.length - nf - nw} pass, ${nw} warn, ${nf} fail`);
console.log(nf ? 'RELEASE CHECK FAILED' : nw ? 'RELEASE CHECK OK WITH WARNINGS' : 'RELEASE CHECK OK');
process.exit(nf ? 1 : 0);

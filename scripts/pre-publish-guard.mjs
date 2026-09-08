#!/usr/bin/env node
// @closes-class: tree-not-history
// @scope: all
// @scope-ok: САМЫЙ ДОРОГОЙ на пути правки, 4,28 с: секрет в неизменённом файле и в старом коммите утекает так же, поэтому нужны и дерево, и вся история git
// Pre-publish guard — a MECHANICAL andon for irreversible publication.
//
// Per-rule severity + scope, so the guard protects what actually matters without
// bricking the repo on its own immutable history:
//
//   • Real secrets (tokens, keys, private-key blocks, connection strings) are a
//     LIVE risk wherever they sit — even in an old commit. They stay BLOCK and are
//     scanned in the working TREE *and* full git HISTORY (a leaked token in history
//     must still be caught and rotated).
//
//   • Absolute home paths (/Users/<name>/, /home/<name>/) are local filesystem
//     strings, NOT credentials. They already pervade this repo's history (1000+),
//     so scanning all history for them AND blocking permanently bricks every commit
//     for every session — it did exactly that on 2026-06-02. They are WARN-only and
//     scanned in the working TREE only: that surfaces the paths you can actually
//     edit out (parameterise with $HOME), never blocks, and never re-litigates
//     immutable history.
//
// Exit 1 (block) fires ONLY on a BLOCK-severity finding. Wired as a git pre-push
// hook (.githooks/pre-push) and a PreToolUse Bash guard, so a push cannot proceed
// while a real secret exists.
//
// This exists because a skill/checklist that relies on the agent remembering to
// read it is not mechanical. This script makes the check unavoidable.

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordTrip } from './meta-lib.mjs';
import { fileURLToPath } from 'node:url';

// Files that legitimately contain pattern *definitions*, doc examples, or PII-shaped
// test fixtures — skip these so the guard does not flag its own detection patterns or
// the redaction utility's tests (a PII-redactor's tests must contain sample PII).
// Matched against each grep line, which in history diffs carries the code, not the
// filename — hence redactPii (the function name appears on every fixture line).
const SELF_REFERENCE = /pre-publish-guard|pre-publish-checklist|run-pentest-harness|ANTI_PATTERNS_CATALOG|\.jidoka-denylist|redact-pii|redactPii/;

// severity: 'block' (exit 1) | 'warn' (report, exit 0). scopes: which corpora to scan.
const RULES = [
  { name: 'absolute home path', re: '(/Users/|/home/)[A-Za-z0-9._-]+/', allow: /\/(Users|home)\/(you|user|runner|me|<)/, severity: 'warn',  scopes: ['tree'] },
  { name: 'GitHub token',        re: 'gh[posru]_[A-Za-z0-9]{30}',        allow: null,                    severity: 'block', scopes: ['tree', 'history'] },
  { name: 'OpenAI key',          re: 'sk-[A-Za-z0-9]{40}',               allow: null,                    severity: 'block', scopes: ['tree', 'history'] },
  { name: 'AWS access key',      re: 'AKIA[A-Z0-9]{16}',                 allow: null,                    severity: 'block', scopes: ['tree', 'history'] },
  { name: 'private key block',   re: '-----BEGIN [A-Z ]*PRIVATE KEY',    allow: null,                    severity: 'block', scopes: ['tree', 'history'] },
  // Real DSNs block (incl. history — a leaked prod password is live). Known LOCAL/
  // docker-compose defaults are not secrets and are allow-listed: trivial dev cred
  // pairs (postgres:postgres / :password) and compose-service / localhost hosts
  // (@db, @localhost, @redis …). A real host + real password still blocks.
  { name: 'connection string',   re: '[a-z]+://[^:@/ ]+:[^@/ ]{6,}@',    allow: /(example|user:pass|<|postgres:(postgres|password)@|:password@|@(localhost|127\.0\.0\.1|db|postgres|redis|mysql|mongo)([:/]|$))/, severity: 'block', scopes: ['tree', 'history'] },
];

// НЕТ ОТВЕТА и НЕТ СЕКРЕТОВ это разные вещи, и до 2026-09-07 они были одной.
// git grep выходит с 1, когда совпадений нет, и со 128, когда ответить не может
// (не репозиторий, битый индекс). Прежний `catch { return '' }` читал оба случая
// как пустой результат, а пустой результат печатался как «no real secrets».
// На дереве без .git сторож был зелёным ВСЕГДА, включая установленную копию
// ~/.claude/jidoka, которую правила велят звать каждой сессии.
// Класс: green-check-that-checks-nothing.
class Unscannable extends Error {}

// Предусловие: сторож обязан сначала убедиться, что ему ЕСТЬ ЧТО читать.
// Проверка стоит доли миллисекунды и снимает весь класс разом, а не по одному
// вызывающему.
function assertScannable() {
  const r = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
  if (r.status !== 0 || String(r.stdout).trim() !== 'true') {
    throw new Unscannable(
      'это не рабочее дерево git, поэтому проверить нечего:\n' +
      '  ' + (String(r.stderr || '').trim().split('\n')[0] || 'git rev-parse не подтвердил рабочее дерево'));
  }
}

function grepTree(re) {
  // -e ОБЯЗАТЕЛЕН: шаблон приватного ключа начинается с дефиса, и без -e git читает
  // его как неизвестную опцию и выходит со 129. Старый перехват глотал этот код
  // наравне с «совпадений нет», поэтому правило «private key block» не срабатывало
  // НИ РАЗУ за всё время жизни сторожа. Нашлось первым же красным кейсом.
  const r = spawnSync('git', ['grep', '-nIE', '-e', re, '--', '.'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status === 0) return r.stdout;
  if (r.status === 1) return '';                    // честное «совпадений нет»
  throw new Unscannable(
    `git grep не смог ответить (код ${r.status}):\n  ` +
    (String(r.stderr || '').trim().split('\n')[0] || 'причина не названа'));
}
function grepHistory(re) {
  try {
    return execSync(`git log --all -p --no-color | grep -nIE ${JSON.stringify(re)} || true`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });
  } catch { return ''; }
}
const SCAN = { tree: grepTree, history: grepHistory };

const blockFindings = [];
const warnFindings = [];

function classify(line, r, scope) {
  if (!line.trim()) return;
  if (SELF_REFERENCE.test(line)) return;
  if (r.allow && r.allow.test(line)) return;
  const entry = `[${scope}] ${r.name}: ${line.trim().slice(0, 100)}`;
  (r.severity === 'block' ? blockFindings : warnFindings).push(entry);
}



// ─── самопроверка ───────────────────────────────────────────────────────────
// У сторожа не было НИ ОДНОГО кейса до 2026-09-07, и именно поэтому он полгода
// печатал «секретов нет» на дереве без .git. Первое плечо здесь КРАСНОЕ: вход,
// на котором сторож ОБЯЗАН отказать. Кейс, который умеет только зеленеть,
// ничего не доказывает.
// @divergence: "дерево без .git не объявляется чистым" — до правки
// grepTree тот же вход давал «no real secrets» и код 0; правило и величина
// расходились ровно здесь.
function selfTest() {
  const wf = writeFileSync;
  const GUARD = fileURLToPath(import.meta.url);
  const AKIA = 'AKIA' + 'IOSFODNN7EXAMPLE';        // склеено, чтобы не сработать на себе
  let pass = 0, fail = 0;
  const ok = (name, cond) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } };

  const run = (cwd) => spawnSync(process.execPath, [GUARD], {
    cwd, encoding: 'utf8',
    env: { ...process.env, META_TRIP_LOG: join(cwd, 'trips.jsonl') },
  });

  const mk = (withGit) => {
    const d = mkdtempSync(join(tmpdir(), 'ppg-'));
    if (withGit) {
      spawnSync('git', ['init', '-q'], { cwd: d });
      wf(join(d, 'placeholder.txt'), 'seed\n');
      spawnSync('git', ['add', '-A'], { cwd: d });
      spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'seed'], { cwd: d });
    }
    return d;
  };

  // 1. КРАСНОЕ ПЛЕЧО: дерево без .git и с настоящим ключом обязано быть отказом,
  //    а не зелёной галочкой. Это тот вход, на котором сторож молчал.
  const noGit = mk(false);
  wf(join(noGit, 'leak.js'), 'const aws = "' + AKIA + '";\n');
  const r1 = run(noGit);
  ok('дерево без .git не объявляется чистым', r1.status !== 0);
  ok('отказ назван словами, а не молчанием', /не могу|cannot|не является|not a git/i.test((r1.stderr || '') + (r1.stdout || '')));
  ok('на непроверяемом дереве НЕ печатается «секретов нет»', !/no real secrets/.test((r1.stderr || '') + (r1.stdout || '')));
  rmSync(noGit, { recursive: true, force: true });

  // 2. Тот же файл в настоящем репозитории обязан БЛОКИРОВАТЬ. Пара к кейсу 1:
  //    без неё «отказывает всегда» тоже прошло бы.
  const withGit = mk(true);
  wf(join(withGit, 'leak.js'), 'const aws = "' + AKIA + '";\n');
  spawnSync('git', ['add', '-A'], { cwd: withGit });
  const r2 = run(withGit);
  ok('тот же ключ в настоящем репозитории блокирует', r2.status === 1);
  ok('в отчёте назван вид секрета', /AWS access key/.test((r2.stderr || '') + (r2.stdout || '')));
  rmSync(withGit, { recursive: true, force: true });

  // 3. Приватный ключ в репозитории обязан блокировать. Отдельное плечо, потому
  //    что именно это правило было мёртвым: шаблон начинается с дефиса, git читал
  //    его как опцию, падал со 129, и код возврата глотался.
  const keyRepo = mk(true);
  wf(join(keyRepo, 'id_rsa'), '-----BEGIN' + ' RSA PRIVATE KEY-----\nabc\n');
  spawnSync('git', ['add', '-A'], { cwd: keyRepo });
  const r4 = run(keyRepo);
  ok('блок приватного ключа блокирует (правило было мёртвым)', r4.status === 1);
  ok('и назван по имени', /private key block/.test((r4.stderr || '') + (r4.stdout || '')));
  rmSync(keyRepo, { recursive: true, force: true });

  // 4. Чистый репозиторий обязан пройти. Без этого плеча сторож мог бы просто
  //    всегда краснеть и оба верхних кейса были бы зелёными.
  const clean = mk(true);
  const r3 = run(clean);
  ok('чистый репозиторий проходит', r3.status === 0);
  ok('и говорит об этом прямо', /no real secrets/.test((r3.stderr || '') + (r3.stdout || '')));
  rmSync(clean, { recursive: true, force: true });

  console.log(`\npre-publish-guard self-test: ${pass} passed, ${fail} failed`);
  return fail === 0;
}


const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain && process.argv.includes('--self-test')) {
  process.exit(selfTest() ? 0 : 1);
}

if (isMain) {
  try {
    assertScannable();
  } catch (e) {
    if (!(e instanceof Unscannable)) throw e;
    console.error('\n\x1b[31m✗ pre-publish-guard ОТКАЗАЛ: не могу проверить это дерево\x1b[0m\n');
    console.error('  ' + e.message.split('\n').join('\n  '));
    console.error('\n  Отсутствие ответа это НЕ отсутствие секретов. Раньше здесь печаталась');
    console.error('  зелёная строка и код 0, то есть непроверенное выдавалось за чистое.');
    console.error('  Что делать: запускать сторож из рабочего дерева git. Установленная копия');
    console.error('  ~/.claude/jidoka репозиторием не является, и проверка там смысла не имеет.\n');
    process.exit(3);
  }

  for (const r of RULES) {
    for (const scope of r.scopes) {
      for (const line of SCAN[scope](r.re).split('\n')) classify(line, r, scope);
    }
  }

  // Optional deny-list: brand names, personal names — one term per line, # for comments.
  // Block-severity, tree + history (a name/brand leak is publish-sensitive like a secret).
  if (existsSync('.jidoka-denylist')) {
    const terms = readFileSync('.jidoka-denylist', 'utf8').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'));
    for (const term of terms) {
      const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      for (const scope of ['tree', 'history']) {
        for (const line of SCAN[scope](esc).split('\n')) {
          if (line.trim() && !SELF_REFERENCE.test(line)) blockFindings.push(`[${scope}] deny '${term}': ${line.trim().slice(0, 100)}`);
        }
      }
    }
  }

  if (warnFindings.length) {
    console.error('\n\x1b[33m⚠ pre-publish-guard warnings (non-blocking) — local home paths; parameterise with $HOME when you touch these files:\x1b[0m');
    for (const f of warnFindings.slice(0, 20)) console.error('  ' + f);
    if (warnFindings.length > 20) console.error(`  … and ${warnFindings.length - 20} more`);
  }

  if (blockFindings.length) {
    recordTrip('tree-not-history', 'scripts/pre-publish-guard.mjs'); // gate fired: a publish was blocked
    console.error('\n\x1b[31m✗ pre-publish-guard BLOCKED this push — a real secret was found:\x1b[0m\n');
    for (const f of blockFindings.slice(0, 40)) console.error('  ' + f);
    if (blockFindings.length > 40) console.error(`  … and ${blockFindings.length - 40} more`);
    console.error('\n  Rotate the secret, remove it from the TREE, then scrub HISTORY (orphan-commit');
    console.error('  rewrite — force-push alone leaks dangling commits reachable by SHA).');
    console.error('  See .claude/skills/pre-publish-checklist.md.\n');
    process.exit(1);
  }

  console.error(
    '\x1b[32m✓ pre-publish-guard: no real secrets in tree or history' +
    (warnFindings.length ? ` (${warnFindings.length} home-path warning${warnFindings.length > 1 ? 's' : ''})` : '') +
    '\x1b[0m',
  );
  process.exit(0);
}

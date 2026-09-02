#!/usr/bin/env node
/**
 * skills-sync — подтягивает отставший СТОРОННИЙ скилл из источника на диск.
 *
 * Это НЕ автоматический синк для всех отставших разом. `skills-diff.mjs` уже
 * показывает, где апстрим только ДОБАВИЛ (безопасно тянуть) и где что-то
 * УБРАЛ (тянуть вслепую значит стереть то, что у нас есть, и решение здесь —
 * за человеком, не за скриптом). Поэтому по умолчанию это dry-run: скрипт
 * говорит, что запишет, и не пишет, пока не передан --apply. Список скиллов
 * передаётся явно через --only — никакого «применить всё отставшее».
 *
 * Использование:
 *   node scripts/skills-sync.mjs --only hyperframes,seo-content-strategist        # план (dry-run)
 *   node scripts/skills-sync.mjs --only hyperframes,seo-content-strategist --apply
 *
 * Перед --apply посмотри отчёт skills-diff.mjs по этим именам: если там есть
 * ненулевая колонка «убрано в источнике», это НЕ тот случай для этого скрипта.
 *
 * @closes-class: installed-copy-drifts-from-upstream
 * @divergence: "вердикт/частичная-не-выглядит-успехом" — печать всегда показывала ✓,
 *              даже когда часть файлов не удалось получить (failed.length > 0);
 *              видимый символ «успех» не совпадал с фактом, что часть дрейфа осталась
 *              незакрытой.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readSkillLock, folderOf, upstreamMapForFolder, readLocalUnit, compareUnit, resolveLocalDir, isIgnored,
} from './skills-freshness.mjs';
import { treeOf, blob } from './skills-diff.mjs';

const HOME = os.homedir();
const SKILL_LOCK = path.join(HOME, '.agents', '.skill-lock.json');
const SKILL_ROOTS = [path.join(HOME, '.agents', 'skills'), path.join(HOME, '.claude', 'skills')];

async function syncOne(entry, apply) {
  const dir = resolveLocalDir(entry.name, SKILL_ROOTS);
  if (!dir) return { name: entry.name, error: 'не установлен локально — нечего обновлять' };

  const tree = await treeOf(entry.repo);
  if (!tree) return { name: entry.name, error: 'дерево источника недоступно (сеть/лимит)' };

  const folder = folderOf(entry.skillPath);
  const upstream = upstreamMapForFolder(tree, folder);
  const local = readLocalUnit(dir);
  const cmp = compareUnit(upstream, local, entry.name);

  if (cmp.verdict !== 'устарел') return { name: entry.name, skipped: `verdict=${cmp.verdict}, обновлять нечего` };

  const written = [];
  const failed = [];
  for (const relPath of [...cmp.missing, ...cmp.changed]) {
    const sha = upstream.get(relPath);
    if (!sha) { failed.push(relPath); continue; }
    const content = await blob(entry.repo, sha);
    if (content === null) { failed.push(relPath); continue; }
    const dest = path.join(dir, relPath);
    if (apply) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, content);
    }
    written.push(relPath);
  }
  return { name: entry.name, dir, written, failed, extra: cmp.extra };
}

/** Чистая: как назвать исход по факту (written/failed), а не одним символом на всё. */
export function syncVerdict({ written, failed }) {
  if (failed.length > 0) return written.length > 0 ? 'partial' : 'failed';
  return written.length > 0 ? 'ok' : 'nothing';
}

const VERDICT_SYMBOL = { ok: '✓', partial: '⚠', failed: '✘', nothing: '·' };

function selfTest() {
  const checks = [];
  const eq = (name, got, want) =>
    checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

  eq('вердикт/полный-успех', syncVerdict({ written: ['a.md'], failed: [] }), 'ok');
  eq('вердикт/полная-неудача', syncVerdict({ written: [], failed: ['a.md'] }), 'failed');
  // САМОЕ ВАЖНОЕ УТВЕРЖДЕНИЕ ЭТОГО ФАЙЛА — собственный кейс расхождения: часть файлов
  // записана (written непусто), значит наивная проверка «written.length>0 → успех»
  // сказала бы «чисто», а на самом деле часть дрейфа (failed) осталась незакрытой.
  eq('вердикт/частичная-не-выглядит-успехом', syncVerdict({ written: ['a.md'], failed: ['b.md'] }), 'partial');
  eq('вердикт/нечего-писать', syncVerdict({ written: [], failed: [] }), 'nothing');

  const failedChecks = checks.filter((c) => !c.ok);
  for (const c of checks) {
    if (c.ok) console.log(`  ✓ ${c.name}`);
    else console.log(`  ✗ ${c.name}\n      получено: ${JSON.stringify(c.got)}\n      ожидалось: ${JSON.stringify(c.want)}`);
  }
  console.log(`\nсамопроверка: ${checks.length - failedChecks.length}/${checks.length} прошли`);
  return failedChecks.length === 0 ? 0 : 1;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) process.exit(selfTest());
  const apply = argv.includes('--apply');
  const onlyIdx = argv.indexOf('--only');
  if (onlyIdx < 0 || !argv[onlyIdx + 1]) {
    console.error('нужен --only <имя,имя,...> — этот скрипт не трогает то, что не названо явно');
    process.exit(2);
  }
  const only = new Set(argv[onlyIdx + 1].split(',').map((s) => s.trim()).filter(Boolean));

  let lock;
  try { lock = readSkillLock(fs.readFileSync(SKILL_LOCK, 'utf8')); } catch (e) {
    console.error(`не удалось прочитать реестр: ${e.message}`);
    process.exit(2);
  }

  const targets = lock.filter((e) => only.has(e.name));
  const foundNames = new Set(targets.map((t) => t.name));
  for (const name of only) if (!foundNames.has(name)) console.error(`нет в реестре сторонних скиллов: ${name}`);

  const results = [];
  for (const entry of targets) results.push(await syncOne(entry, apply));

  for (const r of results) {
    if (r.error) { console.log(`✘ ${r.name}: ${r.error}`); continue; }
    if (r.skipped) { console.log(`— ${r.name}: ${r.skipped}`); continue; }
    const verdict = syncVerdict(r);
    const symbol = apply ? VERDICT_SYMBOL[verdict] : '·';
    const verb = apply ? 'записано' : 'будет записано (dry-run, добавь --apply)';
    console.log(`${symbol} ${r.name} (${r.dir}): ${verb} ${r.written.length} файлов`);
    for (const f of r.written) console.log(`    ${f}`);
    if (r.failed.length) console.log(`    не удалось получить (дрейф НЕ закрыт по этим файлам): ${r.failed.join(', ')}`);
    if (r.extra.length) console.log(`    есть только у нас, не тронуто: ${r.extra.join(', ')}`);
  }
}

const invokedDirectly = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  main().catch((e) => { console.error(`skills-sync: ошибка (${e.message})`); process.exit(1); });
}

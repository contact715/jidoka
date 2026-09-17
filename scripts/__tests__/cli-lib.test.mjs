// Строгий разбор аргументов (scripts/lib/cli.mjs) — класс extra-argument-silently-swallowed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCli, formatUsage, explain, HOOK_BAD_CALL_EXIT } from '../lib/cli.mjs';
import { cliCandidates, loadCli } from '../../hooks/lib/load-cli.mjs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const SPEC = {
  name: 't',
  selfTest: true,
  options: {
    json: { type: 'boolean' },
    repo: { type: 'string' },
    limit: { type: 'number', default: 5 },
    tier: { type: 'string', choices: ['light', 'deep'] },
    tag: { type: 'string', multiple: true, short: 't' },
  },
  positionals: { min: 1, max: 2, name: 'файл' },
};
const err = (argv, spec = SPEC) => parseCli(argv, spec).error;

test('незнакомый флаг — ошибка с именем флага', () => {
  assert.match(err(['a', '--bogus']), /незнакомый флаг --bogus/);
  assert.match(err(['a', '-z']), /незнакомый флаг -z/);
});

test('незнакомый флаг рядом с --self-test и --help — всё равно ошибка', () => {
  assert.ok(err(['--bogus', '--self-test']));
  assert.ok(err(['--help', '--bogus']));
});

test('--help и --self-test не требуют обязательных слов', () => {
  const h = parseCli(['--help'], SPEC);
  assert.equal(h.error, undefined);
  assert.equal(h.help, true);
  assert.equal(parseCli(['-h'], SPEC).help, true);
  assert.equal(parseCli(['--self-test'], SPEC).selfTest, true);
});

test('--self-test у скрипта без самопроверки — незнакомый флаг, а не молчаливая работа', () => {
  assert.match(err(['--self-test'], { options: {} }), /незнакомый флаг --self-test/);
  assert.doesNotMatch(formatUsage({ options: {} }, 'x'), /--self-test/);
});

test('лишнее слово ошибка и при --self-test', () => {
  assert.match(err(['--self-test', 'a', 'b', 'c']), /лишнее слово «c»/);
});

test('флаг без значения и значение у булева флага — ошибки', () => {
  assert.match(err(['a', '--repo']), /флагу --repo нужно значение/);
  assert.match(err(['a', '--json=1']), /флаг --json не принимает значения/);
});

test('значение, похожее на флаг, — ошибка (забытое значение не становится флагом)', () => {
  assert.match(err(['a', '--repo', '--json']), /похоже на флаг/);
  assert.match(err(['a', '--repo', '-x']), /похоже на флаг/);
});

test('текст с дефисом впереди берётся как есть — и в значении, и в позиции', () => {
  const r = parseCli(['- пункт', '--repo', '-fix: опечатка'], SPEC);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.positionals, ['- пункт']);
  assert.equal(r.values.repo, '-fix: опечатка');
  assert.equal(parseCli(['a', '--repo=--x'], SPEC).values.repo, '--x');
});

test('число проверяется, умолчание приходит числом', () => {
  assert.equal(parseCli(['a'], SPEC).values.limit, 5);
  assert.equal(parseCli(['a', '--limit', '12'], SPEC).values.limit, 12);
  assert.equal(parseCli(['a', '--limit', '-3'], SPEC).values.limit, -3);
  assert.match(err(['a', '--limit', 'abc']), /нужно число/);
  assert.match(err(['a', '--limit', '']), /нужно число/);
});

test('choices и multiple', () => {
  assert.match(err(['a', '--tier', 'medium']), /light \| deep/);
  assert.deepEqual(parseCli(['a', '-t', 'x', '--tag', 'y'], SPEC).values.tag, ['x', 'y']);
});

test('счёт позиционных: не хватает и лишнее', () => {
  assert.match(err([]), /не хватает аргументов \(файл\): нужно 1, дано 0/);
  assert.match(err(['a', 'b', 'c']), /лишнее слово «c»: принимается не больше 2/);
  assert.match(err(['x'], { options: {} }), /лишнее слово «x»/);
  assert.deepEqual(parseCli(['a', '--', '--json'], SPEC).positionals, ['a', '--json']);
});

const CMDS = {
  selfTest: true,
  options: { json: { type: 'boolean' } },
  commands: {
    next: {},
    done: { positionals: { min: 1, max: 1, name: 'id' } },
    add: { options: { prompt: { type: 'string' } }, positionals: { min: 1, max: 1 } },
    relay: { passthrough: 'jidoka-relay.mjs' },
    resume: { passthrough: 'run-state.mjs', prepend: ['--resume'] },
  },
};

test('команды: известная, незнакомая, отсутствующая', () => {
  assert.equal(parseCli(['next'], CMDS).command, 'next');
  assert.deepEqual(parseCli(['done', 'abc'], CMDS).positionals, ['abc']);
  assert.match(err(['nope'], CMDS), /незнакомая команда «nope»/);
  assert.match(err([], CMDS), /нужна команда/);
  assert.equal(parseCli(['--self-test'], CMDS).selfTest, true);
  assert.match(err(['done'], CMDS), /не хватает аргументов \(id\)/);
  assert.match(err(['next', 'extra'], CMDS), /лишнее слово «extra»/);
});

test('флаг чужой команды — ошибка; флаг своей и общий — нет', () => {
  assert.match(err(['next', '--prompt', 'x'], CMDS), /флаг --prompt не относится к команде «next»/);
  assert.equal(parseCli(['add', 't', '--prompt', 'x', '--json'], CMDS).values.prompt, 'x');
  assert.match(err(['--prompt', 'x', '--self-test'], CMDS), /только с командой/);
});

test('сквозная передача: хвост не разбирается здесь', () => {
  const r = parseCli(['relay', 'auto', '--cwd', '.', '--bogus'], CMDS);
  assert.equal(r.error, undefined);
  assert.equal(r.forward, 'jidoka-relay.mjs');
  assert.deepEqual(r.rest, ['auto', '--cwd', '.', '--bogus']);
  assert.deepEqual(parseCli(['resume', 'wave-1'], CMDS).prepend, ['--resume']);
  // --self-test после команды принадлежит цели, а не диспетчеру
  assert.equal(parseCli(['relay', '--self-test'], CMDS).selfTest, false);
});

test('defaultCommand подставляется, когда слово не дано', () => {
  assert.equal(parseCli([], { ...CMDS, defaultCommand: 'next' }).command, 'next');
});

test('справка всегда несёт коды выхода и встроенные флаги', () => {
  const u = formatUsage({ summary: 'Тест.', selfTest: true, options: { repo: { type: 'string', desc: 'куда' } } }, 'x');
  assert.match(u, /Коды выхода: 0/);
  assert.match(u, /--repo <значение>\s+куда/);
  assert.match(u, /-h, --help/);
  assert.match(u, /--self-test/);
  assert.equal(formatUsage({ usage: 'Usage: x\nExit codes: 0 ok' }), 'Usage: x\nExit codes: 0 ok');
});

test('ошибка в спецификации — исключение, а не молчаливый пропуск', () => {
  assert.throws(() => parseCli([], { options: { x: { type: 'int' } } }), /тип должен быть/);
  assert.throws(() => parseCli([], { options: { x: { type: 'string', defualt: 1 } } }), /незнакомое поле «defualt»/);
});

test('explain без кода отдаёт текст как есть', () => {
  assert.equal(explain(new Error('что-то')), 'что-то');
});

test('позиционный из списка: чужое слово — ошибка', () => {
  const spec = { positionals: { min: 1, max: 1, name: 'событие', choices: ['Stop', 'PreToolUse'] } };
  assert.equal(parseCli(['Stop'], spec).error, undefined);
  assert.match(err(['Stopp'], spec), /«Stopp» не из списка \(событие\): Stop \| PreToolUse/);
});

test('у хука справка называет неблокирующий код неверного вызова', () => {
  assert.match(formatUsage({ badCallExit: HOOK_BAD_CALL_EXIT }, 'h'), /неверный вызов — 1/);
  assert.equal(HOOK_BAD_CALL_EXIT, 1);
});

test('хук: помощник ищется сначала в установке, потом в каноне, без домашнего каталога', () => {
  assert.deepEqual(cliCandidates('/h/.claude/hooks'), ['/h/.claude/jidoka/scripts/lib/cli.mjs', '/h/.claude/scripts/lib/cli.mjs']);
  assert.equal(cliCandidates('/r/global-setup/hooks').at(-1), '/r/scripts/lib/cli.mjs');
  assert.deepEqual(cliCandidates('/h/.claude'), ['/h/.claude/jidoka/scripts/lib/cli.mjs']);
  assert.deepEqual(cliCandidates('/r/global-setup'), ['/r/scripts/lib/cli.mjs']);
  // hooks/lib — библиотека хуков: ищем от каталога хуков, а не от lib
  assert.deepEqual(cliCandidates('/h/.claude/hooks/lib'), cliCandidates('/h/.claude/hooks'));
  assert.deepEqual(cliCandidates('/r/hooks/lib'), cliCandidates('/r/hooks'));
  assert.ok(!cliCandidates('/h/.claude/hooks').some((p) => p === '/h/scripts/lib/cli.mjs'), '../../ вне global-setup ушло бы в чужой HOME');
});

test('хук: из канона находится настоящий помощник', async () => {
  const repo = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  const m = await loadCli(pathToFileURL(join(repo, 'hooks', 'x.mjs')).href);
  assert.equal(m.HOOK_BAD_CALL_EXIT, 1);
});

test('хук: без помощника — громкая ошибка, а не молчаливый пропуск разбора', async () => {
  await assert.rejects(loadCli('file:///nowhere/hooks/x.mjs', () => false), /не найден scripts\/lib\/cli\.mjs/);
});

test('справка без явного имени скрипта берёт имя из спецификации', () => {
  assert.match(formatUsage({ name: 'auto-strengthen', options: {} }), /node scripts\/auto-strengthen\.mjs/);
});

test('опечатка в любом поле спецификации — исключение, а не молчаливый пропуск', () => {
  assert.throws(() => parseCli([], { optoins: {} }), /незнакомое поле спецификации «optoins»/);
  assert.throws(() => parseCli(['x'], { positionals: { min: 1, max: 1, choises: ['x'] } }), /«choises»/);
  assert.throws(() => parseCli(['a'], { commands: { a: { opts: {} } } }), /«opts»/);
  assert.throws(() => parseCli([], { badCallExit: 3 }), /badCallExit/);
  assert.throws(() => parseCli([], { badcallExit: 1 }), /«badcallExit»/);
});

test('похожее на флаг — отказ, а не позиционное слово', () => {
  const spec = { options: { fix: { type: 'boolean' } }, positionals: { min: 0, max: 5 } };
  for (const bad of ['--fiх', '—fix', '–fix', '--fix ', ' --fix', '--foo.bar', '-х', '--bogus\n']) {
    assert.match(parseCli([bad], spec).error || '', /похоже на флаг/, JSON.stringify(bad));
  }
  assert.deepEqual(parseCli(['- пункт', '-5', '-fix: опечатка в доке', '—', 'слово'], spec).positionals, ['- пункт', '-5', '-fix: опечатка в доке', '—', 'слово']);
  assert.deepEqual(parseCli(['--', '—fix', '--fiх'], spec).positionals, ['—fix', '--fiх']);
  assert.equal(parseCli(['--fix'], spec).values.fix, true);
});

test('значение, похожее на флаг, через «=» принимается', () => {
  assert.equal(parseCli(['--note=—тест'], { options: { note: { type: 'string' } } }).values.note, '—тест');
});

test('число — только десятичная запись', () => {
  const spec = { options: { n: { type: 'number' } } };
  for (const bad of [' ', '0x10', '1e3', '12abc', 'Infinity']) assert.match(parseCli(['--n', bad], spec).error || '', /нужно число/, bad);
  assert.equal(parseCli(['--n', '-3'], spec).values.n, -3);
  assert.equal(parseCli(['--n', '2.5'], spec).values.n, 2.5);
  assert.equal(parseCli(['--n=+7'], spec).values.n, 7);
});

test('умолчание и список значений флага действуют только в своей команде', () => {
  const spec = { commands: {
    a: { options: { dry: { type: 'boolean', default: true }, mode: { type: 'string', choices: ['x'] } } },
    b: { options: { dry: { type: 'boolean' }, mode: { type: 'string', choices: ['y'] } } },
  } };
  assert.equal(parseCli(['a'], spec).values.dry, true);
  assert.equal(parseCli(['b'], spec).values.dry, undefined);
  assert.equal(parseCli(['b', '--mode', 'y'], spec).values.mode, 'y');
  assert.match(parseCli(['a', '--mode', 'y'], spec).error || '', /принимает x/);
});

test('справка называет общий флаг команд один раз', () => {
  const u = formatUsage({ name: 'k', commands: { plan: { options: { week: { type: 'string' } } }, dispatch: { options: { week: { type: 'string' } } } } });
  assert.equal(u.match(/--week/g).length, 1);
  assert.match(u, /только plan, dispatch/);
});

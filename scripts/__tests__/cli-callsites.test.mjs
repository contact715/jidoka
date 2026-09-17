// Места вызова скриптов движка разбираются их строгими спецификациями.
// Строгий разбор ломает вызов, который раньше молча проходил; этот тест находит такой вызов
// в репозитории до выкладки. ~/.claude сюда не входит (в CI его нет) — для него
// `node scripts/cli-strictness.mjs --callsites --home` на машине владельца.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandWords, normalizeWord, extract, isLive, collect, PLACEHOLDER, RUNTIME } from '../lib/cli-callsites.mjs';
import { judge, replay, replayInSandbox } from '../lib/cli-replay.mjs';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const args = (text) => extract(text, 'x.sh')[0].args;

describe('извлечение вызова', () => {
  it('флаги, значения в кавычках и конец команды', () => {
    assert.deepEqual(args('node scripts/a.mjs --doc "мой файл.md" --json | head'), ['--doc', 'мой файл.md', '--json']);
    assert.deepEqual(args('out=$(node "$ROOT/scripts/a.mjs" --all 2>&1); rc=$?'), ['--all']);
  });
  it('заполнители документации становятся словом X', () => {
    assert.deepEqual(args('node scripts/a.mjs <class> "<claimed>" --mode <FM-x.y>'), [PLACEHOLDER, PLACEHOLDER, '--mode', PLACEHOLDER]);
    assert.deepEqual(args('node scripts/a.mjs --file "$f" ${X}'), ['--file', RUNTIME, RUNTIME]);
  });
  it('необязательные части в скобках раскрываются', () => {
    assert.deepEqual(args('node scripts/a.mjs [--json] [--repo <path>]'), ['--json', '--repo', PLACEHOLDER]);
  });
  it('комментарий shell и проза после тире не попадают в аргументы', () => {
    assert.deepEqual(args('node scripts/a.mjs next   # start next'), ['next']);
    assert.deepEqual(args('node scripts/a.mjs next — доведи её до конца'), ['next']);
  });
  it('перенаправление ввода — конец команды, а не заполнитель', () => {
    assert.deepEqual(args('node hooks/h.mjs Stop </dev/null'), ['Stop']);
  });
  it('команда в строке JS режется по её кавычке', () => {
    const c = extract("run('node scripts/a.mjs --json'), other('--x')", 'y.mjs')[0];
    assert.deepEqual(c.args, ['--json']);
  });
  it('имя скрипта в строке без аргументов — упоминание, а не вызов', () => {
    const c = extract('"jidoka:log":"node .jidoka/scripts/meta-log.mjs","x":1', 'y.mjs')[0];
    assert.equal(c.mention, true);
    assert.deepEqual(c.args, []);
  });
  it('многоточие делает вызов неполным', () => {
    assert.equal(extract('node scripts/a.mjs ...  # append', 'y.md')[0].partial, true);
  });
  it('package.json — вызов неполный: хвост допишет npm run … --', () => {
    assert.equal(extract('"meta:log": "node scripts/meta-log.mjs"', 'package.json')[0].partial, true);
  });
  it('история не считается живым местом вызова', () => {
    assert.equal(isLive('docs/retros/wave-1.md'), false);
    assert.equal(isLive('global-setup/CLAUDE.md'), true);
    assert.equal(isLive('.githooks/pre-commit'), true);
  });
  it('экранированная обратная кавычка внутри шаблона JS заканчивает команду', () => {
    const src = 'const hint = `запусти \\`node scripts/a.mjs --dry\\` и проверь`;';
    assert.deepEqual(extract(src, 'y.mjs')[0].args, ['--dry']);
  });
  it('заполнитель с продолжением пути — одно слово X', () => {
    assert.deepEqual(args('node scripts/a.mjs --doc <path>/docs/NORTH_STAR.md'), ['--doc', PLACEHOLDER]);
  });
  it('пояснение после выравнивающих пробелов — не аргументы', () => {
    assert.deepEqual(args('node scripts/a.mjs --resume [<волна>]       без волны — последняя'), ['--resume', PLACEHOLDER]);
    assert.deepEqual(args('node scripts/a.mjs eval   ·   node scripts/a.mjs resume'), ['eval']);
  });
  it('скобка с пояснением — конец команды', () => {
    assert.deepEqual(args("node scripts/a.mjs --scope 'x/**' (--written a,b | --git)"), ['--scope', 'x/**']);
  });
  it('перенос внутри строки JS (текст \\\\\\n) — вызов неполный, слэш выброшен', () => {
    const c = extract("'node scripts/a.mjs \\\\\\n' +\n'  --doc x'", 'y.mjs')[0];
    assert.equal(c.partial, true);
    assert.ok(!c.args.includes('\\'));
  });
  it('перенос shell (слэш и настоящий перевод строки) — команда продолжается', () => {
    assert.deepEqual(args('node scripts/a.mjs \\\n  --doc x'), ['--doc', 'x']);
  });
  it('N и прочие одиночные заглавные — заполнители', () => {
    assert.deepEqual(args('node scripts/a.mjs --limit N'), ['--limit', PLACEHOLDER]);
  });
  it('русская проза без кавычек после команды — конец команды, в кавычках — аргумент', () => {
    assert.deepEqual(args('node scripts/a.mjs даст блок для вставки'), []);
    assert.deepEqual(args('node scripts/a.mjs --repo . и убедиться'), ['--repo', '.']);
    assert.deepEqual(args('node scripts/a.mjs log "заявлено" --json'), ['log', 'заявлено', '--json']);
  });
  it('имя скрипта, склеенное с интерполяцией, — не вызов с аргументами', () => {
    const c = extract("`node scripts/a.mjs${' '.repeat(3)}│`", 'y.mjs')[0];
    assert.deepEqual(c.args, []);
  });
  it('экранированные кавычки внутри echo "…" — аргумент в кавычках, а не конец команды', () => {
    assert.deepEqual(args('echo "    node scripts/a.mjs --gate tests --run \\"npm test\\""'), ['--gate', 'tests', '--run', 'npm test']);
  });
  it('инлайн-код markdown, перенесённый на другую строку, — вызов неполный', () => {
    const c = extract('см. `node scripts/a.mjs --task\n"<запрос>"` дальше', 'x.md')[0];
    assert.equal(c.partial, true);
  });
  it('выравнивание пробелами между аргументами — не конец команды', () => {
    assert.deepEqual(args('node scripts/a.mjs log    <class> "<note>"   # record'), ['log', PLACEHOLDER, PLACEHOLDER]);
  });
  it('русское имя файла после флага — значение, а не проза', () => {
    assert.deepEqual(args('node scripts/a.mjs -o отчёт.md         # в файл'), ['-o', 'отчёт.md']);
  });
  it('спецификация модуля — живое место вызова, бриф прошлой волны — история', () => {
    assert.equal(isLive('docs/specs/modules/x/y.md'), true);
    assert.equal(isLive('docs/specs/briefs/wave-1_UX.md'), false);
    assert.equal(isLive('docs/metrics/ac-verify-map.json'), false);
  });
  it('статус-строка из ~/.claude собирается как вызов global-setup', () => {
    const c = extract('node /Users/x/.claude/statusline-jidoka.mjs --bogus', 'settings.json')[0];
    assert.equal(c.script, 'global-setup/statusline-jidoka.mjs');
    assert.deepEqual(c.args, ['--bogus']);
  });
  it('заполнитель внутри пути и после «=» — часть слова', () => {
    assert.deepEqual(args('node scripts/a.mjs --golden docs/evals/<agent>/cases.jsonl --name=<outcome>'), ['--golden', PLACEHOLDER, `--name=${PLACEHOLDER}`]);
  });
  it('$ARGUMENTS — заполнитель запуска, отдельный от заполнителя документации', () => {
    assert.deepEqual(args('node scripts/a.mjs $ARGUMENTS'), [RUNTIME]);
  });
  it('commandWords не падает на пустом хвосте', () => assert.equal(commandWords('').length, 0));
  it('normalizeWord выбрасывает пустое слово', () => assert.equal(normalizeWord({ w: '', quoted: false }), null));
});

describe('вердикт по вызову', () => {
  const SPEC = { options: { json: { type: 'boolean' }, mode: { type: 'string', choices: ['a', 'b'] } }, positionals: { min: 1, max: 1 } };
  it('незнакомый флаг — сломанное место', () => {
    assert.equal(judge({ args: ['x', '--bogus'] }, SPEC).ok, false);
  });
  it('неполный вызов без обязательных слов — не сломан', () => {
    assert.equal(judge({ args: ['--json'], partial: true }, SPEC).ok, true);
  });
  it('неполный вызов без значения флага — не сломан (значение допишет npm run … --)', () => {
    const spec = { options: { snapshot: { type: 'string' } } };
    assert.equal(judge({ args: ['--snapshot'], partial: true }, spec).ok, true);
    assert.equal(judge({ args: ['--snapshot'] }, spec).ok, false);
  });
  it('неполный вызов с незнакомым флагом — всё равно сломан', () => {
    assert.equal(judge({ args: ['--bogus'], partial: true }, SPEC).ok, false);
  });
  it('заполнитель X в значении со списком — не сломан', () => {
    assert.equal(judge({ args: ['y', '--mode', PLACEHOLDER] }, SPEC).ok, true);
  });
  it('аргументы модулю без точки входа — сломанное место: их никто не читает', () => {
    const r = replay([{ script: 'scripts/lib.mjs', args: ['--self-test'] }, { script: 'scripts/lib.mjs', args: [] }], new Map(), new Set(['scripts/lib.mjs']));
    assert.equal(r.failures.length, 1);
    assert.match(r.failures[0].error, /нет точки входа/);
  });
  it('заполнитель как лишнее слово — поломка: скрипт слов не принимает', () => {
    assert.equal(judge({ args: [PLACEHOLDER] }, { options: {} }).ok, false);
    assert.equal(judge({ args: [RUNTIME] }, { options: {} }).ok, false);
  });
  it('<команда> из документации на месте подкоманды — не поломка, $ARGUMENTS там — поломка', () => {
    assert.equal(judge({ args: [PLACEHOLDER] }, { commands: { a: {} } }).ok, true);
    assert.equal(judge({ args: [RUNTIME] }, { commands: { a: {} } }).ok, false);
  });
  it('вызов несуществующего скрипта движка — поломка', () => {
    const r = replay([{ script: 'scripts/no-such.mjs', prefix: '', args: ['--x'], kind: 'repo', source: '.githooks/pre-push' },
      { script: 'scripts/no-such.mjs', prefix: '', args: ['--x'], kind: 'repo', source: 'scripts/y.mjs' }], new Map(), new Set(), new Set(['scripts/no-such.mjs']));
    assert.equal(r.failures.length, 1);
    assert.match(r.failures[0].error, /скрипта нет/);
  });
  it('диспетчер: хвост сверяется со спецификацией цели', () => {
    const specs = new Map([
      ['scripts/d.mjs', { commands: { go: { passthrough: 't.mjs' } } }],
      ['scripts/t.mjs', { options: { json: { type: 'boolean' } } }],
    ]);
    const r = replay([{ script: 'scripts/d.mjs', args: ['go', '--bogus'] }], specs);
    assert.equal(r.failures.length, 1);
    assert.equal(r.failures[0].via, 'scripts/d.mjs');
  });
});

describe('живые места вызова в репозитории', () => {
  const calls = collect(ROOT, { kind: 'repo' });
  const r = replayInSandbox(ROOT, calls);
  it('вызовов найдено и сверено не ноль', () => {
    assert.ok(calls.length > 100, `найдено ${calls.length}`);
    assert.ok(r.checked > 0, 'ни одного переведённого скрипта — сверка ничего не проверила');
  });
  it('модули переведённых скриптов импортируются без действий', () => {
    assert.deepEqual(r.attempts, []);
    assert.deepEqual(r.broken, []);
  });
  it('ни одно живое место вызова не сломано строгим разбором', () => {
    const live = r.failures.filter((f) => isLive(f.source));
    assert.deepEqual(live.map((f) => `${f.source}:${f.line} ${f.script}: ${f.error}`), []);
  });
});

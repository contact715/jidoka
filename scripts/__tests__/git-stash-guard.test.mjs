// Сторож общего стека git stash — класс agent-uses-shared-git-stash (2026-09-17).
//
// Стек stash один на основную папку и все worktree, а сессий Claude несколько. Дважды за одну
// волну исполнитель сделал `git stash` / `git stash pop` вопреки запрету в задании: запрет жил
// только в тексте. Здесь проверяется, что сторож судит ДЕЙСТВИЕ (настоящие слова команды), а не
// упоминание в сообщении коммита — класс guard-fires-on-mention-not-action.
//
// Два уровня: чистое правило на таблице и живой хук, запущенный как процесс с событием в stdin.
// Второй уровень нужен потому, что правило, верное в модуле, но не подключённое к хуку, ничего не
// блокирует (класс fix-dead-because-tested-at-wrong-level).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { simpleCommands } from '../../hooks/lib/shell-commands.mjs';
import { stashViolations, stashVerdict, STASH_RECIPES } from '../../hooks/lib/git-stash-rule.mjs';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const HOOK = join(ROOT, 'hooks', 'permission-gate.mjs');

const heredocCommit = [
  "git commit -q -F - <<'EOF'",
  'fix: исполнителям запрещён git stash pop',
  '',
  'Агент сделал git stash && git stash pop; стек общий.',
  'EOF',
].join('\n');

const prBodyWithApostrophe = [
  'gh pr create --title x --body "$(cat <<\'EOF\'',
  "Don't run git stash pop here; it's shared.",
  'EOF',
  ')"',
].join('\n');

const DEEP = 'команда глубже разбора';
const label = (cmd) => {
  const t = JSON.stringify(cmd);
  return t.length > 110 ? `${t.slice(0, 80)}… (${cmd.length} симв.)` : t;
};
const nestedEval = (depth) => {
  let c = 'git stash pop';
  for (let n = 0; n < depth; n++) c = `eval ${JSON.stringify(c)}`;
  return c;
};

// [команда, ожидаемая форма нарушения]
const BLOCK = [
  ['git stash', 'git stash'],
  ['git stash save "wip"', 'git stash save'],
  ['git stash pop', 'git stash pop'],
  ['git stash pop stash@{0}', 'git stash pop'],
  ['git stash push', 'git stash push без -m'],
  ['git stash push -u', 'git stash push без -m'],
  ['git stash push -u -m ""', 'git stash push без -m'],
  ['git stash -u', 'git stash push без -m'],
  ['git stash -- src/a.ts', 'git stash push без -m'],
  ['git stash apply', 'git stash apply без SHA'],
  ['git stash apply stash@{0}', 'git stash apply без SHA'],
  ['git stash drop', 'git stash drop без ссылки'],
  ['git stash clear', 'git stash clear'],
  ['git stash branch tmp', 'git stash branch'],
  ['git stash create', 'git stash create'],
  ['git -C /some/dir stash pop', 'git stash pop'],
  ['git -C "/dir with space" stash', 'git stash'],
  ['git --git-dir=/x/.git --work-tree /x stash pop', 'git stash pop'],
  ['git -c core.pager=cat --no-pager stash', 'git stash'],
  ['/usr/bin/git stash pop', 'git stash pop'],
  ['cd repo && git stash && npm test && git stash pop', 'git stash'],
  ['npm test; git stash pop', 'git stash pop'],
  ['false || git stash', 'git stash'],
  ['npm test&git stash pop', 'git stash pop'],
  ['(cd x && git stash pop)', 'git stash pop'],
  ['git stash pop | cat', 'git stash pop'],
  ['git status\ngit stash pop', 'git stash pop'],
  ['git \\\n  stash pop', 'git stash pop'],
  ['echo "$(git stash pop)"', 'git stash pop'],
  ['echo `git stash`', 'git stash'],
  ['x=$( (cd a; git stash pop) )', 'git stash pop'],
  ["bash -c 'git stash pop'", 'git stash pop'],
  ['sh -lc "cd x && git stash"', 'git stash'],
  ['zsh -c "git -C /r stash pop"', 'git stash pop'],
  ['eval "git stash pop"', 'git stash pop'],
  ["bash <<< 'git stash pop'", 'git stash pop'],
  ["bash <<'EOF'\ncd x\ngit stash pop\nEOF", 'git stash pop'],
  ['FOO=1 git stash pop', 'git stash pop'],
  ['env GIT_DIR=x git stash', 'git stash'],
  ['command git stash', 'git stash'],
  ['timeout 30 git stash pop', 'git stash pop'],
  ['nice -n 5 git stash pop', 'git stash pop'],
  ['git commit -m "$(git stash pop)"', 'git stash pop'],
  ['cat <<EOF\n`git stash pop`\nEOF', 'git stash pop'],
  ['git stash apply abc1234 && git stash drop', 'git stash drop без ссылки'],
  ['git stash list && git stash pop', 'git stash pop'],
  // второй круг: находки красной команды 2026-09-17
  ['REF=$(git stash list | head -1); git stash drop $REF', 'git stash drop без ссылки'],
  ['git stash drop $(git stash list | awk "/t/{print $1}")', 'git stash drop без ссылки'],
  ['git stash apply $SHA', 'git stash apply без SHA'],
  ['git stash push -u -m $TAG', 'git stash push без -m'],
  ['git stash apply 0000000', 'git stash apply без SHA'],
  ["echo 'git stash pop' | bash", 'git stash pop'],
  ["printf 'git stash\\n' | sh", 'git stash'],
  ["cat <<'EOF' | bash\ngit stash pop\nEOF", 'git stash pop'],
  ["bash - <<'EOF'\ngit stash pop\nEOF", 'git stash pop'],
  ["bash /dev/stdin <<'EOF'\ngit stash pop\nEOF", 'git stash pop'],
  ['G=git; $G stash pop', 'git stash pop'],
  ['${GIT:-git} stash pop', 'git stash pop'],
  ['"$GIT" stash', 'git stash'],
  ['GIT stash pop', 'git stash pop'],
  ['"$(git --exec-path)"/git-stash pop', 'git stash pop'],
  ["git -c alias.sp='stash pop' sp", 'git stash pop'],
  ["git -c 'alias.sp=!git stash pop' sp", 'git stash pop'],
  ['find . -maxdepth 0 -exec git stash pop \\;', 'git stash pop'],
  ['x=$(cat <<EOF\nhi\nEOF)\ngit stash pop', 'git stash pop'],
  ['function f { git stash pop; }; f', 'git stash pop'],
  ['(( x = 1<<2 ))\ngit stash pop', 'git stash pop'],
  ["bash -c $'git\\x20stash\\x20pop'", 'git stash pop'],
  ["bash -c $'git\\040stash\\040pop'", 'git stash pop'],
  ['$"git" stash pop', 'git stash pop'],
  ['=git stash pop', 'git stash pop'],
  ['repeat 1 git stash pop', 'git stash pop'],
  ['caffeinate -i git stash pop', 'git stash pop'],
  ['stdbuf -oL git stash pop', 'git stash pop'],
  ["env -S 'git stash pop'", 'git stash pop'],
  ['sudo -iu me git stash pop', 'git stash pop'],
  [`${Array.from({ length: 70 }, (_, n) => `V${n}=1`).join(' ')} git stash pop`, 'git stash pop'],
  [`${'nice -x '.repeat(70)}git stash pop`, 'git stash pop'],
  [nestedEval(7), DEEP],
  [`${'$('.repeat(4900)}true${')'.repeat(4900)}; git stash pop`, DEEP],
  ['git stash save -- --help', 'git stash save'],
  ['git stash store -m -h abc1234', 'git stash store'],
  ['git stash push -m x --no-message', 'git stash push без -m'],
  ['git commit --no-verify -m x && git stash pop', 'git stash pop'],
];

const ALLOW = [
  'git stash list',
  "git stash list --format='%H %gs'",
  'git stash show -p stash@{1}',
  'git stash show',
  'git stash push -u -m "wave-368-baseline"',
  'git stash push -m tag',
  'git stash push --message=tag -u',
  'git stash push --message tag',
  'git stash push -mtag',
  'git stash push -um tag',
  'git stash -u -m tag',
  'git stash apply 3f2a9c1',
  'git stash apply --index 3f2a9c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a39',
  'git stash drop stash@{2}',
  'git stash drop -q stash@{0}',
  'git stash --help',
  'git -C /x stash list',
  'git commit -m "never run git stash pop here"',
  "git commit -m 'агент сделал git stash; git stash pop'",
  "git commit -m '$(git stash pop)'",
  heredocCommit,
  prBodyWithApostrophe,
  "echo 'git stash pop'",
  'echo git stash pop',
  'grep -rn "git stash" docs/',
  'node x.mjs --note "agent ran git stash; git stash pop"',
  'git status # потом: git stash pop',
  'git log --grep=stash',
  'git worktree add --detach ../base origin/main',
  'stash pop',
  'git status',
  '',
  // второй круг
  ...STASH_RECIPES,
  'SHA=$(git stash list --format=\'%H %gs\' | awk \'/wave-368/{print $1; exit}\'); git stash apply "$SHA"',
  'REF=$(git stash list --format=\'%gd %gs\' | awk \'/wave-368/{print $1; exit}\'); git stash drop "$REF"',
  'git stash push -u -m "$TAG"',
  "git commit -F - <<'EOF'\nsubject\nEOF \ngit stash pop\nEOF",
  'git stash push --mess=tag',
  'git stash push -m"l1\nl2"',
  'git stash pop -h',
  'git stash --help',
  "python3 - <<'PY'\nimport subprocess\nprint('git stash pop')\nPY",
  "node -e \"console.log('git stash pop')\"",
  "cat <<EOF | grep stash\ngit stash pop\nEOF",
  "echo 'git stash pop' | cat",
  'nice -n 5 git stash list',
  'find . -name "*.stash" -exec rm {} \\;',
  'echo $((1<<2)) && git stash list',
  `${'nice -x '.repeat(70)}git stash list`,
  nestedEval(3).replace('pop', 'list'),
];

describe('разбор команды оболочки на настоящие слова', () => {
  it('кавычки склеиваются в одно слово, цепочка делится на команды', () => {
    const cmds = simpleCommands('cd "a b" && git -C \'x y\' stash list; echo ok').map((c) => c.argv);
    assert.deepEqual(cmds, [['cd', 'a b'], ['git', '-C', 'x y', 'stash', 'list'], ['echo', 'ok']]);
  });
  it('перенаправления не попадают в слова команды', () => {
    const cmds = simpleCommands('git stash list 2>&1 > /tmp/out.txt').map((c) => c.argv);
    assert.deepEqual(cmds, [['git', 'stash', 'list']]);
  });
  it('тело heredoc — данные, а не команда', () => {
    const cmds = simpleCommands(heredocCommit).map((c) => c.argv);
    assert.deepEqual(cmds, [['git', 'commit', '-q', '-F', '-']]);
  });
  it('подстановка $(...) разбирается как отдельная команда, даже с апострофом в heredoc', () => {
    const cmds = simpleCommands(prBodyWithApostrophe).map((c) => c.argv[0]);
    assert.deepEqual(cmds.sort(), ['cat', 'gh']);
  });
});

describe('правило формы git stash', () => {
  it('таблица не пустая: зелёный на пустом множестве был бы ложным', () => {
    assert.ok(BLOCK.length >= 80 && ALLOW.length >= 50);
  });
  it('рецепты из текста отказа сами проходят сторож', () => {
    assert.ok(STASH_RECIPES.length >= 3);
    for (const r of STASH_RECIPES) assert.deepEqual(stashViolations(r), [], r);
  });
  it('огромная команда разбирается быстро (без квадратичного роста)', () => {
    const big = `${'nice -x '.repeat(25000)}git stash pop`;
    const t = Date.now();
    assert.equal(stashViolations(big).length, 1);
    assert.ok(Date.now() - t < 1500, `медленно: ${Date.now() - t} мс`);
  });
  for (const [cmd, form] of BLOCK) {
    it(`блокирует: ${label(cmd)}`, () => {
      const v = stashViolations(cmd);
      assert.ok(v.length >= 1, `не заблокировано: ${cmd}`);
      assert.ok(v.some((x) => x.form === form), `ожидалась форма «${form}», получено ${JSON.stringify(v.map((x) => x.form))}`);
      assert.ok(v.every((x) => typeof x.reason === 'string' && x.reason.length > 10), 'у нарушения нет причины');
    });
  }
  for (const cmd of ALLOW) {
    it(`пропускает: ${label(cmd)}`, () => {
      assert.deepEqual(stashViolations(cmd), []);
    });
  }
  it('stashVerdict отдаёт форму и для разрешённой записи', () => {
    assert.equal(stashVerdict(['list']).allowed, true);
    assert.equal(stashVerdict(['pop']).allowed, false);
  });
  it('мусор на входе не роняет правило', () => {
    for (const junk of [null, undefined, 42, '"незакрытая кавычка git stash pop', '$(git stash pop', '`git stash']) {
      assert.doesNotThrow(() => stashViolations(junk));
    }
  });
  it('незакрытая подстановка всё равно считается исполнением', () => {
    assert.equal(stashViolations('echo $(git stash pop').length, 1);
  });
});

describe('живой хук permission-gate: событие в stdin, код выхода, текст отказа', () => {
  const run = (input, ledger = []) => {
    const dir = mkdtempSync(join(tmpdir(), 'stash-guard-'));
    try {
      const ledgerPath = join(dir, 'ledger.jsonl');
      if (ledger.length) writeFileSync(ledgerPath, ledger.map((e) => JSON.stringify(e)).join('\n') + '\n');
      const r = spawnSync(process.execPath, [HOOK], {
        input: typeof input === 'string' ? input : JSON.stringify({ ...input, cwd: dir }),
        encoding: 'utf8',
        cwd: dir,
        env: { ...process.env, JIDOKA_PERMISSIONS: ledgerPath },
        timeout: 15000,
      });
      return { code: r.status, err: r.stderr || '' };
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });

  it('git -C <папка> stash pop блокируется кодом 2 и называет безопасную замену', () => {
    const r = run(bash('cd /r && git -C /r stash pop'));
    assert.equal(r.code, 2, r.err);
    assert.match(r.err, /git stash pop/);
    assert.match(r.err, /git worktree add --detach/);
    assert.match(r.err, /WIP/);
    assert.match(r.err, /git stash push -u -m/);
  });
  it('разрешения на опасную форму не предлагается', () => {
    const r = run(bash('git stash'));
    assert.equal(r.code, 2, r.err);
    assert.doesNotMatch(r.err, /permission-ledger\.mjs grant/);
  });
  it('безопасная форма проходит', () => {
    assert.equal(run(bash('git stash push -u -m "wave-368-base"')).code, 0);
  });
  it('упоминание в сообщении коммита проходит', () => {
    assert.equal(run(bash(heredocCommit)).code, 0);
  });
  it('прежнее правило про --no-verify по-прежнему блокирует', () => {
    const r = run(bash('git commit --no-verify -m x'));
    assert.equal(r.code, 2, r.err);
    assert.match(r.err, /permission-ledger\.mjs grant git-no-verify/);
  });
  it('живое разрешение на --no-verify не отключает проверку stash (находка красной команды)', () => {
    const grant = { type: 'grant', id: 'g1', action: 'git-no-verify', scope: '*', by: 'test', reason: 'test', at: Date.now(), expiresAt: Date.now() + 3600_000 };
    assert.equal(run(bash('git commit --no-verify -m x'), [grant]).code, 0, 'разрешение само по себе должно пропускать');
    const r = run(bash('git commit --no-verify -m x && git stash pop'), [grant]);
    assert.equal(r.code, 2, r.err);
    assert.match(r.err, /git stash pop/);
  });
  it('Monitor и терминал тоже судятся: они исполняют команду оболочки', () => {
    assert.equal(run({ tool_name: 'Monitor', tool_input: { command: 'git stash pop', description: 'x' } }).code, 2);
    assert.equal(run({ tool_name: 'mcp__terminal__run_in_terminal', tool_input: { command: 'git -C /r stash' } }).code, 2);
    assert.equal(run({ tool_name: 'Monitor', tool_input: { ws: { url: 'wss://x' }, description: 'x' } }).code, 0);
  });
  it('инструмент без команды оболочки не судится', () => {
    assert.equal(run({ tool_name: 'Write', tool_input: { command: 'git stash pop' } }).code, 0);
  });
  it('испорченный вход пропускается (fail-open)', () => {
    assert.equal(run('{not json').code, 0);
  });
  it('самопроверка хука зелёная', () => {
    const r = spawnSync(process.execPath, [HOOK, '--self-test'], { encoding: 'utf8', timeout: 15000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /git stash/);
  });
});

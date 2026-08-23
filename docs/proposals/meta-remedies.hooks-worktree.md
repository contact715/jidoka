# Предложение в реестр классов: `hooks-resolved-outside-the-pushing-tree`

Заведён 2026-08-23 (projectx-app). Запись в `scripts/meta-remedies.mjs` делает
ЧЕЛОВЕК — агент, который может зарегистрировать себе гейт, может объявить себя
безопасным. Ниже готовый блок, вставить в `REMEDIES`:

```js
  'hooks-resolved-outside-the-pushing-tree': {
    // 2026-08-23 projectx-app. core.hooksPath один на репозиторий, рабочих деревьев много.
    // Абсолютный путь → в worktree бежит хук чужого дерева, а scripts/ берутся из своего
    // (падение «script not found: --wait=25»). Относительный → служебный каталог husky порождается
    // пакетным менеджером и в worktree отсутствует, git молча не зовёт НИ ОДНОГО хука:
    // 4 дерева из 6 пушили без гейта. Вторая форма тише и потому опаснее первой.
    since: '2026-08-23',
    mechanism: 'projectx-app/scripts/install-git-hooks.mjs (+ tests/canon/git-hooks-worktree.test.ts)',
    gate: 'Хуки идут через диспетчер в общем git-каталоге: он определяет дерево, из которого '
        + 'git его позвал, и запускает .husky/<хук> ЭТОГО дерева. --check краснеет на любом '
        + 'дереве, чей core.hooksPath не ведёт в диспетчер.',
    family: ['green-check-that-checks-nothing', 'guard-bypassed-via-alternate-path',
             'guard-built-but-unreachable-on-the-push-path'],
    premortem: {
      risk: /core\.hooksPath|husky|worktree.*(хук|hook)|hook.*worktree|--no-verify/i,
      clears: /install-git-hooks|hooks-worktree|диспетчер хуков/i,
    },
  },
```

Проверка после вставки:

```
node scripts/meta-audit.mjs     # ожидается: класс перестаёт числиться живым риском
node scripts/gate-audit.mjs     # механизм несёт @closes-class и @scope
```

Полный разбор: `docs/HOOKS_BELONG_TO_THE_WORKING_TREE.md`.

// PROPOSED meta-remedies.mjs (2026-07-12, evening) — supersedes the morning 2026-07-12 proposal
// (already applied: declaration-over-implementation + browser-verification-skipped are in the live
// registry). This one adds ONE class:
//
//   NEW class 'gate-bypass' (3 incidents: 2026-06-02 Bash side-channel, 2026-06-06 red-team ×2).
//   The mechanism (policy-enforce-hook.mjs) has been built and red-team-proven since 2026-06-05,
//   but TWO gaps kept the class open: (a) it was never registered here, and (b) until 2026-07-12
//   ~/.claude/settings.json routed the hook only on Write|Edit|MultiEdit|NotebookEdit — the Bash
//   side-channel the hook's own bashWriteTargets() was written to catch never received traffic.
//   Closed 2026-07-12: hook added to the Bash matcher; gate-audit.mjs verifyPreToolUse() now
//   mechanically fails when a PreToolUse gate is built but not routed.
//
// NOT included here: 'ledger-pollution' (the other ungated recurring class) — a parallel session is
// building a dedicated mechanism for it right now (scripts/ledger-schema-gate.mjs + CI wiring);
// registering it with a different mechanism from this session would collide. It gets its own
// proposal when that gate lands.
//
// meta-remedies.mjs is L0 (the gate registry); policy-enforce-hook refuses agent writes to it by
// design, so this proposal is applied under explicit OWNER approval:
//
//     cp docs/proposals/meta-remedies.proposed.mjs scripts/meta-remedies.mjs
//     node scripts/meta-audit.mjs    # expect: gate-bypass "GATED — holding"; ledger-pollution still
//                                    # ungated (exit 1) until its own gate + registration land
//     node scripts/eval-suite.mjs    # expect green

// Single source of truth for the meta-mistake gate registry.
//
// Consumed by every engine in the family:
//   meta-audit      — recurrence / regression / holding classification
//   meta-trend      — learning curve (time-to-gate, coverage, regression rate)
//   meta-premortem  — preventive check of a planned action against known classes
//   meta-generalize — lesson families (which gate covers which adjacent classes)
//   meta-decay      — aging of gates that have held untouched for a long time
//
// Each entry: a mistake class -> the architectural remedy that gates it.
//   since     — the date the gate went live (closes the learning loop: incidents
//               strictly after it are regressions, not the cause of the gate)
//   mechanism — the executable that ENFORCES the gate (null = documented-only,
//               which is weaker and flagged as such by the engines)
//   gate      — the rule the mechanism enforces, in prose
//   family    — adjacent classes the SAME gate logic also covers, so a lesson
//               learned for one class generalizes instead of staying isolated
//   premortem — { risk, clears }: signatures in a PLANNED action. `risk` matches
//               language that historically precedes this class; `clears` matches a
//               proof/awareness token that neutralizes it. risk-without-clears =
//               a preventive warning before the mistake is made (meta-premortem).
//
// An unregistered recurring class is escalated by meta-audit (build a gate).

export const REMEDIES = {
  'declaration-over-implementation': {
    // 2026-06-06 regression (wave-meta-gates: commit said selftest-reality registered, registry got
    // mutation-test; gate built but unwired). Strengthened: gate-audit.mjs now blocks ORPHAN gate:*
    // scripts (no workflow/hook/installer caller) — "wired" is verified mechanically, not claimed.
    // 2026-07-12: enforcement closed — proof-of-work-gate.mjs (Stop hook) now watches what the
    // session DID: source edited + nothing executed after the last edit → the stop is blocked once.
    since: '2026-06-06',
    strengthened: '2026-08-11',
    mechanism: 'hooks/proof-of-work-gate.mjs + scripts/suppression-not-a-fix.mjs',
    // УСИЛЕНО 2026-08-11 после регрессии (2 повтора при живом гейте).
    // proof-of-work-gate спрашивает «выполнялось ли что-нибудь после правки», и
    // оба раза выполнялось — просто проверка проверяла не заявленное:
    //   2026-06-07 — «готово» после ОДНОЙ чистой проверки, до перерисовки;
    //   2026-06-10 — починкой был МАСКИРУЮЩИЙ тип-каст, типы позеленели честно.
    // Добавлен второй признак, потоковый: что правка ДОБАВИЛА. Молчаливое
    // подавление (as any, @ts-ignore, eslint-disable, пропуск теста) делает
    // последующее «зелено» бессмысленным и блокируется; объяснённое рядом
    // комментарием от 25 символов проходит — гейт требует причину, не запрет.
    family: ['claim-without-test', 'fixed-without-rerun', 'wired-without-trace', 'orphaned-gate', 'code-edited-nothing-run'],
    premortem: {
      risk: /\b(done|implemented|fixed|wired|works|working|complete[d]?|ready|finished|mechanical(?:ly)?)\b/i,
      clears: /\b(test|spec|passes|passing|exit code|output shown|proof|verified by running|\.test\.|\.spec\.)\b/i,
      advise: 'ship an executable proof (a passing test, a blocking hook, or shown command output) in the same turn',
    },
    gate:
      'A claim of "implemented / wired / mechanical / fixed / done" MUST ship an EXECUTABLE proof in the same turn: ' +
      'a test that passes, a hook that blocks, or a command whose output is shown. No proof artifact in the turn → ' +
      'status is NOT done. Enforced two ways: proof-of-work-gate.mjs (Stop hook, wired in ~/.claude/settings.json ' +
      'hooks.Stop since 2026-07-12) blocks a session stop once when code was edited but nothing was executed after ' +
      'the last edit; proof-gate.mjs remains the invocable typed-proof runner (a UI claim needs a browser proof, ' +
      'a data-removal claim needs a history scan).',
  },
  'browser-verification-skipped': {
    // Owner escalation 2026-07-02 ("в каждой сессии ты не делаешь проверку в браузере и
    // пропускаешь!"): tsc+tests green was treated as "UI change done" session after session.
    // The gate went live the same day but was never registered here, so memory-consolidate
    // kept reporting the class as ungated. This entry closes the registry, not the gate.
    since: '2026-07-02',
    mechanism: 'hooks/browser-verify-gate.mjs',
    family: ['ui-done-without-look', 'tsc-green-as-ui-proof', 'screenshot-skipped'],
    premortem: {
      risk: /\b(ui|css|layout|render(s|ed|ing)?|component|screen|visual|tsx|jsx)\b|экран|вёрстк|компонент|стил/i,
      clears: /\b(screenshot|playwright|browser|preview_|headed|claude-in-chrome|computer-use)\b|скрин|браузер/i,
      advise: 'open a real browser, navigate to the affected screen, screenshot it and LOOK before saying done — tsc/tests prove logic, only the browser proves it looks and behaves right',
    },
    gate:
      'Editing observable UI is complete ONLY after a real browser look (navigate + screenshot + read the ' +
      'screenshot). Enforced by browser-verify-gate.mjs (Stop hook, wired in ~/.claude/settings.json hooks.Stop ' +
      'since 2026-07-02): a session that edited UI source but never called a browser tool is blocked once. ' +
      '"No data / server down" is not an excuse — render the state on a throwaway route and screenshot that. ' +
      'Rule text: ~/.claude/rules/browser-verification-mandatory.md + docs/BROWSER_VERIFICATION_MANDATORY.md.',
  },
  'gate-bypass': {
    // 3 incidents: 2026-06-02 (Bash file-writes >>, sed -i, node fs.writeFileSync to L0 paths were
    // unchecked — side-channel found by self), 2026-06-06 ×2 (red-team: unprotected CONSTITUTION
    // write + case-variant bypass). The hook logic closed all three attack shapes by 2026-06-05
    // (25 self-tests, red-team catalog), but the class stayed honestly OPEN until 2026-07-12
    // because the Bash side-channel was never ROUTED: ~/.claude/settings.json ran the hook only on
    // Write|Edit|MultiEdit|NotebookEdit. since = 2026-07-12, the day the last channel closed
    // (hook on the Bash matcher) and routing became mechanically verified (gate-audit
    // verifyPreToolUse fails on built-but-unrouted PreToolUse gates).
    since: '2026-07-12',
    mechanism: 'scripts/policy-enforce-hook.mjs',
    family: ['l0-write-sidechannel', 'case-variant-bypass', 'protected-path-write', 'hook-built-not-routed'],
    premortem: {
      risk: /\b(write|edit|append|sed -i|tee|cp|mv|writeFileSync)\b.*\b(CONSTITUTION|MISSION|NORTH_STAR|\.secrets|\.env|meta-remedies|baseline)\b/i,
      clears: /\b(policy-enforce|owner-grant|blocked|self-test|PreToolUse)\b/i,
      advise: 'L0/secret writes go through policy-enforce-hook; agents never write meta-remedies/baselines/secrets, and L0 docs only under an audited owner grant',
    },
    gate:
      'A write to an L0/secret path (Write/Edit OR a Bash side-channel: >, >>, tee, sed -i, cp/mv, ' +
      'node fs-writers) must be blocked by policy-enforce-hook unless an audited owner grant covers an L0 DOC ' +
      '(never a secret/registry/.git). Routed in ~/.claude/settings.json PreToolUse on BOTH matchers — ' +
      'Write|Edit|MultiEdit|NotebookEdit AND Bash (Bash since 2026-07-12); gate-audit.mjs verifyPreToolUse() ' +
      'fails the audit when a PreToolUse gate is built but not routed. 25 hook self-tests + the red-team ' +
      'catalog (bash side-channel, sed -i, tee, case-variant) attack it continuously.',
  },
  'ledger-pollution': {
    // 2× on 2026-06-06 (meta-mistakes.jsonl carried 8 wave-judge-debias/telemetry rows with no
    // claimed/real/caught_by — meta-honesty flagged them self-confirming and BLOCKED; a same-day
    // recurrence proved the writer was still appending run1/run2 telemetry into the mistake ledger).
    // The header comment (2026-07-12) deferred registration because a parallel session was still
    // building the mechanism and a different-mechanism entry would collide. The mechanism landed and
    // was wired that day: ledger-schema-gate.mjs validateLedgerEntry() is called on the write path in
    // meta-log.mjs AND run in .githooks/pre-commit; gate-audit.mjs treats it as a real gate (no orphan).
    // since = 2026-07-12, the day the gate went live and routing became mechanically verified.
    since: '2026-07-12',
    mechanism: 'scripts/ledger-schema-gate.mjs',
    family: ['telemetry-row-in-ledger', 'self-confirming-ledger-row', 'ledger-schema-missing-fields'],
    premortem: {
      risk: /\b(meta-mistakes|meta-log|ledger|jsonl|telemetry|run1|run2|append(ed|ing)?)\b/i,
      clears: /\b(claimed|real|caught_by|validateLedgerEntry|ledger-schema-gate|schema)\b/i,
      advise: 'every meta-mistakes.jsonl row needs claimed/real/caught_by; telemetry/measurement rows go to their own file, never the mistake ledger — the write path runs validateLedgerEntry',
    },
    gate:
      'Every row appended to meta-mistakes.jsonl MUST carry claimed/real/caught_by fields describing a real ' +
      'logged mistake; telemetry/measurement rows (judge-debias run1/run2, position-sensitivity, test signals) ' +
      'are rejected and routed to their own file. Enforced by ledger-schema-gate.mjs validateLedgerEntry(): ' +
      'called on the write path in scripts/meta-log.mjs and run in .githooks/pre-commit; gate-audit.mjs confirms ' +
      'it is wired (not an orphan). Self-confirming or schema-incomplete rows never enter the learning signal.',
  },
  'tree-not-history': {
    since: '2026-05-29',
    mechanism: 'scripts/pre-publish-guard.mjs',
    family: ['secret-in-history', 'cleanup-current-state-only'],
    premortem: {
      risk: /\b(publish|public repo|cleanup|cleaned|remove[d]? (the )?secret|sanitiz|ready to ship|open[- ]?source)\b/i,
      clears: /\b(git log|history|log -p|pre-publish-guard|scanned history|full history)\b/i,
      advise: 'scan the full git history (scripts/pre-publish-guard.mjs), not just the working tree',
    },
    gate: 'Cleanup/security claims must scan full history, not current state. Mechanism scans git log -p.',
  },
  'reward-hacking': {
    since: '2026-05-31',
    mechanism: 'scripts/meta-honesty.mjs',
    family: ['synonym-pile', 'booster-words', 'self-confirming-retro', 'eval-gaming'],
    premortem: {
      risk: /\b(flawless|perfect(ly)?|bulletproof|comprehensive|robust|seamless|world[- ]class|state[- ]of[- ]the[- ]art|100%|all \w+ (pass(ed|ing)?|verified|confirmed|successful))\b/i,
      clears: /\b(external|red[- ]?team|falsif|counterexample|caught_by|independent (check|review|judge)|adversarial)\b/i,
      advise: 'get an EXTERNAL/adversarial check that could falsify the claim; more pass-synonyms is lexical novelty, not semantic evidence',
    },
    gate:
      'A retro/claim must not GAME the reward signal. Done/pass-synonym restatements, booster-word piles, ' +
      'and self-confirming entries are caught by meta-honesty (synonym-pile + booster detection + external-catch ' +
      'ratio); red-team continuously attacks this class. Lexical novelty is not semantic novelty.',
  },
  'self-test-blindspot': {
    since: '2026-06-02',
    mechanism: 'scripts/selftest-reality.mjs',
    family: ['threshold-untested', 'boundary-case-missed', 'near-target-untested', 'happy-path-only'],
    premortem: {
      risk: /\b(self-test|unit test|self-tested|passes|green|tested|covered|all cases)\b/i,
      clears: /\b(boundary|near-target|edge case|property|forAll|mutation|random input|min\b|max\b|threshold)\b/i,
      advise: 'test BOUNDARY/near-target cases, not just convenient ones; back the self-test with mutation-test (kills un-asserted code) + property-test (random inputs surface threshold bugs)',
    },
    gate:
      'A self-test must actually run and assert (selftest-reality.mjs blocks exit-0-with-no-assertion-output, ' +
      'the "never ran" fingerprint) AND cover boundary/near-target cases, not only convenient ones. Back it with ' +
      'mutation-test (scripts/mutation-test.mjs, kills code no assertion catches) and property-test ' +
      '(scripts/property-test.mjs, random inputs find the threshold bug). Real data surfacing a self-test gap = this class.',
  },
  'scope-narrowed-silently': {
    since: '2026-05-29',
    mechanism: null,
    family: ['top-n-unstated', 'sampled-as-full', 'partial-as-complete'],
    premortem: {
      risk: /\b(top \d+|first \d+|a few|sampled?|main ones|key (files|ones|parts)|most important|partial)\b/i,
      clears: /\b(only|limited to|boundary|not exhaustive|\d+ of \d+|out of \d+|explicitly|i'm stating)\b/i,
      advise: 'state the boundary explicitly in the same turn (e.g. "top 10 of 240"), so it does not read as full coverage',
    },
    gate: 'If a task is bounded (top-N, sampled, partial), the boundary must be stated explicitly in the same turn. Silent truncation reads as full coverage.',
  },
  'canonical-doc-silently-overwritten': {
    since: '2026-08-11',
    mechanism: 'projectx-app/scripts/canonical-docs-guard.mjs (эталонная реализация)',
    family: ['fixture-left-in-place', 'backup-never-restored', 'corruption-swept-into-commit'],
    premortem: {
      // Без \b: в JS граница слова опирается на латиницу, поэтому перед
      // кириллицей она не срабатывает и половина шаблона молчала бы
      // (проверено при заведении класса — гейт выглядел рабочим и не ловил).
      risk: /(substitut|подмен|swap (the|a) file|inject.*(fixture|corpus)|temporarily (replace|overwrite)|restore in finally|finally.*restore)/i,
      clears: /(SIGINT|SIGTERM|signal handler|on startup|orphan|recover|self-heal|самолеч|при старте)/i,
      advise: 'инструмент, который подменяет ОТСЛЕЖИВАЕМЫЙ файл, обязан возвращать его не только из finally: finally не выполняется при SIGKILL. Нужны обработчики сигналов И самолечение при старте — иначе один убитый прогон оставит порчу, и её подметёт следующий коммит',
    },
    gate:
      'Любой инструмент, временно подменяющий отслеживаемый файл (фуз-стенд, генератор фикстур, ' +
      'проверка валидатора на кривом вводе), обязан иметь ДВА слоя возврата: обработчики сигналов ' +
      '(SIGINT/SIGTERM/uncaughtException) и поиск осиротевших резервных копий ПРИ СТАРТЕ. SIGKILL ' +
      'не перехватывается в принципе, поэтому вернуть файл может только следующий запуск. Отдельно: ' +
      'каноническому документу нужен сторож формы («это всё ещё тот файл?» — размер, заголовок, ' +
      'разметка не стала JSON), стоящий в pre-commit. Происхождение: projectx-app 2026-08-11 — ' +
      'docs/AGENT_ROSTER.md пролежал затёртым заготовкой фуз-стенда (378 строк удалено, одна ' +
      'вставлена, коммит 703bafcb2), ронял семь наборов тестов неделю, и нашли его по СОДЕРЖИМОМУ ' +
      'падений, а не проверкой.',
  },
  'gate-claims-block-but-passes': {
    since: '2026-06-10',
    mechanism: 'scripts/gate-honesty-check.mjs',
    family: ['exit-code-not-propagated', 'hard-block-is-actually-soft', 'false-bypass-log'],
    premortem: {
      risk: /(hard.?block|blocking gate|refuses|жёстк\w* гейт|блокирует коммит|не пропустит)/i,
      clears: /(exit \$\?|exit code|process\.exit\(1|проброс|ненулев)/i,
      advise: 'вызов гейта в хуке обязан нести `|| exit $?`, а сам скрипт — выходить ненулевым кодом. Иначе гейт печатает отказ, пишет запись об обходе и пропускает',
    },
    gate:
      'Скрипт, печатающий отказ в канал ошибок, обязан уметь выйти ненулевым кодом; вызов в хуке ' +
      'обязан этот код пробрасывать (`|| exit $?`, присваивание или условие). Проверяет ' +
      'scripts/gate-honesty-check.mjs, стоит в pre-commit. Происхождение: 2026-06-10 — хук печатал ' +
      '«Commit refused», писал запись об обходе в .sdd-bypass.log, и коммит проходил без --no-verify. ' +
      'Граница честности: достижимость ветки выхода не проверяется, только наличие.',
  },
  'reactive-literal-execution': {
    since: '2026-06-28',
    mechanism: 'hooks/browser-verify-gate.mjs',
    family: ['instruction-applied-literally', 'symptom-fixed-not-composition', 'one-element-iterated'],
    premortem: {
      risk: /(move it|put it|make it smaller|not full width|подвинь|поставь|поменьше|не на всю ширину|чуть выше)/i,
      clears: /(design intent|compose|composition|screenshot|preflight|замысел|композици|скриншот)/i,
      advise: 'короткая указивка про размещение — это СИМПТОМ («мне не нравится, как собрано»), а не спецификация. Переведи в замысел и пересобери область целиком, затем сними скриншот и раскритикуй сам',
    },
    gate:
      'Указание про размещение элемента не исполняется буквально: сначала семь вопросов Spatial ' +
      'Design Pre-Flight, затем правка КОМПОЗИЦИИ области, затем скриншот и самокритика. Механизм: ' +
      'browser-verify-gate.mjs блокирует завершение хода, если видимый интерфейс правился без ' +
      'браузерной проверки. Происхождение: projectx-app 2026-06-28 — панель присутствия собрана ' +
      'буквальным исполнением микроуказаний и вышла сиротливой капсулой в углу.',
  },
  'peer-restyle-instead-of-clone': {
    since: '2026-06-28',
    mechanism: null,
    family: ['sibling-styled-anew', 'lookalike-not-clone', 'set-item-diverges'],
    premortem: {
      risk: /(add (a|an|the)? ?(item|button|tab|row)|добавь (пункт|кнопк|вкладк|строк)|сделай как|в это меню|в эту панель)/i,
      clears: /(clone|shared (class|helper|constant)|same class|клонир|общ\w+ (класс|константа|хелпер)|тот же класс)/i,
      advise: 'новый элемент набора — это КЛОН соседа, а не новый вариант. Прочитай разметку соседа и вынеси общий класс на всех, включая новичка. Тест: дизайнер не должен угадать, какой из них добавлен',
    },
    gate:
      'Элемент, добавляемый в существующий набор (ряд навигации, переключатель режимов, панель ' +
      'вкладок), обязан использовать ТУ ЖЕ строку классов, что соседи — через общую константу, а не ' +
      'скопированную вручную. Механизма пока НЕТ: проверка «соседи одинаковы» пишется под конкретный ' +
      'набор, общего линтера у нас не построено. Рабочий образец: projectx-app ' +
      'tests/.../panel-controls-canon.test.ts — держит SIDEBAR_PANEL_* на всех органах панели. ' +
      'Происхождение: projectx-app 2026-06-28 — Календарь в ряду режимов делали тремя заходами, ' +
      'потому что писали новый вариант вместо клона соседа.',
  },

  // ── Зарегистрировано 2026-08-22 по прямому указанию владельца («зарегистрируй классы») ──
  // Шестнадцать механизмов работали и были подключены, но реестр их не знал. Следствие было
  // не косметическим: стартовая сводка звала эти классы «живым риском», meta-trend занижал
  // покрытие, а август получил семнадцать инцидентов при НУЛЕ зарегистрированных гейтов.
  //
  // Поле since у каждой записи — РЕАЛЬНАЯ дата появления механизма из git log, а не дата
  // вставки. Готовый блок от gate-audit подставляет сегодняшнее число и сам предупреждает,
  // что иначе время-до-гейта врёт; подставить его значило бы записать в прибор ложь ради
  // удобства. Для gate-cost взята дата появления scopeAudit (2026-08-17), а не дата
  // создания файла gate-audit.mjs (2026-06-01): классу соответствует механизм, а не файл.

  'core-property-substituted-by-scaffold': {
    // projectx 2026-07-04: программа объявлена завершённой, а «недетерминированная среда»
    // была регэксп-триггерами. Владелец поймал сам.
    since: '2026-08-14',
    mechanism: 'hooks/guardrail-tripwire.mjs',
    family: ['declaration-over-implementation'],
    gate: 'останавливает прогон, когда несущее свойство задачи подменено каркасом',
  },

  'fabricated-plausible-detail': {
    // projectx 2026-07-24: выдуманный адрес перенаправления в письме партнёру. Владелец поймал.
    since: '2026-07-24',
    mechanism: 'hooks/outbound-claims-gate.mjs + scripts/verify-claims.mjs',
    family: ['unverified-dead-claim'],
    gate: 'не выпускает наружу проверяемую деталь, пока она не проверена: DNS, живой запрос, маршрут в коде',
  },

  'precedent-generalized-into-standing-permission': {
    // Разбор 2026-08-03: за четыре недели шесть встреч с --no-verify, три обхода,
    // два обоснованы прецедентом, а не живым разрешением.
    since: '2026-08-07',
    mechanism: 'hooks/permission-gate.mjs + scripts/permission-ledger.mjs',
    family: ['gate-bypass'],
    gate: 'разовое разрешение не становится постоянным правом: нужна живая запись с областью и сроком',
  },

  'synthesis-shipped-without-coverage-audit': {
    // Rejuvenation Nation 2026-08-03: четыре раза подряд «ты точно всё учёл?», и каждый раз
    // находились пропуски — 15 блоков в ТЗ, потом ещё Yelp, оплата, мониторинг.
    since: '2026-08-04',
    mechanism: 'hooks/synthesis-coverage-gate.mjs + scripts/synthesis-coverage-audit.mjs',
    family: ['completeness-claimed-without-self-audit', 'research-completeness-not-self-audited'],
    gate: 'документ-синтез не сдаётся без механической сверки с источниками',
  },

  'completeness-claimed-without-self-audit': {
    // Замер 2026-08-17: одиннадцать случаев «ты точно всё?» за август в пяти проектах.
    // Гейт покрывает те из них, где источник истины сверяется машиной.
    since: '2026-08-04',
    mechanism: 'hooks/synthesis-coverage-gate.mjs',
    family: ['synthesis-shipped-without-coverage-audit'],
    gate: 'полнота сдачи доказывается сверкой, а не вопросом владельца',
  },

  'stopped-mid-queue-reported-instead': {
    // 2026-08-03: сессия взяла задачу из очереди, сделала одну и остановилась отчитаться.
    since: '2026-08-14',
    mechanism: 'hooks/task-queue-gate.mjs',
    family: [],
    gate: 'не даёт остановиться, когда очередь ещё не пуста, а сессия её уже трогала',
  },

  'gate-cost-not-proportional-to-change': {
    // Правило записано 2026-07-27, рецидивы 2026-08-17 и 2026-08-21 («ты там 2000 гоняешь
    // файлов»). Механизм — маркер области рядом с @closes-class и проверка расхождения.
    since: '2026-08-17',
    // механизм — функция scopeAudit внутри gate-audit.mjs; в поле путь БЕЗ решётки:
    // проверка существования механизма ищет файл, и адрес с символом ей не резолвится
    mechanism: 'scripts/gate-audit.mjs',
    family: ['every-agent-runs-the-full-check', 'heavy-steps-stack-across-worktrees'],
    gate: 'гейт объявляет свою область, и аудит краснеет, когда она шире изменения',
  },

  'gate-run-claimed-not-proven': {
    // 2026-08-22: слой качества не мог отличить «гейты прогнаны» от «сказано, что прогнаны».
    since: '2026-08-22',
    mechanism: 'scripts/gate-receipt.mjs',
    family: ['declaration-over-implementation', 'evidence-is-self-issued-label'],
    gate: 'квитанцию пишет обёртка гейта, а не исполнитель, и она просрочена при любой правке кода',
  },

  'work-runs-at-import-time': {
    // Замер 2026-08-15: 86 модулей из 240 выполняли работу при импорте, один зависал,
    // 19 файлов репозитория переписывались сами.
    since: '2026-08-15',
    mechanism: 'scripts/import-safety.mjs',
    family: ['cli-side-effect-on-import'],
    gate: 'верхний уровень модуля объявляет, а не работает: импорт не должен ничего запускать',
  },

  'heavy-steps-stack-across-worktrees': {
    // 2026-08-22: пять перезагрузок за сутки. Очередь тяжёлых задач привязана к КАТАЛОГУ,
    // рабочих копий несколько, значит замков несколько и сборки идут параллельно.
    since: '2026-08-22',
    mechanism: 'scripts/machine-guard.mjs',
    family: ['gate-cost-not-proportional-to-change', 'guards-measure-size-blind-to-count'],
    gate: 'смотрит на память ВСЕЙ машины и на все тяжёлые шаги, а не на свою папку',
  },

  'mechanism-built-human-step-never-taken': {
    // 2026-08-17: обратная ось реестра печатала готовый блок регистрации семь дней подряд,
    // и вставки не было ни разу. Эта запись — закрытие ровно того случая.
    since: '2026-08-17',
    mechanism: 'scripts/pending-human.mjs',
    family: [],
    gate: 'у незакрытого человеческого шага есть очередь, возраст и счётчик просрочки',
  },

  'research-claim-without-evidence': {
    // Правило о пропорциональном ресёрче 2026-07-29: утверждение о нашем коде без адреса
    // файла и источник без метки силы — это мнение, а не результат.
    since: '2026-08-18',
    mechanism: 'scripts/research-audit.mjs',
    family: ['fabricated-plausible-detail'],
    gate: 'документ ресёрча не сдаётся с утверждениями без источника, адреса и раздела непроверенного',
  },

  'parallel-work-invisible-across-sessions': {
    // 2026-08-22: сессии перетирали работу друг друга, а восстановить авторство постфактум
    // нельзя — 100 коммитов, один автор contact715.
    since: '2026-08-22',
    mechanism: 'scripts/session-board.mjs',
    family: ['conflict-found-but-nobody-acted', 'reset-hard-wiped-parallel-session-work'],
    gate: 'сессия объявляет намерение и заявленные пути в момент работы, а не выводит их из следов потом',
  },

  'agreement-lives-only-in-chat': {
    // 2026-08-22: договорённость двух сессий о владении зоной жила только в переписке.
    since: '2026-08-22',
    mechanism: 'scripts/session-mail.mjs',
    family: ['project-change-not-journaled'],
    gate: 'вопрос о владении висит в журнале, пока на него не ответили, и переживает сворачивание контекста',
  },

  'installed-copy-drifts-from-upstream': {
    // Замер 2026-08-11: 14 официальных скиллов из 17 устарели, узнали из поста в соцсети.
    since: '2026-08-11',
    mechanism: 'scripts/skills-freshness.mjs',
    family: [],
    gate: 'сверяет установленные копии чужого кода с источником по SHA блобов, частичную проверку не выдаёт за полную',
  },

  'conflict-found-but-nobody-acted': {
    // 2026-08-22: доска находила столкновение, но найденный конфликт и конфликт, с которым
    // что-то сделали, — разные вещи. Прибор, печатающий один список каждый день, пролистывают.
    since: '2026-08-22',
    mechanism: 'scripts/teamlead.mjs',
    family: ['mechanism-built-human-step-never-taken', 'parallel-work-invisible-across-sessions'],
    gate: 'различает «никто не спросил», «ждём ответа» и «решено», человеку поднимает только первое и протухшее',
  },

};

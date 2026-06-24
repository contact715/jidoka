#!/usr/bin/env node
// session-state — one hook script for the "mission control" bottom line.
// Wired on FOUR events (arg = event name): UserPromptSubmit, PreToolUse, Stop, Notification.
// Maintains ~/.claude/session-env/state-<session_id>.json:
//   { state: working|waiting|done, ts: <prompt start ms>, prompt, activity }
// The statusline reads this file and pins it at the bottom of the terminal.
//
// ALWAYS exits 0 and prints NOTHING to stdout (UserPromptSubmit stdout would be injected
// into the model context; PreToolUse stdout could alter permission flow).
//
// Self-test: node session-state.mjs --self-test

import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

// stuck-detector lives in scripts/, which is a SIBLING of hooks/ in the repo but
// installs to ~/.claude/jidoka/scripts/ globally (hooks install to ~/.claude/hooks/).
// Resolve both layouts at runtime; a static import would crash the hook in the global
// install (and a crashing PreToolUse hook blocks every tool call).
async function loadStuckDetector() {
  const candidates = [
    new URL('../scripts/stuck-detector.mjs', import.meta.url),                 // repo layout
    pathToFileURL(join(homedir(), '.claude', 'jidoka', 'scripts', 'stuck-detector.mjs')), // global install
  ];
  for (const url of candidates) {
    try { if (url.protocol !== 'file:' || existsSync(url)) return await import(url.href); } catch { /* try next */ }
  }
  return null;
}

// pure: describe a tool call in a few human words (testable)
export function describeActivity(toolName, toolInput = {}) {
  if (!toolName) return '';
  const base = p => (p || '').split('/').pop();
  if (toolName === 'Bash') {
    const d = (toolInput.description || '').trim();
    // русское описание показываем как есть; английское/техническое — заменяем понятной фразой
    return /[а-яё]/i.test(d) ? d.slice(0, 80) : 'выполняю команду в терминале';
  }
  if (toolName === 'Edit' || toolName === 'Write') return `${toolName === 'Edit' ? 'правлю' : 'пишу'} ${base(toolInput.file_path)}`;
  if (toolName === 'Read') return `читаю ${base(toolInput.file_path)}`;
  if (toolName === 'Grep' || toolName === 'Glob') return `ищу: ${(toolInput.pattern || '').slice(0, 40)}`;
  if (toolName === 'Task' || toolName === 'Agent') return `агент: ${(toolInput.description || toolInput.subagent_type || '').slice(0, 50)}`;
  if (toolName === 'WebFetch' || toolName === 'WebSearch') return `в сети: ${(toolInput.query || toolInput.url || '').slice(0, 50)}`;
  if (toolName.startsWith('mcp__')) return toolName.replace('mcp__', '').replace(/__/g, ': ').slice(0, 50);
  return toolName;
}

// pure: is this prompt a self-sufficient task description, or a short continuation
// ("делай все три", "да", "продолжай") that only makes sense next to the previous topic?
export function isSubstantive(prompt) {
  const p = (prompt || '').trim();
  return p.split(/\s+/).filter(Boolean).length >= 5 || p.length >= 40;
}

// pure: next state record given an event (testable).
// Unknown fields (e.g. nudgedAt written by the statusline) survive every transition EXCEPT a new
// prompt, which starts a fresh record — so the "still working" nudge re-arms per task.
export function nextState(prev, event, payload = {}) {
  const s = { ...prev, state: prev.state || 'working', ts: prev.ts || null, prompt: prev.prompt || '', activity: prev.activity || '' };
  if (event === 'UserPromptSubmit') {
    const text = (payload.prompt || '').replace(/\s+/g, ' ').trim();
    // служебные сообщения системы (уведомления фоновых задач, локальные команды) —
    // НЕ промпт человека: якорь не трогаем, просто остаёмся в «работаю»
    if (/^(<task-notification>|<local-command-caveat>|<local-command-stdout>|<command-name>|<system-reminder>|Caveat:)/i.test(text)) {
      return { ...s, state: 'working' };
    }
    // topic = последний СОДЕРЖАТЕЛЬНЫЙ запрос; короткие продолжения не затирают смысл
    const p = text.slice(0, 500);
    const topic = isSubstantive(p) ? p : (prev.topic || prev.prompt || '');
    return { state: 'working', ts: payload.now, prompt: p, topic, activity: '' };
  }
  if (event === 'PreToolUse') return { ...s, state: 'working', activity: describeActivity(payload.tool_name, payload.tool_input) };
  if (event === 'Stop') return { ...s, state: 'done', activity: '' };
  if (event === 'Notification') return { ...s, state: 'waiting' };
  return s;
}

// pure: terminal tab title for the current state — visible from other tabs.
// Prefers the topic (meaningful) over a short continuation prompt.
export function titleFor(state, prompt, topic) {
  const icon = state === 'working' ? '▶' : state === 'waiting' ? '⏳' : state === 'done' ? '✓' : '◇';
  const p = (topic || prompt || '').slice(0, 40);
  return p ? `${icon} ${p}` : '';
}

function selfTest() {
  const T = [
    ['prompt starts working + timer', (() => {
      const r = nextState({}, 'UserPromptSubmit', { now: 1000, prompt: '  сделай\n красиво  ' });
      return r.state === 'working' && r.ts === 1000 && r.prompt === 'сделай красиво';
    })()],
    ['tool sets activity, keeps timer', (() => {
      const r = nextState({ state: 'working', ts: 5, prompt: 'p' }, 'PreToolUse', { tool_name: 'Bash', tool_input: { description: 'ставлю ccboard' } });
      return r.activity === 'ставлю ccboard' && r.ts === 5 && r.prompt === 'p';
    })()],
    ['stop → done, activity cleared', nextState({ state: 'working', ts: 5, activity: 'x' }, 'Stop').state === 'done' && nextState({ activity: 'x' }, 'Stop').activity === ''],
    ['notification → waiting, prompt kept', (() => {
      const r = nextState({ prompt: 'p', ts: 5 }, 'Notification');
      return r.state === 'waiting' && r.prompt === 'p';
    })()],
    ['tool after waiting → working again', nextState({ state: 'waiting' }, 'PreToolUse', { tool_name: 'Read', tool_input: { file_path: '/a/b.ts' } }).state === 'working'],
    ['activity: edit names file', describeActivity('Edit', { file_path: '/x/y/app.tsx' }) === 'правлю app.tsx'],
    ['activity: mcp readable', describeActivity('mcp__playwright__browser_click', {}) === 'playwright: browser_click'],
    ['activity: empty tool → empty', describeActivity('') === ''],
    ['unknown event → unchanged', nextState({ state: 'done', ts: 1 }, 'Whatever').state === 'done'],
    ['nudgedAt survives tool events', nextState({ state: 'working', ts: 1, nudgedAt: 99 }, 'PreToolUse', { tool_name: 'Read', tool_input: {} }).nudgedAt === 99],
    ['nudgedAt survives Stop/Notification', nextState({ nudgedAt: 99 }, 'Stop').nudgedAt === 99 && nextState({ nudgedAt: 99 }, 'Notification').nudgedAt === 99],
    ['new prompt resets nudgedAt', nextState({ nudgedAt: 99 }, 'UserPromptSubmit', { now: 5, prompt: 'x' }).nudgedAt === undefined],
    ['substantive: длинная задача → да', isSubstantive('усиль закреплённый промпт киллер-фичами докрути') === true],
    ['substantive: «делай все три» → нет', isSubstantive('делай все три') === false],
    ['substantive: «да» → нет', isSubstantive('да') === false],
    ['topic: содержательный промпт становится темой', nextState({}, 'UserPromptSubmit', { now: 1, prompt: 'усиль закреплённый промпт киллер фичами и покрой' }).topic === 'усиль закреплённый промпт киллер фичами и покрой'],
    ['topic: продолжение хранит прежнюю тему', nextState({ topic: 'большая задача' }, 'UserPromptSubmit', { now: 1, prompt: 'делай все три' }).topic === 'большая задача'],
    ['topic: продолжение берёт прежний промпт как тему', nextState({ prompt: 'старый запрос' }, 'UserPromptSubmit', { now: 1, prompt: 'да' }).topic === 'старый запрос'],
    ['topic: новая содержательная задача заменяет тему', nextState({ topic: 'старая тема' }, 'UserPromptSubmit', { now: 1, prompt: 'теперь полностью новая большая задача про другое' }).topic.includes('новая')],
    ['title предпочитает тему короткому промпту', titleFor('working', 'делай все три', 'большая задача') === '▶ большая задача'],
    ['title: working with icon', titleFor('working', 'сделай красиво') === '▶ сделай красиво'],
    ['title: waiting/done icons', titleFor('waiting', 'п') === '⏳ п' && titleFor('done', 'п') === '✓ п'],
    ['title: clipped to 40', titleFor('working', 'а'.repeat(99)).length === 42],
    ['title: no prompt → empty', titleFor('working', '') === ''],
    ['system task-notification не подменяет промпт', (() => {
      const r = nextState({ state: 'waiting', ts: 5, prompt: 'мой вопрос' }, 'UserPromptSubmit', { now: 9, prompt: '<task-notification> <task-id>x</task-id>' });
      return r.prompt === 'мой вопрос' && r.ts === 5 && r.state === 'working';
    })()],
    ['local command не подменяет промпт', nextState({ prompt: 'p', ts: 5 }, 'UserPromptSubmit', { now: 9, prompt: 'Caveat: The messages below were generated' }).prompt === 'p'],
    ['system-reminder не подменяет промпт', nextState({ prompt: 'p', ts: 5 }, 'UserPromptSubmit', { now: 9, prompt: '<system-reminder>x</system-reminder>' }).prompt === 'p'],
    ['bash: английское описание → понятная фраза', describeActivity('Bash', { description: 'Run tui-top against a corrupted state.json' }) === 'выполняю команду в терминале'],
    ['bash: русское описание остаётся', describeActivity('Bash', { description: 'ставлю ccboard' }) === 'ставлю ccboard'],
    ['bash: без описания → понятная фраза', describeActivity('Bash', { command: 'ls -la' }) === 'выполняю команду в терминале'],
  ];
  let fails = 0;
  for (const [name, ok] of T) { if (!ok) fails++; console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`); }
  if (fails) { console.log('\n\x1b[31msession-state self-test FAILED\x1b[0m'); process.exit(1); }
  console.log('\n\x1b[32m✓ session-state: transitions correct\x1b[0m');
  process.exit(0);
}

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const event = process.argv[2] || '';
  try {
    const d = JSON.parse(readFileSync(0, 'utf8') || '{}');
    const sid = d.session_id;
    if (sid && event) {
      const dir = join(homedir(), '.claude', 'session-env');
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `state-${sid}.json`);
      let prev = {}; try { prev = JSON.parse(readFileSync(file, 'utf8')); } catch { /* fresh */ }
      const next = nextState(prev, event, { now: Date.now(), prompt: d.prompt, tool_name: d.tool_name, tool_input: d.tool_input });
      writeFileSync(file, JSON.stringify(next), 'utf8');
      // pin the task into the terminal tab title (OSC 0), straight to the tty so it never
      // touches stdout (which would leak into the model context on UserPromptSubmit)
      const title = titleFor(next.state, next.prompt, next.topic);
      if (title) { try { writeFileSync('/dev/tty', `\x1b]0;${title}\x07`); } catch { /* headless */ } }
      // stuck-detector (soft trial): keep a per-session activity ring; on a loop/runaway
      // pattern, log a diagnosis the andon layer can read. Never blocks the tool.
      if (event === 'PreToolUse') {
        try {
          const sd = await loadStuckDetector();
          if (sd) {
            const rf = join(dir, `ring-${sid}.json`);
            let ring = []; try { ring = JSON.parse(readFileSync(rf, 'utf8')); } catch { /* fresh */ }
            ring = sd.pushRing(ring, next.activity || '');
            writeFileSync(rf, JSON.stringify(ring));
            const v = sd.detect(ring);
            if (v.stuck) {
              const log = join(homedir(), '.claude', 'jidoka', 'stuck-events.jsonl');
              mkdirSync(join(homedir(), '.claude', 'jidoka'), { recursive: true });
              appendFileSync(log, JSON.stringify({ ts: new Date().toISOString(), session: sid, ...v }) + '\n');
            }
          }
        } catch { /* best-effort; never block the session */ }
      }
    }
  } catch { /* never block the session */ }
  process.exit(0);
}

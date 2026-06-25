#!/usr/bin/env node
// model-router — route each agent call to a provider+model by tier × cost × usage × privacy, with a
// LOCAL-model fallback (the LiteLLM-gate pattern a high-volume practitioner uses). Extends model-tier
// (which picks opus/sonnet/haiku by role) into a provider router: Claude API vs a local model.
//
// It also routes development work between the two-model Jidoka cell:
//   - Claude Fable 5: architecture, root-cause investigation, long-horizon planning, high-risk review.
//   - Codex GPT-5.5: local implementation, terminal/browser verification, integration, final proof.
//
// Why: cost (local is far cheaper for bulk), privacy (some clients require data never leaves), and a
// hedge for the June-2026 subscription→API tightening — run legitimately on API or local instead of
// dodging subscription limits. This routes HONESTLY; it does NOT swap subscription tokens to evade ToS.
//
// route(task, ctx) → { provider: 'claude-api' | 'local', model, reason }
//   task: { role, tier, hard }   ctx: { usageRatio (0..1+), privacy, allowLocal }
//
// HONEST boundary: a policy (not a live dispatcher). It DECIDES the provider/model; the orchestrator
// executes it. Local model capability is a coarse registry, not a live benchmark.
//
// FULL & self-tested. Usage:
//   node scripts/model-router.mjs --self-test
//   node scripts/model-router.mjs --task '{"role":"backend-agent","tier":"budget"}' --usage 1.1
//   node scripts/model-router.mjs --task-text "plan the billing migration" --json

import { modelForAgent, classOf } from './model-tier.mjs';

// local models for cost/privacy (capable = strong general/dev model; light = cheap mechanical)
export const LOCAL = { capable: 'deepseek-3.2', light: 'llama-3.3-8b' };
export const DEVELOPMENT_MODELS = {
  fable: { provider: 'anthropic', model: 'claude-fable-5' },
  codex: { provider: 'openai-codex', model: 'gpt-5.5' },
};

const rx = (name, re) => ({ name, re });
const FABLE_PLAN_SIGNALS = [
  rx('architecture', /\b(architecture|architect|system design|design system|adr|rfc|design proposal)\b|архитект|системн(ый|ую|ая)|дизайн системы/i),
  rx('ambiguous-scope', /\b(ambiguous|unclear|unknown|explore|investigate|discovery|holistic)\b|непонятн|разобраться|исслед/i),
  rx('root-cause', /\b(root[- ]cause|incident|regression|flaky|race condition|deadlock|memory leak)\b|коренн|причин[аы]|инцидент|регресс|флейк/i),
  rx('systemic-guardrail', /\b(systemic|prevent recurrence|never again|guardrail|regression protection|self-learning|design drift|design-system drift)\b|больше не повтор|самообуч|системн.*ошиб|дизайн.*дрейф/i),
  rx('large-migration', /\b(migration|migrate|moderni[sz]e|rewrite|large refactor|multi-file|cross-module)\b|миграц|перепис|больш(ой|ая|ую) рефактор/i),
  rx('strategy', /\b(strategy|roadmap|tradeoff|trade-off|decision matrix|approach)\b|стратег|подход|компромисс/i),
  rx('long-horizon', /\b(long-horizon|multi-stage|multi-step|end-to-end|autonomous)\b|многошаг|долг(ий|ая|ую)/i),
];
const FABLE_REVIEW_SIGNALS = [
  rx('review', /\b(review|audit|critique|adversarial|second opinion|pre-mortem|premortem)\b|ревью|аудит|проверь|критик/i),
  rx('security-risk', /\b(security|auth|oauth|jwt|permission|rbac|secret|token|credential|csrf|xss|sql injection)\b|безопас|авторизац|аутентификац|секрет|токен/i),
  rx('money-risk', /\b(billing|payment|invoice|subscription|pricing|money|finance|tax)\b|биллинг|платеж|цена|деньг|финанс/i),
  rx('data-risk', /\b(database migration|schema migration|pii|personal data|customer data|gdpr|hipaa|retention)\b|персональн|данн|gdpr|миграц.*баз/i),
  rx('public-contract', /\b(public api|api contract|breaking change|backward compat|compatibility|sdk)\b|контракт|совместим|публичн.*api/i),
];
const CODEX_EXECUTE_SIGNALS = [
  rx('local-edit', /\b(implement|add|change|edit|wire|hook up|fix|patch|update)\b|добавь|измени|почини|исправь|внедри/i),
  rx('terminal-proof', /\b(test|lint|build|typecheck|playwright|dev server|ci|failing test)\b|тест|линт|билд|сборк|ci/i),
  rx('ui-work', /\b(ui|css|component|button|modal|form|layout|responsive)\b|кнопк|компонент|форма|верстк|адаптив/i),
  rx('mechanical', /\b(rename|format|copy|move|delete unused|dead code|small refactor)\b|переимен|формат|удали|мелк/i),
];
const PRIVACY_SIGNALS = [
  rx('secret-material', /\b(api key|private key|password|credential|secret|token dump|env file)\b|парол|секрет|ключ/i),
  rx('regulated-data', /\b(customer data|personal data|pii|phi|hipaa|gdpr|confidential)\b|персональн|конфиденц/i),
];

function signalNames(defs, text) {
  return defs.filter((d) => d.re.test(text)).map((d) => d.name);
}

function riskLevel(signals, changedLines, explicitRisk) {
  if (explicitRisk === 'high' || changedLines >= 80 || signals.review.length >= 2) return 'high';
  if (explicitRisk === 'medium' || changedLines >= 30 || signals.review.length === 1 || signals.plan.length >= 2) return 'medium';
  return 'low';
}

export function routeDevelopmentTask(taskText = '', { phase = 'intake', changedLines = 0, risk = '' } = {}) {
  const text = String(taskText || '').trim();
  const folded = text.toLowerCase();
  const signals = {
    plan: signalNames(FABLE_PLAN_SIGNALS, folded),
    review: signalNames(FABLE_REVIEW_SIGNALS, folded),
    execute: signalNames(CODEX_EXECUTE_SIGNALS, folded),
    privacy: signalNames(PRIVACY_SIGNALS, folded),
  };
  const normalizedPhase = String(phase || 'intake').toLowerCase();
  const lines = Number.isFinite(Number(changedLines)) ? Number(changedLines) : 0;
  const explicitRisk = String(risk || '').toLowerCase();
  const level = riskLevel(signals, lines, explicitRisk);
  const privacyGuard = signals.privacy.length > 0;
  const afterCode = ['after-code', 'review', 'post-implementation', 'pre-merge'].includes(normalizedPhase);
  const explicitReview = signals.review.includes('review');
  const complexPlan = signals.plan.length >= 2 || (signals.plan.length >= 1 && level !== 'low');
  const concreteExecution = signals.execute.length > 0 && signals.plan.length === 0 && !explicitReview;

  let routeName = 'codex-execute';
  let primary = DEVELOPMENT_MODELS.codex;
  let secondary = null;
  let handoffRequired = false;
  let reviewRequired = false;
  let automationMode = 'direct-codex';
  let nextAction = 'Codex implements locally, runs focused proof, and reports evidence.';
  let reason = 'clear execution task with local verification path';

  if (privacyGuard) {
    routeName = level === 'high' ? 'codex-redact-then-review' : 'codex-redact-first';
    primary = DEVELOPMENT_MODELS.codex;
    secondary = level === 'high' ? DEVELOPMENT_MODELS.fable : null;
    reviewRequired = level === 'high';
    automationMode = level === 'high' ? 'redact-then-relay' : 'direct-codex';
    nextAction = 'Redact secrets/regulated data before any external handoff; Codex keeps local execution and proof.';
    reason = `privacy-sensitive signal (${signals.privacy.join(', ')}) blocks raw Fable handoff`;
  } else if (afterCode && (explicitReview || level !== 'low')) {
    routeName = 'fable-review';
    primary = DEVELOPMENT_MODELS.fable;
    secondary = DEVELOPMENT_MODELS.codex;
    handoffRequired = true;
    reviewRequired = true;
    automationMode = 'relay-auto';
    nextAction = 'Prepare a Fable review packet, then Codex applies accepted fixes and reruns proof.';
    reason = `post-implementation risk is ${level}${lines ? ` with ${lines} changed lines` : ''}`;
  } else if (complexPlan && !explicitReview) {
    routeName = 'fable-plan';
    primary = DEVELOPMENT_MODELS.fable;
    secondary = DEVELOPMENT_MODELS.codex;
    handoffRequired = true;
    automationMode = 'relay-auto';
    nextAction = 'Ask Fable for architecture/root-cause plan; Codex executes the approved chunks and verifies.';
    reason = `complex planning signal (${signals.plan.join(', ')}) at ${level} risk`;
  } else if (explicitReview || (signals.review.length > 0 && !concreteExecution)) {
    routeName = 'fable-review';
    primary = DEVELOPMENT_MODELS.fable;
    secondary = DEVELOPMENT_MODELS.codex;
    handoffRequired = true;
    reviewRequired = true;
    automationMode = 'relay-auto';
    nextAction = 'Ask Fable for adversarial review; Codex owns fixes, tests, and final evidence.';
    reason = `review/audit signal (${signals.review.join(', ')})`;
  } else if (level === 'high' && concreteExecution) {
    routeName = 'codex-then-fable-review';
    primary = DEVELOPMENT_MODELS.codex;
    secondary = DEVELOPMENT_MODELS.fable;
    reviewRequired = true;
    automationMode = 'relay-auto';
    nextAction = 'Codex implements the clear change, then prepares a Fable review packet before final closure.';
    reason = `clear execution with high-risk signal (${signals.review.join(', ') || 'changed-lines/risk flag'})`;
  }

  const autoRelay = automationMode === 'relay-auto';

  return {
    route: routeName,
    automation: {
      mode: automationMode,
      autoRelay,
      command: autoRelay
        ? 'node ~/.codex/jidoka/scripts/jidoka.mjs relay auto --cwd "$PWD" --from codex --task "<task>" --allow-codex-write'
        : null,
    },
    primary,
    secondary,
    fableRole: routeName.includes('fable') ? (routeName === 'fable-plan' ? 'planner/investigator' : 'adversarial reviewer') : (secondary?.model === DEVELOPMENT_MODELS.fable.model ? 'reviewer' : null),
    codexRole: routeName === 'fable-plan' ? 'executor/verifier after handoff' : 'local executor/verifier',
    handoffRequired,
    reviewRequired,
    redactionRequired: privacyGuard,
    risk: level,
    reason,
    nextAction,
    signals,
  };
}

export function route(task = {}, { usageRatio = 0, privacy = false, allowLocal = false } = {}) {
  const tier = task.tier || 'balanced';
  const cls = classOf(task.role || 'backend-agent');
  const apiModel = modelForAgent(task.role || 'backend-agent', tier);

  // privacy-sensitive work must stay in-house → local, but never a TOY model for high-reasoning roles
  if (privacy) return { provider: 'local', model: cls === 'low' ? LOCAL.light : LOCAL.capable, reason: 'privacy-sensitive → local model (data stays in-house)' };
  // usage budget exhausted → local fallback (legit cost control, not a subscription-limit dodge)
  if (usageRatio >= 1) return { provider: 'local', model: cls === 'low' ? LOCAL.light : LOCAL.capable, reason: 'usage budget exhausted → local fallback' };
  // local explicitly allowed + a mechanical task → cheap local
  if (allowLocal && cls === 'low') return { provider: 'local', model: LOCAL.light, reason: 'mechanical task + local allowed → cheap local model' };
  // default: Claude API at the tier model
  return { provider: 'claude-api', model: apiModel, reason: `claude-api ${apiModel} (tier=${tier}, class=${cls})` };
}

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  ok('normal task → claude-api with the model-tier model', (() => { const r = route({ role: 'backend-agent', tier: 'balanced' }); return r.provider === 'claude-api' && r.model === 'sonnet'; })());
  ok('privacy-sensitive → local (data stays in-house)', route({ role: 'backend-agent' }, { privacy: true }).provider === 'local');
  ok('usage exhausted → local fallback', route({ role: 'backend-agent' }, { usageRatio: 1.2 }).provider === 'local');
  ok('under budget → still claude-api', route({ role: 'backend-agent' }, { usageRatio: 0.5 }).provider === 'claude-api');
  ok('allowLocal + mechanical role → cheap local light', route({ role: 'statusline' }, { allowLocal: true }).model === LOCAL.light);
  ok('allowLocal + HIGH role → NOT the light local (judgement not cheaped out)', route({ role: 'debate-judge' }, { allowLocal: true }).model !== LOCAL.light);
  ok('privacy + HIGH role → capable local, not light', route({ role: 'chief-architect' }, { privacy: true }).model === LOCAL.capable);
  ok('privacy + mechanical role → light local, not the expensive capable (closes the dead-ternary blindspot)', route({ role: 'statusline' }, { privacy: true }).model === LOCAL.light);
  ok('reason is always explained', typeof route({ role: 'backend-agent' }).reason === 'string' && route({ role: 'backend-agent' }).reason.length > 0);
  // inherits the model-tier invariant on the API path: a judge is never haiku
  ok('judge on API path is never haiku (inherits model-tier floor)', route({ role: 'debate-judge', tier: 'budget' }).model !== 'haiku');
  ok('architecture migration routes to Fable planning', routeDevelopmentTask('plan architecture for a large billing migration').route === 'fable-plan');
  ok('architecture migration enables automatic relay', routeDevelopmentTask('plan architecture for a large billing migration').automation.autoRelay === true);
  ok('systemic design drift root-cause routes to Fable planning', routeDevelopmentTask('find root-cause of design system drift, fix it, and add regression protection').route === 'fable-plan');
  ok('systemic design drift enables automatic relay', routeDevelopmentTask('find root-cause of design system drift, fix it, and add regression protection').automation.autoRelay === true);
  ok('clear UI edit routes to Codex execution', routeDevelopmentTask('add a button and update CSS').route === 'codex-execute');
  ok('clear UI edit stays direct Codex', routeDevelopmentTask('add a button and update CSS').automation.autoRelay === false);
  ok('explicit review routes to Fable review', routeDevelopmentTask('review this auth and billing diff').route === 'fable-review');
  ok('failing tests route to Codex execution', routeDevelopmentTask('fix failing tests and run build').route === 'codex-execute');
  ok('post-code large diff requires Fable review', routeDevelopmentTask('feature implementation', { phase: 'after-code', changedLines: 120 }).route === 'fable-review');
  ok('secret material blocks raw Fable handoff', routeDevelopmentTask('debug env file with API key and auth token').redactionRequired === true);
  ok('secret material does not auto-relay raw data', routeDevelopmentTask('debug env file with API key and auth token').automation.autoRelay === false);

  if (fails.length) { console.log(`\n\x1b[31mmodel-router self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ model-router: provider+model routing correct (local fallback, judgement floor held)\x1b[0m');
  process.exit(0);
}

const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const taskText = arg('--task-text');
  if (taskText) {
    const ctx = {
      phase: arg('--phase') || 'intake',
      changedLines: Number(arg('--changed-lines') || '0'),
      risk: arg('--risk') || '',
    };
    const r = routeDevelopmentTask(taskText, ctx);
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify(r, null, 2));
    } else {
      console.log(`model-router: development task → \x1b[1m${r.route}\x1b[0m`);
      console.log(`  primary: ${r.primary.provider} / ${r.primary.model}`);
      if (r.secondary) console.log(`  secondary: ${r.secondary.provider} / ${r.secondary.model}`);
      console.log(`  risk: ${r.risk}`);
      console.log(`  reason: ${r.reason}`);
      console.log(`  next: ${r.nextAction}`);
      if (r.redactionRequired) console.log('  guard: redact secrets/regulated data before any Fable handoff');
    }
    process.exit(0);
  }
  const task = JSON.parse(arg('--task') || '{"role":"backend-agent","tier":"balanced"}');
  const ctx = { usageRatio: parseFloat(arg('--usage') || '0'), privacy: process.argv.includes('--privacy'), allowLocal: process.argv.includes('--allow-local') };
  const r = route(task, ctx);
  console.log(`model-router: ${task.role} → \x1b[1m${r.provider} / ${r.model}\x1b[0m — ${r.reason}`);
  process.exit(0);
}

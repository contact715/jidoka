export const meta = {
  name: 'jidoka-enrichment',
  description: 'Weekly self-improvement: recon current jidoka state → deep GitHub research → adversarial verify → AI-war debates → ranked improvement plan',
  phases: [
    { title: 'Recon', detail: 'read current jidoka reality (capabilities, weaknesses, already-shipped)' },
    { title: 'Research', detail: 'parallel GitHub/web research across domains' },
    { title: 'Verify', detail: 'adversarial: exists? maintained? duplicates? wires in?' },
    { title: 'Debate', detail: 'prosecutor vs defender vs judge per shortlisted proposal' },
    { title: 'Synthesize', detail: 'ranked weekly improvement plan' },
  ],
}

// ── Phase 0: recon — read the CURRENT state so the analysis never goes stale ──
phase('Recon')
log('Reading current jidoka state (so we never re-propose what is already shipped)')

const RECON_SCHEMA = {
  type: 'object', additionalProperties: true,
  required: ['strengths', 'weaknesses', 'alreadyShipped'],
  properties: {
    summary: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' } },
    weaknesses: { type: 'array', items: { type: 'string' } },
    alreadyShipped: { type: 'array', items: { type: 'string' }, description: 'capabilities/scripts that already exist — do NOT re-propose' },
    knownGaps: { type: 'array', items: { type: 'string' } },
    priorProposals: { type: 'array', items: { type: 'string' }, description: 'recommendations from previous weekly reports already on record' },
  },
}

const recon = await agent(
  `Ты — разведчик состояния движка разработки jidoka. Цель: дать ТОЧНЫЙ снимок текущей реальности, чтобы последующий ресёрч не предлагал то, что уже есть.
Рабочая папка — корень репозитория jidoka (github.com/contact715/jidoka).
Прочитай и обобщи:
- docs/HONEST_SYSTEM_STATE.md и docs/ENGINEERING_SYSTEM_ASSESSMENT.md (что реально работает, честные границы).
- Список скриптов: ls scripts/*.mjs (и .sh) — это арсенал механизмов.
- Агенты: ls .claude/agents/*.md.
- ВСЕ прошлые отчёты ресёрча: docs/research/**/*.md (особенно последние) — что уже рекомендовано/внедрено.
- ~/.claude/jidoka/memory-consolidated.md если есть (активные уроки/слабые места).
- Свежие коммиты: git log --oneline -40 (что недавно добавлено).
Верни строго по схеме: strengths (объективно сильное), weaknesses (реальные дыры, особенно ungated-риски), alreadyShipped (возможности/скрипты, которые УЖЕ есть — их НЕ предлагать заново), knownGaps, priorProposals (рекомендации из прошлых недельных отчётов). Будь конкретным и честным.`,
  { label: 'recon:jidoka-state', phase: 'Recon', schema: RECON_SCHEMA, agentType: 'general-purpose' }
)

const REALITY = `СНИМОК ТЕКУЩЕГО СОСТОЯНИЯ jidoka (динамическая разведка этой недели):
СИЛЬНЫЕ СТОРОНЫ: ${(recon?.strengths || []).join('; ')}
СЛАБЫЕ СТОРОНЫ: ${(recon?.weaknesses || []).join('; ')}
УЖЕ ВНЕДРЕНО (НЕ предлагать заново): ${(recon?.alreadyShipped || []).join('; ')}
ИЗВЕСТНЫЕ ПРОБЕЛЫ: ${(recon?.knownGaps || []).join('; ')}
РАНЕЕ ПРЕДЛОЖЕНО (в прошлых недельных отчётах): ${(recon?.priorProposals || []).join('; ')}
Сводка: ${recon?.summary || ''}`

// ── shared schemas ──
const REPO_FINDINGS_SCHEMA = {
  type: 'object', additionalProperties: true, required: ['domain', 'repos'],
  properties: {
    domain: { type: 'string' },
    repos: { type: 'array', items: { type: 'object', additionalProperties: true,
      required: ['name', 'whatItDoes', 'gapItFillsInJidoka'],
      properties: {
        name: { type: 'string' }, url: { type: 'string' }, stars: { type: 'string' }, lastActivity: { type: 'string' },
        whatItDoes: { type: 'string' }, killerFeature: { type: 'string' }, methodOrPaper: { type: 'string' },
        gapItFillsInJidoka: { type: 'string' },
        duplicationRisk: { type: 'string', enum: ['none', 'partial', 'full', 'unknown'] },
        integrationEffort: { type: 'string', enum: ['quick-win', 'medium', 'big-bet', 'unknown'] },
        jidokaWiringPoint: { type: 'string' },
      } } },
    methods: { type: 'array', items: { type: 'object', additionalProperties: true } },
  },
}
const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: true, required: ['repo', 'exists', 'recommendation', 'reason'],
  properties: {
    repo: { type: 'string' }, url: { type: 'string' }, exists: { type: 'boolean' },
    maintained: { type: 'string', enum: ['active', 'stale', 'archived', 'unknown'] }, starsVerified: { type: 'string' },
    duplicatesJidoka: { type: 'string', enum: ['none', 'partial', 'full', 'unknown'] },
    realGapFilled: { type: 'string' }, wiresOrDies: { type: 'string' },
    recommendation: { type: 'string', enum: ['ADOPT', 'ADAPT', 'REJECT'] }, reason: { type: 'string' },
  },
}
const ARG_SCHEMA = { type: 'object', additionalProperties: true, required: ['argument'], properties: { argument: { type: 'string' } } }
const DEBATE_VERDICT_SCHEMA = {
  type: 'object', additionalProperties: true, required: ['verdict', 'reasoning'],
  properties: { verdict: { type: 'string', enum: ['ADOPT', 'ADAPT', 'REJECT'] }, confidence: { type: 'string' },
    reasoning: { type: 'string' }, ifAdopt_killerFeature: { type: 'string' }, ifAdopt_wiringPoint: { type: 'string' } },
}
const SYNTH_SCHEMA = {
  type: 'object', additionalProperties: true, required: ['executiveSummary', 'recommendations'],
  properties: {
    executiveSummary: { type: 'string' },
    strengthsToReinforce: { type: 'array', items: { type: 'string' } },
    weaknessesToClose: { type: 'array', items: { type: 'object', additionalProperties: true } },
    recommendations: { type: 'array', items: { type: 'object', additionalProperties: true,
      required: ['title', 'priority'],
      properties: { rank: { type: 'number' }, title: { type: 'string' }, sourceRepo: { type: 'string' }, url: { type: 'string' },
        what: { type: 'string' }, killerFeature: { type: 'string' }, gapFilled: { type: 'string' }, jidokaWiringPoint: { type: 'string' },
        effort: { type: 'string' }, priority: { type: 'string' }, debateVerdict: { type: 'string' }, isNewThisWeek: { type: 'boolean' } } } },
    quickWins: { type: 'array', items: { type: 'string' } },
    bigBets: { type: 'array', items: { type: 'string' } },
    deltaVsLastWeek: { type: 'string' },
  },
}

function researchPrompt(domain, focus) {
  return `Ты ищешь на GitHub и в вебе РЕАЛЬНЫЕ репозитории/методики, которые усилят движок jidoka в домене: ${domain}.
${REALITY}
ФОКУС: ${focus}
КАК: используй WebSearch + WebFetch (и gh search repos / gh repo view через Bash если есть). ОБЯЗАТЕЛЬНО проверь, что репо существует (открой страницу), запиши реальные звёзды и дату активности. НЕ выдумывай (если не уверен — "unknown").
Отдавай приоритет тому, чего у jidoka НЕТ или что радикально лучше. НЕ предлагай то, что в "УЖЕ ВНЕДРЕНО". Если репо дублирует существующее — duplicationRisk=full и объясни.
Для каждого: что делает, killer feature, метод/статья, КОНКРЕТНЫЙ пробел jidoka, риск дублирования, усилие (quick-win/medium/big-bet), КОНКРЕТНАЯ точка встройки (скрипт/агент/hook/док). Верни 5-8 лучших + заметные методики. Качество важнее количества, будь скептичен.`
}

phase('Research')
const DOMAINS = [
  { key: 'agentic-orchestration', focus: 'Оркестрация многоагентной разработки: claude-flow, OpenHands, Aider, CrewAI, AutoGen/AG2, LangGraph, Swarm. Что в координации/параллелизме сильнее нашего pipeline?' },
  { key: 'agent-memory', focus: 'Память агентов: mem0, Letta/MemGPT, Zep, Graphiti, cognee, claude-context, MemoryOS, A-MEM. Vector/graph/иерархическая память, RAG, авто-подтягивание контекста.' },
  { key: 'spec-context-engineering', focus: 'Spec-driven и context engineering: spec-kit, BMAD, Kiro, agent-os, context-engineering, repomix. Что сильнее нашей L0-L4 иерархии?' },
  { key: 'requirements-elicitation', focus: 'Движки бизнес-вопросов: structured interviews, PRD/PRFAQ генераторы, Mom Test, Socratic questioning, requirement completeness, JTBD.' },
  { key: 'eval-llm-judge', focus: 'Eval и LLM-as-judge: promptfoo, DeepEval, Inspect (AISI), Ragas, langfuse, agent-as-judge, judge calibration/debias, golden-dataset тулинг.' },
  { key: 'self-improve-debate', focus: 'Методы 2025-2026: self-refine, Reflexion-варианты, multi-agent debate, ToT/GoT, DSPy/TextGrad, automatic prompt optimization, self-improving agents.' },
  { key: 'prompt-skills-mcp', focus: 'Промпт-оптимизация, agent skills, MCP-экосистема: DSPy, TextGrad, awesome-skills, MCP servers (memory/knowledge-graph/sequential-thinking), subagent design.' },
  { key: 'competitor-killer-features', focus: 'Киллер-фичи конкурентов (gap-анализ): Cursor, Devin, Factory, Codex/Copilot Workspace, Replit Agent, Windsurf. Чего нет у jidoka и стоит воспроизвести.' },
]

const findings = (await parallel(DOMAINS.map((d) => () =>
  agent(researchPrompt(d.key, d.focus), { label: `research:${d.key}`, phase: 'Research', schema: REPO_FINDINGS_SCHEMA, agentType: 'general-purpose' })
))).filter(Boolean)

// dedupe across domains (barrier: need all to dedupe + score)
const repoMap = new Map()
for (const f of findings) for (const r of (f.repos || [])) {
  const key = String(r.name || r.url || '').toLowerCase().replace(/^https?:\/\/github\.com\//, '').replace(/\/+$/, '').trim()
  if (!key) continue
  if (!repoMap.has(key)) repoMap.set(key, { ...r, domains: [f.domain], appearances: 1 })
  else { const e = repoMap.get(key); e.appearances++; e.domains.push(f.domain); if (!e.url && r.url) e.url = r.url }
}
const allMethods = findings.flatMap((f) => (f.methods || []).map((m) => ({ ...m, domain: f.domain })))
const candidates = [...repoMap.values()].filter((r) => r.duplicationRisk !== 'full').sort((a, b) => b.appearances - a.appearances).slice(0, 24)
log(`${repoMap.size} уник. репо; ${candidates.length} кандидатов; ${allMethods.length} методик`)

phase('Verify')
const verdicts = (await parallel(candidates.map((r) => () =>
  agent(`Адверсариально проверь кандидата на усиление jidoka. Будь скептиком: не пропусти дубль/мёртвый вес.
РЕПО: ${r.name}  ${r.url || ''}
Заявлено: ${r.whatItDoes || ''} | killer: ${r.killerFeature || ''} | пробел: ${r.gapItFillsInJidoka || ''} | встройка: ${r.jidokaWiringPoint || ''}
${REALITY}
Через WebFetch/gh проверь: (1) существует; (2) живой (последний коммит, не архив); (3) реальные звёзды; (4) дублирует ли УЖЕ ВНЕДРЁННОЕ (none/partial/full); (5) реальный ли пробел; (6) встроится в живой механизм или мёртвый код. recommendation ADOPT/ADAPT/REJECT с причиной. Не существует → exists=false, REJECT.`,
    { label: `verify:${r.name}`.slice(0, 48), phase: 'Verify', schema: VERIFY_SCHEMA, agentType: 'general-purpose' })
    .then((v) => ({ ...v, candidate: r })).catch(() => null)
))).filter(Boolean)
const survivors = verdicts.filter((v) => v.exists && v.recommendation !== 'REJECT')
const shortlist = survivors.sort((a, b) => (a.recommendation === 'ADOPT' ? -1 : 1) - (b.recommendation === 'ADOPT' ? -1 : 1)).slice(0, 10)
log(`Проверку прошли ${survivors.length}/${verdicts.length}; в дебаты ${shortlist.length}`)

phase('Debate')
const debated = await pipeline(shortlist,
  (v, _o, i) => parallel([
    () => agent(`Ты ПРОКУРОР: сильнейший довод ПРОТИВ внедрения "${v.candidate.name}" в jidoka (дублирует / мёртвый груз / не стоит усилий / лишняя зависимость / не закрывает реальный пробел).
${REALITY}
Верификатор: пробел=${v.realGapFilled || ''}, wiresOrDies=${v.wiresOrDies || ''}, dup=${v.duplicatesJidoka}.`,
      { label: `prosecute:${i}`, phase: 'Debate', schema: ARG_SCHEMA, agentType: 'general-purpose' }),
    () => agent(`Ты ЗАЩИТНИК: сильнейший довод ЗА внедрение "${v.candidate.name}" — конкретный пробел, killer feature, точная точка встройки, почему это станет живым механизмом.
${REALITY}
Заявка: ${v.candidate.whatItDoes || ''} | пробел: ${v.realGapFilled || v.candidate.gapItFillsInJidoka || ''}.`,
      { label: `defend:${i}`, phase: 'Debate', schema: ARG_SCHEMA, agentType: 'general-purpose' }),
  ]),
  (args2, v, i) => agent(`Ты СУДЬЯ: один вердикт ADOPT/ADAPT/REJECT по внедрению "${v.candidate.name}" в jidoka.
ПРЕДЛОЖЕНИЕ: ${v.candidate.whatItDoes || ''}
ПРОКУРОР: ${args2[0] ? args2[0].argument : '(нет)'}
ЗАЩИТНИК: ${args2[1] ? args2[1].argument : '(нет)'}
${REALITY}
Внедряем ТОЛЬКО если закрывает реальный пробел, встроится в живой механизм, не дублирует. Если ADOPT/ADAPT — назови killer feature и точную точку встройки.`,
    { label: `judge:${i}`, phase: 'Debate', schema: DEBATE_VERDICT_SCHEMA, effort: 'high' })
    .then((verdict) => ({ proposal: v.candidate.name, url: v.candidate.url, verifier: v, verdict })).catch(() => null))
const debatedClean = (debated || []).filter(Boolean)
const adopted = debatedClean.filter((d) => d.verdict && d.verdict.verdict !== 'REJECT')
log(`Дебаты: ${adopted.length} прошли из ${debatedClean.length}`)

phase('Synthesize')
const synthInput = {
  reconSummary: recon?.summary || '',
  weaknesses: recon?.weaknesses || [],
  debateOutcomes: debatedClean.map((d) => ({ repo: d.proposal, url: d.url, verdict: d.verdict.verdict, confidence: d.verdict.confidence, reasoning: d.verdict.reasoning, killer: d.verdict.ifAdopt_killerFeature, wiring: d.verdict.ifAdopt_wiringPoint })),
  priorProposals: recon?.priorProposals || [],
  notableMethods: allMethods.slice(0, 20),
}
const synthesis = await agent(
  `Ты — главный синтезатор недельного плана усиления движка jidoka. На входе: разведка текущего состояния, результаты адверсариальной проверки и AI-войны.
${REALITY}
ДАННЫЕ:
${JSON.stringify(synthInput, null, 2)}
Собери итог строго по схеме:
- executiveSummary: 1 абзац — главный вывод недели.
- strengthsToReinforce: что усилить из сильного.
- weaknessesToClose: [{weakness, severity}] — реальные дыры.
- recommendations: РАНЖИРОВАННЫЙ список ТОЛЬКО прошедших дебаты (ADOPT/ADAPT). Для каждого: rank, title, sourceRepo, url, what, killerFeature, gapFilled, jidokaWiringPoint (конкретный скрипт/агент/hook), effort, priority (P0/P1/P2), debateVerdict, isNewThisWeek (true если НЕ было в priorProposals).
- quickWins (3-6), bigBets (2-4), deltaVsLastWeek (что нового vs прошлые отчёты).
Не дублируй УЖЕ ВНЕДРЁННОЕ. Привязывай каждую рекомендацию к реальной точке встройки.`,
  { label: 'synthesize', phase: 'Synthesize', schema: SYNTH_SCHEMA, effort: 'high', agentType: 'general-purpose' }
)

return { recon, synthesis, debatedClean, candidatesChecked: candidates.length, methodsCount: allMethods.length }

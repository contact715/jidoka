---
status: Template
level: L0
type: north-star
owner_role: chief-product-officer
created: 2026-05-31
---

# North Star — <PRODUCT NAME>

> The product's compass. Filled once per product, kept short, revisited each wave. Everything
> below the architecture (business processes, features, agent behaviour) is DERIVED from this —
> not the other way round. The Chief Product Officer owns this file. A feature that does not
> serve the North Star does not get built; a process that violates an Invariant gets redesigned,
> not optimised.
>
> Replace every `<...>`. Delete this quote block when done. Keep the whole file under ~1 page —
> a North Star that needs scrolling is a strategy doc, not a compass.

## 1. North Star (one sentence)
<Where this product is going, in a single sentence a new teammate could repeat back. Not a feature
list. The thing that stays true even as features change.>

## 2. Why it exists (the pain)
<Whose pain, and what it costs them today. Concrete, not abstract. "X loses 30% of leads because
nobody answers at night", not "we optimise workflows". If you can't name whose day gets better,
stop here.>

## 3. Goal — 1 to 3 years (what success looks like)
<The measurable destination. 2-4 outcomes with numbers where possible. This is what the Kaizen
metric loop checks against. "Every inbound answered in <60s, 24/7" / "owner sees true revenue
daily without asking anyone".>

## 4. Principles (how we act — what is sacred)
<3-6 principles that decide tie-breaks. The ones you would defend in a hard meeting. Each one
line. e.g. "Honest over impressive — if the AI was wrong, it says so." / "On the customer's
language, no abstractions.">

## 5. Invariants (rules we NEVER break — processes are derived FROM these)
<This is the section that turns philosophy into process. List the hard rules every business
process and feature must satisfy. A new process is designed to honour these; if it can't, the
process is wrong, not the invariant. e.g. "A human approves before anything irreversible reaches
a customer." / "‘Sent/saved' is claimed only after the tool really succeeded." Each invariant
should be checkable.>

## 6. What we do NOT do (anti-scope — the boundary)
<Explicit non-goals. What this product refuses to be, so it does not sprawl. "Not a generic
chatbot." / "Not a CRM replacement." Saying no here is what keeps the North Star sharp.>

## 7. How we check alignment (the gate every wave runs)
Every new feature / tool / process is run against this North Star before build:
- **Helps** — advances the Goal or strengthens a Principle → proceed.
- **Neutral** — does not move the North Star but does not violate it → allowed, deprioritised.
- **Conflicts** — works against the Goal, breaks an Invariant, or crosses the anti-scope boundary
  → **andon: stop and decide.** Either the feature changes, or the North Star changes on purpose
  (a deliberate pivot, logged), never silently.

The Chief Product Officer answers helps/neutral/conflicts in the product brief; `northstar-check`
verifies the document exists and is complete and that the wave's spec is bound to it.

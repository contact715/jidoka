// Unit tests for the development model router. This keeps the Fable-vs-Codex
// split executable instead of living only in AGENTS.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeDevelopmentTask } from '../model-router.mjs';

test('architecture and migration work routes to Fable planning', () => {
  const route = routeDevelopmentTask('plan architecture for a large billing migration');
  assert.equal(route.route, 'fable-plan');
  assert.equal(route.primary.model, 'claude-fable-5');
  assert.equal(route.secondary.model, 'gpt-5.5');
  assert.equal(route.handoffRequired, true);
  assert.equal(route.automation.autoRelay, true);
});

test('clear implementation with proof routes to Codex execution', () => {
  const route = routeDevelopmentTask('add a button and run tests');
  assert.equal(route.route, 'codex-execute');
  assert.equal(route.primary.model, 'gpt-5.5');
  assert.equal(route.reviewRequired, false);
  assert.equal(route.automation.mode, 'direct-codex');
});

test('systemic design drift root cause routes to Fable planning', () => {
  const route = routeDevelopmentTask('find root-cause of design system drift, fix it, and add regression protection');
  assert.equal(route.route, 'fable-plan');
  assert.equal(route.primary.model, 'claude-fable-5');
  assert.equal(route.secondary.model, 'gpt-5.5');
  assert.equal(route.automation.autoRelay, true);
  assert.deepEqual(route.signals.plan, ['architecture', 'root-cause', 'systemic-guardrail']);
});

test('high-risk post-code work routes to Fable review', () => {
  const route = routeDevelopmentTask('review this auth diff', { phase: 'after-code', changedLines: 120 });
  assert.equal(route.route, 'fable-review');
  assert.equal(route.primary.model, 'claude-fable-5');
  assert.equal(route.reviewRequired, true);
  assert.equal(route.automation.autoRelay, true);
});

test('privacy-sensitive work requires redaction before Fable handoff', () => {
  const route = routeDevelopmentTask('debug an env file with API key and customer data');
  assert.equal(route.redactionRequired, true);
  assert.match(route.route, /^codex-redact/);
  assert.equal(route.automation.autoRelay, false);
});

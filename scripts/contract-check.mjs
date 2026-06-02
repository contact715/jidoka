#!/usr/bin/env node
// contract-check — the fe↔be contract gate. Given a declared contract (the API endpoints both sides
// agreed on), verify the FRONTEND only calls endpoints that exist in the contract, and the BACKEND
// implements every endpoint the contract promises. Catches the classic drift: the frontend calls
// POST /api/x that the backend renamed, or the backend ships an endpoint the contract never declared.
//
// HONEST boundary: it checks {method, path} agreement between three lists (contract / fe-calls /
// be-handlers) that a product's build extracts (e.g. fe from the api-client, be from the route table).
// It does NOT parse arbitrary source to discover calls — the product supplies the lists. The framework
// itself exposes no HTTP API → N/A here (the api-contract-registry is the matching DORMANT slot); the
// gate + this matcher ship to products via install-into.
//
// FULL logic / DORMANT data (no API in this repo). Usage:
//   node scripts/contract-check.mjs --self-test
//   node scripts/contract-check.mjs --contract <c.json> --fe <fe.json> --be <be.json>

import { readFileSync, existsSync } from 'node:fs';

const key = (e) => `${String(e.method || 'GET').toUpperCase()} ${e.path}`;

// pure: compare fe-calls and be-handlers against the declared contract
export function checkContract(contract = [], feCalls = [], beHandlers = []) {
  const C = new Set(contract.map(key)), FE = new Set(feCalls.map(key)), BE = new Set(beHandlers.map(key));
  const feViolations = [...FE].filter((k) => !C.has(k));            // FE calls something not in the contract
  const beMissing = [...C].filter((k) => !BE.has(k));               // contract promises an endpoint BE didn't implement
  const beUndeclared = [...BE].filter((k) => !C.has(k));            // BE exposes an endpoint the contract never declared
  const violations = [
    ...feViolations.map((k) => ({ kind: 'fe-calls-undeclared', endpoint: k })),
    ...beMissing.map((k) => ({ kind: 'be-missing-contract-endpoint', endpoint: k })),
    ...beUndeclared.map((k) => ({ kind: 'be-exposes-undeclared', endpoint: k })),
  ];
  return { ok: violations.length === 0, violations, contract: C.size, fe: FE.size, be: BE.size };
}

function selfTest() {
  const fails = [];
  const ok = (n, c) => { if (!c) fails.push(n); console.log(`  ${c ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${n}`); };

  const contract = [{ method: 'GET', path: '/api/leads' }, { method: 'POST', path: '/api/leads' }];
  ok('matching fe + be → ok', checkContract(contract, contract, contract).ok === true);
  ok('FE calls an undeclared endpoint → violation', (() => { const r = checkContract(contract, [...contract, { method: 'DELETE', path: '/api/leads' }], contract); return !r.ok && r.violations.some((v) => v.kind === 'fe-calls-undeclared'); })());
  ok('BE missing a contract endpoint → violation', (() => { const r = checkContract(contract, contract, [{ method: 'GET', path: '/api/leads' }]); return !r.ok && r.violations.some((v) => v.kind === 'be-missing-contract-endpoint'); })());
  ok('BE exposes an undeclared endpoint → violation', (() => { const r = checkContract(contract, contract, [...contract, { method: 'GET', path: '/api/secret' }]); return !r.ok && r.violations.some((v) => v.kind === 'be-exposes-undeclared'); })());
  ok('method mismatch is caught (GET vs POST distinct)', (() => { const r = checkContract([{ method: 'GET', path: '/x' }], [{ method: 'POST', path: '/x' }], [{ method: 'GET', path: '/x' }]); return !r.ok && r.violations.some((v) => v.kind === 'fe-calls-undeclared'); })());
  ok('empty everything → vacuously ok', checkContract([], [], []).ok === true);

  if (fails.length) { console.log(`\n\x1b[31mcontract-check self-test FAILED (${fails.length})\x1b[0m`); process.exit(1); }
  console.log('\n\x1b[32m✓ contract-check: fe↔be contract matching correct\x1b[0m');
  process.exit(0);
}

const arg = (k) => { const i = process.argv.indexOf(k); return i !== -1 ? process.argv[i + 1] : null; };
const load = (p) => (p && existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);

const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--self-test')) selfTest();
  const contract = load(arg('--contract')), fe = load(arg('--fe')), be = load(arg('--be'));
  if (!contract || !fe || !be) {
    console.log('contract-check: N/A here — needs --contract/--fe/--be endpoint lists (a product supplies them; this repo exposes no HTTP API). The gate ships to products.');
    process.exit(0);
  }
  const r = checkContract(contract.endpoints || contract, fe.endpoints || fe, be.endpoints || be);
  console.log(`contract-check: contract ${r.contract} · fe ${r.fe} · be ${r.be} endpoint(s)`);
  if (!r.ok) {
    console.error(`\n\x1b[31m✗ ${r.violations.length} contract violation(s):\x1b[0m`);
    for (const v of r.violations) console.error(`    ${v.kind}: ${v.endpoint}`);
    process.exit(1);
  }
  console.log('\x1b[32m✓ fe and be agree with the contract.\x1b[0m');
  process.exit(0);
}

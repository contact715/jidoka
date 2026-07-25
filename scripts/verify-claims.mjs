#!/usr/bin/env node
/**
 * verify-claims — mechanically verify the CHECKABLE SPECIFICS inside a draft
 * before it is shown to the owner or sent to anyone outside.
 *
 * Origin (owner escalation, projectx 2026-07-24): a partner-facing email to Thumbtack
 * carried the redirect URI `https://mosco.ai/auth/thumbtack/callback`. It was invented
 * by analogy with an older application form — the host serves the marketing site, the
 * route does not exist in the repo, and the real app host `app.mosco.ai` has no DNS
 * record at all. Nothing in the toolchain checked it; the owner caught it by eye.
 *
 * Anti-pattern class: `fabricated-verifiable-specific` — emitting a concrete, checkable
 * detail (URL, host, route, email) that was inferred rather than verified.
 *
 * What this does: extract every URL / host / email from a draft, then actually resolve
 * DNS, actually issue an HTTP request, and — for hosts we own — actually look for a
 * matching Next.js route in the repo. Prints a verdict table.
 *
 * Design rule: only DEFINITIVE negatives fail (NXDOMAIN, 404/410, missing route on an
 * owned host). Network trouble, timeouts and 5xx are reported as UNVERIFIED and never
 * fail the run — a flaky link must not block honest work.
 *
 * Usage:
 *   node verify-claims.mjs --file draft.md
 *   node verify-claims.mjs --text "... draft ..."
 *   cat draft.md | node verify-claims.mjs
 *   node verify-claims.mjs --self-test
 *
 * Options:
 *   --repo <path>    repo root used to resolve route claims (default: cwd)
 *   --owned <a,b>    comma-separated owned domains (default: ~/.claude/owned-domains.json)
 *   --offline        skip all network, report every network claim as UNVERIFIED
 *   --json           machine-readable output
 *   --quiet          only print problems
 *
 * Exit codes: 0 = no definitive problems · 1 = at least one fabricated/dead specific · 2 = usage error
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import dns from "node:dns/promises";

const HTTP_TIMEOUT_MS = 10_000;
const MAX_CHECKS = 40;

/* ------------------------------------------------------------------ extraction */

// Deliberately conservative: trailing punctuation is stripped so "see https://x.com."
// does not become a claim about "x.com.".
const URL_RE = /https?:\/\/[^\s<>"'`)\]}|]+/gi;
const EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi;
const TRAILING_JUNK = /[.,;:!?)>\]}'"]+$/;

/** Extract checkable specifics from free text. Pure — no I/O. */
export function extractClaims(text) {
  const claims = [];
  const seen = new Set();
  const push = (kind, value, extra = {}) => {
    const key = `${kind}:${value.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    claims.push({ kind, value, ...extra });
  };

  for (const raw of text.match(URL_RE) || []) {
    const cleaned = raw.replace(TRAILING_JUNK, "");
    let parsed;
    try {
      parsed = new URL(cleaned);
    } catch {
      continue;
    }
    push("url", cleaned, { host: parsed.hostname.toLowerCase(), pathname: parsed.pathname });
  }

  for (const raw of text.match(EMAIL_RE) || []) {
    const cleaned = raw.replace(TRAILING_JUNK, "");
    push("email", cleaned, { host: cleaned.split("@")[1].toLowerCase() });
  }

  return claims;
}

/** True when `host` is, or is a subdomain of, one of the owned domains. */
export function isOwnedHost(host, ownedDomains) {
  const h = String(host || "").toLowerCase();
  return ownedDomains.some((d) => {
    const dd = String(d).toLowerCase();
    return h === dd || h.endsWith(`.${dd}`);
  });
}

/* ---------------------------------------------------------------- classification */

/** Map an HTTP status onto a verdict. Pure — the network half is injected by the caller. */
export function classifyHttp(status) {
  if (status >= 200 && status < 400) return { state: "LIVE", note: `HTTP ${status}` };
  if (status === 401 || status === 403 || status === 429)
    return { state: "PROTECTED", note: `HTTP ${status} — host answers, path not provable` };
  if (status === 404 || status === 410)
    return { state: "DEAD_PATH", note: `HTTP ${status} — this address does not exist` };
  return { state: "UNVERIFIED", note: `HTTP ${status}` };
}

/* ------------------------------------------------------------------ route lookup */

/** Strip Next.js route groups `(marketing)` and parallel segments `@slot`. */
function routeSegments(dirRelPath) {
  return dirRelPath
    .split(path.sep)
    .filter((seg) => seg && !(seg.startsWith("(") && seg.endsWith(")")) && !seg.startsWith("@"));
}

const ROUTE_FILES = ["page.tsx", "page.jsx", "page.ts", "page.js", "route.ts", "route.js"];

/**
 * Look for a Next.js App-Router route matching `urlPath` inside `repoRoot`.
 * Returns { state: 'ROUTE_FOUND'|'ROUTE_MISSING'|'NO_REPO', match?: string }.
 * Dynamic segments ([id], [...slug]) count as a match for the corresponding position.
 */
export function resolveRouteInRepo(repoRoot, urlPath) {
  const appDir = path.join(repoRoot, "app");
  if (!fs.existsSync(appDir)) return { state: "NO_REPO" };

  const wanted = String(urlPath || "/")
    .split("/")
    .filter(Boolean)
    .map((s) => s.toLowerCase());

  let found = null;

  const walk = (dir, relSegs) => {
    if (found) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const hasRouteFile = entries.some((e) => e.isFile() && ROUTE_FILES.includes(e.name));
    if (hasRouteFile && segmentsMatch(relSegs, wanted)) {
      found = path.relative(repoRoot, dir) || "app";
      return;
    }

    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const next = routeSegments(path.join(relSegs.join(path.sep), e.name));
      // depth guard: never wander deeper than the address we are checking
      if (next.length > wanted.length + 2) continue;
      walk(path.join(dir, e.name), [...relSegs, e.name]);
      if (found) return;
    }
  };

  walk(appDir, []);
  return found ? { state: "ROUTE_FOUND", match: found } : { state: "ROUTE_MISSING" };
}

/** Compare a candidate route dir (raw segments, groups included) against wanted URL segments. */
export function segmentsMatch(rawSegs, wanted) {
  const actual = routeSegments(rawSegs.join(path.sep)).map((s) => s.toLowerCase());
  if (actual.length !== wanted.length) return false;
  return actual.every((seg, i) => {
    if (seg.startsWith("[") && seg.endsWith("]")) return true; // dynamic segment
    return seg === wanted[i];
  });
}

/* ----------------------------------------------------------------- network probes */

async function probeHost(host, offline) {
  if (offline) return { state: "UNVERIFIED", note: "offline mode" };
  try {
    await dns.lookup(host);
    return { state: "RESOLVES" };
  } catch (err) {
    const code = err && err.code;
    if (code === "ENOTFOUND" || code === "NXDOMAIN" || code === "EAI_NODATA")
      return { state: "DEAD_HOST", note: "no DNS record — this host does not exist" };
    return { state: "UNVERIFIED", note: `DNS error ${code || "unknown"}` };
  }
}

async function probeUrl(url, offline) {
  if (offline) return { state: "UNVERIFIED", note: "offline mode" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        // Some hosts 403 a bare fetch; a normal UA keeps the answer honest.
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      },
    });
    return classifyHttp(res.status);
  } catch (err) {
    const msg = err && err.name === "AbortError" ? "timeout" : String((err && err.message) || err);
    return { state: "UNVERIFIED", note: `request failed: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------------------------------------------------- verifier */

export async function verifyClaims(text, opts = {}) {
  const owned = opts.owned || [];
  const repoRoot = opts.repo || process.cwd();
  const offline = Boolean(opts.offline);

  let claims = extractClaims(text);
  // `ownedOnly` keeps the Stop-hook pass fast and quiet: quoting a third-party link in
  // chat is normal, inventing an address on our own infrastructure is the actual defect.
  if (opts.ownedOnly) claims = claims.filter((c) => isOwnedHost(c.host, owned));
  claims = claims.slice(0, MAX_CHECKS);
  const results = [];

  for (const claim of claims) {
    const owns = isOwnedHost(claim.host, owned);
    const row = { ...claim, owned: owns, state: "UNVERIFIED", notes: [] };

    const host = await probeHost(claim.host, offline);
    if (host.state === "DEAD_HOST") {
      row.state = "DEAD";
      row.notes.push(host.note);
      results.push(row);
      continue;
    }
    if (host.note) row.notes.push(host.note);

    if (claim.kind === "email") {
      // An address we cannot send from is not provable here; resolving the domain is
      // the honest limit of a local check.
      row.state = host.state === "RESOLVES" ? "PLAUSIBLE" : "UNVERIFIED";
      results.push(row);
      continue;
    }

    const http = await probeUrl(claim.value, offline);
    row.notes.push(http.note);

    if (http.state === "DEAD_PATH") row.state = "DEAD";
    else if (http.state === "LIVE") row.state = "LIVE";
    else if (http.state === "PROTECTED") row.state = "PROTECTED";
    else row.state = "UNVERIFIED";

    // For a host we own, the repo is the source of truth about our own routes:
    // a path with no route file is fabricated even when the host answers 200.
    if (owns && claim.pathname && claim.pathname !== "/") {
      const route = resolveRouteInRepo(repoRoot, claim.pathname);
      if (route.state === "ROUTE_FOUND") row.notes.push(`route in repo: ${route.match}`);
      else if (route.state === "ROUTE_MISSING") {
        row.state = "DEAD";
        row.notes.push("no matching route in this repo — the address is invented");
      }
    }

    results.push(row);
  }

  const dead = results.filter((r) => r.state === "DEAD");
  return { results, dead, ok: dead.length === 0 };
}

/* -------------------------------------------------------------------- owned list */

export function loadOwnedDomains(explicit) {
  if (explicit && explicit.length) return explicit;
  const cfg = path.join(os.homedir(), ".claude", "owned-domains.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(cfg, "utf8"));
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.domains)) return parsed.domains;
  } catch {
    /* absent config is fine — owned-host checks simply do not apply */
  }
  return [];
}

/* -------------------------------------------------------------------- self-test */

function assert(cond, label) {
  if (!cond) throw new Error(`FAIL: ${label}`);
  console.log(`  ok  ${label}`);
}

async function selfTest() {
  console.log("verify-claims --self-test");
  let checks = 0;
  const check = (cond, label) => {
    assert(cond, label);
    checks++;
  };

  // 1. extraction
  const claims = extractClaims(
    "Redirect URI: https://mosco.ai/auth/thumbtack/callback\nContact: contact@castells.media (see https://example.com/docs.)"
  );
  check(claims.length === 3, "extracts two urls and one email");
  check(
    claims.some((c) => c.kind === "url" && c.pathname === "/auth/thumbtack/callback"),
    "keeps the url path"
  );
  check(
    claims.some((c) => c.value === "https://example.com/docs"),
    "strips trailing sentence punctuation"
  );
  check(
    claims.some((c) => c.kind === "email" && c.host === "castells.media"),
    "extracts email host"
  );

  // 2. dedup
  check(extractClaims("https://a.com/x https://a.com/x").length === 1, "dedupes repeats");

  // 3. owned-host matching
  check(isOwnedHost("app.mosco.ai", ["mosco.ai"]), "subdomain counts as owned");
  check(isOwnedHost("mosco.ai", ["mosco.ai"]), "apex counts as owned");
  check(!isOwnedHost("notmosco.ai", ["mosco.ai"]), "suffix lookalike is not owned");

  // 4. http classification
  check(classifyHttp(200).state === "LIVE", "200 is live");
  check(classifyHttp(404).state === "DEAD_PATH", "404 is a dead path");
  check(classifyHttp(403).state === "PROTECTED", "403 is protected, not dead");
  check(classifyHttp(500).state === "UNVERIFIED", "5xx is unverified, never a failure");

  // 5. route resolution against a throwaway repo
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "verify-claims-"));
  fs.mkdirSync(path.join(tmp, "app", "(dashboard)", "connections"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "app", "(dashboard)", "connections", "page.tsx"), "x");
  fs.mkdirSync(path.join(tmp, "app", "api", "integrations", "meta", "callback"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "app", "api", "integrations", "meta", "callback", "route.ts"), "x");

  check(resolveRouteInRepo(tmp, "/connections").state === "ROUTE_FOUND", "finds a route inside a route group");
  check(
    resolveRouteInRepo(tmp, "/api/integrations/meta/callback").state === "ROUTE_FOUND",
    "finds a nested api route"
  );
  check(
    resolveRouteInRepo(tmp, "/auth/thumbtack/callback").state === "ROUTE_MISSING",
    "reports the invented route as missing"
  );
  check(resolveRouteInRepo(path.join(tmp, "nope"), "/x").state === "NO_REPO", "no app dir → NO_REPO");

  // 6. end-to-end, offline: an invented route on an owned host must fail
  const bad = await verifyClaims("Redirect URI: https://mosco.ai/auth/thumbtack/callback", {
    owned: ["mosco.ai"],
    repo: tmp,
    offline: true,
  });
  check(!bad.ok && bad.dead.length === 1, "offline run still catches the invented owned route");

  // 7. end-to-end, offline: a third-party url is never failed on network grounds
  const neutral = await verifyClaims("See https://developers.thumbtack.com/docs", {
    owned: ["mosco.ai"],
    repo: tmp,
    offline: true,
  });
  check(neutral.ok, "third-party links are not failed when unverifiable");

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${checks} checks passed`);
}

/* ------------------------------------------------------------------------- cli */

function parseArgs(argv) {
  const out = { owned: null, repo: process.cwd(), offline: false, json: false, quiet: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--self-test") out.selfTest = true;
    else if (a === "--file") out.file = argv[++i];
    else if (a === "--text") out.text = argv[++i];
    else if (a === "--repo") out.repo = argv[++i];
    else if (a === "--owned") out.owned = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--offline") out.offline = true;
    else if (a === "--json") out.json = true;
    else if (a === "--quiet") out.quiet = true;
  }
  return out;
}

const ICON = { LIVE: "ok  ", PROTECTED: "~   ", PLAUSIBLE: "ok  ", UNVERIFIED: "?   ", DEAD: "DEAD" };

async function main() {
  const args = parseArgs(process.argv);
  if (args.selfTest) return selfTest();

  let text = args.text || "";
  if (args.file) text = fs.readFileSync(args.file, "utf8");
  if (!text && !process.stdin.isTTY) text = fs.readFileSync(0, "utf8");
  if (!text.trim()) {
    console.error("verify-claims: nothing to check. Pass --file, --text or pipe text on stdin.");
    process.exit(2);
  }

  const owned = loadOwnedDomains(args.owned);
  const { results, dead, ok } = await verifyClaims(text, {
    owned,
    repo: args.repo,
    offline: args.offline,
  });

  if (args.json) {
    console.log(JSON.stringify({ ok, results }, null, 2));
    process.exit(ok ? 0 : 1);
  }

  if (!results.length) {
    if (!args.quiet) console.log("verify-claims: no URLs or emails in this draft — nothing to check.");
    process.exit(0);
  }

  const rows = args.quiet ? dead : results;
  for (const r of rows) {
    const own = r.owned ? " [ours]" : "";
    console.log(`${ICON[r.state] || r.state} ${r.value}${own}`);
    for (const n of r.notes.filter(Boolean)) console.log(`      ${n}`);
  }

  if (!ok) {
    console.log(
      `\n${dead.length} fabricated or dead specific(s). Do not put these in front of the owner or send them anywhere — fix or drop them first.`
    );
    process.exit(1);
  }
  if (!args.quiet) console.log("\nall specifics check out.");
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`verify-claims: ${err && err.message ? err.message : err}`);
    process.exit(2);
  });
}

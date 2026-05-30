#!/usr/bin/env node
/**
 * Tool authoring scaffold.
 *
 * Generates the three artefacts every new tool needs:
 *   1. app/(dashboard)/<id>/page.tsx                — route stub
 *   2. components/<id>/<Pascal>Tool.tsx             — component skeleton with HeroBanner
 *   3. Appends a Tool entry to the matching per-category catalog file:
 *      components/tools-hub/data/catalog/<category>.ts
 *
 * Usage:
 *   npm run create-tool -- --id=foo --name="Foo Tool" --category=growth --description="..."
 *
 * Options:
 *   --id (required)          kebab-case identifier (e.g. foo-bar)
 *   --name (required)        display name
 *   --category (required)    one of: lead-capture | communication | scheduling |
 *                            reputation | growth | sales | ops | builders
 *   --description            short description (default: "...")
 *   --status                 live | beta | coming-soon (default: coming-soon)
 *   --icon                   lucide icon name (default: Sparkles)
 *   --agent-id               link to existing agent (optional)
 *   --dry-run                print what would be created, don't write
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const VALID_CATEGORIES = [
  'lead-capture', 'communication', 'scheduling', 'reputation',
  'growth', 'sales', 'ops', 'builders',
];

const VALID_STATUSES = ['live', 'beta', 'coming-soon'];

// Mapping from category id to the exported array name in catalog/<id>.ts.
const CATEGORY_ARRAY_NAME = {
  'lead-capture':  'LEAD_CAPTURE_TOOLS',
  'communication': 'COMMUNICATION_TOOLS',
  'scheduling':    'SCHEDULING_TOOLS',
  'reputation':    'REPUTATION_TOOLS',
  'growth':        'GROWTH_TOOLS',
  'sales':         'SALES_TOOLS',
  'ops':           'OPS_TOOLS',
  'builders':      'BUILDERS_TOOLS',
};

const { values } = parseArgs({
  options: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string', default: '...' },
    category: { type: 'string' },
    status: { type: 'string', default: 'coming-soon' },
    icon: { type: 'string', default: 'Sparkles' },
    'agent-id': { type: 'string', default: '' },
    'dry-run': { type: 'boolean', default: false },
  },
});

// Validate
if (!values.id || !/^[a-z][a-z0-9-]+$/.test(values.id)) {
  console.error('Error: --id is required and must be kebab-case (e.g. foo-bar)');
  process.exit(1);
}
if (!values.name) {
  console.error('Error: --name is required');
  process.exit(1);
}
if (!values.category || !VALID_CATEGORIES.includes(values.category)) {
  console.error(`Error: --category must be one of: ${VALID_CATEGORIES.join(', ')}`);
  process.exit(1);
}
if (!VALID_STATUSES.includes(values.status)) {
  console.error(`Error: --status must be one of: ${VALID_STATUSES.join(', ')}`);
  process.exit(1);
}
if (!/^[A-Z][A-Za-z0-9]*$/.test(values.icon)) {
  console.error('Error: --icon must be a PascalCase lucide-react icon name (e.g. Sparkles)');
  process.exit(1);
}

const ROOT = process.cwd();
const ROUTE_FILE = path.join(ROOT, `app/(dashboard)/${values.id}/page.tsx`);
const COMPONENT_DIR = path.join(ROOT, `components/${values.id}`);
const COMPONENT_FILE = path.join(COMPONENT_DIR, `${pascalCase(values.id)}Tool.tsx`);

// Per-category catalog is the registration target.
const CATALOG_FILE = path.join(ROOT, `components/tools-hub/data/catalog/${values.category}.ts`);
const ARRAY_NAME = CATEGORY_ARRAY_NAME[values.category];

// Pre-flight: ensure catalog file exists.
if (!fs.existsSync(CATALOG_FILE)) {
  console.error(`Error: catalog file not found at ${CATALOG_FILE}`);
  process.exit(1);
}

// Check duplicate id across ALL catalogs (registry uniqueness).
const allCatalogs = VALID_CATEGORIES.map((c) =>
  path.join(ROOT, `components/tools-hub/data/catalog/${c}.ts`)
).filter((p) => fs.existsSync(p));
for (const cat of allCatalogs) {
  const content = fs.readFileSync(cat, 'utf-8');
  if (content.includes(`id: "${values.id}"`)) {
    console.error(`Error: tool with id "${values.id}" already registered in ${path.relative(ROOT, cat)}`);
    process.exit(1);
  }
}
if (fs.existsSync(ROUTE_FILE)) {
  console.error(`Error: route file already exists: ${ROUTE_FILE}`);
  process.exit(1);
}
if (fs.existsSync(COMPONENT_FILE)) {
  console.error(`Error: component file already exists: ${COMPONENT_FILE}`);
  process.exit(1);
}

const Pascal = pascalCase(values.id);

// Generate route stub
const routeTemplate = `"use client";

import { ${Pascal}Tool } from "@/components/${values.id}/${Pascal}Tool";

export default function ${Pascal}Page() {
  return <${Pascal}Tool />;
}
`;

// Generate component stub
const componentTemplate = `"use client";

import { HeroBanner, HeroPill } from "@/components/ui/HeroBanner";
import { Sparkles } from "lucide-react";

/**
 * ${values.name} — ${values.description}
 *
 * Status: ${values.status}
 * Category: ${values.category}
 *
 * TODO: implement.
 */
export function ${Pascal}Tool() {
  return (
    <div className="flex flex-col gap-6">
      <HeroBanner
        id="${values.id}-intro"
        title={<>${values.name}</>}
        body={<>${values.description}</>}
      >
        <HeroPill>
          <Sparkles className="w-3.5 h-3.5" /> Coming soon
        </HeroPill>
      </HeroBanner>

      <div className="rounded-card border border-[color:var(--border-default)] bg-[color:var(--surface-secondary)] p-6">
        <p className="text-sm text-[color:var(--text-muted)]">
          ${values.name} is under construction. Check back soon.
        </p>
      </div>
    </div>
  );
}
`;

// Tool entry to append to the catalog array
const toolEntry = `  // Auto-generated ${new Date().toISOString().slice(0, 10)} — verify category placement
  {
    id: "${values.id}",
    name: "${values.name}",
    description: "${values.description}",
    icon: ${values.icon},
    href: "/${values.id}",
    status: "${values.status}",
    category: "${values.category}",${values['agent-id'] ? `\n    agentId: "${values['agent-id']}",` : ''}
    features: [],
  },`;

// Compute the catalog file edit (insert entry + ensure icon import).
const catalogContent = fs.readFileSync(CATALOG_FILE, 'utf-8');
const { updatedContent: nextCatalogContent, error: editError } = injectEntry(
  catalogContent,
  toolEntry,
  values.icon,
  ARRAY_NAME,
);

if (editError) {
  console.error(`Error: ${editError}`);
  process.exit(1);
}

if (values['dry-run']) {
  console.log('--- DRY RUN ---');
  console.log('Would create:', path.relative(ROOT, ROUTE_FILE));
  console.log('Would create:', path.relative(ROOT, COMPONENT_FILE));
  console.log('Would update:', path.relative(ROOT, CATALOG_FILE));
  console.log('');
  console.log('Tool entry to be appended:');
  console.log(toolEntry);
  process.exit(0);
}

// Write route file
fs.mkdirSync(path.dirname(ROUTE_FILE), { recursive: true });
fs.writeFileSync(ROUTE_FILE, routeTemplate);

// Write component file
fs.mkdirSync(COMPONENT_DIR, { recursive: true });
fs.writeFileSync(COMPONENT_FILE, componentTemplate);

// Update catalog
fs.writeFileSync(CATALOG_FILE, nextCatalogContent);

console.log(`Created tool "${values.id}":`);
console.log(`   Route:     ${path.relative(ROOT, ROUTE_FILE)}`);
console.log(`   Component: ${path.relative(ROOT, COMPONENT_FILE)}`);
console.log(`   Registry:  ${path.relative(ROOT, CATALOG_FILE)} (entry appended to ${ARRAY_NAME})`);
console.log('');
console.log('Next steps:');
console.log(`   1. Update the features array + double-check the icon choice`);
console.log(`   2. Add to sidebar nav (lib/sidebar/nav.ts or similar) if desired`);
console.log(`   3. Run npm run dev and visit /${values.id}`);

function pascalCase(str) {
  return str
    .split('-')
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

/**
 * Inject `entry` immediately before the closing `];` of the named array,
 * and ensure `icon` is present in the lucide-react import line.
 *
 * Returns { updatedContent, error }.
 */
function injectEntry(source, entry, icon, arrayName) {
  // 1. Find the array `export const ARRAY_NAME: Tool[] = [ ... ];`
  // We split on lines and walk to find the array end.
  const arrayDeclRegex = new RegExp(`export\\s+const\\s+${arrayName}\\s*:\\s*Tool\\[\\]\\s*=\\s*\\[`);
  const declMatch = source.match(arrayDeclRegex);
  if (!declMatch) {
    return { error: `could not find \`export const ${arrayName}: Tool[] = [\` in catalog file` };
  }
  // The matched substring ends at the opening `[` of the array literal —
  // place the cursor immediately after it so we walk the array body, not
  // the `Tool[]` type-annotation brackets.
  const openBracketIdx = declMatch.index + declMatch[0].length - 1;
  let depth = 1;
  let i = openBracketIdx + 1;
  let inString = null;     // single | double | template
  let inLineComment = false;
  let inBlockComment = false;
  for (; i < source.length; i++) {
    const ch = source[i];
    const prev = source[i - 1];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (prev === '*' && ch === '/') inBlockComment = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') { inLineComment = true; i++; continue; }
    if (ch === '/' && source[i + 1] === '*') { inBlockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) {
    return { error: 'could not find matching closing `]` of catalog array' };
  }
  const closingBracketIdx = i; // points at `]`

  // Insert entry directly before the closing `]`. We want the result to read:
  //   ...prev,\n  // Auto-generated ...\n  { ... },\n];
  // Detect whether the char before `]` is a newline; if so, just splice.
  // Otherwise add a leading newline.
  const insertion = `\n${entry}\n`;
  let updated = source.slice(0, closingBracketIdx) + insertion + source.slice(closingBracketIdx);

  // 2. Ensure icon is in the lucide-react import.
  // Find lines like: import { ... } from "lucide-react";
  const importRegex = /import\s*\{([^}]*)\}\s*from\s*["']lucide-react["']\s*;?/;
  const importMatch = updated.match(importRegex);
  if (importMatch) {
    const inner = importMatch[1];
    const names = inner.split(',').map((s) => s.trim()).filter(Boolean);
    if (!names.includes(icon)) {
      const newInner = ` ${[...names, icon].join(', ')} `;
      updated = updated.replace(importRegex, `import {${newInner}} from "lucide-react";`);
    }
  } else {
    // No existing lucide import — prepend one. Place after the very first
    // line if the file already starts with imports.
    const firstNonEmpty = updated.indexOf('\n');
    const importLine = `import { ${icon} } from "lucide-react";\n`;
    if (firstNonEmpty === -1) {
      updated = importLine + updated;
    } else {
      updated = importLine + updated;
    }
  }

  return { updatedContent: updated };
}

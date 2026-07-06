# zui-visualize v2 — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the App-layer vertical slice of the `zui-visualize` skill: analyze a Node/TS repo, emit the unified graph schema, inject it into a self-contained Fable SVG board, with a working Product/Engineer view toggle.

**Architecture:** A bundled deterministic Node extractor (`extract-app.js`, tree-sitter) emits `graph.json` + `labels.json`/`meta.json` sidecar stubs in a unified schema. A pure text injector (`assemble-board.js`) substitutes those into an HTML template derived from the Fable board, producing `docs/architecture-board.html`. The renderer gains one feature: a Product/Engineer toggle that swaps node labels and side-panel content from the sidecars.

**Tech Stack:** Node.js (CommonJS), tree-sitter (`tree-sitter`, `tree-sitter-javascript`, `tree-sitter-typescript`), Node's built-in `node:test` + `assert`, vanilla SVG/JS renderer (no framework).

## Global Constraints

- Node scripts are CommonJS (`'use strict'`, `require`), matching the reference `extract-graph.js`.
- Tree-sitter dep versions pinned exactly: `tree-sitter@0.25.0`, `tree-sitter-javascript@0.25.0`, `tree-sitter-typescript@0.23.2`.
- Extractor output MUST be deterministic — two runs byte-identical. No `Math.random`, no unstable key ordering, no timestamps.
- Unified schema is the contract (verbatim from spec):
  - node: `{ id, label, sub?, layer, shape, cluster?, loc, details:[[k,v],…] }`
  - edge: `{ from, to, kind, rel? }`
  - cluster: `{ id, label, color, layer, slot:{x,y}, dag }`
- Slice 1 emits only `layer:"app"`, `shape:"rect"`, edge `kind:"import"`.
- Cluster colors cycle deterministically in creation order: `--note-yellow`, `--note-blue`, `--note-green`, `--note-pink`, `--note-orange`, `--note-purple`.
- IDs identical across `graph.json`, `labels.json`, `meta.json`.
- No reference to `~/Documents/jasper/zui` anywhere.
- Tests use `node --test`; each task ends green and committed.
- Reference sources live in `reference/zui-visualize-bundle.txt` (contains the old `extract-graph.js`) and `reference/zui-visualize-fable-board.html` (the renderer).

---

## File Structure

```
skill/
  skill.md                     # v2 orchestration (phases 0–6)
  scripts/
    package.json               # pinned tree-sitter deps
    extract-app.js             # tree-sitter extractor → graph.json + sidecar stubs
    lib/
      schema.js                # node/edge/cluster builders, slug, color cycle, slotting
    assemble-board.js          # inject graph/labels/meta into template → board html
  template/
    board.html                 # Fable board with __GRAPH__/__LABELS__/__META__ markers
  contexts/
    graph-schema.md            # unified schema doc (updated from reference)
test/
  fixtures/checkout-mini/      # small Node/TS fixture repo
  schema.test.js
  extract-app.test.js
  assemble-board.test.js
```

Rationale: `schema.js` isolates all pure schema/slug/color/slot logic so it is unit-testable without tree-sitter or the filesystem. `extract-app.js` owns AST walking and wiring. `assemble-board.js` is a tiny pure-text step. The template is data-free HTML.

---

### Task 1: Project scaffold + pinned deps

**Files:**
- Create: `skill/scripts/package.json`
- Create: `.gitignore` (append if exists)

**Interfaces:**
- Consumes: nothing.
- Produces: `skill/scripts/node_modules` with tree-sitter grammars available to later tasks.

- [ ] **Step 1: Write `skill/scripts/package.json`**

```json
{
  "name": "zui-visualize-scripts",
  "private": true,
  "version": "2.0.0",
  "dependencies": {
    "tree-sitter": "0.25.0",
    "tree-sitter-javascript": "0.25.0",
    "tree-sitter-typescript": "0.23.2"
  }
}
```

- [ ] **Step 2: Ensure `.gitignore` ignores node_modules**

Ensure the repo-root `.gitignore` contains the line `node_modules/` (it already does from setup; confirm, add if missing).

- [ ] **Step 3: Install deps**

Run: `cd skill/scripts && npm install --legacy-peer-deps`
Expected: exit 0; `skill/scripts/node_modules/tree-sitter` exists.

- [ ] **Step 4: Verify grammars load**

Run:
```bash
cd skill/scripts && node -e "const P=require('tree-sitter');const JS=require('tree-sitter-javascript');const p=new P();p.setLanguage(JS);console.log(p.parse('const x=1').rootNode.type)"
```
Expected: prints `program`.

- [ ] **Step 5: Commit**

```bash
git add skill/scripts/package.json skill/scripts/package-lock.json .gitignore
git commit -m "chore: scaffold extractor scripts with pinned tree-sitter deps"
```

---

### Task 2: Schema helpers (`schema.js`)

Pure functions — no tree-sitter, no fs. This locks the schema contract.

**Files:**
- Create: `skill/scripts/lib/schema.js`
- Test: `test/schema.test.js`

**Interfaces:**
- Produces:
  - `slugify(s: string) → string` — lowercase, camelCase→hyphen, non-`[a-z0-9-]`→`-`, collapse/trim `-`.
  - `NOTE_COLORS: string[]` — the six `--note-*` vars in fixed order.
  - `class GraphBuilder` with:
    - `addCluster({ id, label, layer }) → clusterObj` (auto-assigns next `color` from `NOTE_COLORS` cycling by creation order; `slot` set later; `dag:false`)
    - `addNode({ id, label, sub?, layer, shape, cluster?, loc?, details? }) → nodeObj` (idempotent by id; first write wins)
    - `addEdge(from, to, kind, rel?)` (dedupes; ignores self-edges)
    - `assignSlots({ cellW=700, cellH=560, cols=3 })` — lays clusters on a grid in creation order, writing `cluster.slot = {x,y}`
    - `build() → { nodes, edges, clusters }` (arrays in insertion order)
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

```js
// test/schema.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { slugify, NOTE_COLORS, GraphBuilder } = require('../skill/scripts/lib/schema');

test('slugify normalizes camelCase and paths', () => {
  assert.equal(slugify('src/routes'), 'src-routes');
  assert.equal(slugify('orderService'), 'order-service');
  assert.equal(slugify('paymentProcessor.ts'), 'payment-processor-ts');
});

test('clusters get cycling colors in creation order', () => {
  const g = new GraphBuilder();
  g.addCluster({ id: 'c_a', label: 'a', layer: 'app' });
  g.addCluster({ id: 'c_b', label: 'b', layer: 'app' });
  const { clusters } = g.build();
  assert.equal(clusters[0].color, NOTE_COLORS[0]);
  assert.equal(clusters[1].color, NOTE_COLORS[1]);
  assert.equal(clusters[0].dag, false);
});

test('addNode is idempotent by id, addEdge dedupes and drops self-edges', () => {
  const g = new GraphBuilder();
  g.addNode({ id: 'n1', label: 'first', layer: 'app', shape: 'rect' });
  g.addNode({ id: 'n1', label: 'second', layer: 'app', shape: 'rect' });
  g.addNode({ id: 'n2', label: 'two', layer: 'app', shape: 'rect' });
  g.addEdge('n1', 'n2', 'import', 'imports');
  g.addEdge('n1', 'n2', 'import', 'imports'); // dup
  g.addEdge('n1', 'n1', 'import'); // self
  const { nodes, edges } = g.build();
  assert.equal(nodes.find(n => n.id === 'n1').label, 'first');
  assert.equal(nodes.length, 2);
  assert.equal(edges.length, 1);
  assert.deepEqual(edges[0], { from: 'n1', to: 'n2', kind: 'import', rel: 'imports' });
});

test('assignSlots places clusters on a deterministic grid', () => {
  const g = new GraphBuilder();
  for (let i = 0; i < 4; i++) g.addCluster({ id: 'c' + i, label: '' + i, layer: 'app' });
  g.assignSlots({ cellW: 700, cellH: 560, cols: 3 });
  const { clusters } = g.build();
  assert.deepEqual(clusters[0].slot, { x: 0, y: 0 });
  assert.deepEqual(clusters[1].slot, { x: 700, y: 0 });
  assert.deepEqual(clusters[3].slot, { x: 0, y: 560 }); // wraps to row 2
});

test('build output is stable across two builds', () => {
  const make = () => {
    const g = new GraphBuilder();
    g.addCluster({ id: 'c_a', label: 'a', layer: 'app' });
    g.addNode({ id: 'n1', label: 'x', layer: 'app', shape: 'rect', cluster: 'c_a', loc: 3, details: [['Type', 'lib']] });
    g.assignSlots({});
    return JSON.stringify(g.build());
  };
  assert.equal(make(), make());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/schema.test.js`
Expected: FAIL — cannot find module `../skill/scripts/lib/schema`.

- [ ] **Step 3: Write minimal implementation**

```js
// skill/scripts/lib/schema.js
'use strict';

const NOTE_COLORS = [
  '--note-yellow', '--note-blue', '--note-green',
  '--note-pink', '--note-orange', '--note-purple',
];

function slugify(s) {
  return String(s)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

class GraphBuilder {
  constructor() {
    this._nodes = new Map();
    this._edges = [];
    this._edgeKeys = new Set();
    this._clusters = [];
    this._clusterIds = new Set();
  }

  addCluster({ id, label, layer }) {
    if (this._clusterIds.has(id)) return this._clusters.find(c => c.id === id);
    const color = NOTE_COLORS[this._clusters.length % NOTE_COLORS.length];
    const c = { id, label, color, layer, slot: { x: 0, y: 0 }, dag: false };
    this._clusters.push(c);
    this._clusterIds.add(id);
    return c;
  }

  addNode(spec) {
    if (this._nodes.has(spec.id)) return this._nodes.get(spec.id);
    const n = {
      id: spec.id,
      label: spec.label,
      ...(spec.sub != null ? { sub: spec.sub } : {}),
      layer: spec.layer,
      shape: spec.shape,
      ...(spec.cluster != null ? { cluster: spec.cluster } : {}),
      loc: spec.loc != null ? spec.loc : 0,
      details: spec.details || [],
    };
    this._nodes.set(spec.id, n);
    return n;
  }

  addEdge(from, to, kind, rel) {
    if (from === to) return;
    const key = from + ' ' + to + ' ' + kind;
    if (this._edgeKeys.has(key)) return;
    this._edgeKeys.add(key);
    this._edges.push({ from, to, kind, ...(rel != null ? { rel } : {}) });
  }

  assignSlots({ cellW = 700, cellH = 560, cols = 3 } = {}) {
    this._clusters.forEach((c, i) => {
      c.slot = { x: (i % cols) * cellW, y: Math.floor(i / cols) * cellH };
    });
  }

  build() {
    return {
      nodes: [...this._nodes.values()],
      edges: this._edges,
      clusters: this._clusters,
    };
  }
}

module.exports = { slugify, NOTE_COLORS, GraphBuilder };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/schema.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add skill/scripts/lib/schema.js test/schema.test.js
git commit -m "feat: unified graph schema builder with deterministic colors and slots"
```

---

### Task 3: Fixture repo

A small Node/TS service the extractor tests run against. Carries CI/IaC files that Slice 1 must ignore (they exist so later slices reuse the fixture).

**Files:**
- Create: `test/fixtures/checkout-mini/package.json`
- Create: `test/fixtures/checkout-mini/src/index.ts`
- Create: `test/fixtures/checkout-mini/src/server.ts`
- Create: `test/fixtures/checkout-mini/src/routes/orders.ts`
- Create: `test/fixtures/checkout-mini/src/services/paymentProcessor.ts`
- Create: `test/fixtures/checkout-mini/src/lib/db.ts`
- Create: `test/fixtures/checkout-mini/serverless.yml` (ignored by Slice 1)

**Interfaces:**
- Produces: a fixture whose expected extraction is asserted in Task 4/5. Key facts later tasks depend on:
  - service dirs → clusters: `routes`, `services`, `lib`
  - `orders.ts` defines `GET /orders`, imports `paymentProcessor` and `db`
  - `paymentProcessor.ts` calls `fetch(...)` (→ `External` detail) and imports `db`

- [ ] **Step 1: Write `package.json`**

```json
{ "name": "checkout-mini", "version": "1.0.0", "main": "src/index.ts" }
```

- [ ] **Step 2: Write `src/index.ts`**

```ts
import { createServer } from './server';
createServer();
```

- [ ] **Step 3: Write `src/server.ts`**

```ts
import { registerOrders } from './routes/orders';

export function createServer() {
  const app: any = { get() {}, post() {} };
  registerOrders(app);
  return app;
}
```

- [ ] **Step 4: Write `src/routes/orders.ts`**

```ts
import { charge } from '../services/paymentProcessor';
import { query } from '../lib/db';

export function registerOrders(app: any) {
  app.get('/orders', async () => {
    const rows = await query('select * from orders');
    return rows;
  });
  app.post('/orders', async (body: any) => {
    await charge(body.amount);
    return { ok: true };
  });
}
```

- [ ] **Step 5: Write `src/services/paymentProcessor.ts`**

```ts
import { query } from '../lib/db';

export async function charge(amount: number) {
  const res = await fetch('https://api.stripe.com/v1/charges', {
    method: 'POST',
    body: String(amount),
  });
  await query('insert into payments values ($1)', [amount]);
  return res.ok;
}
```

- [ ] **Step 6: Write `src/lib/db.ts`**

```ts
export async function query(sql: string, params?: any[]) {
  return [];
}
```

- [ ] **Step 7: Write `serverless.yml` (Slice 1 ignores this)**

```yaml
service: checkout-mini
provider:
  name: aws
  runtime: nodejs20.x
functions:
  webhook:
    handler: src/handlers/webhook.handler
```

- [ ] **Step 8: Commit**

```bash
git add test/fixtures/checkout-mini
git commit -m "test: add checkout-mini fixture repo"
```

---

### Task 4: `extract-app.js` — nodes, clusters, sidecar stubs

Port the reference `extract-graph.js` (found in `reference/zui-visualize-bundle.txt`, block `=== FILE: scripts/extract-graph.js ===`) into `skill/scripts/extract-app.js`, adapted to emit the new schema via `GraphBuilder`. This task covers **node/cluster/sidecar** emission; edge wiring is Task 5.

**Files:**
- Create: `skill/scripts/extract-app.js`
- Test: `test/extract-app.test.js`

**Interfaces:**
- Consumes: `GraphBuilder`, `slugify` from `./lib/schema`.
- Produces: CLI `node extract-app.js <root> --out-dir <dir>` writing `graph.json`, `labels.json`, `meta.json`. Also exports for tests:
  - `extract(root: string) → { graph, labels, meta }` where `graph = { nodes, edges, clusters }`, `labels = { [id]: string }`, `meta = { [id]: { product, engineer } }`.
  - Node id conventions: app file/module id = `slugify(relPathWithoutExt)`; route id = `route:<METHOD> <path>`; function id = `fn:<name>`; cluster id = `c_<dir-slug>`.

- [ ] **Step 1: Write the failing test (node/cluster/sidecar assertions)**

```js
// test/extract-app.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { extract } = require('../skill/scripts/extract-app');

const FIXTURE = path.join(__dirname, 'fixtures', 'checkout-mini');

test('extracts service-dir clusters for routes/services/lib', () => {
  const { graph } = extract(FIXTURE);
  const ids = graph.clusters.map(c => c.id).sort();
  assert.ok(ids.includes('c_routes'), 'has routes cluster');
  assert.ok(ids.includes('c_services'), 'has services cluster');
  assert.ok(ids.includes('c_lib'), 'has lib cluster');
  graph.clusters.forEach(c => assert.equal(c.layer, 'app'));
});

test('all app nodes are rect/app with loc and details', () => {
  const { graph } = extract(FIXTURE);
  assert.ok(graph.nodes.length >= 4);
  graph.nodes.forEach(n => {
    assert.equal(n.layer, 'app');
    assert.equal(n.shape, 'rect');
    assert.equal(typeof n.loc, 'number');
    assert.ok(Array.isArray(n.details));
  });
});

test('route module carries an Endpoints detail; external caller carries External', () => {
  const { graph } = extract(FIXTURE);
  const flat = graph.nodes.map(n => ({ id: n.id, d: Object.fromEntries(n.details) }));
  const route = flat.find(n => n.d.Endpoints);
  assert.ok(route, 'some node lists Endpoints');
  assert.match(route.d.Endpoints, /\/orders/);
  const ext = flat.find(n => n.d.External);
  assert.ok(ext, 'payment processor lists External');
});

test('sidecar stubs cover every node id with engineer.file prefilled', () => {
  const { graph, labels, meta } = extract(FIXTURE);
  for (const n of graph.nodes) {
    assert.ok(n.id in labels, 'label stub for ' + n.id);
    assert.ok(n.id in meta, 'meta stub for ' + n.id);
    assert.ok('product' in meta[n.id] && 'engineer' in meta[n.id]);
    assert.equal(typeof meta[n.id].engineer.file, 'string');
  }
});

test('extraction is deterministic', () => {
  assert.equal(JSON.stringify(extract(FIXTURE)), JSON.stringify(extract(FIXTURE)));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/extract-app.test.js`
Expected: FAIL — cannot find module `../skill/scripts/extract-app`.

- [ ] **Step 3: Write the implementation**

Port the reference extractor's proven internals verbatim (tree-sitter setup, `ensureDeps`, `walkFiles`, `walk`, `txt`/`kid`/`kids`, `buildBindings`, `evalPathNode`, `extractRequires`, `extractFunctions`, `extractRoutes`, `extractCallNames`, `resolveRequire`, `inferServices`) from the `=== FILE: scripts/extract-graph.js ===` block in `reference/zui-visualize-bundle.txt`. Then replace its ad-hoc `nodes`/`edges` assembly with the code below. Do NOT reimplement the AST helpers from scratch — copy them.

```js
// skill/scripts/extract-app.js  (assembly section — after the ported AST helpers)
'use strict';
const fs = require('fs');
const path = require('path');
const { GraphBuilder, slugify } = require('./lib/schema');

// ... (ported AST helpers: parseSource, walkFiles, buildBindings, evalPathNode,
//      extractRequires, extractFunctions, extractRoutes, extractCallNames,
//      resolveRequire, inferServices — copied from reference extract-graph.js) ...

function fileIdFor(relFile) {
  return slugify(relFile.replace(/\.[^.]+$/, ''));
}

function countLoc(src) {
  return src.split('\n').length;
}

function extract(root) {
  const ROOT = path.resolve(root);
  const allAbsFiles = walkFiles(ROOT);

  // Parse every source file (fileData: relFile → { src, fns, routes, requires, calls })
  const fileData = new Map();
  for (const absFile of allAbsFiles) {
    const relFile = path.relative(ROOT, absFile);
    let src;
    try { src = fs.readFileSync(absFile, 'utf8'); } catch (_) { continue; }
    const tree = parseSource(src, path.extname(absFile));
    if (!tree) continue;
    const bindings = buildBindings(tree, src);
    fileData.set(relFile, {
      src,
      fns: extractFunctions(tree, src, relFile),
      routes: extractRoutes(tree, src, relFile, bindings),
      requires: extractRequires(tree, src),
      calls: extractCallNames(tree, src),
    });
  }

  const g = new GraphBuilder();
  const labels = {};
  const meta = {};
  const services = inferServices([...fileData.keys()]); // [{ id:'svc:x', label, dir, files }]

  // Clusters: one per inferred service dir (id normalized to c_<dir-slug>)
  const dirToCluster = new Map();
  for (const svc of services) {
    const cid = 'c_' + slugify(path.basename(svc.dir));
    if (!dirToCluster.has(svc.dir)) {
      g.addCluster({ id: cid, label: svc.dir, layer: 'app' });
      dirToCluster.set(svc.dir, cid);
    }
  }

  const fileToCluster = relFile => dirToCluster.get(path.dirname(relFile)) || undefined;

  const addSidecar = (id, label, file, signature, deps) => {
    labels[id] = label;                       // Claude phase 3 overwrites with plain English
    meta[id] = {
      product: { title: label, description: '', inputs: '', outputs: '' },
      engineer: { signature: signature || '', file: file || '', notes: '', deps: deps || [] },
    };
  };

  // File-module nodes
  for (const [relFile, data] of fileData) {
    const id = fileIdFor(relFile);
    const dir = path.dirname(relFile);
    const base = path.basename(relFile);
    const isRoute = data.routes.length > 0;
    const external = detectExternal(data.src); // returns string like 'Stripe API' or null
    const details = [['Type', isRoute ? 'route module' : 'module'], ['Language', 'TypeScript']];
    if (isRoute) {
      details.push(['Endpoints', data.routes.map(r => `${r.method} ${r.path}`).join(' · ')]);
    }
    if (external) details.push(['External', external]);
    g.addNode({
      id, label: base, sub: dir === '.' ? 'repo root' : dir,
      layer: 'app', shape: 'rect', cluster: fileToCluster(relFile),
      loc: countLoc(data.src), details,
    });
    const deps = data.requires.map(String);
    addSidecar(id, base, relFile, '', deps);
  }

  g.assignSlots({});

  const graph = g.build();
  return { graph, labels, meta };
}

// Detect a first external dependency mentioned in source (best-effort, deterministic).
function detectExternal(src) {
  if (/api\.stripe\.com|['"]stripe['"]/.test(src)) return 'Stripe API';
  if (/\bfetch\s*\(|axios\.|got\.|httpx\.|requests\./.test(src)) return 'HTTP API';
  if (/aws-sdk|@aws-sdk|SES|SQS|S3/.test(src)) return 'AWS';
  return null;
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const root = args[0];
  const outIdx = args.indexOf('--out-dir');
  const outDir = outIdx !== -1 ? args[outIdx + 1] : null;
  if (!root) { console.error('Usage: node extract-app.js <root> --out-dir <dir>'); process.exit(2); }
  const { graph, labels, meta } = extract(root);
  if (graph.nodes.length < 4 || graph.edges.length < 3) {
    process.stderr.write(`WARNING: shallow graph (${graph.nodes.length} nodes, ${graph.edges.length} edges)\n`);
  }
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'graph.json'), JSON.stringify(graph, null, 2));
    fs.writeFileSync(path.join(outDir, 'labels.json'), JSON.stringify(labels, null, 2));
    fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 2));
    process.stderr.write(`Written graph.json, labels.json, meta.json to ${outDir}\n`);
  } else {
    process.stdout.write(JSON.stringify({ graph, labels, meta }, null, 2) + '\n');
  }
}

module.exports = { extract, detectExternal, fileIdFor };
```

Note: the tree-sitter auto-install (`ensureDeps`) from the reference must run before helpers are required. Keep that block; it is a no-op once Task 1 has installed deps.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/extract-app.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add skill/scripts/extract-app.js test/extract-app.test.js
git commit -m "feat: extract-app emits app-layer nodes, clusters, and sidecar stubs"
```

---

### Task 5: `extract-app.js` — import/route edge wiring

Add edges to the extractor. Route→function and file→file import edges, all `kind:"import"`.

**Files:**
- Modify: `skill/scripts/extract-app.js` (the `extract()` assembly)
- Test: `test/extract-app.test.js` (add edge tests)

**Interfaces:**
- Consumes: same fileData/fnById maps.
- Produces: `graph.edges` of shape `{ from, to, kind:"import", rel:"imports" }` where `from`/`to` are file-module ids (or `fn:`/`route:` ids when modeled).

- [ ] **Step 1: Add failing edge tests**

```js
// append to test/extract-app.test.js
test('emits import edges between file modules', () => {
  const { graph } = extract(FIXTURE);
  const has = (from, to) => graph.edges.some(e => e.from === from && e.to === to && e.kind === 'import');
  // src/routes/orders.ts imports services/paymentProcessor.ts and lib/db.ts
  const ordersId = require('../skill/scripts/extract-app').fileIdFor('src/routes/orders.ts');
  const payId = require('../skill/scripts/extract-app').fileIdFor('src/services/paymentProcessor.ts');
  const dbId = require('../skill/scripts/extract-app').fileIdFor('src/lib/db.ts');
  assert.ok(has(ordersId, payId), 'orders → paymentProcessor');
  assert.ok(has(ordersId, dbId), 'orders → db');
  graph.edges.forEach(e => { assert.equal(e.kind, 'import'); assert.equal(e.rel, 'imports'); });
});

test('graph now clears the shallow-graph floor', () => {
  const { graph } = extract(FIXTURE);
  assert.ok(graph.edges.length >= 3, 'has >= 3 edges');
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test test/extract-app.test.js`
Expected: the two new tests FAIL (no edges emitted yet); earlier tests still PASS.

- [ ] **Step 3: Add edge wiring to `extract()`**

Insert after the file-module node loop and before `g.assignSlots({})`:

```js
  // Import edges: resolve each file's requires to a target file-module id
  for (const [relFile, data] of fileData) {
    const fromId = fileIdFor(relFile);
    for (const spec of data.requires) {
      const resolved = resolveRequire.call({ ROOT, fileData }, relFile, spec, ROOT, fileData);
      if (resolved && fileData.has(resolved)) {
        g.addEdge(fromId, fileIdFor(resolved), 'import', 'imports');
      }
    }
  }
```

If the ported `resolveRequire(fromFile, specifier)` closes over `ROOT` as a module-level const (as in the reference), call it directly as `resolveRequire(relFile, spec)` instead of the `.call(...)` form above — match whichever signature the ported helper uses. The resolved value is a repo-relative path; only wire it if it is a known source file (`fileData.has(resolved)`).

- [ ] **Step 4: Run tests to verify all pass**

Run: `node --test test/extract-app.test.js`
Expected: PASS (all 7 tests).

- [ ] **Step 5: Commit**

```bash
git add skill/scripts/extract-app.js test/extract-app.test.js
git commit -m "feat: extract-app wires file-to-file import edges"
```

---

### Task 6: HTML template with data markers

Turn the reference board into a data-free template.

**Files:**
- Create: `skill/template/board.html` (from `reference/zui-visualize-fable-board.html`)

**Interfaces:**
- Produces: an HTML file identical to the reference board except the `const GRAPH = { … };` literal is replaced by three marker lines. Consumed by Task 7.

- [ ] **Step 1: Copy the reference board to the template path**

Run:
```bash
mkdir -p skill/template
cp reference/zui-visualize-fable-board.html skill/template/board.html
```

- [ ] **Step 2: Replace the hardcoded GRAPH literal with markers**

In `skill/template/board.html`, delete the entire `const GRAPH = { clusters:[…], nodes:[…], edges:[…] };` block (the big literal near the top of the `<script>`) and replace it with exactly:

```js
const GRAPH  = /*__GRAPH__*/ null;
const LABELS = /*__LABELS__*/ {};
const META   = /*__META__*/ {};
```

- [ ] **Step 3: Verify the template still parses as HTML/JS (markers present, no leftover sample data)**

Run:
```bash
grep -c '__GRAPH__\|__LABELS__\|__META__' skill/template/board.html
grep -c "checkout-service\|c_src\|paymentProcessor" skill/template/board.html
```
Expected: first prints `3`; second prints `0` for the removed sample-data identifiers (the `boardChip` title text may still say "checkout-service" — that is replaced in Task 8; if it appears here it is acceptable, but the GRAPH sample ids `c_src`/`paymentProcessor` must be gone).

- [ ] **Step 4: Commit**

```bash
git add skill/template/board.html
git commit -m "feat: data-free board template with injection markers"
```

---

### Task 7: `assemble-board.js` injector

Pure text substitution of the three markers.

**Files:**
- Create: `skill/scripts/assemble-board.js`
- Test: `test/assemble-board.test.js`

**Interfaces:**
- Consumes: `skill/template/board.html`, `graph.json`, `labels.json`, `meta.json`.
- Produces:
  - `assemble({ template, graph, labels, meta }) → string` (pure; throws `Error` if any marker missing).
  - CLI `node assemble-board.js --in-dir <dir> --out <file.html>` reading `<dir>/graph.json` etc.

- [ ] **Step 1: Write the failing test**

```js
// test/assemble-board.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { assemble } = require('../skill/scripts/assemble-board');

const TEMPLATE = [
  '<script>',
  'const GRAPH  = /*__GRAPH__*/ null;',
  'const LABELS = /*__LABELS__*/ {};',
  'const META   = /*__META__*/ {};',
  '</script>',
].join('\n');

test('injects all three blobs and leaves no markers', () => {
  const out = assemble({
    template: TEMPLATE,
    graph: { nodes: [{ id: 'n1' }], edges: [], clusters: [] },
    labels: { n1: 'Node One' },
    meta: { n1: { product: {}, engineer: {} } },
  });
  assert.ok(out.includes('"id": "n1"') || out.includes('"id":"n1"'));
  assert.ok(out.includes('Node One'));
  assert.equal(/__GRAPH__|__LABELS__|__META__/.test(out), false);
});

test('throws when a marker is missing', () => {
  assert.throws(
    () => assemble({ template: 'const GRAPH = /*__GRAPH__*/ null;', graph: {}, labels: {}, meta: {} }),
    /__LABELS__/
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/assemble-board.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

```js
// skill/scripts/assemble-board.js
'use strict';
const fs = require('fs');
const path = require('path');

const MARKERS = {
  '/*__GRAPH__*/ null': 'graph',
  '/*__LABELS__*/ {}': 'labels',
  '/*__META__*/ {}': 'meta',
};

function assemble({ template, graph, labels, meta }) {
  const data = { graph, labels, meta };
  let out = template;
  for (const [marker, key] of Object.entries(MARKERS)) {
    if (!out.includes(marker)) throw new Error(`Template missing marker for ${key}: ${marker}`);
    out = out.replace(marker, JSON.stringify(data[key], null, 2));
  }
  return out;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const inDir = args[args.indexOf('--in-dir') + 1];
  const outFile = args[args.indexOf('--out') + 1];
  const templatePath = path.join(__dirname, '..', 'template', 'board.html');
  const out = assemble({
    template: fs.readFileSync(templatePath, 'utf8'),
    graph: JSON.parse(fs.readFileSync(path.join(inDir, 'graph.json'), 'utf8')),
    labels: JSON.parse(fs.readFileSync(path.join(inDir, 'labels.json'), 'utf8')),
    meta: JSON.parse(fs.readFileSync(path.join(inDir, 'meta.json'), 'utf8')),
  });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, out);
  process.stderr.write(`Wrote ${outFile}\n`);
}

module.exports = { assemble };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/assemble-board.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add skill/scripts/assemble-board.js test/assemble-board.test.js
git commit -m "feat: assemble-board injects graph/labels/meta into template"
```

---

### Task 8: Product/Engineer toggle in the renderer

Add the view switch to `skill/template/board.html`. This is renderer JS/DOM work; verified by a DOM assertion test using the assembled output parsed for the control + logic, plus manual smoke.

**Files:**
- Modify: `skill/template/board.html` (chrome markup + label/panel logic + init)
- Test: `test/assemble-board.test.js` (add a structural assertion on the template)

**Interfaces:**
- Consumes: `LABELS`, `META` globals (already injected).
- Produces: a `viewMode` (`'engineer'|'product'`) with `setViewMode(m)` re-rendering node labels via `labelFor(n)` and re-rendering the open panel.

- [ ] **Step 1: Add a failing structural test**

```js
// append to test/assemble-board.test.js
const fs = require('fs');
const path = require('path');
test('template ships the Product/Engineer toggle and label logic', () => {
  const tpl = fs.readFileSync(path.join(__dirname, '..', 'skill', 'template', 'board.html'), 'utf8');
  assert.match(tpl, /id="viewToggle"/);
  assert.match(tpl, /function labelFor\(/);
  assert.match(tpl, /viewMode\s*===\s*'product'/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/assemble-board.test.js`
Expected: the new test FAILS (toggle not yet in template).

- [ ] **Step 3: Add the toggle markup**

In `skill/template/board.html`, inside `#canvasWrap` next to the other `.chrome` pills (after the `#searchWrap` div), add:

```html
    <div id="viewToggle" class="chrome pill pill-soft" role="group" aria-label="View mode">
      <button class="icon-btn active" id="viewEng" title="Engineer view">Eng</button>
      <button class="icon-btn" id="viewProd" title="Product view">Product</button>
    </div>
```

Add minimal CSS near the other chrome rules:

```css
#viewToggle{top:16px;left:50%;transform:translateX(-50%);padding:4px;gap:2px;border-radius:14px}
#viewToggle .icon-btn{width:auto;padding:0 10px;font:600 12px var(--font)}
```

- [ ] **Step 4: Add the view logic**

Near the top of the `<script>` (after `const nodeById = …`), add:

```js
let viewMode = 'engineer';
function labelFor(n){
  if (viewMode === 'product') return (LABELS && LABELS[n.id]) || n.label;
  return n.label;
}
function setViewMode(m){
  viewMode = m;
  document.getElementById('viewEng').classList.toggle('active', m === 'engineer');
  document.getElementById('viewProd').classList.toggle('active', m === 'product');
  nodes.forEach(n => { n._lbl.textContent = labelFor(n); });
  sizeNodes();
  nodes.forEach(placeNode);
  buildEdges();
  if (selected) renderPanel(selected);
}
```

Change the node-label assignment in `buildNode(n)` from
`n._lbl.textContent = n.label;` to `n._lbl.textContent = labelFor(n);`.

In `renderPanel(n)`, after the metrics block, branch on `viewMode`: in `product` mode render `META[n.id]?.product` (`description`, then `inputs`/`outputs` as `kv` rows) in place of the "Parsed fields" section; in `engineer` mode keep the existing `details` section and additionally render `META[n.id]?.engineer` (`signature`, `notes`, `deps`) as `kv` rows. Guard every access with `META[n.id]` existence.

Wire the buttons near the other listeners:

```js
document.getElementById('viewEng').addEventListener('click', () => setViewMode('engineer'));
document.getElementById('viewProd').addEventListener('click', () => setViewMode('product'));
```

- [ ] **Step 5: Run the structural test**

Run: `node --test test/assemble-board.test.js`
Expected: PASS (all tests).

- [ ] **Step 6: Manual smoke check**

Run:
```bash
cd skill/scripts && node extract-app.js ../../test/fixtures/checkout-mini --out-dir /tmp/zui-out
node assemble-board.js --in-dir /tmp/zui-out --out /tmp/zui-out/architecture-board.html
open /tmp/zui-out/architecture-board.html
```
Expected: board opens; app-layer clusters (routes/services/lib) render with nodes and import edges; clicking a node opens the panel; the Eng/Product toggle changes node labels (Product shows plain-English once labels.json is filled — with stubs it falls back to technical names) and swaps panel content. (Labels are stubs until the skill's Claude phases run; fallback to `n.label` is expected here.)

- [ ] **Step 7: Commit**

```bash
git add skill/template/board.html test/assemble-board.test.js
git commit -m "feat: Product/Engineer view toggle in board renderer"
```

---

### Task 9: `skill.md` v2 + `contexts/graph-schema.md`

Orchestration doc and the schema reference the Claude phases read.

**Files:**
- Create: `skill/skill.md`
- Create: `skill/contexts/graph-schema.md`

**Interfaces:**
- Consumes: `extract-app.js`, `assemble-board.js`, `template/board.html`.
- Produces: the skill entrypoint. No code; documentation that drives the Claude-run phases (2b knowledge base, 3 labels, 4 metadata).

- [ ] **Step 1: Write `skill/contexts/graph-schema.md`**

Document the unified schema verbatim from the spec's "Unified Graph Schema" section: node/edge/cluster shapes, the sidecar `labels.json`/`meta.json` formats, ID conventions table, color cycle, and slot seeding. State that Slice 1 emits only `layer:"app"`, `shape:"rect"`, edge `kind:"import"`.

- [ ] **Step 2: Write `skill/skill.md`**

Frontmatter:

```markdown
---
name: zui-visualize
description: Analyze a codebase and generate a self-contained interactive architecture board (single HTML file) in the project's docs/ folder. Slice 1 covers the application code layer.
allowed-tools: Bash Read Write Edit Glob Grep
---
```

Body must specify, as phases:

- **Phase 0 — Orientation:** resolve `$ARGUMENTS` to `ROOT`; read up to 10 doc files (README, docs/*, ARCHITECTURE) to draft an in-memory knowledge base (service purpose, domain vocab, layers).
- **Phase 1 — Detect:** app framework + entry point + service dirs (reference `contexts/graph-schema.md`).
- **Phase 2 — Extract:** run `node "${CLAUDE_SKILL_DIR}/scripts/extract-app.js" "$ROOT" --out-dir "$ROOT/docs/zui"`. If exit non-zero / shallow, note low confidence.
- **Phase 2b — Knowledge base:** write `$ROOT/docs/zui/knowledge-base.md` (Service Purpose · Domain Vocabulary · Architecture Layers · External Dependencies · Confidence Notes).
- **Phase 3 — Labels:** read `docs/zui/graph.json`; for every node id, write a plain-English label into `docs/zui/labels.json` (overwrite stubs). Naming rules: routes → business action; files → role; expand acronyms.
- **Phase 4 — Metadata:** for every node id, fill `docs/zui/meta.json` `product` (title/description/inputs/outputs) and complete `engineer` (notes; signature/file/deps already prefilled). Never leave `description` blank.
- **Phase 5 — Assemble:** run `node "${CLAUDE_SKILL_DIR}/scripts/assemble-board.js" --in-dir "$ROOT/docs/zui" --out "$ROOT/docs/architecture-board.html"`.
- **Phase 6 — Report:** print nodes/edges/clusters counts, label coverage, confidence, and the output path. Tell the user to open `docs/architecture-board.html`.

Constraints section: never hardcode domain assumptions; ZUI files under `docs/zui/*` and `docs/architecture-board.html` overwrite on re-run; do not touch non-ZUI docs; IDs consistent across all three JSON files; no dependency on `~/Documents/jasper/zui`.

- [ ] **Step 3: Verify skill.md references resolve**

Run:
```bash
grep -c 'extract-app.js\|assemble-board.js' skill/skill.md
test -f skill/contexts/graph-schema.md && echo OK
```
Expected: first ≥ 2; second prints `OK`.

- [ ] **Step 4: Commit**

```bash
git add skill/skill.md skill/contexts/graph-schema.md
git commit -m "docs: skill.md v2 orchestration and unified graph-schema context"
```

---

### Task 10: End-to-end integration test

One test that runs the whole deterministic pipeline (extract → assemble) and asserts a valid board file, closing the seam.

**Files:**
- Test: `test/e2e.test.js`

**Interfaces:**
- Consumes: `extract`, `assemble`, `skill/template/board.html`.

- [ ] **Step 1: Write the failing test**

```js
// test/e2e.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { extract } = require('../skill/scripts/extract-app');
const { assemble } = require('../skill/scripts/assemble-board');

test('extract → assemble produces a marker-free board with real nodes', () => {
  const { graph, labels, meta } = extract(path.join(__dirname, 'fixtures', 'checkout-mini'));
  const template = fs.readFileSync(path.join(__dirname, '..', 'skill', 'template', 'board.html'), 'utf8');
  const html = assemble({ template, graph, labels, meta });
  assert.equal(/__GRAPH__|__LABELS__|__META__/.test(html), false);
  assert.ok(html.includes('"clusters"'));
  assert.ok(graph.nodes.length >= 4 && graph.edges.length >= 3);
  // board still contains its engine entrypoints
  assert.match(html, /function forceLayout\(/);
  assert.match(html, /id="viewToggle"/);
});
```

- [ ] **Step 2: Run to verify it fails, then passes**

Run: `node --test test/e2e.test.js`
Expected: PASS once Tasks 4–8 are complete (if run earlier, FAIL). Confirm PASS now.

- [ ] **Step 3: Run the full suite**

Run: `node --test`
Expected: all test files PASS.

- [ ] **Step 4: Commit**

```bash
git add test/e2e.test.js
git commit -m "test: end-to-end extract-to-board integration"
```

---

## Self-Review Notes

- **Spec coverage:** unified schema → Tasks 2, 9; `extract-app.js` new-schema + JS/TS deep → Tasks 4–5; sidecar stubs w/ prefilled engineer fields → Task 4; template injection → Tasks 6–7; Product/Engineer toggle → Task 8; skill.md v2 phases 0–6 → Task 9; fixture + tests → Tasks 3–5, 7, 10; determinism → Tasks 2, 4; error handling (shallow graph, missing marker) → Tasks 4, 7. Non-JS/TS grep fallback is carried by the ported reference helpers; deep verification of it is deferred (fixture is TS) — acceptable for Slice 1.
- **Placeholder scan:** all code steps show full code; the one "port these helpers verbatim from reference" instruction (Task 4 Step 3) names the exact source block rather than restating ~250 lines — intentional and precise.
- **Type consistency:** `extract()`/`assemble()` signatures, `fileIdFor`, `labelFor`, `setViewMode`, `viewMode`, marker strings, and JSON filenames match across Tasks 2–10.

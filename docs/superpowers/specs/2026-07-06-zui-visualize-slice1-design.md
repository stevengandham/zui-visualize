# zui-visualize v2 — Slice 1 Design (App-layer vertical slice)

**Date:** 2026-07-06
**Status:** Approved for planning
**Implemented by:** Fable 5

## Purpose

Combine two existing artifacts into a single Claude Code skill that analyzes a
repository and emits **one self-contained `docs/architecture-board.html`** — the
"Fable" Miro-style SVG architecture board with real, extracted data baked in.

The two source artifacts (kept in `reference/`):

- `zui-visualize-bundle.txt` — the old skill: an 8-phase analysis pipeline plus a
  tree-sitter `extract-graph.js`, emitting a simple `system/service/route/function`
  graph consumed by an **external** Vite/canvas app at `~/Documents/jasper/zui`.
- `zui-visualize-fable-board.html` — a self-contained SVG board (clustered frames,
  rect/hex/pipe shapes, three layers, force layout with DAG lanes, minimap, search,
  layer toggles, detail side-panel, snap guides, drag/pinch/zoom) with **hardcoded
  sample data** in a *richer* schema.

Slice 1 proves the full seam — **schema → inject → render → view toggle** — on the
**App layer only**. CI/CD and Infra extractors are later slices (out of scope here)
but the schema and renderer are built to accommodate them without change.

## Scope

### In scope (Slice 1)

1. **Unified graph schema** — the contract both halves agree on.
2. **`extract-app.js`** — evolve the existing tree-sitter extractor to emit the new
   schema for the App layer (JS/TS deep AST; other languages best-effort grep).
3. **Template injection** — a bundled HTML template derived from
   `zui-visualize-fable-board.html` with data placeholders, plus an injection step.
4. **Product/Engineer view toggle** — added to the renderer; swaps node labels and
   side-panel content using the `labels`/`meta` sidecars.
5. **skill.md v2 orchestration** — phases 0–6, App-layer only, writing the board into
   the target repo's `docs/`.
6. **Fixture repo + tests** for the deterministic parts.

### Out of scope (later slices)

- `extract-cicd.js` (CI/CD layer), `extract-infra.js` (Infra layer).
- Polyglot AST-quality extractors beyond JS/TS.
- Layout persistence / saving board edits.
- Reveal.js slide deck (`--slides`).
- Any dependency on `~/Documents/jasper/zui`.

## Unified Graph Schema (the combine seam)

Emitted as `graph.json`; consumed by the renderer.

```jsonc
{
  "nodes": [
    { "id": "string",              // stable, unique; app: slug of relative path
      "label": "string",           // technical name (Engineer view default)
      "sub": "string?",            // secondary line, e.g. dir "src/routes"
      "layer": "app",              // Slice 1 always "app"; later "cicd"|"infra"
      "shape": "rect",             // app nodes are rect; hex/pipe reserved
      "cluster": "clusterId?",     // owning frame
      "loc": 0,                    // line count (drives gentle size scaling)
      "details": [["Type","route module"], ["Endpoints","GET /orders"]] }
  ],
  "edges": [
    { "from": "id", "to": "id", "kind": "import", "rel": "imports" }
    // kind ∈ import|pipe|cross|infra ; Slice 1 emits only "import" (+ "cross" if a
    // route file references a handler already modeled — otherwise none)
  ],
  "clusters": [
    { "id": "c_routes", "label": "src/routes", "color": "--note-blue",
      "layer": "app", "slot": { "x": 0, "y": 0 }, "dag": false }
  ]
}
```

**Sidecars** (separate files, keyed by node id):

```jsonc
// labels.json   — plain-English node label
{ "route:GET /orders": "List Orders" }

// meta.json     — product + engineer views for the side panel
{ "route:GET /orders": {
    "product":  { "title": "List Orders", "description": "…",
                  "inputs": "…", "outputs": "…" },
    "engineer": { "signature": "…", "file": "src/routes/orders.ts",
                  "notes": "…", "deps": ["svc:orderService"] } } }
```

### ID conventions (carried from old skill, unchanged)

| Type | Pattern | Example |
|------|---------|---------|
| app file/module | `<slug-of-relative-path>` | `src-routes-orders` |
| service dir | `svc:<dir-slug>` | `svc:services` |
| route | `route:<METHOD> <path>` | `route:GET /orders/:id` |
| function | `fn:<name>` | `fn:createOrder` |
| cluster | `c_<dir-slug>` | `c_routes` |

IDs must be identical across `graph.json`, `labels.json`, and `meta.json`.

### Cluster color assignment

Deterministic: cycle the six note colors (`--note-yellow`, `--note-blue`,
`--note-green`, `--note-pink`, `--note-orange`, `--note-purple`) in cluster-creation
order so re-runs are stable.

### Slot seeding

`slot` seeds initial cluster position; the browser force layout refines it. The merge
step lays App-layer clusters on a coarse grid (e.g. 700px cells, ~3 columns) so first
paint is sane before the force pass. Determinism required (no randomness in slotting).

## Components

### A. `extract-app.js` (evolve `reference/` extract-graph.js)

Keep the existing tree-sitter machinery (file walk, const-binding resolution, route /
function / require extraction, service inference, degree-based node cap). Changes:

- **Emit new schema fields** on every node: `layer:"app"`, `shape:"rect"`, `cluster`
  (from `inferServices`/directory), `loc` (line count of the file), `details` (typed
  facts: `Type`, `Language`, `Endpoints` for route modules, `External` when an HTTP
  client / SDK is detected in the file).
- **Emit `clusters[]`** — one per inferred service directory, with deterministic color
  + grid slot.
- **Edges** carry `kind:"import"`, `rel:"imports"` (existing import/require wiring);
  route→fn stays as `kind:"import"` for now.
- **Sidecar stubs:** emit `labels.json` and `meta.json` skeletons (id → empty/derived)
  so Claude phases 3–4 fill them. Extractor pre-fills `engineer.signature/file/deps`
  from the AST (it already has them); Claude fills `product.*` and plain-English labels.
- **Non-JS/TS:** existing grep fallback path emits app nodes best-effort (no `loc`,
  minimal `details`).
- **CLI:** `node extract-app.js <root> --out-dir <dir>` writes `graph.json`,
  `labels.json`, `meta.json`. On shallow graph (<4 nodes / <3 edges) the extractor
  WARNS and continues (exit 0), still writing all files, rather than exiting 1
  (amended 2026-07-06: warn-and-continue ships better UX — user still gets a partial
  board). Exit 2 on usage.

### B. HTML template + injection

- `template/board.html` = `zui-visualize-fable-board.html` with the hardcoded `GRAPH`
  object replaced by three placeholder markers:
  ```js
  const GRAPH  = /*__GRAPH__*/ null;
  const LABELS = /*__LABELS__*/ {};
  const META   = /*__META__*/ {};
  ```
- `assemble-board.js` — reads `graph.json`/`labels.json`/`meta.json`, string-replaces
  the three markers with `JSON.stringify(...)`, writes `docs/architecture-board.html`.
  Pure text substitution; no template engine. Fails loudly if a marker is missing.

### C. Product/Engineer toggle (renderer edit)

- New chrome pill (top area) with a two-state switch: **Engineer** (default) /
  **Product**.
- **Node label swap:** Engineer → `node.label` (technical). Product → `LABELS[id]`
  falling back to `node.label`. `sizeNodes()` re-runs on toggle so cards refit.
- **Side panel swap:** Engineer → existing "Parsed fields" (`details`) + `META.engineer`
  (signature/notes/deps). Product → `META.product` (description, inputs, outputs).
- State kept in a single `viewMode` variable; toggling re-renders labels + open panel.
  No persistence.
- Everything else in the board is untouched.

### D. skill.md v2 (orchestration)

| Phase | Action | Output |
|-------|--------|--------|
| 0 | Orientation — read docs, draft knowledge base | in-memory |
| 1 | Detect app framework + entry point + service dirs | in-memory |
| 2 | Run `extract-app.js` → merge/slot | `graph.json`, sidecar stubs |
| 2b | Finalize `knowledge-base.md` | `docs/zui/knowledge-base.md` |
| 3 | Fill plain-English labels | `labels.json` |
| 4 | Fill product + engineer metadata | `meta.json` |
| 5 | `assemble-board.js` inject → board | `docs/architecture-board.html` |
| 6 | Report (nodes/edges/clusters, confidence) | stdout |

Dropped from old skill: Phase 5 slides, Phase 6 deploy-to-Vite, Phase 7 docs-index.
Output root: the **target repo's** `docs/` (skill argument = repo path), not the skill
dir.

## Data Flow

```
repo ─▶ extract-app.js ─▶ graph.json + labels.json(stub) + meta.json(stub)
graph.json + repo docs ─▶ (Claude phases 2b–4) ─▶ knowledge-base.md, labels.json, meta.json
graph.json + labels + meta ─▶ assemble-board.js ─▶ docs/architecture-board.html
```

## Error Handling

| Situation | Action |
|-----------|--------|
| Repo path missing | Stop, ask user |
| Shallow graph (<4 nodes / <3 edges) | Warn; still assemble board; note low confidence |
| No JS/TS (other lang) | Grep fallback; note reduced detail |
| Marker missing in template | `assemble-board.js` exits non-zero with clear message |
| No `/docs` in target repo | Create `docs/` |

## Testing

TDD on the deterministic pieces:

1. **Fixture repo** `test/fixtures/checkout-mini/` — a small Node/TS service
   (index, server, routes/, services/, lib/) exercising imports, routes, and one HTTP
   client (for `External` detail). (Also carries a `serverless.yml`/`.circleci` for
   later slices, ignored by Slice 1 extractor.)
2. **`extract-app.js` tests** — assert exact node ids, cluster ids/colors, edge
   `{from,to,kind}` set, `loc` present, `details` for a route module and an
   external-calling service. Assert determinism (two runs byte-identical).
3. **`assemble-board.js` tests** — inject known fixtures; assert output contains the
   three JSON blobs and no residual `__GRAPH__`/`__LABELS__`/`__META__` markers;
   assert failure when a marker is absent.
4. **Renderer smoke** — open assembled board in a browser: nodes render, layer toggles
   work, clicking a node opens the panel, Product/Engineer switch changes labels + panel.
   (Manual eyeball; optional headless later.)

## Success Criteria

- Running the skill on the fixture repo (and one real Node repo) produces a
  `docs/architecture-board.html` that opens standalone, shows clustered app nodes with
  real imports, and the Product/Engineer toggle changes labels and panel content.
- Extractor and injector are covered by passing tests; two runs are byte-identical.
- No reference to `~/Documents/jasper/zui` anywhere in the output path.

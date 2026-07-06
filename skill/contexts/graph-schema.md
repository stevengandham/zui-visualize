# Unified Graph Schema

The extractor emits `graph.json`; the renderer consumes it. Sidecar files
`labels.json` and `meta.json` are keyed by node id and filled in by the Claude
phases (3 and 4).

**Slice 1 scope:** every node has `layer: "app"` and `shape: "rect"`, and every
edge has `kind: "import"` (plus `kind: "cross"` only if a route file references a
handler already modeled — otherwise none). Other layers/shapes/kinds are reserved
for later slices.

## `graph.json`

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

## Sidecars (separate files, keyed by node id)

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

The extractor writes both files as stubs: `labels.json` values are empty or
derived technical names, and `meta.json` has `engineer.signature/file/deps`
pre-filled from the AST. Claude fills the plain-English labels, `product.*`,
and `engineer.notes`.

## ID conventions

| Type | Pattern | Example |
|------|---------|---------|
| app file/module | `<slug-of-relative-path>` | `src-routes-orders` |
| service dir | `svc:<dir-slug>` | `svc:services` |
| route | `route:<METHOD> <path>` | `route:GET /orders/:id` |
| function | `fn:<name>` | `fn:createOrder` |
| cluster | `c_<dir-slug>` | `c_routes` |

IDs must be identical across `graph.json`, `labels.json`, and `meta.json`.

## Cluster color assignment

Deterministic: cycle the six note colors (`--note-yellow`, `--note-blue`,
`--note-green`, `--note-pink`, `--note-orange`, `--note-purple`) in
cluster-creation order so re-runs are stable.

## Slot seeding

`slot` seeds initial cluster position; the browser force layout refines it. The
merge step lays App-layer clusters on a coarse grid (e.g. 700px cells, ~3
columns) so first paint is sane before the force pass. Determinism required (no
randomness in slotting).

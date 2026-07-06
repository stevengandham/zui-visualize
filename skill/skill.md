---
name: zui-visualize
description: Analyze a codebase and generate a self-contained interactive architecture board (single HTML file) in the project's docs/ folder. Slice 1 covers the application code layer.
allowed-tools: Bash Read Write Edit Glob Grep
---

# zui-visualize

Generate an interactive architecture board for a target repository. The skill
argument (`$ARGUMENTS`) is the path to the repo to analyze; all output goes to
that repo's `docs/` folder.

Schema reference for everything below: `contexts/graph-schema.md`.

## Phases

### Phase 0 — Orientation

1. Resolve `$ARGUMENTS` to an absolute path `ROOT`. If the path is missing or
   does not exist, stop and ask the user.
2. Read up to 10 documentation files from the target repo — `README*`,
   `docs/*`, `ARCHITECTURE*` — and draft an in-memory knowledge base: service
   purpose, domain vocabulary, architecture layers. This informs naming in
   Phases 3–4.

### Phase 1 — Detect

Identify the app framework (Express, Fastify, Serverless, etc.), the entry
point, and the service directories. Keep findings in memory; they guide label
and metadata quality. See `contexts/graph-schema.md` for the node/cluster
shapes the extractor will produce.

### Phase 2 — Extract

Run:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/extract-app.js" "$ROOT" --out-dir "$ROOT/docs/zui"
```

This writes `graph.json`, `labels.json` (stub), and `meta.json` (stub) to
`$ROOT/docs/zui/` (creating the directory if needed). Exit code 2 means a
usage error (missing root argument). A shallow graph (<4 nodes or <3 edges)
prints a WARNING on stderr but the files are still written — continue, and
note low confidence in the Phase 6 report. Non-zero exit for any other reason:
stop and investigate before proceeding.

### Phase 2b — Knowledge base

Write `$ROOT/docs/zui/knowledge-base.md` from the Phase 0 draft plus what the
extraction revealed. Sections: Service Purpose · Domain Vocabulary ·
Architecture Layers · External Dependencies · Confidence Notes.

### Phase 3 — Labels

Read `$ROOT/docs/zui/graph.json`. For **every** node id, write a plain-English
label into `$ROOT/docs/zui/labels.json`, overwriting the extractor's stubs.

Naming rules:
- Routes → the business action ("List Orders", not "GET /orders").
- Files/modules → their role ("Payment Processing", not "payments.ts").
- Expand acronyms using the knowledge base vocabulary.

### Phase 4 — Metadata

For **every** node id in `$ROOT/docs/zui/meta.json`:
- Fill `product`: `title`, `description`, `inputs`, `outputs` — written for a
  non-engineer reader.
- Complete `engineer`: write `notes`; `signature`, `file`, and `deps` are
  already prefilled by the extractor — keep them.
- Never leave `description` blank.

### Phase 5 — Assemble

Run:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/assemble-board.js" --in-dir "$ROOT/docs/zui" --out "$ROOT/docs/architecture-board.html"
```

This injects the three JSON files into `template/board.html` by replacing the
`/*__GRAPH__*/`, `/*__LABELS__*/`, and `/*__META__*/` markers (escaping `<` in
the injected JSON). It fails loudly, naming the missing marker, if the template
has been corrupted — do not hand-edit the output around such a failure; fix the
template.

### Phase 6 — Report

Print to the user:
- Node / edge / cluster counts from `graph.json`.
- Label coverage (labels filled vs. total node ids).
- Confidence level (note if the graph was shallow or the repo is non-JS/TS).
- The output path, telling the user to open `docs/architecture-board.html` in
  a browser. Mention the board features: Product/Engineer toggle, layer
  checkboxes, search, minimap, and the click-to-open detail panel.

## Install notes

- Dependencies for `skill/scripts` are installed automatically on the
  extractor's first run (its `ensureDeps` block); no manual step is normally
  needed. Manual installs inherit the same requirements below.
- On Node >= 23, installing the deps requires
  `CXXFLAGS="-std=c++20" npm install --legacy-peer-deps` — the tree-sitter
  native binding needs C++20 to compile against modern V8 headers.
- `--legacy-peer-deps` is load-bearing: `tree-sitter-typescript` declares a
  peer of `tree-sitter@^0.21.0` while we pin 0.25.0.

## Constraints

- **No hardcoded domain assumptions.** All naming and vocabulary come from the
  target repo's code and docs.
- **Owned outputs only.** `docs/zui/*` and `docs/architecture-board.html` are
  ZUI-owned and overwritten on every re-run. Do not touch any other files in
  the target repo's `docs/`.
- **ID consistency.** Node ids must be identical across `graph.json`,
  `labels.json`, and `meta.json` — never rename or add ids in the sidecars.
- **Self-contained.** No dependency on `~/Documents/jasper/zui` or any path
  outside the skill directory and the target repo.
- If the target repo has no `docs/` directory, create it.

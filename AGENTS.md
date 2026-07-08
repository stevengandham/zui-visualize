# AGENTS.md

Instructions for AI coding agents working in this repo.

## What this repo is

A Claude Code skill (`skill/`) that extracts a codebase's app-layer
architecture into a graph, then assembles it into a single self-contained
HTML board (`skill/template/board.html`). See `README.md` for the
user-facing overview and `skill/skill.md` for the skill's own phase-by-phase
instructions (that file is the source of truth for skill *behavior*; this
file is about working *on* the repo's code).

## Layout

- `skill/scripts/extract-app.js` — tree-sitter-based extractor; walks a
  target repo and emits `graph.json` + stub `labels.json`/`meta.json`.
- `skill/scripts/assemble-board.js` — injects those three JSON files into
  `skill/template/board.html`, producing the final board.
- `skill/scripts/lib/schema.js` — shared graph/node/cluster schema helpers.
- `skill/template/board.html` — the renderer: vanilla JS + inline SVG, no
  build step, no external dependencies at runtime.
- `test/` — `node --test` suite covering the extractor, assembler, and an
  end-to-end fixture repo at `test/fixtures/checkout-mini`.

## Running tests

```bash
node --test test/*.test.js
```

Do **not** run bare `node --test` — it also picks up `.ts` fixture files
under `test/fixtures/` and chokes on them.

## Install gotcha

On Node ≥ 23, installing `skill/scripts`' dependencies requires a C++20
toolchain for the native tree-sitter binding:

```bash
CXXFLAGS="-std=c++20" npm install --legacy-peer-deps
```

(run inside `skill/scripts/`). `--legacy-peer-deps` is load-bearing:
`tree-sitter-typescript` declares a peer of `tree-sitter@^0.21.0` while this
repo pins `0.25.0`.

## Conventions

- `board.html` is hand-written vanilla JS/SVG, not a bundled framework app —
  keep it that way; the whole point is a single portable file with no build
  step.
- Colors in the template flow through CSS custom properties (`var(--x)`),
  including inside SVG `fill`/`stroke` via inline `style` attributes (SVG
  presentation attributes don't accept `var()` directly). Keep new
  color-bearing elements on that pattern so light/dark theming keeps
  working without a re-render.
- `graph.json`/`labels.json`/`meta.json` must share identical node ids —
  never rename or add ids in one file without updating the others.

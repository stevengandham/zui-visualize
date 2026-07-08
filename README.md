# zui-visualize

A [Claude Code](https://claude.com/claude-code) skill that turns a codebase
into an interactive, self-contained architecture board — a single HTML file
you can open in any browser, share, or check into `docs/`.

Point it at a repo and it will:

- Parse the app-code layer with tree-sitter (JS/TS today) and build a graph
  of files, modules, and their dependencies.
- Use Claude to write plain-English labels and descriptions for every node —
  a route becomes "List Orders", not `GET /orders`; a file becomes "Payment
  Processing", not `payments.ts`.
- Assemble it all into one HTML file with a Miro-style zoomable board: search,
  minimap, layer filters, a click-to-open detail panel per node, and a
  **Product / Engineer view toggle** so the same board reads well for a
  non-technical stakeholder or the engineer who owns the code.
- Support light and dark mode, following your OS preference with a manual
  override.

No servers, no build step, no accounts — the output is one portable HTML
file with the graph data inlined.

## Install

Copy the `skill/` directory into your Claude Code skills folder:

```bash
git clone https://github.com/stevengandham/zui-visualize.git
cp -r zui-visualize/skill ~/.claude/skills/zui-visualize
```

The extractor's dependencies (tree-sitter and its language grammars) install
automatically on first run. On Node ≥ 23 you'll need a C++20 toolchain for
the native tree-sitter binding — see `skill/skill.md` → **Install notes** if
the automatic install fails.

## Usage

In Claude Code:

```
/zui-visualize ~/path/to/your/repo
```

This generates `docs/zui/` (raw graph + label/metadata sidecars) and
`docs/architecture-board.html` inside the target repo. Open the HTML file in
a browser — that's the board.

Re-running the skill regenerates both; they're fully owned by zui-visualize
and safe to overwrite. Everything else in the target repo's `docs/` is left
alone.

## How it works

1. **Extract** — a tree-sitter-based script (`skill/scripts/extract-app.js`)
   walks the repo and emits a graph (`graph.json`) plus stub label/metadata
   files.
2. **Understand** — Claude reads the repo's docs and source to fill in
   business-readable labels and descriptions, guided by the instructions in
   `skill/skill.md`.
3. **Assemble** — `skill/scripts/assemble-board.js` injects the graph and
   its labels/metadata into `skill/template/board.html`, producing one
   self-contained file.

The full node/edge/cluster schema is documented in
`skill/contexts/graph-schema.md`.

## Status

Covers the **application code layer** (routes, modules, imports) today.
CI/CD pipeline graphs and infrastructure (serverless/Helm/Argo) topology are
planned as additional layers on the same board.

## License

MIT — see [LICENSE](LICENSE).

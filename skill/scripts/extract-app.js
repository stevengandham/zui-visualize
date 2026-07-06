#!/usr/bin/env node
/**
 * extract-app.js — App-layer static extractor for ZUI visualize skill.
 *
 * Uses tree-sitter for accurate AST parsing of JS/TS/CJS repos. Emits
 * app-layer nodes, clusters, and sidecar stubs via GraphBuilder (edges are
 * wired in a later pass).
 *
 * Usage:
 *   node extract-app.js <root> --out-dir <dir>   # writes graph.json, labels.json, meta.json
 *
 * Requires (auto-installs on first run):
 *   tree-sitter, tree-sitter-javascript, tree-sitter-typescript
 */

'use strict'

const fs   = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const { GraphBuilder, slugify } = require('./lib/schema')

// Module-level extraction state, set by extract() before helpers run.
// (Smallest change that keeps the ported helpers — which reference ROOT and
// NODE_PATH_ROOTS — working without re-threading parameters through them.)
let ROOT = null
let NODE_PATH_ROOTS = []

// ── Detect NODE_PATH roots from package.json scripts ─────────────────────────
// Reads all script values, extracts NODE_PATH=<val> segments, resolves them
// relative to ROOT. Enables bare specifier resolution (e.g. require('service')
// → ROOT/src/service when NODE_PATH=./src).
function detectNodePaths() {
  const pkgPath = path.join(ROOT, 'package.json')
  if (!fs.existsSync(pkgPath)) return []
  try {
    const scripts = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).scripts ?? {}
    const roots = new Set()
    for (const cmd of Object.values(scripts)) {
      for (const m of String(cmd).matchAll(/NODE_PATH=([^\s]+)/g)) {
        const resolved = path.resolve(ROOT, m[1])
        if (fs.existsSync(resolved)) roots.add(resolved)
      }
    }
    return [...roots]
  } catch (_) { return [] }
}

// ── Auto-install deps (one-time, local to scripts/) ──────────────────────────
function ensureDeps() {
  const SCRIPT_DIR = __dirname
  const NM         = path.join(SCRIPT_DIR, 'node_modules')
  const needed     = ['tree-sitter', 'tree-sitter-javascript', 'tree-sitter-typescript']
  const missing    = needed.filter(p => !fs.existsSync(path.join(NM, p)))
  if (missing.length > 0) {
    process.stderr.write(`Installing tree-sitter deps (one-time)...\n`)
    execSync(
      `npm install --prefix "${SCRIPT_DIR}" --save-exact --legacy-peer-deps ${missing.join(' ')}`,
      { stdio: ['ignore', 'inherit', 'inherit'] }
    )
  }
  return NM
}

const NM_DIR     = ensureDeps()
const Parser     = require(path.join(NM_DIR, 'tree-sitter'))
const JavaScript = require(path.join(NM_DIR, 'tree-sitter-javascript'))
const TSModule   = require(path.join(NM_DIR, 'tree-sitter-typescript'))
const TypeScript = TSModule.typescript || TSModule

const jsParser = new Parser(); jsParser.setLanguage(JavaScript)
const tsParser = new Parser(); tsParser.setLanguage(TypeScript)

function parseSource(src, ext) {
  try {
    return (ext === '.ts' || ext === '.tsx' ? tsParser : jsParser).parse(src)
  } catch (_) { return null }
}

// ── File walker ───────────────────────────────────────────────────────────────
const SKIP_DIRS = new Set(['node_modules','.git','dist','build','coverage','.nyc_output','vendor','target'])
const SRC_EXTS  = new Set(['.js','.mjs','.cjs','.ts','.tsx'])

function walkFiles(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isDirectory() && !SKIP_DIRS.has(e.name)) out.push(...walkFiles(path.join(dir, e.name)))
    else if (e.isFile() && SRC_EXTS.has(path.extname(e.name))) out.push(path.join(dir, e.name))
  }
  return out
}

// ── AST utilities ────────────────────────────────────────────────────────────
function* walk(node) { yield node; for (const c of node.children) yield* walk(c) }
const txt  = (node, src) => src.slice(node.startIndex, node.endIndex)
const kid  = (node, type) => node.children.find(c => c.type === type) ?? null
const kids = (node, type) => node.children.filter(c => c.type === type)

// ── Const binding resolver ────────────────────────────────────────────────────
// Collects top-level const/let/var x = 'literal' bindings so we can resolve
// string concatenations like `v2 + path` where v2='/v2' and path='/api/foo'.
function buildBindings(tree, src) {
  const bindings = new Map()
  for (const node of walk(tree.rootNode)) {
    if (node.type !== 'lexical_declaration' && node.type !== 'variable_declaration') continue
    for (const decl of kids(node, 'variable_declarator')) {
      const nameNode = kid(decl, 'identifier')
      const val      = decl.children[decl.children.length - 1]
      if (!nameNode || !val) continue
      const name = txt(nameNode, src)
      if (val.type === 'string') {
        bindings.set(name, txt(val, src).replace(/^['"`]|['"`]$/g, ''))
      } else if (val.type === 'template_string') {
        bindings.set(name, txt(val, src).replace(/^`|`$/g, ''))
      }
    }
  }
  return bindings
}

// Evaluate a path expression node to a string, resolving identifier bindings.
// Handles: string literals, identifiers, binary (+) concatenation.
function evalPathNode(node, src, bindings) {
  if (!node) return null
  if (node.type === 'string') return txt(node, src).replace(/^['"`]|['"`]$/g, '')
  if (node.type === 'template_string') return txt(node, src).replace(/^`|`$/g, '')
  if (node.type === 'identifier') return bindings.get(txt(node, src)) ?? null
  if (node.type === 'binary_expression') {
    const [left, , right] = node.children
    const l = evalPathNode(left,  src, bindings)
    const r = evalPathNode(right, src, bindings)
    if (l !== null && r !== null) return l + r
    if (l !== null) return l
    if (r !== null) return r
  }
  return null
}

// ── Bare specifier helpers (NODE_PATH resolution) ────────────────────────────
// Returns true if the specifier is not a relative path, not a node_modules
// package (starts with a letter/@ but has no scope slash or is a known
// project-internal name resolvable via NODE_PATH roots).
function isNodePathSpec(spec) {
  if (!spec || spec.startsWith('.') || spec.startsWith('/')) return false
  if (!NODE_PATH_ROOTS.length) return false
  // Skip obvious npm packages: scoped (@foo/bar) or single bare names with no
  // slash that don't resolve under any node-path root.
  const topSegment = spec.split('/')[0]
  return NODE_PATH_ROOTS.some(r => fs.existsSync(path.join(r, topSegment)))
}

// ── Require/import extractor ─────────────────────────────────────────────────
function extractRequires(tree, src) {
  const out = []
  for (const node of walk(tree.rootNode)) {
    if (node.type === 'call_expression') {
      const fn = node.children[0]
      if (fn && txt(fn, src) === 'require') {
        const argsNode = kid(node, 'arguments')
        const strNode  = argsNode?.children.find(c => c.type === 'string')
        if (strNode) {
          const spec = txt(strNode, src).replace(/^['"]|['"]$/g, '')
          if (spec.startsWith('.') || isNodePathSpec(spec)) out.push(spec)
        }
      }
    }
    if (node.type === 'import_statement') {
      const strNode = node.children.find(c => c.type === 'string')
      if (strNode) {
        const spec = txt(strNode, src).replace(/^['"]|['"]$/g, '')
        if (spec.startsWith('.') || isNodePathSpec(spec)) out.push(spec)
      }
    }
  }
  return [...new Set(out)]
}

// ── Function/method extractor ─────────────────────────────────────────────────
function extractFunctions(tree, src, relFile) {
  const out = []

  for (const node of walk(tree.rootNode)) {
    // Named function declarations
    if (node.type === 'function_declaration' || node.type === 'generator_function_declaration') {
      const nameNode = kid(node, 'identifier')
      if (nameNode) out.push({ name: txt(nameNode, src), file: relFile, line: node.startPosition.row + 1 })
    }

    // const/let/var x = function / arrow
    if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
      for (const decl of kids(node, 'variable_declarator')) {
        const nameNode = kid(decl, 'identifier')
        const val      = decl.children.find(c =>
          ['function', 'arrow_function', 'generator_function'].includes(c.type)
        )
        if (nameNode && val) out.push({ name: txt(nameNode, src), file: relFile, line: node.startPosition.row + 1 })
      }
    }

    // Class methods
    if (node.type === 'method_definition') {
      const nameNode = node.children.find(c => c.type === 'property_identifier' || c.type === 'identifier')
      if (!nameNode) continue
      const methodName = txt(nameNode, src)
      if (['constructor','get','set'].includes(methodName)) continue

      let clsNode = node.parent
      while (clsNode && clsNode.type !== 'class_declaration' && clsNode.type !== 'class') clsNode = clsNode.parent
      const clsName = clsNode
        ? (() => { const id = clsNode.children.find(c => c.type === 'identifier'); return id ? txt(id, src) : null })()
        : null

      out.push({
        name:       clsName ? `${clsName}.${methodName}` : methodName,
        simpleName: methodName,
        className:  clsName,
        file:       relFile,
        line:       node.startPosition.row + 1,
      })
    }
  }

  return out
}

// ── Route extractor ───────────────────────────────────────────────────────────
const HTTP_VERBS = new Set(['get','post','put','patch','delete','options','head'])

function extractRoutes(tree, src, relFile, bindings) {
  const out = []

  for (const node of walk(tree.rootNode)) {
    if (node.type !== 'call_expression') continue
    const callee = node.children[0]
    if (!callee) continue

    // Express: router.get('/path', ...) / app.post('/path', ...)
    if (callee.type === 'member_expression') {
      const prop = callee.children.find(c => c.type === 'property_identifier')
      if (!prop) continue
      const verb = txt(prop, src).toLowerCase()

      if (HTTP_VERBS.has(verb)) {
        const argsNode = kid(node, 'arguments')
        if (!argsNode) continue
        const pathNode = argsNode.children.find(c =>
          c.type === 'string' || c.type === 'template_string' ||
          c.type === 'identifier' || c.type === 'binary_expression'
        )
        const routePath = evalPathNode(pathNode, src, bindings)
        if (routePath && routePath.startsWith('/')) {
          out.push({ method: verb.toUpperCase(), path: routePath, file: relFile, line: node.startPosition.row + 1 })
        }
      }

      // Hapi: server.route({ method, path, ... })
      if (verb === 'route') {
        const argsNode = kid(node, 'arguments')
        if (!argsNode) continue
        for (const argNode of argsNode.children) {
          const configs = argNode.type === 'array' ? kids(argNode, 'object') : [argNode]
          for (const obj of configs) {
            if (obj.type !== 'object') continue
            let method = null, routePath = null
            for (const pair of kids(obj, 'pair')) {
              const keyNode = pair.children.find(c => c.type === 'property_identifier' || c.type === 'string')
              const valNode = pair.children[pair.children.length - 1]
              if (!keyNode || !valNode) continue
              const key = txt(keyNode, src).replace(/^['"]|['"]$/g, '')
              if (key === 'method') {
                const resolved = evalPathNode(valNode, src, bindings)
                if (resolved) method = resolved.toUpperCase()
                else method = txt(valNode, src).replace(/^['"]|['"]$/g, '').toUpperCase()
              }
              if (key === 'path') {
                routePath = evalPathNode(valNode, src, bindings)
              }
            }
            if (method && routePath && routePath.startsWith('/')) {
              out.push({ method, path: routePath, file: relFile, line: node.startPosition.row + 1 })
            }
          }
        }
      }
    }
  }

  return out
}

// ── Call name extractor ───────────────────────────────────────────────────────
function extractCallNames(tree, src) {
  const names = new Set()
  for (const node of walk(tree.rootNode)) {
    if (node.type !== 'call_expression') continue
    const callee = node.children[0]
    if (!callee) continue
    if (callee.type === 'identifier') names.add(txt(callee, src))
    else if (callee.type === 'member_expression') {
      const prop = callee.children.find(c => c.type === 'property_identifier')
      if (prop) names.add(txt(prop, src))
    }
  }
  return [...names]
}

// ── Module resolver ───────────────────────────────────────────────────────────
const EXTS = ['.js', '.ts', '.mjs', '.cjs']
function tryResolveBase(base) {
  // File candidates first (never return a bare directory path)
  const fileCandidates = [...EXTS.map(e => base + e),
                          path.join(base, 'index.js'), path.join(base, 'index.ts')]
  for (const c of fileCandidates) if (fs.existsSync(c)) return path.relative(ROOT, c)
  return null
}

function resolveRequire(fromFile, specifier) {
  if (specifier.startsWith('.')) {
    // Relative specifier — resolve from the file's directory
    const base = path.resolve(path.dirname(path.join(ROOT, fromFile)), specifier)
    return tryResolveBase(base)
  }
  // Bare specifier — try each NODE_PATH root
  for (const npRoot of NODE_PATH_ROOTS) {
    const result = tryResolveBase(path.join(npRoot, specifier))
    if (result) return result
  }
  return null
}

// ── Infer services from directory structure ───────────────────────────────────
// Strategy: group files by their immediate parent directory. Directories that
// have at least one non-index source file become service nodes. Directories that
// only contain index.js re-exports are transparent pass-throughs.
function inferServices(allRelFiles) {
  const dirFiles = new Map()
  for (const f of allRelFiles) {
    const dir = path.dirname(f)
    if (!dirFiles.has(dir)) dirFiles.set(dir, [])
    dirFiles.get(dir).push(f)
  }

  // Score each directory: prefer deeper paths with actual logic
  const services = []
  for (const [dir, files] of dirFiles) {
    // Skip root and single-level dirs (too broad)
    const depth = dir.split('/').filter(Boolean).length
    if (depth < 1) continue
    // Skip root, single-segment dirs (too broad), test dirs, and generated output
    if (dir === '.') continue
    if (!/\//.test(dir)) continue  // e.g., bare "src" — needs at least one sub-level
    if (/\b(test|spec|__tests__|fixtures|mocks)\b/i.test(dir)) continue
    if (dir.startsWith('docs/')) continue

    const logicFiles = files.filter(f => {
      const base = path.basename(f, path.extname(f))
      return base !== 'index' && !base.startsWith('.')
    })
    if (logicFiles.length === 0) continue

    const name = path.basename(dir)
    services.push({ id: `svc:${slugify(name)}`, label: name, dir, files })
  }

  // Deduplicate: if a child dir and parent dir both qualify, prefer the child
  // (more specific). Remove parents that are supersets of children.
  const childDirs = new Set(services.map(s => s.dir))
  return services.filter(s => {
    const parts = s.dir.split('/')
    // If any ancestor dir is also a service, this one wins (keep it), drop parent
    for (let i = 1; i < parts.length; i++) {
      const ancestor = parts.slice(0, i).join('/')
      if (childDirs.has(ancestor) && ancestor !== s.dir) {
        // Keep the more specific child; the parent will be filtered later
        // by checking: if I am an ancestor of another service, am I redundant?
      }
    }
    return true
  })
}


// ── Assembly ──────────────────────────────────────────────────────────────────
function fileIdFor(relFile) {
  return slugify(relFile.replace(/\.[^.]+$/, ''));
}

function countLoc(src) {
  return src.split('\n').length;
}

function extract(root) {
  ROOT = path.resolve(root);
  NODE_PATH_ROOTS = detectNodePaths();
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

  // Import edges: resolve each file's requires to a target file-module id
  for (const [relFile, data] of fileData) {
    const fromId = fileIdFor(relFile);
    for (const spec of data.requires) {
      const resolved = resolveRequire(relFile, spec);
      if (resolved && fileData.has(resolved)) {
        g.addEdge(fromId, fileIdFor(resolved), 'import', 'imports');
      }
    }
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

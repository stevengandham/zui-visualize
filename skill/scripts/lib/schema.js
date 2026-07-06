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

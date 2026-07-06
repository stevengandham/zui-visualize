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

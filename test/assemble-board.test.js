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

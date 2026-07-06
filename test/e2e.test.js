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

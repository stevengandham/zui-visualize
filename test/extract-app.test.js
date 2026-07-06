// test/extract-app.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { extract } = require('../skill/scripts/extract-app');

const FIXTURE = path.join(__dirname, 'fixtures', 'checkout-mini');

test('extracts service-dir clusters for routes/services/lib', () => {
  const { graph } = extract(FIXTURE);
  const ids = graph.clusters.map(c => c.id).sort();
  assert.ok(ids.includes('c_routes'), 'has routes cluster');
  assert.ok(ids.includes('c_services'), 'has services cluster');
  assert.ok(ids.includes('c_lib'), 'has lib cluster');
  graph.clusters.forEach(c => assert.equal(c.layer, 'app'));
});

test('all app nodes are rect/app with loc and details', () => {
  const { graph } = extract(FIXTURE);
  assert.ok(graph.nodes.length >= 4);
  graph.nodes.forEach(n => {
    assert.equal(n.layer, 'app');
    assert.equal(n.shape, 'rect');
    assert.equal(typeof n.loc, 'number');
    assert.ok(Array.isArray(n.details));
  });
});

test('route module carries an Endpoints detail; external caller carries External', () => {
  const { graph } = extract(FIXTURE);
  const flat = graph.nodes.map(n => ({ id: n.id, d: Object.fromEntries(n.details) }));
  const route = flat.find(n => n.d.Endpoints);
  assert.ok(route, 'some node lists Endpoints');
  assert.match(route.d.Endpoints, /\/orders/);
  const ext = flat.find(n => n.d.External);
  assert.ok(ext, 'payment processor lists External');
});

test('sidecar stubs cover every node id with engineer.file prefilled', () => {
  const { graph, labels, meta } = extract(FIXTURE);
  for (const n of graph.nodes) {
    assert.ok(n.id in labels, 'label stub for ' + n.id);
    assert.ok(n.id in meta, 'meta stub for ' + n.id);
    assert.ok('product' in meta[n.id] && 'engineer' in meta[n.id]);
    assert.equal(typeof meta[n.id].engineer.file, 'string');
  }
});

test('extraction is deterministic', () => {
  assert.equal(JSON.stringify(extract(FIXTURE)), JSON.stringify(extract(FIXTURE)));
});

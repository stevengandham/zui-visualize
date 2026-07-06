// skill/scripts/assemble-board.js
'use strict';
const fs = require('fs');
const path = require('path');

const MARKERS = {
  '/*__GRAPH__*/ null': 'graph',
  '/*__LABELS__*/ {}': 'labels',
  '/*__META__*/ {}': 'meta',
};

function assemble({ template, graph, labels, meta }) {
  const data = { graph, labels, meta };
  let out = template;
  for (const [marker, key] of Object.entries(MARKERS)) {
    if (!out.includes(marker)) throw new Error(`Template missing marker for ${key}: ${marker}`);
    out = out.replace(marker, JSON.stringify(data[key], null, 2));
  }
  return out;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const inDir = args[args.indexOf('--in-dir') + 1];
  const outFile = args[args.indexOf('--out') + 1];
  const templatePath = path.join(__dirname, '..', 'template', 'board.html');
  const out = assemble({
    template: fs.readFileSync(templatePath, 'utf8'),
    graph: JSON.parse(fs.readFileSync(path.join(inDir, 'graph.json'), 'utf8')),
    labels: JSON.parse(fs.readFileSync(path.join(inDir, 'labels.json'), 'utf8')),
    meta: JSON.parse(fs.readFileSync(path.join(inDir, 'meta.json'), 'utf8')),
  });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, out);
  process.stderr.write(`Wrote ${outFile}\n`);
}

module.exports = { assemble };

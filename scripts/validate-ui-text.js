import fs from 'node:fs';

const files = [
  'src/App.jsx',
  'public/help/market-board-guide.html',
  'public/data/market.json'
];

const errors = [];

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    const visibleEscape = />[^<]*\\u[0-9a-fA-F]{4}/.test(line)
      || /\{\s*['"`][^'"`]*\\u[0-9a-fA-F]{4}/.test(line)
      || (file.endsWith('.html') && /\\u[0-9a-fA-F]{4}/.test(line))
      || (file.endsWith('.json') && /\\u[0-9a-fA-F]{4}/.test(line));
    if (visibleEscape) {
      errors.push(`${file}:${index + 1} contains a visible Unicode escape: ${line.trim()}`);
    }
  });
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log('validated visible UI text');

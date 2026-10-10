const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const excluded = new Set(['.git', 'node_modules', 'dist', '.venv-whisper']);
const files = [];

function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!excluded.has(entry.name)) collect(path.join(directory, entry.name));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(path.join(directory, entry.name));
    }
  }
}

collect(root);
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax check passed for ${files.length} JavaScript files.`);

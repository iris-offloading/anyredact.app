// Manages the home page badge wall (src/worker/badges.ts) in D1. Codes are stored as pasted.
//   npm run badges -- add < code.html     paste a directory's badge code (or pipe it in)
//   npm run badges -- list
//   npm run badges -- remove <id>
// Add --preview for the preview database, --local for `wrangler dev`.
// The site shows changes within five minutes, with no deploy.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const [command, id] = args.filter((a) => !a.startsWith('--'));
const db = flag('--preview') ? 'anyredact-preview' : 'anyredact';
const where = flag('--local') ? '--local' : '--remote';
const sql = (s) => `'${s.replace(/'/g, "''")}'`;

function run(statement) {
  const dir = mkdtempSync(path.join(tmpdir(), 'badges-'));
  const file = path.join(dir, 'badges.sql');
  writeFileSync(file, statement);
  try {
    execFileSync('npx', ['wrangler', 'd1', 'execute', db, where, '--file', file, '--json'], { stdio: ['ignore', 'pipe', 'inherit'] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (command === 'add') {
  const code = readFileSync(0, 'utf8').trim();
  if (!code) throw new Error('Paste a badge code on standard input.');
  run(`INSERT INTO badges (code, position) VALUES (${sql(code)}, (SELECT COALESCE(MAX(position), 0) + 1 FROM badges));`);
  console.log('Added.');
} else if (command === 'list') {
  execFileSync('npx', ['wrangler', 'd1', 'execute', db, where, '--command', 'SELECT id, position, code FROM badges ORDER BY position, id'], { stdio: 'inherit' });
} else if (command === 'remove' && /^\d+$/.test(id ?? '')) {
  run(`DELETE FROM badges WHERE id = ${Number(id)};`);
  console.log('Removed.');
} else {
  console.log('Usage: npm run badges -- add|list|remove <id> [--preview] [--local]');
}

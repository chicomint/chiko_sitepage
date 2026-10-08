import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
function check(folder) {
  for (const item of readdirSync(folder, { withFileTypes: true })) {
    if (['node_modules', '.git', 'data', 'backups', 'artifacts', 'legacy'].includes(item.name)) continue;
    const path = join(folder, item.name);
    if (item.isDirectory()) check(path);
    else if (item.name.endsWith('.js')) {
      const result = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' });
      if (result.status !== 0) process.exit(result.status || 1);
    }
  }
}
check('.');
console.log('JavaScript syntax checks passed.');

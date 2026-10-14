import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../..', import.meta.url)));
import { connectDatabase } from '../draw/database.js';
import { migrate } from '../draw/migration.js';
let store;
try { store = await connectDatabase(); console.log(JSON.stringify(await migrate(store))); }
catch { console.error('Migration failed. Check database access and source files; original data was retained.'); process.exitCode = 1; }
finally { await store?.close(); }

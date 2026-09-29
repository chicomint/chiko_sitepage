import { connectDatabase } from '../cms/database.js';
import { migrate } from '../cms/migration.js';
let store;
try { store = await connectDatabase(); console.log(JSON.stringify(await migrate(store))); }
catch { console.error('Migration failed. Check database access and source files; original data was retained.'); process.exitCode = 1; }
finally { await store?.close(); }

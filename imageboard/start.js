'use strict';

if(process.env.CHIKO_DATA_FORMAT==='legacy-v16') {
  require('./compat/server');
} else if(process.env.NODE_ENV==='production') {
  console.error('Set CHIKO_DATA_FORMAT=legacy-v16 after completing the migration checks.');
  process.exitCode=1;
} else {
  require('./server');
}

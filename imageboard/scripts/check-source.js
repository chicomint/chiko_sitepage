'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
function visit(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){if(entry.name.startsWith('.')||['node_modules','data','backups','artifacts'].includes(entry.name))continue;const p=path.join(directory,entry.name);if(entry.isDirectory())visit(p);else if(p.endsWith('.js')){const r=spawnSync(process.execPath,['--check',p],{stdio:'inherit'});if(r.status!==0)process.exit(r.status || 1);}}}
visit(path.join(__dirname,'..'));

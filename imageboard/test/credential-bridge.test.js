'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {hashPassword}=require('../lib/utils');
const {planBridge}=require('../scripts/bridge-credentials');
const {passwordMatches}=require('../compat/auth');
const source=values=>({collection:name=>({find:()=>({toArray:async()=>structuredClone(values[name] || [])})})});

test('credential bridge requires recorded identity mappings and preserves original hashes and permissions',async()=>{
  const hash=hashPassword('unchanged original password');
  const native={staff:[{id:'known-id',passwordHash:hash,enabled:true,role:'admin'}],posts:[{id:100,passwordHash:hash}]};
  const legacy={users:[{login:'migrated',globalRole:1,_chikoMigration:{oldId:'known-id',sourceEnabled:true}},{login:'unmatched',globalRole:0,_chikoMigration:{oldId:'different'}}],chikoIdMap:[{oldId:100,boardUri:'a',postId:7,threadId:1}]};
  const original=structuredClone({native,legacy});
  const plan=await planBridge(source(native),source(legacy),'a'.repeat(64));
  assert.equal(plan.accounts.length,1);assert.equal(plan.deletion.length,1);
  assert.equal(plan.accounts[0].chikoLegacyScryptHash,hash);
  assert.equal(plan.accounts[0].globalRole,undefined);
  assert.equal(await passwordMatches(plan.accounts[0],'unchanged original password'),true);
  assert.equal(plan.deletion[0]._id,'a:7');
  assert.deepEqual({native,legacy},original);
  await assert.rejects(planBridge(source(native),source(legacy),'unverified'),/checksum/);
});

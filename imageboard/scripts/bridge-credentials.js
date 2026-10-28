'use strict';

// Recover compatible credentials from the verified pre-migration native backup.
// Source account IDs must match the IDs recorded by the previous migration.
// No password derivation, reset, source-account update or privilege change.
function validHash(value){return /^scrypt\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/.test(value || '');}
async function planBridge(nativeDb,targetDb,provenance){
  if(!/^[a-f0-9]{64}$/.test(provenance))throw new Error('A verified source backup checksum is required.');
  const [staff,users,posts,maps]=await Promise.all([
    nativeDb.collection('staff').find({}).toArray(),targetDb.collection('users').find({}).toArray(),
    nativeDb.collection('posts').find({}).toArray(),targetDb.collection('chikoIdMap').find({}).toArray()
  ]);
  const accounts=[],deletion=[];
  for(const user of users){
    const oldId=user._chikoMigration?.oldId;
    const source=oldId && staff.find(v=>v.id===oldId);
    if(!source || !validHash(source.passwordHash))continue;
    if(source.enabled===false && user._chikoMigration.sourceEnabled!==false)throw new Error('Source account enabled-state disagreement requires review.');
    accounts.push({_id:user.login,chikoLegacyScryptHash:source.passwordHash,chikoCredentialSource:provenance,sourceAccountId:oldId});
  }
  for(const map of maps){
    const post=posts.find(v=>v.id===map.oldId);
    if(!post || !validHash(post.passwordHash))continue;
    deletion.push({_id:`${map.boardUri}:${map.postId}`,nativeScryptHash:post.passwordHash,oldId:map.oldId,source:provenance});
  }
  return {accounts,deletion};
}
async function applyBridge(db,plan){
  for(const [name,documents,field] of [['chikoAccounts',plan.accounts,'chikoLegacyScryptHash'],['chikoPostCredentials',plan.deletion,'nativeScryptHash']]){
    for(const doc of documents){
      const prior=await db.collection(name).findOne({_id:doc._id});
      if(prior?.[field] && prior[field]!==doc[field])throw new Error('Existing sidecar credentials differ; refusing to replace them.');
      if(!prior?.[field])await db.collection(name).updateOne({_id:doc._id},{$set:doc},{upsert:true});
    }
  }
  return {accounts:plan.accounts.length,deletionCredentials:plan.deletion.length};
}
module.exports={planBridge,applyBridge,validHash};

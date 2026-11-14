import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModelAvailabilityService } from '../src/service/availability.js';
test('availability caches by owner, model and credential and expires', async () => {
 let count=0, now=0; const keys:string[]=[];
 const probe={probe:async()=>{count++}};
 const service=new ModelAvailabilityService(key=>{keys.push(key);return probe},()=>now);
 assert.equal((await service.check('a',{model:'test/a',openRouterApiKey:'test-key'})).status,'available');
 await service.check('a',{model:'test/a',openRouterApiKey:'test-key'}); assert.equal(count,1);
 await service.check('b',{model:'test/a',openRouterApiKey:'test-key'}); await service.check('a',{model:'test/a',openRouterApiKey:'secret'});
 assert.deepEqual(keys,['test-key','test-key','secret']); assert.equal(count,3);
 now=60001; await service.check('a',{model:'test/a',openRouterApiKey:'test-key'}); assert.equal(count,4);
});
test('failures are safe and retryable without exposing provider messages',async()=>{
 const service=new ModelAvailabilityService(()=>({probe:async()=>{throw Object.assign(new Error('secret'),{statusCode:402})}}));
 const result=await service.check('a',{model:'test/a',openRouterApiKey:'test-key'});
 assert.equal(result.status,'unavailable'); assert.match(result.reason!,/credits/); assert.ok(!JSON.stringify(result).includes('secret'));
});
test('duplicate requests coalesce and concurrency is bounded',async()=>{
 let release!:()=>void;const wait=new Promise<void>(r=>{release=r});let calls=0;
 const probe={probe:async()=>{calls++;await wait}};
 const service=new ModelAvailabilityService(()=>probe);
 const a=service.check('a',{model:'one',openRouterApiKey:'test-key'}),b=service.check('a',{model:'one',openRouterApiKey:'test-key'}),c=service.check('a',{model:'two',openRouterApiKey:'test-key'});
 assert.equal((await service.check('a',{model:'three',openRouterApiKey:'test-key'})).status,'unavailable');
 release();await Promise.all([a,b,c]);assert.equal(calls,2);
});

 test('missing or invalid keys never create a provider or use an environment fallback', async()=>{
 let calls=0;
 const service=new ModelAvailabilityService(()=>{calls++;throw Error('should not create provider')});
 for(const key of [undefined, '', ' ', 'with space', 'x'.repeat(513)]) {
 const result=await service.check('owner',{model:'test/model',openRouterApiKey:key as string});
 assert.equal(result.status,'unavailable');assert.match(result.reason!,/Enter your/);
 }
 assert.equal(calls,0);
 });

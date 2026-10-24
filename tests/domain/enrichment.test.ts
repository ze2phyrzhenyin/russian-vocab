import {describe,it,expect} from 'vitest';
import {EnrichmentRunner,enrichmentResultSchema,type EnrichmentProvider} from '../../src/server/enrichment';
const request={sourceKey:'source:1',contentVersion:1,russian:'читать',chinese:'阅读',sourceExcerpt:'Untrusted source text',requestedFields:['aspect']};
const result={schemaVersion:'slovo-enrichment/1',sourceKey:'source:1',fields:{aspect:{value:'unknown',status:'unknown',evidence:[]}}};
describe('server content provider boundary',()=>{
  it('keeps no-key mode explicit and never synthesizes a success',async()=>{const runner=new EnrichmentRunner(null);expect(runner.status().configured).toBe(false);await expect(runner.run(request)).rejects.toMatchObject({kind:'unconfigured'})});
  it('rejects reviewed status, unexpected fields and wrong source identity',async()=>{
    expect(enrichmentResultSchema.safeParse({...result,fields:{aspect:{value:'perfective',status:'reviewed',evidence:[]}}}).success).toBe(false);
    const runner=new EnrichmentRunner({id:'unit',model:'test',version:'1',generate:async()=>({...result,sourceKey:'wrong'})});
    await expect(runner.run(request)).rejects.toMatchObject({kind:'invalid-output'});
  });
  it('reuses validated cache without calls and honors call budget on a changed source version',async()=>{
    let calls=0;const runner=new EnrichmentRunner({id:'unit',model:'test',version:'1',generate:async()=>{calls++;return result}},{maxCalls:1,minimumIntervalMs:0});
    expect((await runner.run(request)).cached).toBe(false);expect((await runner.run(request)).cached).toBe(true);expect(calls).toBe(1);
    await expect(runner.run({...request,contentVersion:2})).rejects.toMatchObject({kind:'budget'});
  });
  it('bounds hanging providers, cancels explicitly and retries only transient errors',async()=>{
    const provider:EnrichmentProvider={id:'unit',model:'test',version:'1',generate:async()=>new Promise(()=>{})};
    const runner=new EnrichmentRunner(provider,{timeoutMs:10,maxRetries:1,minimumIntervalMs:0});
    await expect(runner.run(request)).rejects.toMatchObject({kind:'timeout'});expect(runner.status().calls).toBe(2);
    const controller=new AbortController();controller.abort();await expect(runner.run(request,controller.signal)).rejects.toMatchObject({kind:'cancelled'});
  });
});

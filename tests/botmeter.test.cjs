const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function helper(fetch, env = {}) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../lib/botmeter.cjs'), 'utf8'), {
    module, require, fetch, process: { env: { BOTMETER_URL: 'https://monitor.example', BOTMETER_INGEST_KEY: 'test-secret', ...env } },
    URL, AbortSignal, console: { warn() {} },
  });
  return module.exports;
}
const provider='https://api.openai.com/v1/responses';
const options={body:JSON.stringify({model:'configured-model',input:'Bearer test-secret sk-example-secret'})};
const payload={model:'returned-model',usage:{input_tokens:100,input_tokens_details:{cached_tokens:25},output_tokens:12},output_text:'test-secret'};
test('fixed ID, exact usage, sanitized content and intact provider response',async()=>{
 const events=[];const h=helper(async(url,opts)=>String(url).startsWith(provider)?Response.json(payload):(events.push(JSON.parse(opts.body)),Response.json({ok:true})));
 const response=await h.monitoredFetch(provider,options);
 assert.deepEqual(await response.json(),payload);const e=events[0];
 assert.equal(e.bot,'fritz');assert.equal(e.model,'returned-model');assert.equal(e.inputTokens,100);assert.equal(e.cachedTokens,25);assert.equal(e.outputTokens,12);assert.equal(e.usageKnown,true);
 assert.match(e.id,/^[A-Za-z0-9_-]{1,120}$/);assert.ok(!JSON.stringify(e).includes('test-secret'));assert.ok(!JSON.stringify(e).includes('sk-example-secret'));
});
test('three delivery attempts reuse ID; next provider attempt gets new ID',async()=>{
 const events=[];const h=helper(async(url,opts)=>String(url).startsWith(provider)?Response.json(payload):(events.push(JSON.parse(opts.body)),Response.json({}, {status:503})));
 await h.monitoredFetch(provider,options);await h.monitoredFetch(provider,options);
 assert.equal(events.length,6);assert.equal(new Set(events.slice(0,3).map(e=>e.id)).size,1);assert.notEqual(events[0].id,events[3].id);
});
test('invalid credentials do not retry, network failures preserve original error',async()=>{
 const failure=new Error('Bearer test-secret');const events=[];const h=helper(async(url,opts)=>{if(String(url).startsWith(provider))throw failure;events.push(JSON.parse(opts.body));return Response.json({}, {status:401});});
 await assert.rejects(h.monitoredFetch(provider,options),e=>e===failure);assert.equal(events.length,1);assert.equal(events[0].status,'error');assert.equal(events[0].usageKnown,false);assert.ok(!JSON.stringify(events).includes('test-secret'));
});
test('missing usage stays unknown; no invented image count or temporary URLs',()=>{
 const h=helper(async()=>{});const e=h.eventFor('https://api.openai.com/v1/images/edits',{model:'image-model'},{},Date.now(),'id',null);
 assert.equal(e.usageKnown,false);assert.equal(e.images,0);assert.equal(e.imageUrls.length,0);
});
test('embeddings report one batch without vectors; partial text usage is unknown',()=>{
 const h=helper(async()=>{});const e=h.eventFor('https://api.openai.com/v1/embeddings',{model:'embed'}, {usage:{prompt_tokens:44},data:[{embedding:[0.12345,0.56789]}]},Date.now(),'id',null);
 assert.equal(e.usageKnown,true);assert.equal(e.inputTokens,44);assert.equal(e.outputTokens,0);assert.equal(e.kind,'embedding');assert.ok(!JSON.stringify(e).includes('0.12345'));
 const partial=h.eventFor(provider,{model:'text'},{usage:{input_tokens:40}},Date.now(),'id',null);assert.equal(partial.usageKnown,false);
});
test('HTTP provider error with usage is reported and response is preserved',async()=>{
 const events=[];const h=helper(async(url,opts)=>String(url).startsWith(provider)?Response.json(payload,{status:429}):(events.push(JSON.parse(opts.body)),Response.json({})));
 const response=await h.monitoredFetch(provider,options);assert.equal(response.status,429);assert.equal(events[0].status,'error');assert.equal(events[0].inputTokens,100);
});
test('non-provider traffic and unconfigured monitoring are passthrough',async()=>{
 let calls=0;const h=helper(async()=>{calls++;return Response.json({});},{BOTMETER_URL:''});await h.monitoredFetch(provider,options);assert.equal(calls,1);
 const other=helper(async()=>{calls++;return Response.json({});});await other.monitoredFetch('https://discord.com/api',{});assert.equal(calls,2);
});

test('final Discord text and image URLs attach to provider event without changing raw output',async()=>{
 const reports=[];const h=helper(async(url,opts)=>{
  if(String(url).startsWith(provider))return Response.json({...payload,output_text:'{"winner":1}'});
  if(String(url).startsWith('https://discord.com/')){assert.equal(new URL(url).searchParams.get('wait'),'true');return Response.json({content:'Actual bot reply',attachments:[{content_type:'image/png',url:'https://cdn.discordapp.com/attachments/123/result.png'}]});}
  reports.push({path:new URL(url).pathname,event:JSON.parse(opts.body)});return Response.json({ok:true});
 });
 await h.withTelemetry(async()=>{h.setCommand('/image');await h.monitoredFetch(provider,options);await h.monitoredFetch('https://discord.com/api/v10/webhooks/app/token',{method:'POST',body:JSON.stringify({content:'Actual bot reply'})});})();
 assert.equal(reports.length,2);assert.equal(reports[0].event.output,'{"winner":1}');assert.equal(reports[1].path,'/api/result');assert.equal(reports[1].event.ids[0],reports[0].event.id);assert.equal(reports[1].event.output,'Actual bot reply');assert.equal(reports[1].event.imageUrls.length,1);
});
test('failed Discord sends never claim a delivered result',async()=>{
 const reports=[];const h=helper(async(url,opts)=>{
  if(String(url).startsWith(provider))return Response.json(payload);
  if(String(url).startsWith('https://discord.com/'))return Response.json({}, {status:500});
  reports.push(JSON.parse(opts.body));return Response.json({});
 });
 await h.withTelemetry(async()=>{await h.monitoredFetch(provider,options);await h.monitoredFetch('https://discord.com/api/v10/webhooks/app/token',{method:'POST',body:'{"content":"not delivered"}'});})();assert.equal(reports.length,1);
});

test('Responses format config never hides the actual output text',()=>{
 const h=helper(async()=>{});
 const data={text:{format:{type:'text'},verbosity:'medium'},output:[{content:[{type:'output_text',text:'The actual reply'}]}]};
 assert.equal(h.eventFor(provider,{},data,Date.now(),'id',null).output,'The actual reply');
});
test('candidate selection reports the chosen sentence, not only its index',()=>{
 const h=helper(async()=>{});
 const request={text:{format:{name:'shae_candidate_selection'}},input:[{content:[{type:'input_text',text:'Question: example\nNumbered candidates:\n0: First sentence\n1: Chosen sentence\n2: Last sentence'}]}]};
 const data={text:{format:{type:'json_schema'}},output:[{content:[{text:'{"winner":1}'}]}]};
 const result=JSON.parse(h.eventFor(provider,request,data,Date.now(),'id',null).output);
 assert.equal(result.selected_line,'Chosen sentence');
 assert.equal(result.candidate_index,1);
});

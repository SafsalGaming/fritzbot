const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');
const context = new AsyncLocalStorage();
const originalFetch = globalThis.fetch.bind(globalThis);
const BOT = 'fritz';
function withTelemetry(handler) { return function(...args) { return context.run({command:'/unknown'},()=>handler.apply(this,args)); }; }
function setCommand(command) { const ctx=context.getStore(); if(ctx)ctx.command=String(command||'/unknown').slice(0,150); }
function scrub(value,depth=0){
  if(depth>8)return '[nested content]';
  if(typeof value==='string')return value.startsWith('data:')?'[inline media omitted]':value.slice(0,70000);
  if(Array.isArray(value))return value.slice(0,100).map(x=>scrub(x,depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!/(authorization|token$|secret|password|api.?key|b64_json|embedding$)/i.test(k)).map(([k,v])=>[k,scrub(v,depth+1)]));
  return value;
}
function description(value){try{return (typeof value==='string'?value:JSON.stringify(scrub(value))).slice(0,70000);}catch{return '[content unavailable]';}}
function requestPayload(body){try{if(typeof body==='string')return JSON.parse(body);if(body&&typeof body.entries==='function')return Object.fromEntries([...body.entries()].filter(([,v])=>typeof v==='string'));}catch{}return {};}
function eventFor(url,payload,data,started,id,error){
  const usage=data?.usage||{};
  const embedding=url.endsWith('/embeddings');
  const image=url.includes('/images/');
  const input=Number(usage.input_tokens??usage.prompt_tokens)||0;
  const cached=Number(usage.input_tokens_details?.cached_tokens??usage.prompt_tokens_details?.cached_tokens)||0;
  const output=Number(usage.output_tokens??usage.completion_tokens)||0;
  const text=data?.output_text||data?.text||data?.choices?.[0]?.message?.content||(data?.output||[]).flatMap(x=>(x.content||[]).map(y=>y.text||y.refusal||'')).filter(Boolean).join('\n');
  return {id,bot:BOT,command:context.getStore()?.command||'/index-build',model:payload.model||data?.model||'unknown',kind:embedding?'embedding':image?'image':'text',status:error?'error':'success',prompt:description({instructions:payload.instructions,input:payload.input??payload.messages??payload.prompt??'[audio upload]',...(!payload.input&&!payload.prompt&&payload.language?{language:payload.language}:{})}),output:error?String(error.message||error).slice(0,3000):embedding?`Created ${data?.data?.length||0} embeddings; ${data?.data?.[0]?.embedding?.length||0} dimensions`:image?'Image generated; preview will be attached after Discord upload.':description(text||''),imageUrls:(data?.data||[]).map(x=>x.url).filter(x=>typeof x==='string'&&x.startsWith('https://')).slice(0,10),inputTokens:input,cachedTokens:Math.min(input,cached),outputTokens:output,images:image&&!error?(data?.data?.length||1):0,usageKnown:typeof usage.input_tokens==='number'||typeof usage.prompt_tokens==='number',durationMs:Date.now()-started,occurredAt:new Date(started).toISOString()};
}
async function deliver(action,event){
  const url=process.env.BOTMETER_URL,key=process.env.BOTMETER_INGEST_KEY;
  if(!url||!key)return false;
  for(let attempt=0;attempt<2;attempt++){
    try{const res=await originalFetch(new URL('/api/'+action,url),{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(event),signal:AbortSignal.timeout(5000)});if(res.ok)return true;if(res.status<500&&res.status!==429)break;}catch{}
  }
  console.warn('[botmeter] Reporting failed; event id:',event.id);
  return false;
}
async function monitoredFetch(url,options){
  if(!String(url).startsWith('https://api.openai.com/v1/')||!process.env.BOTMETER_URL||!process.env.BOTMETER_INGEST_KEY)return originalFetch(url,options);
  const started=Date.now(),id=randomUUID(),payload=requestPayload(options?.body);
  let response;
  try{response=await originalFetch(url,options);}catch(error){try{await deliver('ingest',eventFor(String(url),payload,null,started,id,error));}catch{}throw error;}
  try{
    const data=await response.clone().json().catch(()=>({}));
    const event=eventFor(String(url),payload,data,started,id,response.ok?null:new Error(data?.error?.message||'Provider HTTP '+response.status));
    if(event.kind==='image'&&context.getStore())context.getStore().lastImageId=id;
    await deliver('ingest',event);
  }catch{console.warn('[botmeter] Could not prepare usage report');}
  return response;
}
async function attachImageResponse(response){
  const id=context.getStore()?.lastImageId;
  if(!id)return;
  try{const data=await response.clone().json();const imageUrls=(data.attachments||[]).map(a=>a.url).filter(u=>typeof u==='string'&&u.startsWith('https://')).slice(0,10);if(imageUrls.length)await deliver('attach',{id,bot:BOT,imageUrls});}catch{}
}
module.exports={withTelemetry,setCommand,monitoredFetch,attachImageResponse,eventFor};

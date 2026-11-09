import {writeFileSync} from 'node:fs';
const target=(await(await fetch('http://127.0.0.1:51906/json')).json()).find(x=>x.type==='page');
const ws=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
let next=0;const pending=new Map();export const events=[];
ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.method)events.push(m);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(Error(JSON.stringify(m.error)));else p.resolve(m.result);}};
export async function cdp(method,params={}){const id=++next;const result=new Promise((resolve,reject)=>pending.set(id,{resolve,reject}));ws.send(JSON.stringify({id,method,params}));return result;}
export async function evaluate(expression){const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
export function close(){ws.close();}
if(process.argv[1]===import.meta.filename){try{const value=await evaluate(process.argv[2]);if(process.argv[3])writeFileSync(new URL(process.argv[3],import.meta.url),JSON.stringify(value,null,2)+'\n');console.log(JSON.stringify(value,null,2));}finally{close();}}

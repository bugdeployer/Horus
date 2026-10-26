import {Recorder} from '../../packages/sdk-javascript/src/node.js';
import {readFileSync} from 'node:fs';
const config=JSON.parse(readFileSync(0,'utf8')||'{}');
const recorder=new Recorder('checkout-javascript',{label:'JavaScript checkout',...config});
await recorder.addSource('checkout.js',{file:'runtime-js.mjs',content:readFileSync(new URL(import.meta.url),'utf8')});
const normalize=recorder.observe('checkout.normalize',async(order,faulty)=>{
  await Promise.resolve();
  recorder.checkpoint('order',order);
  const result={...order,quantity:Number(order.quantity),currency:faulty?'USD':order.currency};
  recorder.checkpoint('order',result);
  recorder.expect('currency preserved',result.currency===order.currency,result.currency,order.currency);
  return result;
},{source_id:'checkout.js'});
class Checkout{processed=0;submit(order,reject){if(reject)throw new Error('Synthetic upstream rejection');this.processed++;return {status:'accepted',amount:order.quantity*1250,currency:order.currency};}}
Checkout.prototype.submit=recorder.observe('Checkout.submit',Checkout.prototype.submit,{class_name:'Checkout',fields:['processed'],source_id:'checkout.js'});
for(const [name,faulty,reject] of [['success',false,false],['transformed',true,false],['upstream_failure',false,true]]){
  try{await recorder.trace(`checkout.${name}`,async()=>new Checkout().submit(await normalize({id:'js-17',quantity:'2',currency:'SGD',authorization:'synthetic-private-value'},faulty),reject));}catch{}
}
process.stdout.write(JSON.stringify(recorder.export()));

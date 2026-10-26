import {Recorder} from '../../packages/sdk-javascript/src/node.js';
import {readFileSync} from 'node:fs';
type Order={id:string;quantity:string|number;currency:string;authorization?:string};
const config=JSON.parse(readFileSync(0,'utf8')||'{}');
const recorder=new Recorder('checkout-typescript',{label:'TypeScript checkout',...config});
await recorder.addSource('checkout.ts',{file:'runtime-ts.mts',content:readFileSync(new URL(import.meta.url),'utf8')});
const normalize=recorder.observe('checkout.normalize',async(order:Order,faulty:boolean):Promise<Order>=>{
  await Promise.resolve();
  recorder.checkpoint('order',order);
  const result:Order={...order,quantity:Number(order.quantity),currency:faulty?'USD':order.currency};
  recorder.checkpoint('order',result);
  recorder.expect('currency preserved',result.currency===order.currency,result.currency,order.currency);
  return result;
},{source_id:'checkout.ts'});
class Checkout{
  processed=0;
  submit(order:Order,reject:boolean){if(reject)throw new Error('Synthetic upstream rejection');this.processed++;return {status:'accepted',amount:Number(order.quantity)*1250,currency:order.currency};}
}
Checkout.prototype.submit=recorder.observe('Checkout.submit',Checkout.prototype.submit,{class_name:'Checkout',fields:['processed'],source_id:'checkout.ts'});
for(const [name,faulty,reject] of [['success',false,false],['transformed',true,false],['upstream_failure',false,true]] as const){
  try{await recorder.trace(`checkout.${name}`,async()=>new Checkout().submit(await normalize({id:'ts-17',quantity:'2',currency:'SGD',authorization:'synthetic-private-value'},faulty),reject));}catch{}
}
process.stdout.write(JSON.stringify(recorder.export()));

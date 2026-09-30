const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function page(search='') {
 const elements=new Map();
 const element=id=>{if(!elements.has(id))elements.set(id,{value:'',hidden:false,disabled:false,dataset:{},classList:{toggle(){},remove(){}},addEventListener(){},focus(){},querySelector(){return {innerHTML:''};}});return elements.get(id);};
 let callback;
 const auth={onAuthStateChange(fn){callback=fn;},getSession:async()=>({data:{session:{user:{email:'qa@example.invalid'}}}})};
 const context={window:{location:{search,origin:'https://beta.weotzi.com'},ConfigManager:{getSupabaseClient:()=>({auth})}},document:{readyState:'complete',getElementById:element,querySelectorAll:()=>[]},URLSearchParams,console,setInterval,clearInterval};
 vm.runInNewContext(fs.readFileSync('public/shared/js/recover.js','utf8'),context);
 return {element,event:(name,session)=>callback(name,session)};
}
test('ordinary authenticated sessions remain on recovery email step',()=>{
 const p=page();p.event('SIGNED_IN',{user:{email:'qa@example.invalid'}});
 assert.equal(p.element('rc-view-password').hidden,true);
});
test('verified recovery event opens password step',()=>{
 const p=page();p.event('PASSWORD_RECOVERY',{user:{email:'qa@example.invalid'}});
 assert.equal(p.element('rc-view-password').hidden,false);
 assert.equal(p.element('rc-view-email').hidden,true);
});
test('explicit recovery return waits for a recovered session',async()=>{
 const p=page('?recovery=1');await Promise.resolve();
 assert.equal(p.element('rc-view-password').hidden,false);
});

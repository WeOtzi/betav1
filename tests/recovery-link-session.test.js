const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const tick=()=>new Promise(r=>setImmediate(r));
// acceso (ACC-05): init es asíncrono (espera ConfigManager.ready()); los
// tests esperan a que termine antes de disparar eventos de Auth.
function page(search='',opts={}) {
 const elements=new Map();
 const element=id=>{if(!elements.has(id))elements.set(id,{value:'',hidden:false,disabled:false,dataset:{},textContent:'',classList:{toggle(){},remove(){}},addEventListener(){},focus(){},querySelector(){return {innerHTML:''};}});return elements.get(id);};
 let callback;
 const auth={onAuthStateChange(fn){callback=fn;},getSession:async()=>({data:{session:{user:{email:'qa@example.invalid'}}}})};
 const ConfigManager=opts.ConfigManager||{getSupabaseClient:()=>({auth})};
 const context={window:{location:{search,hash:opts.hash||'',origin:'https://beta.weotzi.com'},ConfigManager,WeotziEmailConfirm:opts.EC},document:{readyState:'complete',getElementById:element,querySelectorAll:()=>[]},URLSearchParams,console,setInterval,clearInterval,setTimeout,clearTimeout,Promise};
 vm.runInNewContext(fs.readFileSync('public/shared/js/recover.js','utf8'),context);
 return {element,auth,event:(name,session)=>callback(name,session),hasCallback:()=>typeof callback==='function'};
}
test('ordinary authenticated sessions remain on recovery email step',async()=>{
 const p=page();await tick();p.event('SIGNED_IN',{user:{email:'qa@example.invalid'}});
 assert.equal(p.element('rc-view-password').hidden,true);
});
test('verified recovery event opens password step',async()=>{
 const p=page();await tick();p.event('PASSWORD_RECOVERY',{user:{email:'qa@example.invalid'}});
 assert.equal(p.element('rc-view-password').hidden,false);
 assert.equal(p.element('rc-view-email').hidden,true);
});
test('explicit recovery return waits for a recovered session',async()=>{
 const p=page('?recovery=1');await tick();await tick();
 assert.equal(p.element('rc-view-password').hidden,false);
});
test('ACC-05: el cliente de Supabase llega recién cuando ConfigManager.ready() resuelve',async()=>{
 let ready=false,release;
 const auth={onAuthStateChange(){},getSession:async()=>({data:{session:{user:{email:'qa@example.invalid'}}}})};
 const ConfigManager={ready:()=>new Promise(r=>{release=()=>{ready=true;r();};}),getSupabaseClient:()=>ready?{auth}:null};
 const p=page('?recovery=1',{ConfigManager});
 await tick();
 assert.equal(p.element('rc-view-password').hidden,true,'todavía en el paso 1 mientras carga la config');
 release();await tick();await tick();
 assert.equal(p.element('rc-view-password').hidden,false,'con la config lista abre el paso 3');
});
test('ACC-05: el link con #type=recovery (sin ?recovery=1) también abre el paso 3',async()=>{
 const p=page('',{hash:'#access_token=x&type=recovery'});await tick();await tick();
 assert.equal(p.element('rc-view-password').hidden,false);
});
test('ACC-17: link vencido → aviso y se queda en el paso 1, sin pedir sesión',async()=>{
 let rendered=null;
 const EC={readAuthLinkError:()=>({error:'access_denied',code:'otp_expired',expired:true}),renderLinkErrorNotice:(box,o)=>{rendered=o;box.hidden=false;}};
 const p=page('?recovery=1',{EC});await tick();await tick();
 assert.equal(p.element('rc-view-password').hidden,true);
 assert.equal(p.element('rc-link-notice').hidden,false);
 assert.equal(rendered.linkError.code,'otp_expired');
 assert.equal(p.hasCallback(),false,'no escucha eventos de recuperación con un link inválido');
});

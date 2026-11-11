const test=require('node:test');
const {gateway}=require('../scripts/release/preview-server.cjs'); const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');
test('permanent preview keeps root routes and follows the verified release map',async()=>{
const root=fs.mkdtempSync(path.join(os.tmpdir(),'valen-root-test-')); const dir=path.join(root,'releases','test');
fs.mkdirSync(path.join(dir,'public','inicio'),{recursive:true});fs.mkdirSync(path.join(dir,'public','shared/js'),{recursive:true}); fs.mkdirSync(path.join(root,'control'));
fs.writeFileSync(path.join(dir,'public/inicio/index.html'),'<html><head></head><body><a href="/artist/login/">Entrar</a></body></html>');
fs.writeFileSync(path.join(dir,'public/shared/js/app-config.json'),'{}');
fs.writeFileSync(path.join(root,'control/root-preview.json'),JSON.stringify({ref:'valentina/rediseno-laura'}));
const target='preview-valentina-rediseno-laura-12345678'; const entry={directory:dir,ref:'valentina/rediseno-laura',commit:'abc',version:'2.2.2'};
const mapFile=path.join(root,'preview-map.json');fs.writeFileSync(mapFile,JSON.stringify({[target]:entry}));
const server=gateway({stateRoot:root});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
try {
let r=await fetch(base+'/',{redirect:'manual'});assert.equal(r.headers.get('location'),'/inicio/');
r=await fetch(base+'/inicio',{redirect:'manual'});assert.equal(r.headers.get('location'),'/inicio/');
r=await fetch(base+'/inicio/',{headers:{cookie:'weotzi_preview_target=preview-old'}});let body=await r.text();assert.equal(r.status,200);assert(body.includes('window.WEOTZI_BASE_PATH=""'));assert(body.includes('href="/artist/login/"'));assert(body.includes('<base href="/inicio/">'));
r=await fetch(base+'/api/release');assert.equal((await r.json()).commit,'abc');
entry.commit='next';fs.writeFileSync(mapFile,JSON.stringify({[target]:entry}));r=await fetch(base+'/api/release');assert.equal((await r.json()).commit,'next');
r=await fetch(base+'/api/example',{method:'POST'});assert.equal(r.status,403);
r=await fetch(base+'/.env');assert.equal(r.status,404);
r=await fetch(base+'/preview/'+target+'/inicio/');assert((await r.text()).includes('window.WEOTZI_BASE_PATH="/preview/'+target+'"'));
r=await fetch(base+'/__preview/branches');assert((await r.text()).includes('Previews de desarrollo'));
fs.writeFileSync(mapFile,'{}');r=await fetch(base+'/inicio/');assert.equal(r.status,503);
console.log('PASS: root, slash, assets/navigation prefix, release, dynamic CI map, POST blocked, private files, legacy preview, branch index, missing branch');
}finally{await new Promise(r=>server.close(r));}
});

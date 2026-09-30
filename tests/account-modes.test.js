'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {activate,registerTestClient,clientProfile,canClaimByEmail}=require('../services/account-modes');
function response(){return {code:200,status(n){this.code=n;return this;},json(body){this.body=body;return this;}};}
test('profile identity comes from verified session, test email is not considered verified',()=>{
 const p=clientProfile({id:'session-id',email:'qa@example.test',raw:{email_confirmed_at:'now',app_metadata:{qa_unverified_email:true},user_metadata:{full_name:'QA'}}});
 assert.equal(p.user_id,'session-id');assert.equal(p.email_verified,false);
});
test('unverified test email cannot claim old guest quotations or another client record',()=>{
 const q={client_email:'qa@example.test',client_user_id:null};
 assert.equal(canClaimByEmail({email:q.client_email,raw:{app_metadata:{qa_unverified_email:true}}},q),false);
 assert.equal(canClaimByEmail({email:q.client_email,raw:{}},{...q,client_user_id:'other'}),false);
 assert.equal(canClaimByEmail({email:'QA@example.test',raw:{}},q),true);
});
test('changing mode requires a session',async()=>{
 const r=response();await activate({headers:{},body:{mode:'client',user_id:'victim'}},r);assert.equal(r.code,401);
});
test('test registration is disabled unless explicitly enabled',async()=>{
 const old=process.env.AUDIT_REGISTRATION_OPEN;delete process.env.AUDIT_REGISTRATION_OPEN;
 try{const r=response();await registerTestClient({body:{}},r);assert.equal(r.code,403);}finally{if(old!==undefined)process.env.AUDIT_REGISTRATION_OPEN=old;}
});
test('test registration still validates password and email syntax',async()=>{
 const old=process.env.AUDIT_REGISTRATION_OPEN;process.env.AUDIT_REGISTRATION_OPEN='true';
 try{const r=response();await registerTestClient({body:{email:'not-an-email',password:'123',full_name:'QA'}},r);assert.equal(r.code,400);}finally{if(old===undefined)delete process.env.AUDIT_REGISTRATION_OPEN;else process.env.AUDIT_REGISTRATION_OPEN=old;}
});

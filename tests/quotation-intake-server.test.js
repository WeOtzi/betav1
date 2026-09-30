const test = require('node:test');
const assert = require('node:assert/strict');
const {normalizeIntake} = require('../services/quotation-intake');
const key = '315fdf41-68c3-451c-8dc2-931c3cc035da';
const artist = {user_id:'artist-user',username:'real.wo',name:'Real',email:'artist@example.test',registration_status:'pendiente de validacion'};
const body = () => ({submission_key:key,mode:'submit',quotation:{artist_id:'artist-user',client_full_name:'QA',client_email:'qa@example.test',tattoo_idea_description:'Idea',tattoo_style:{style_name:'Realismo'},tattoo_body_part:'Brazo',tattoo_size:'Mediano'}});
test('el servidor deriva artista y estado sin confiar en destinatario ni propietario del navegador', () => {
 const b=body(); Object.assign(b.quotation,{artist_email:'override@example.test',quote_status:'completed',client_user_id:'other',artist_budget_amount:999});
 const {q}=normalizeIntake(b,{id:'session-user',email:'qa@example.test'},artist);
 assert.equal(q.artist_email,artist.email); assert.equal(q.quote_status,'pending'); assert.equal(q.client_user_id,'session-user'); assert.equal(q.artist_budget_amount,undefined);
});
test('un visitante no puede vincular una cotización a una cuenta ajena',()=>{
 const {q}=normalizeIntake(body(),{id:'other-user',email:'other@example.test'},artist);
 assert.equal(q.client_user_id,null);
});
test('la clave de reintento produce un id estable y no expone la clave',()=>{
 const a=normalizeIntake(body(),null,artist).q;const b=body(); b.mode='draft';
 assert.equal(a.quote_id,normalizeIntake(b,null,artist).q.quote_id);
 assert.match(a.quote_id,/^QN[0-9a-f]{32}$/);assert.ok(!a.quote_id.includes(key));
});
test('no se aceptan ids elegidos, artistas incompletos ni solicitudes finales vacías',()=>{
 assert.throws(()=>normalizeIntake({...body(),submission_key:'QN48159'},null,artist));
 assert.throws(()=>normalizeIntake(body(),null,{...artist,registration_status:'incompleto'}));
 assert.throws(()=>normalizeIntake({...body(),quotation:{}},null,null));
});
test('el borrador permite avanzar sin datos completos y normaliza extras',()=>{
 const {q,extras}=normalizeIntake({submission_key:key,mode:'draft',extras:{idea_mode:'explorar',personalization_level:'interpretacion',reference_notes:['nota']}},null,null);
 assert.equal(q.quote_status,'in_progress');assert.equal(extras.idea_mode,'explorar');assert.deepEqual(extras.reference_notes,['nota']);
});

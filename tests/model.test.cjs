const { test } = require('node:test');
const assert = require('node:assert/strict');
const m = require('../web/model.js');
function storage(value = null) { return { getItem: () => value, setItem: (_, v) => { value = v; } }; }
test('first run has Plex/YouTube, saved empty remains empty across restart', () => {
 const s = storage(); assert.deepEqual(m.load(s).apps, m.defaults);
 m.save(s, []); assert.deepEqual(m.load(s).apps, []);
});
test('selection and reordered IDs survive serialization; duplicate IDs collapse', () => {
 const s = storage(), a = m.defaults.concat({ id: 'third.app', name: 'Third' });
 m.save(s, m.move(a, 2, 0).concat(a[2]));
 assert.deepEqual(m.load(s).apps.map(a => a.id), ['third.app', ...m.defaults.map(a => a.id)]);
});
test('moving clamps at boundaries without mutating the source', () => {
 const a = m.defaults.slice(); assert.deepEqual(m.move(a, 0, -1), a); assert.deepEqual(m.move(a, 1, 2), a);
 assert.deepEqual(m.move(a, 1, 0), a.slice().reverse()); assert.deepEqual(a, m.defaults);
});
test('invalid JSON, schema and unreadable storage recover with a warning', () => {
 for (const raw of ['{', '{}', '{"version":2,"apps":[]}']) {
  assert.deepEqual(m.load(storage(raw)).apps, m.defaults); assert.ok(m.load(storage(raw)).warning);
 }
 assert.ok(m.load({getItem(){throw Error('Denied');}}).warning);
});
test('save failure propagates and cannot mutate the caller’s current list', () => {
 const original = m.defaults.slice(); assert.throws(() => m.save({setItem(){throw Error('Full');}}, m.move(original, 1, 0)), /Full/);
 assert.deepEqual(original, m.defaults);
});
test('Samsung Home and self cannot become editable shortcuts', () => {
 assert.deepEqual(m.clean([{id:m.HOME,name:'Home'},{id:m.SELF,name:'Self'}]), []);
});
test('remote navigation clamps ragged grids, footer and list boundaries', () => {
 assert.deepEqual(m.navigate([3,2,2],0,2,'ArrowDown'),[1,1]);
 assert.deepEqual(m.navigate([3,2,2],2,1,'ArrowDown'),[2,1]);
 assert.deepEqual(m.navigate([2],0,0,'ArrowLeft'),[0,0]);
 assert.deepEqual(m.navigate([2,1,1],1,0,'ArrowUp'),[0,0]);
});

test('bad saved entries do not replace valid favorites on the next edit', () => {
 const good = [{id:'one.app',name:'One'},{id:'two.app',name:'Two'}];
 for (const bad of [null, {id:'http://invalid',name:'Bad'}, {id:'empty',name:''}]) {
  const raw=JSON.stringify({version:1,apps:[good[0],bad,good[1]]}), s=storage(raw);
  const loaded=m.load(s);assert.deepEqual(loaded.apps,good);assert.ok(loaded.warning);
  assert.equal(s.getItem(),raw,'loading must not rewrite storage');
  m.save(s,m.move(loaded.apps,0,1));assert.deepEqual(m.load(s).apps,[good[1],good[0]]);
 }
 assert.deepEqual(m.load(storage(JSON.stringify({version:1,apps:[null]}))).apps,[]);
});

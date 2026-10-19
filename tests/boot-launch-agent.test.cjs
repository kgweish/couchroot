'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createBootLaunch}=require('../research/autonomous-root/service/policy');
const {config}=require('../research/autonomous-root/service/policy');
function output(fg='',uptime=40,claimed=false){return {exit_code:0,stdout:`UPTIME:${uptime}\nmemory/appfw/current_fullscreen_appid, value = ${fg} (String)\n${claimed?'CLAIMED\n':''}`};}
function fixture(responses,enabled=true){const calls=[];const a={status:()=>({connected:true}),execute:async command=>{calls.push(command);const r=responses.shift();if(r instanceof Error)throw r;return r;}};return {calls,b:createBootLaunch(a,enabled)};}
test('disabled by default performs no command',async()=>{const {calls,b}=fixture([],false);await b.tick();assert.equal(calls.length,0);});
test('respects user app and late startup',async()=>{for(const r of [output('com.example.player'),output('',111)]){const {calls,b}=fixture([r]);await b.tick();await b.tick();assert.equal(calls.length,1);}});
test('lost launch response is never replayed',async()=>{const {calls,b}=fixture([output(),new Error('disconnect')]);await b.tick();await b.tick();assert.equal(calls.length,2);assert.equal(b.status(),'launch-uncertain');});
test('persistent boot claim prevents repeated launch after service restart',async()=>{const {calls,b}=fixture([output('',40,true)]);await b.tick();assert.equal(calls.length,1);assert.equal(b.status(),'previous-attempt');});
test('accepted relay request still requires Hub foreground',async()=>{const {calls,b}=fixture([output(),{exit_code:0},output('MiniHub001.Hub')]);await b.tick();assert.equal(b.status(),'waiting-foreground');await b.tick();assert.equal(b.status(),'foreground-confirmed');assert.equal(calls.length,3);});
test('boot launcher cannot be enabled on S90D',()=>assert.throws(()=>config({device:'s90d',boot_launcher:true}),/QN90A-only/));
test('connected but unvalidated worker does not consume boot-launch attempt',async()=>{
 let ready=false,calls=0;
 const agent={status:()=>({connected:true,worker_ready:ready}),execute:async()=>{calls++;return output('com.example.player');}};
 const boot=createBootLaunch(agent,true);await boot.tick();assert.equal(calls,0);assert.equal(boot.status(),'waiting-agent');
 ready=true;await boot.tick();assert.equal(calls,1);assert.equal(boot.status(),'other-app');
});

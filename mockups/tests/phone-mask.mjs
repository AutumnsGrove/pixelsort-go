import { chromium, mock, shared } from './lib.mjs';
const b = await chromium.launch(); const errs=[]; const fails=[]; const ok=(c,m)=>{ if(!c) fails.push(m); else console.log('  ok  '+m) };
const p = await b.newPage({ viewport: { width: 900, height: 900 } });
p.on('pageerror',e=>errs.push('PAGEERR '+e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
await p.goto(mock('phone.html?tab=protect&big')); await p.waitForTimeout(900);
const st = ()=>p.evaluate(()=>{const m=__mock.mask();let n=0,sx=0;for(let i=0;i<m.length;i++)if(m[i]){n++;sx+=i%480}return {n,cx:n?sx/n:0,objs:__mock.ed.objects.map(o=>({cx:o.cx,w:o.w,rot:o.rot,mode:o.mode,kind:o.kind}))}});
await p.click('#mAdd .shpchip >> nth=2'); await p.waitForTimeout(600);   // a star
let a=await st(); ok(a.objs.length===1&&a.objs[0].kind==='poly'&&a.n>0,'a starter shape can be added from the phone sheet ('+a.n+' px)');
ok(await p.locator('#mSelBox').isVisible(),'the selected-shape controls appear');
const body=await p.locator('.medit g[data-obj] path').first().boundingBox();
await p.mouse.move(body.x+body.width/2,body.y+body.height/2); await p.mouse.down(); await p.mouse.move(body.x+body.width/2+50,body.y+body.height/2,{steps:6}); await p.mouse.up(); await p.waitForTimeout(500);
let b2=await st(); ok(b2.cx>a.cx+15,'dragging the shape on the little picture moves it ('+Math.round(a.cx)+'→'+Math.round(b2.cx)+')');
await p.fill('#sMs','60'); await p.dispatchEvent('#sMs','input'); await p.dispatchEvent('#sMs','change'); await p.waitForTimeout(500);
let c=await st(); ok(c.n>b2.n*1.5,'the Size slider scales it ('+b2.n+' → '+c.n+')');
await p.fill('#sMr','45'); await p.dispatchEvent('#sMr','input'); await p.dispatchEvent('#sMr','change'); await p.waitForTimeout(400);
ok(Math.round((await st()).objs[0].rot)===45,'the Turn slider rotates it');
await p.click('#mModeBtn'); await p.waitForTimeout(400); ok((await st()).objs[0].mode==='cut' && (await st()).n===0,'Freeze ⇄ Hole toggles it ('+(await st()).n+' px protected now)');
await p.click('#mModeBtn'); await p.waitForTimeout(300);
await p.click('#mDup'); await p.waitForTimeout(300); ok((await st()).objs.length===2,'Duplicate works');
await p.click('#mDel'); await p.waitForTimeout(300); ok((await st()).objs.length===1,'Delete works');
// paint + snap
await p.evaluate(()=>__mock.ed.clear()); await p.click('#mMode [data-v="paint"]'); await p.waitForTimeout(200);
const fr=await p.locator('#ov').boundingBox(); const cx=fr.x+fr.width*.45, cy=fr.y+fr.height*.5, rr=fr.height*.28;
await p.mouse.move(cx+rr,cy); await p.mouse.down(); for(let i=0;i<=44;i++){const t=i/44*Math.PI*2; await p.mouse.move(cx+Math.cos(t)*rr,cy+Math.sin(t)*rr)} await p.mouse.up(); await p.waitForTimeout(500);
ok(await p.locator('#snap.on').count()===1,'a painted loop offers "Snap" on the phone too');
await p.click('#snapGo'); await p.waitForTimeout(600); const s=await st(); ok(s.objs.length===1&&s.objs[0].kind==='ellipse','Snap produces an editable ellipse on the phone');
console.log(fails.length?'\nFAILURES:\n'+fails.join('\n'):'\nPHONE MASK CHECKS PASSED'); console.log(errs.join('\n')||'no page errors'); if (fails.length || errs.length) process.exitCode = 1; await b.close();

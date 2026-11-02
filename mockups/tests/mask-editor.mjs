import { chromium, mock, shared } from './lib.mjs';
const b = await chromium.launch(); const errs=[]; const fails=[]; const ok=(c,m)=>{ if(!c) fails.push(m); else console.log('  ok  '+m) };
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
p.on('pageerror',e=>errs.push('PAGEERR '+e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
await p.goto(mock('studio.html?pro')); await p.waitForTimeout(900);
const st = ()=>p.evaluate(()=>{const m=__mock.mask();let n=0,sx=0,sy=0;for(let i=0;i<m.length;i++)if(m[i]){n++;sx+=i%640;sy+=(i/640)|0}return {n,cx:n?sx/n:0,cy:n?sy/n:0,objs:__mock.ed.objects.map(o=>({id:o.id,cx:o.cx,cy:o.cy,w:o.w,h:o.h,rot:o.rot,mode:o.mode,name:o.name})),sel:__mock.ed.sel,frozen:document.querySelector('#rFz').textContent}});
const box = async(sel)=>p.locator(sel).first().boundingBox();
// 1 add an ellipse from the panel
await p.locator('#mAdd').scrollIntoViewIfNeeded(); await p.click('#mAdd .shp >> nth=0'); await p.waitForTimeout(500);
let a = await st(); ok(a.objs.length===1 && a.n>0, 'adding an ellipse puts a shape on the picture ('+a.n+' px protected)');
ok(await p.locator('#mSel input[data-m="w"]').inputValue()==='30', 'selected-shape card shows its width (30%)');
// 2 drag the body
const body = await box('.medit g[data-obj] ellipse'); 
await p.mouse.move(body.x+body.width/2, body.y+body.height/2); await p.mouse.down(); await p.mouse.move(body.x+body.width/2+160, body.y+body.height/2-40,{steps:8}); await p.mouse.up(); await p.waitForTimeout(500);
let b2 = await st(); ok(b2.cx>a.cx+60 && b2.cy<a.cy-10, 'dragging moves the protected area (centroid '+Math.round(a.cx)+'→'+Math.round(b2.cx)+' px)');
ok(Math.abs(b2.n-a.n)<a.n*0.04, 'moving keeps the same size');
// 3 resize with the SE handle
const hs = await p.$$('.medit rect[data-obj][style*="resize"]'); ok(hs.length===8,'8 resize handles are shown');
const se = await p.locator('.medit rect[style*="nwse-resize"]').nth(1).boundingBox(); // bottom-right
await p.mouse.move(se.x+se.width/2, se.y+se.height/2); await p.mouse.down(); await p.mouse.move(se.x+se.width/2+80, se.y+se.height/2+60,{steps:8}); await p.mouse.up(); await p.waitForTimeout(500);
let c = await st(); ok(c.n>b2.n*1.3 && c.objs[0].w>b2.objs[0].w, 'dragging a corner resizes ('+b2.n+' → '+c.n+' px)');
// 4 rotate: use a rectangle so rotation changes the mask shape; first type numbers
await p.fill('#mSel input[data-m="rot"]','40'); await p.dispatchEvent('#mSel input[data-m="rot"]','change'); await p.waitForTimeout(400);
let r = await st(); ok(Math.round(r.objs[0].rot)===40,'typing a turn angle rotates the shape (40°)');
const rh = await p.locator('.medit circle[style*="grab"]').boundingBox();
const o = r.objs[0]; const fb = await box('.frame'); const cxp = fb.x+o.cx*fb.width, cyp = fb.y+o.cy*fb.height;
await p.mouse.move(rh.x+rh.width/2, rh.y+rh.height/2); await p.mouse.down(); await p.mouse.move(cxp+120, cyp,{steps:10}); await p.mouse.up(); await p.waitForTimeout(400);
r = await st(); ok(Math.abs(r.objs[0].rot-90)<6,'dragging the rotate handle turns it (≈'+Math.round(r.objs[0].rot)+'°)');
// 5 numeric size
await p.fill('#mSel input[data-m="w"]','50'); await p.dispatchEvent('#mSel input[data-m="w"]','change'); await p.waitForTimeout(400);
let w = await st(); ok(Math.round(w.objs[0].w*100)===50,'typing a width sets it exactly (50%)');
// 6 cut a hole with a second shape
const beforeHole = (await st()).n;
await p.click('#mAdd .shp >> nth=0'); await p.waitForTimeout(400);
await p.click('#mSel .mini[data-m="mode"] button[data-v="cut"]'); await p.waitForTimeout(500);
const o2 = (await st()); const afterHole = o2.n; 
await p.fill('#mSel input[data-m="x"]', String(Math.round(w.objs[0].cx*100))); await p.fill('#mSel input[data-m="y"]', String(Math.round(w.objs[0].cy*100)));
await p.dispatchEvent('#mSel input[data-m="y"]','change'); await p.waitForTimeout(500);
const holed = await st(); ok(holed.n < beforeHole-300, 'a "cut a hole" shape removes protection ('+beforeHole+' → '+holed.n+' px)');
// 7 invert
const preInv = (await st()).n; await p.click('#invTog'); await p.waitForTimeout(500); const inv=(await st()).n;
ok(Math.abs((preInv+inv)-640*400)<5,'invert flips the protected area ('+preInv+' ↔ '+inv+')'); await p.click('#invTog'); await p.waitForTimeout(300);
// 8 delete via keyboard, list reflects it
const nObj = (await st()).objs.length; await p.locator('.frame').click({position:{x:5,y:5}});
await p.click('#mList .mi >> nth=0'); await p.waitForTimeout(200); await p.keyboard.press('Delete'); await p.waitForTimeout(400);
ok((await st()).objs.length===nObj-1,'Delete key removes the selected shape');
// 9 clear all, brightest spot
await p.click('#mClearObjs'); await p.waitForTimeout(300); ok((await st()).objs.length===0 && (await st()).n===0,'remove all clears every shape');
await p.click('#pDemo'); await p.waitForTimeout(600); const bs = await st(); const sunY = bs.objs[0].cy;
ok(bs.objs.length===1 && bs.objs[0].name==='Brightest spot' && bs.n>2000 && sunY>0.4 && sunY<0.7,'"Freeze the brightest spot" places an editable shape on the sun ('+Math.round(bs.objs[0].cx*100)+'%, '+Math.round(sunY*100)+'%)');
// and it can be moved afterwards (the thing that was missing)
const sb = await box('.medit g[data-obj] ellipse'); await p.mouse.move(sb.x+sb.width/2, sb.y+sb.height/2); await p.mouse.down(); await p.mouse.move(sb.x+sb.width/2-150, sb.y+sb.height/2+30,{steps:8}); await p.mouse.up(); await p.waitForTimeout(400);
ok((await st()).objs[0].cx < bs.objs[0].cx-0.1,'…and the brightest-spot shape can be dragged afterwards');
// 10 draw a loop with the brush -> snap -> editable shape
await p.click('#mClearObjs').catch(()=>{}); await p.click('#paint'); await p.waitForTimeout(200);
const fr = await box('.frame'); const cx=fr.x+fr.width*.35, cy=fr.y+fr.height*.55, rr=fr.height*.2;
await p.mouse.move(cx+rr,cy); await p.mouse.down(); for(let i=0;i<=44;i++){const t=i/44*Math.PI*2; await p.mouse.move(cx+Math.cos(t)*rr, cy+Math.sin(t)*rr);} await p.mouse.up(); await p.waitForTimeout(600);
ok(await p.locator('#snapChip.on').count()===1,'drawing a loop offers "Looks like a circle · Snap"');
await p.click('#snapGo'); await p.waitForTimeout(700); const sn = await st();
ok(sn.objs.length===1 && sn.objs[0].kind==='ellipse' || sn.objs[0].name.indexOf('Ellipse')===0, 'Snap turns the loop into an editable ellipse');
const brushLeft = await p.evaluate(()=>{let n=0;const b=__mock.brush();for(let i=0;i<b.length;i++)n+=b[i];return n}); ok(brushLeft===0,'…and the freehand stroke is replaced, not doubled');
console.log(fails.length? '\nFAILURES:\n'+fails.join('\n') : '\nALL MASK-EDITOR CHECKS PASSED'); console.log(errs.join('\n')||'no page errors'); if (fails.length || errs.length) process.exitCode = 1; await b.close();

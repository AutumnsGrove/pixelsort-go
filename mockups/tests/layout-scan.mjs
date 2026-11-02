import { chromium, mock, shared } from './lib.mjs';
const b = await chromium.launch(); const errs=[];
const pages=[['studio.html',''],['studio.html','?empty'],['gallery.html',''],['gallery.html','?viewer'],['gallery.html','?share'],['gallery.html','?albums'],['share.html',''],['index.html','']];
const sizes=[[840,627],[1024,720],[1920,1080],[390,844]];
for (const [f,q] of pages) for (const [w,h] of sizes) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  p.on('pageerror',e=>errs.push(f+q+' '+e.message));
  await p.goto(mock(f+q)); await p.waitForTimeout(1200);
  const r = await p.evaluate(()=>{
    const vw=innerWidth, vh=innerHeight, out=[];
    const doc=document.documentElement;
    if(doc.scrollWidth>vw+1) out.push('PAGE scrolls horizontally ('+doc.scrollWidth+'>'+vw+')');
    // elements that are visible, fixed/absolute-positioned UI cut off by the viewport
    document.querySelectorAll('.dock,.top,.links,.read,.icard,.modal,.slate,.side,.frame,.vstage img,.usage,.hero h1,.tabbar,.grid,.card,.stage img').forEach(e=>{
      const cs=getComputedStyle(e); if(cs.display==='none'||cs.visibility==='hidden')return; const r=e.getBoundingClientRect(); if(!r.width)return;
      if(r.left<-2||r.right>vw+2) out.push((e.className||e.tagName).toString().split(' ')[0]+' x:'+Math.round(r.left)+'→'+Math.round(r.right)+' (vw '+vw+')');
    });
    // overlap check: top bar links vs read
    const a=document.querySelector('.read'), l=document.querySelector('.links');
    if(a&&l&&getComputedStyle(a).display!=='none'){const ra=a.getBoundingClientRect(), rl=l.getBoundingClientRect(); if(ra.right>rl.left-8) out.push('top bar: readout collides with links');}
    return out;
  });
  if(r.length){ process.exitCode = 1; console.log(`${f}${q} @${w}x${h}: ${r.join(' | ')}`); }
  await p.close();
}
console.log(errs.join('\n')||'-- scan done, no JS errors');
if (errs.length) process.exitCode = 1;
await b.close();

import { chromium, mock, shared } from './lib.mjs';
const b = await chromium.launch(); const p = await b.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto(mock('index.html'));
await p.addScriptTag({ path: shared('demo-engine.js') });
await p.addScriptTag({ path: shared('regions.js') });
const r = await p.evaluate(() => {
  const out = [];
  // starters flatten to real polygons
  Regions.STARTERS.forEach((s,i)=>{ const q=Regions.starterPoly(i); if(!q||q.length<20) out.push('starter '+s.name+' has '+(q&&q.length)+' pts'); });
  // user svg: circle + rect + a star polygon + junk + multi-subpath
  const cases = {
    circle: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>',
    poly: '<svg xmlns="http://www.w3.org/2000/svg"><polygon points="0,0 40,0 20,30"/></svg>',
    multi: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 H20 V20 H0 Z M5 5 H15 V15 H5 Z"/></svg>',
    none: '<svg xmlns="http://www.w3.org/2000/svg"><text>hi</text></svg>',
    broken: '<svg><path'
  };
  const res = {};
  for (const k in cases) { const x = Regions.parseSVG(cases[k]); res[k] = x.error ? 'ERR:'+x.error : 'ok:'+x.info; }
  // property test: custom tiling + per-class cutting modes
  const W=130,H=84; let n=0;
  for (const stagger of [false,true]) for (let si=0; si<Regions.STARTERS.length; si++) for (const pattern of ['checker','thirds']) {
    const c=document.createElement('canvas'); const d=new PixelDemo(c,{w:W,h:H,params:{angle:20,mode:'random',length:10,randomness:10,seed:5}});
    const t=Regions.tessellate(W,H,{shape:'custom',poly:Regions.starterPoly(si),size:30,gap:3,rotate:17,stagger,seed:3});
    if (t.count<3) out.push('custom '+Regions.STARTERS[si].name+' only '+t.count+' cells');
    const cls=Regions.classify(t,pattern,3,9);
    const defs={0:{frozen:true},1:{mode:'threshold',lo:.25,hi:.8,key:'hue',reverse:true},2:{mode:'ca',rule:110,cell:3,angle:100,randomness:30},3:{mode:'wave',length:14,angle:300,reverse:false}};
    d.setRegions({labels:t.labels,classOfCell:cls,defs}); n++;
    const total=d.lineStarts[d.lineStarts.length-1]; const seen=new Uint8Array(W*H); let dup=0;
    for(let i=0;i<total;i++){ if(seen[d.P[i]]++) dup++; }
    let pixels=0; for(let i=0;i<W*H;i++) pixels+=seen[i]; // every pixel appears exactly once
    if (dup||pixels!==W*H) out.push('COVERAGE '+Regions.STARTERS[si].name+' dup='+dup+' covered='+pixels+'/'+W*H);
    d.instant();
    const o=Array.from(d.orig).sort(), m=Array.from(d.px).sort(); for(let i=0;i<o.length;i++) if(o[i]!==m[i]){out.push('PERM');break}
    for(let i=0;i<W*H;i++) if(d.rclass[i]===0 && d.px[i]!==d.orig[i]){out.push('GAP MOVED');break}
    for(let k=0;k<d.ivA.length;k++){ const c0=t.labels[d.P[d.ivA[k]]]; for(let q=d.ivA[k];q<d.ivB[k];q++){ if(t.labels[d.P[q]]!==c0){out.push('CROSS');k=1e9;break} if(q+1<d.ivB[k]&&d.key[d.P[q]]>d.key[d.P[q+1]]){out.push('UNSORTED');k=1e9;break} } }
    const inst=d.px.slice(); d.params.algo='oddeven'; d.reset(); let g=0; while(!d.done&&g++<4000) d.step(); for(let i=0;i<inst.length;i++) if(inst[i]!==d.px[i]){out.push('STEPPER!=INSTANT '+Regions.STARTERS[si].name);break}
  }
  return {out,res,n};
});
console.log(JSON.stringify(r.res,null,1));
console.log(r.out.length? r.out.slice(0,12).join('\n') : 'CUSTOM-SHAPE + PER-CLASS PROPERTIES HOLD ('+r.n+' configurations)');
console.log(errs.join('\n')||'no page errors');
const bad = Object.values(r.res).filter(v => !/^(ok:|ERR:)/.test(v)).length || r.res.circle.startsWith('ERR') || r.res.poly.startsWith('ERR') || !r.res.none.startsWith('ERR') || !r.res.broken.startsWith('ERR');
if (r.out.length || errs.length || bad) process.exitCode = 1;
await b.close();

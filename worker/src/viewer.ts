// The page a friend sees. A server-rendered string, no framework, no third-party requests.
// Every piece of dynamic text goes through escapeHtml; recipes travel in a JSON block that cannot be closed early.

export interface ManifestImage {
	w: number;
	h: number;
	mime: string;
	name?: string;
	recipe?: Record<string, unknown>;
}
export interface Manifest {
	v: 1;
	created: number;
	expires: number | null;
	title?: string;
	images: ManifestImage[];
}

export function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** JSON that is safe inside a JSON script block: every less-than sign becomes the six-character escape for U+003C. */
export function safeJson(v: unknown): string {
	const lt = String.fromCharCode(92) + 'u003c';
	const ls = String.fromCharCode(92) + 'u2028';
	const ps = String.fromCharCode(92) + 'u2029';
	return JSON.stringify(v)
		.replaceAll('<', lt)
		.replaceAll(String.fromCharCode(0x2028), ls)
		.replaceAll(String.fromCharCode(0x2029), ps);
}

export function csp(nonce: string): string {
	return `default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; script-src 'self' 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
}

export function newNonce(): string {
	const b = crypto.getRandomValues(new Uint8Array(16));
	return btoa(String.fromCharCode(...b)).replace(/[^A-Za-z0-9]/g, '');
}

const STYLE = `
:root{--ink:#0b0a0d;--paper:#f2ece4;--dim:#9a9189;--faint:#2a2630;--ver:#ff5a36;--gold:#e8b45a;
--serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;--mono:ui-monospace,"DM Mono",SFMono-Regular,Menlo,Consolas,monospace}
*{box-sizing:border-box}html,body{margin:0}body{background:var(--ink);color:var(--paper);font:12px/1.6 var(--mono);min-height:100vh}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;padding:0}
a{color:inherit}
.top{position:absolute;left:0;right:0;top:0;padding:22px 32px;display:flex;justify-content:space-between;z-index:5}
.word{font:22px var(--serif);text-decoration:none}.word i{color:var(--ver);font-style:normal;font-size:.55em;letter-spacing:2px;margin-left:3px}
.read{display:flex;gap:18px;color:var(--dim);font-size:11px}
.page{display:grid;grid-template-columns:1fr 360px;grid-template-rows:1fr auto;min-height:100vh}
.stage{display:grid;place-items:center;padding:96px 48px 18px;position:relative}
.stage img,.stage video{max-width:100%;max-height:calc(100vh - 250px);box-shadow:0 0 0 1px var(--faint),0 40px 120px rgba(255,90,54,.2),0 20px 60px rgba(0,0,0,.7)}
.nav{position:absolute;top:50%;transform:translateY(-50%);width:50px;height:50px;border:1px solid var(--faint);border-radius:50%;font-size:19px}
.nav.l{left:10px}.nav.r{right:10px}
.cap{position:absolute;left:48px;bottom:-6px;font:italic 17px var(--serif);color:var(--dim)}
.strip{display:flex;gap:14px;justify-content:center;padding:6px 48px 30px;flex-wrap:wrap}
.strip button{opacity:.55}.strip button:hover{opacity:.9}.strip button.on{opacity:1}
.strip img{width:116px;height:72px;object-fit:cover;display:block;box-shadow:0 0 0 1px var(--faint)}
.strip button.on img{outline:2px solid var(--ver);outline-offset:4px}
.side{grid-row:1 / span 2;grid-column:2;border-left:1px solid var(--faint);padding:96px 32px 30px;display:flex;flex-direction:column;gap:22px}
.eyebrow{font-size:10px;letter-spacing:1.6px;text-transform:uppercase;color:var(--dim)}
h1{font:400 46px/.95 var(--serif);margin:8px 0 0;overflow-wrap:anywhere}
.meta{display:grid;grid-template-columns:auto 1fr;gap:7px 18px;font-size:11px}
.meta span:nth-child(odd){color:var(--dim);letter-spacing:1.2px;text-transform:uppercase;font-size:10px}
.acts{display:grid;gap:9px}.row{display:flex;gap:9px;flex-wrap:wrap}
.btn{border:1px solid var(--faint);border-radius:999px;padding:11px 14px;text-align:center;flex:1;text-decoration:none;display:block}
.btn.pri{background:var(--ver);color:var(--ink);border-color:var(--ver)}
.recipe{position:relative;border:1px solid var(--faint);border-radius:6px;padding:16px 16px 12px;font-size:11.5px;line-height:1.85;background:rgba(0,0,0,.25)}
.recipe::before{content:"RECIPE";position:absolute;top:-8px;left:12px;background:var(--ink);padding:0 8px;font-size:9px;letter-spacing:1.6px;color:var(--ver)}
.recipe .rows>div{display:flex;justify-content:space-between;gap:12px}.recipe .rows>div span:first-child{color:var(--dim)}
.recipe button{margin-top:10px;font-size:10px;letter-spacing:1.3px;text-transform:uppercase;color:var(--gold)}
.note{color:var(--dim);font-size:10.5px;line-height:1.75;margin-top:auto}
.toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:var(--paper);color:var(--ink);padding:9px 16px;border-radius:999px;opacity:0;transition:.2s;pointer-events:none}.toast.on{opacity:1}
.gone{min-height:100vh;display:grid;place-items:center;text-align:center;padding:30px}
.gone h1{font-size:clamp(52px,9vw,120px);margin:14px 0 18px}.gone p{color:var(--dim);max-width:420px;margin:0 auto;line-height:1.8}
.gone em,h1 em{color:var(--ver)}
@media (max-width:900px){.page{grid-template-columns:1fr}.side{grid-row:auto;grid-column:1;border-left:0;border-top:1px solid var(--faint);padding:26px 22px 40px}.stage{padding:84px 16px 10px}.nav{display:none}.read{display:none}.cap{left:16px}}
`;

const SHELL = (title: string, body: string) =>
	`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`;

/** One page for revoked, expired and never-existed links: no hint which it was. */
export function gonePage(): string {
	return SHELL(
		'This gallery is gone · pixelsort-go',
		`<div class="gone"><div><div class="eyebrow">Link no longer works</div><h1>This gallery is <em>gone</em>.</h1><p>It was revoked by whoever made it, or it reached its expiry date. Nothing is kept here after that.</p></div></div>`
	);
}

function daysLeft(expires: number | null, nowS: number): string {
	if (expires === null) return '';
	const d = Math.max(0, Math.ceil((expires - nowS) / 86400));
	return `expires in <b>${d} day${d === 1 ? '' : 's'}</b>`;
}

const CLIENT = `
(function(){
var d=JSON.parse(document.getElementById('data').textContent);var id=d.id,imgs=d.images,i=0;
var $=function(s){return document.querySelector(s)};
function toast(m){var t=$('#toast');t.textContent=m;t.classList.add('on');clearTimeout(toast.t);toast.t=setTimeout(function(){t.classList.remove('on')},2000)}
function row(a,b){var r=document.createElement('div'),x=document.createElement('span'),y=document.createElement('span');x.textContent=a;y.textContent=b;r.append(x,y);return r}
function show(n){i=(n+imgs.length)%imgs.length;var it=imgs[i];var im=$('#img'),vid=$('#vid');var isVid=it.mime.indexOf('video/')===0;im.style.display=isVid?'none':'block';vid.style.display=isVid?'block':'none';if(isVid){vid.src='/a/'+id+'/'+i;var pr=vid.play();if(pr&&pr.catch)pr.catch(function(){})}else{vid.pause();vid.removeAttribute('src');im.src='/a/'+id+'/'+i;im.alt=it.name||''}
$('#cap').textContent=(it.name?it.name+' \\u2014 ':'')+(i+1)+' of '+imgs.length;
document.querySelectorAll('#strip button').forEach(function(b,k){b.classList.toggle('on',k===i)});
var m=$('#meta');m.replaceChildren();[['image',it.name||'#'+(i+1)],['size',it.w+' \\u00d7 '+it.h],['format',it.mime.split('/')[1].toUpperCase()]].forEach(function(x){var a=document.createElement('span'),b=document.createElement('span');a.textContent=x[0];b.textContent=x[1];m.append(a,b)});
var box=$('#recipeBox');if(box){var rows=$('#recipe');rows.replaceChildren();var r=it.recipe;if(r){Object.keys(r).forEach(function(k){var v=r[k];rows.append(row(k,typeof v==='object'?JSON.stringify(v):String(v)))});box.style.display='block'}else box.style.display='none'}}
$('#prev').onclick=function(){show(i-1)};$('#next').onclick=function(){show(i+1)};
$('#strip').addEventListener('click',function(e){var b=e.target.closest('button');if(b)show(+b.dataset.k)});
document.addEventListener('keydown',function(e){if(e.key==='ArrowLeft')show(i-1);if(e.key==='ArrowRight')show(i+1)});
$('#dl').onclick=function(){var a=document.createElement('a');a.href='/a/'+id+'/'+i;a.download=(imgs[i].name||'image-'+(i+1));document.body.append(a);a.click();a.remove()};
$('#cpLink').onclick=function(){navigator.clipboard.writeText(location.origin+'/a/'+id+'/'+i).then(function(){toast('Direct image link copied')},function(){toast('Could not copy')})};
var cr=$('#cpRecipe');if(cr)cr.onclick=function(){navigator.clipboard.writeText(JSON.stringify(imgs[i].recipe)).then(function(){toast('Recipe copied')},function(){toast('Could not copy')})};
show(0)})();
`;

export function viewerPage(id: string, m: Manifest, nonce: string, nowS: number): string {
	const hasRecipes = m.images.some((x) => x.recipe);
	const title = m.title?.trim() || 'A gallery from pixelsort-go';
	const data = safeJson({ id, images: m.images.map((x) => ({ w: x.w, h: x.h, mime: x.mime, name: x.name, recipe: x.recipe })) });
	const strip = m.images
		.map((_, k) => `<button data-k="${k}" aria-label="Image ${k + 1}"><img src="/a/${id}/${k}/thumb" alt="" loading="lazy"></button>`)
		.join('');
	const exp = daysLeft(m.expires, nowS);
	const body = `<header class="top"><a class="word" href="/" aria-label="pixelsort-go">pixelsort<i>GO</i></a><div class="read"><span>shared album</span><span><b>${m.images.length}</b> image${m.images.length === 1 ? '' : 's'}</span>${exp ? `<span>${exp}</span>` : ''}</div></header>
<div class="page"><section class="stage"><button class="nav l" id="prev" aria-label="Previous">←</button><img id="img" alt=""><video id="vid" controls loop muted playsinline style="display:none"></video><button class="nav r" id="next" aria-label="Next">→</button><div class="cap" id="cap"></div></section>
<div class="strip" id="strip">${strip}</div>
<aside class="side"><div><div class="eyebrow">A gallery from pixelsort-go</div><h1>${escapeHtml(title)}</h1></div>
<div class="meta" id="meta"></div>
<div class="acts"><button class="btn pri" id="dl">Download this image</button><div class="row"><button class="btn" id="cpLink">Copy image link</button></div></div>
${hasRecipes ? `<div class="recipe" id="recipeBox"><div class="rows" id="recipe"></div><button id="cpRecipe">Copy recipe JSON</button></div>` : ''}
<p class="note">This link is unlisted — anyone who has it can view and download. Photos carry no location or camera data.</p></aside></div>
<div class="toast" id="toast" role="status"></div>
<script type="application/json" id="data">${data}</script>
<script nonce="${nonce}">${CLIENT}</script>`;
	return SHELL(`${title} · pixelsort-go`, body);
}

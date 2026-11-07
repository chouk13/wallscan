// patterns.js — motifs vectoriels ORIGINAUX (DÉMO), v4 pattern-designer. Inspirés des familles lin / chaux / rayure /
// feuillage / Art déco / papier japonais / cuir / paille / toile d'herbe / relief / semis floral / ondes / panoramiques
// (forêt, collines, pins, scénique peint, gravure palmiers) — aucune reproduction d'un dessin d'éditeur.
// Contrat (ne pas changer) : svgTile(p) → data URI SVG ; tileCm(p) → cm du côté de la tuile carrée ; isPano(p) → décor étiré 100 % × 100 %.
// PATTERN_KEYS → liste des clés `pat` connues ; clé inconnue → repli : tuile unie c1 à grain léger (jamais d'erreur).
// Tuiles 256 × 256 sans couture (tout élément proche d'un bord est recopié à ±256), panoramiques 800 × 400 (ratio 2:1).
// Déterministe : générateur pseudo-aléatoire à graine (LCG), aucun Math.random(). Un seul filtre SVG par tuile, numOctaves ≤ 3,
// bruit « stitché » sur la tuile exacte (filterUnits=userSpaceOnUse) → le grain lui-même est seamless.
var WS_PAT=(function(){
const S=256;
const hex=c=>{c=c.replace("#","");if(c.length===3)c=c.replace(/./g,x=>x+x);return[0,2,4].map(i=>parseInt(c.slice(i,i+2),16));};
const rgb=a=>"#"+a.map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,"0")).join("");
const mix=(a,b,t)=>{const A=hex(a),B=hex(b);return rgb(A.map((v,i)=>v+(B[i]-v)*t));};
const light=(c,t)=>mix(c,"#ffffff",t),dark=(c,t)=>mix(c,"#000000",t);
const lcg=seed=>{let s=(seed*2654435761)>>>0;return()=>(s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296;};
const f=n=>Math.round(n*10)/10,i0=n=>Math.round(n);
// Recopie un élément centré en (x,y), d'emprise r (ry en vertical si différente), sur les bords opposés de la tuile → aucune couture.
const wrap=(x,y,r,draw,ry=r)=>{let o="";for(const dx of[0,-S,S])for(const dy of[0,-S,S]){const X=x+dx,Y=y+dy;if(X+r<0||X-r>S||Y+ry<0||Y-ry>S)continue;o+=draw(f(X),f(Y));}return o;};
// Filtre de matière : bruit périodique sur la région exacte (w×h), désaturé, alpha constant, mélangé en soft-light.
const noise=(freq,oct,amt,type,w,h,extra)=>`<filter id="n" filterUnits="userSpaceOnUse" x="0" y="0" width="${w||S}" height="${h||S}" color-interpolation-filters="sRGB"><feTurbulence type="${type||"fractalNoise"}" baseFrequency="${freq}" numOctaves="${oct}" seed="5" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer>${extra||""}<feFuncA type="linear" slope="0" intercept="${amt}"/></feComponentTransfer><feBlend in2="SourceGraphic" mode="soft-light"/></filter>`;
// Toile chaîne/trame 8 × 8 (armure toile : chaque fil passe dessus/dessous en alternance), fils bombés par dégradé.
const weave=(c1,c2,k)=>{const gap=dark(mix(c1,c2,.6),.15),warp=light(c1,.1),weft=mix(c1,c2,.5*k);
 return`<linearGradient id="gh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light(weft,.3)}"/><stop offset=".55" stop-color="${weft}"/><stop offset="1" stop-color="${dark(weft,.2)}"/></linearGradient><linearGradient id="gv" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${light(warp,.3)}"/><stop offset=".5" stop-color="${warp}"/><stop offset="1" stop-color="${dark(warp,.22)}"/></linearGradient><pattern id="w" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="${gap}"/><rect y=".5" width="8" height="3" fill="url(#gh)"/><rect y="4.5" width="8" height="3" fill="url(#gh)"/><rect x=".5" width="3" height="8" fill="url(#gv)"/><rect x="4.5" width="3" height="8" fill="url(#gv)"/><rect x="4" y=".5" width="4.5" height="3" fill="url(#gh)"/><rect x="-.5" y="4.5" width="4.5" height="3" fill="url(#gh)"/></pattern><pattern id="wg" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 4h8M0 0h8M4 0v8M0 0v8" stroke="#000" stroke-width=".9" opacity=".22"/><path d="M0 1.2h8M0 5.2h8" stroke="#fff" stroke-width=".7" opacity=".16"/></pattern>`;};
// Flammes / irrégularités de fil : segments courts (quelques cm) alignés sur les fils, recopiés aux bords.
const slubs=(r,c1,c2,n,m)=>{let o="";for(let i=0;i<n;i++){const y=4*Math.floor(r()*64)+2,x=r()*S,L=f(18+r()*50),h=f(2.2+r()*1.4),a=f(.18+r()*.25),c=i%3?light(c1,.4):mix(c1,c2,.95);o+=wrap(x,y,L/2,(X,Y)=>`<rect x="${f(X-L/2)}" y="${f(Y-h/2)}" width="${L}" height="${h}" rx="1" fill="${c}" opacity="${a}"/>`);}
 for(let i=0;i<m;i++){const x=4*Math.floor(r()*64)+2,y=r()*S,L=f(18+r()*50),w=f(2+r()*1.2),a=f(.18+r()*.25),c=i%2?light(c1,.35):mix(c1,c2,.9);o+=wrap(x,y,L/2,(X,Y)=>`<rect x="${f(X-w/2)}" y="${f(Y-L/2)}" width="${w}" height="${L}" rx="1" fill="${c}" opacity="${a}"/>`);}return o;};

const T={};
// — Toile de lin (Lina, Kari) : armure toile + flammes + nuage de luminance.
T.lin=(p,r)=>{const{c1,c2}=p;return`<defs>${weave(c1,c2,1)}${noise(".02",3,.36)}</defs><g filter="url(#n)"><rect width="256" height="256" fill="url(#w)"/>${slubs(r,c1,c2,14,10)}</g>`;};
// — Enduit chaux / soie (Argile, Occitan) : uni nuagé multi-couches (taches, traces de taloche, grain fin).
T.chaux=(p,r)=>{const{c1,c2}=p,hi=light(c1,.5),lo=dark(c2,.2);let d=`<defs>${noise(".011",3,.44)}<radialGradient id="b"><stop offset="0" stop-color="${c2}" stop-opacity=".22"/><stop offset=".55" stop-color="${c2}" stop-opacity=".08"/><stop offset="1" stop-color="${c2}" stop-opacity="0"/></radialGradient><radialGradient id="l"><stop offset="0" stop-color="${hi}" stop-opacity=".26"/><stop offset="1" stop-color="${hi}" stop-opacity="0"/></radialGradient><pattern id="d" width="11" height="11" patternUnits="userSpaceOnUse"><path d="M1.5 2.5h.01M7 1h.01M4 8.5h.01M9.5 6h.01M6.2 5.3h.01" stroke="${lo}" stroke-width="1" stroke-linecap="round" opacity=".07"/><path d="M3 5.5h.01M8.5 9h.01M10 2.5h.01" stroke="#fff" stroke-width="1" stroke-linecap="round" opacity=".1"/></pattern></defs><g filter="url(#n)"><rect width="256" height="256" fill="${c1}"/>`;
 for(let i=0;i<9;i++){const x=r()*S,y=r()*S,rx=f(50+r()*80),ry=f(rx*(.4+r()*.45)),a=f(r()*180);d+=wrap(x,y,rx,(X,Y)=>`<ellipse rx="${rx}" ry="${ry}" transform="translate(${X} ${Y}) rotate(${a})" fill="url(#b)"/>`);}
 for(let i=0;i<6;i++){const x=r()*S,y=r()*S,rx=f(40+r()*60),ry=f(rx*(.5+r()*.4)),a=f(r()*180);d+=wrap(x,y,rx,(X,Y)=>`<ellipse rx="${rx}" ry="${ry}" transform="translate(${X} ${Y}) rotate(${a})" fill="url(#l)"/>`);}
 for(let i=0;i<7;i++){const x=r()*S,y=r()*S,rx=f(60+r()*60),ry=f(7+r()*10),a=f(-58+r()*34),o=f(.15+r()*.2);d+=wrap(x,y,rx,(X,Y)=>`<ellipse rx="${rx}" ry="${ry}" transform="translate(${X} ${Y}) rotate(${a})" fill="url(#${i%2?"b":"l"})" opacity="${o}"/>`);}
 return d+`<rect width="256" height="256" fill="url(#d)"/></g>`;};
// — Rayures fines sur fond lin (Beausoleil) : imprimé par-dessus la toile, la trame transparaît.
T.rayure=(p,r)=>{const{c1,c2}=p,c3=mix(c1,c2,.3);return`<defs>${weave(c1,c2,.6)}${noise(".02",3,.3)}<pattern id="s" width="64" height="256" patternUnits="userSpaceOnUse"><rect x="9" width="12" height="256" fill="${c2}" opacity=".82"/><rect x="26" width="2.4" height="256" fill="${c2}" opacity=".6"/><rect x="31" width="2.4" height="256" fill="${c2}" opacity=".6"/><rect x="40" width="17" height="256" fill="${c3}" opacity=".85"/><rect x="61" width="1.3" height="256" fill="${c2}" opacity=".55"/></pattern></defs><g filter="url(#n)"><rect width="256" height="256" fill="url(#w)"/><rect width="256" height="256" fill="url(#s)"/><rect width="256" height="256" fill="url(#wg)" opacity=".45"/>${slubs(r,c1,c2,4,6)}</g>`;};
// — Feuillage botanique (Désirade, Légendes, Madhuca) : feuilles en Bézier, nervures, deux tons, fond nuagé.
T.feuillage=(p,r)=>{const{c1,c2}=p,t2=mix(c2,c1,.32),t3=light(c2,.14);
 const leaf=(id)=>{const L=70,W=15,a=.8+r()*.4,b=.8+r()*.4,s=.9+r()*.25,tipY=f((r()-.5)*4);
  const outline=`M${f(-L*.28)} ${f(W*.34)}C${f(-L*.18)} ${f(W*.22)},${f(-L*.08)} ${f(W*.1)},0 0C${f(L*.2)} ${f(-W*1.15*a)},${f(L*.66)} ${f(-W*1.05*a)},${L} ${tipY}C${f(L*.74)} ${f(W*.95*b)},${f(L*.3)} ${f(W*1.3*b)},0 0C${f(-L*.08)} ${f(W*.16)},${f(-L*.18)} ${f(W*.28)},${f(-L*.28)} ${f(W*.42)}Z`;
  let v=`M${f(L*.05)} 0Q${f(L*.5)} ${f(W*.1)} ${f(L*.92)} ${f(tipY*.6)}`;
  for(let k=1;k<=4;k++){const x=L*(.1+k*.18),l=W*(1.05-k*.16)*s;v+=`M${f(x)} 0q${f(l*.5)} ${f(-l*.5)} ${f(l*1.05)} ${f(-l*.85)}M${f(x+L*.07)} 0q${f(l*.45)} ${f(l*.55)} ${f(l*1.0)} ${f(l*.9)}`;}
  return`<g id="${id}"><path d="${outline}"/><path d="${v}" fill="none" stroke="${c1}" stroke-width=".9" stroke-linecap="round" opacity=".7"/></g>`;};
 // Brin : tige courbe portant 5 folioles alternées (deux tons), défini une fois puis posé plusieurs fois.
 const sprig=(id,cy)=>{const P0=[0,0],P1=[34,cy],P2=[74,cy*.3];const bz=t=>[(1-t)*(1-t)*P0[0]+2*(1-t)*t*P1[0]+t*t*P2[0],(1-t)*(1-t)*P0[1]+2*(1-t)*t*P1[1]+t*t*P2[1]];
  let o=`<g id="${id}"><path d="M0 0Q${P1[0]} ${P1[1]} ${P2[0]} ${f(P2[1])}" fill="none" stroke="${dark(c2,.2)}" stroke-width="1.4" stroke-linecap="round"/>`;
  for(let k=0;k<5;k++){const t=.16+k*.2,[x,y]=bz(t),[x2,y2]=bz(t+.04),tan=Math.atan2(y2-y,x2-x)*180/Math.PI,side=k%2?1:-1,a=f(tan+side*(42+r()*22)),s=f(.36+r()*.14-k*.02);o+=`<use href="#${"abc"[(k+1)%3]}" transform="translate(${f(x)} ${f(y)}) rotate(${a}) scale(${s} ${f(s*side)})" fill="${k%2?c2:t3}"/>`;}
  return o+`<use href="#b" transform="translate(${f(P2[0])} ${f(P2[1])}) rotate(${f(-cy*.4)}) scale(.34)" fill="${t3}"/></g>`;};
 let d=`<defs>${noise(".014",3,.32)}<radialGradient id="g"><stop offset="0" stop-color="${light(c1,.2)}" stop-opacity=".22"/><stop offset="1" stop-color="${light(c1,.2)}" stop-opacity="0"/></radialGradient>${leaf("a")}${leaf("b")}${leaf("c")}${sprig("s",-18)}${sprig("u",16)}</defs><rect width="256" height="256" fill="${c1}" filter="url(#n)"/>`;
 for(let i=0;i<3;i++){const x=r()*S,y=r()*S,R=f(60+r()*50);d+=wrap(x,y,R,(X,Y)=>`<circle cx="${X}" cy="${Y}" r="${R}" fill="url(#g)"/>`);}
 // 6 brins sur une grille 3 × 2 décalée, puis 7 grandes feuilles isolées par-dessus (3 tons).
 for(let i=0;i<6;i++){const x=(i%3+.5)*S/3+(r()-.5)*36+(i>2?42:0),y=(Math.floor(i/3)+.5)*S/2+(r()-.5)*40,a=f(r()*360),s=f(.9+r()*.3),id=i%2?"s":"u";d+=wrap(x,y,80*s,(X,Y)=>`<use href="#${id}" transform="translate(${X} ${Y}) rotate(${a}) scale(${s})"/>`);}
 for(let i=0;i<9;i++){if(i===4||i===7)continue;const x=(i%3+.5)*S/3+42+(r()-.5)*40,y=(Math.floor(i/3)+.5)*S/3+42+(r()-.5)*40,a=f(r()*360),s=f(.6+r()*.42),fl=r()<.5?-1:1,id="abc"[i%3],fill=[c2,t2,t3][i%3];d+=wrap(x,y,80*s,(X,Y)=>`<use href="#${id}" transform="translate(${X} ${Y}) rotate(${a}) scale(${s} ${f(s*fl)})" fill="${fill}"/>`);}
 return d;};
// — Art déco (Années 30) : éventails en écailles, demi-cercles concentriques et rayons, laque + or métallisé.
T.artdeco=(p,r)=>{const{c1,c2}=p,g1=light(c2,.5),g3=dark(c2,.4),lac2=mix(c1,c2,.09);
 let rays="";for(let a=12;a<=168;a+=12){const ca=Math.cos(a*Math.PI/180),sa=Math.sin(a*Math.PI/180);rays+=`M${f(16*ca)} ${f(-16*sa)}L${f(68*ca)} ${f(-68*sa)}`;}
 let dots="";for(let a=18;a<=162;a+=12){const ca=Math.cos(a*Math.PI/180),sa=Math.sin(a*Math.PI/180);dots+=`M${f(58*ca)} ${f(-58*sa)}h.01`;}
 const d=`<defs>${noise(".7",2,.22)}<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${g1}"/><stop offset=".48" stop-color="${c2}"/><stop offset="1" stop-color="${g3}"/></linearGradient><linearGradient id="g2" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${g1}"/><stop offset=".5" stop-color="${c2}"/><stop offset="1" stop-color="${g3}"/></linearGradient><g id="F"><path d="M-72 0A72 72 0 0 1 72 0Z"/><path d="${rays}" stroke="url(#g)" stroke-width=".8" opacity=".9"/><path d="M-60 0A60 60 0 0 1 60 0M-44 0A44 44 0 0 1 44 0M-28 0A28 28 0 0 1 28 0" fill="none" stroke="url(#g2)" stroke-width="1.2"/><path d="${dots}" stroke="${g1}" stroke-width="2.2" stroke-linecap="round" opacity=".85"/><path d="M-72 0A72 72 0 0 1 72 0" fill="none" stroke="url(#g)" stroke-width="2.4"/><path d="M-12 0A12 12 0 0 1 12 0Z" fill="url(#g)"/></g></defs><rect width="256" height="256" fill="${c1}" filter="url(#n)"/>`;
 let u="";for(let k=1;k<=4;k++){const y=64*k,xs=k%2?[0,128,256]:[64,192];for(const x of xs)u+=`<use href="#F" x="${x}" y="${y}" fill="${k%2?c1:lac2}"/>`;}
 return d+u;};
// — Papier japonais (Yuzen) : indigo nuagé, grain de papier, fibres longues et paillettes de pulpe.
T.japon=(p,r)=>{const{c1,c2}=p,fb=light(c2,.3),fd=dark(c1,.4);let d=`<defs>${noise(".9",2,.32)}<radialGradient id="b"><stop offset="0" stop-color="${c2}" stop-opacity=".16"/><stop offset="1" stop-color="${c2}" stop-opacity="0"/></radialGradient><radialGradient id="k"><stop offset="0" stop-color="${fd}" stop-opacity=".16"/><stop offset="1" stop-color="${fd}" stop-opacity="0"/></radialGradient></defs><g filter="url(#n)"><rect width="256" height="256" fill="${c1}"/>`;
 for(let i=0;i<6;i++){const x=r()*S,y=r()*S,R=f(80+r()*80);d+=wrap(x,y,R,(X,Y)=>`<circle cx="${X}" cy="${Y}" r="${R}" fill="url(#${i%2?"b":"k"})"/>`);}
 d+=`<g fill="none" stroke-linecap="round">`;
 for(let i=0;i<20;i++){const x=r()*S,y=r()*S,L=f(10+r()*28),a=f(r()*180),c=f((r()-.5)*L*.5),w=f(.5+r()*.6),o=f(.18+r()*.3),col=i%5?fb:fd;d+=wrap(x,y,L/2,(X,Y)=>`<path d="M${f(-L/2)} 0q${f(L*.25)} ${c} ${L} 0" transform="translate(${X} ${Y}) rotate(${a})" stroke="${col}" stroke-width="${w}" opacity="${o}"/>`);}
 d+=`</g><g fill="${light(c2,.5)}">`;
 for(let i=0;i<14;i++){const x=r()*S,y=r()*S,a=f(r()*180),rx=f(1+r()*1.4),o=f(.35+r()*.4);d+=wrap(x,y,3,(X,Y)=>`<ellipse rx="${rx}" ry=".6" transform="translate(${X} ${Y}) rotate(${a})" opacity="${o}"/>`);}
 return d+`</g></g>`;};
// — Cuir grainé (Moko) : grain cellulaire (turbulence), plis fins, lustre doux.
T.cuir=(p,r)=>{const{c1,c2}=p,hi=light(c1,.55),cr=dark(c1,.5);let d=`<defs>${noise(".16",2,.5,"turbulence",0,0,`<feFuncR type="linear" slope="1" intercept=".3"/><feFuncG type="linear" slope="1" intercept=".3"/><feFuncB type="linear" slope="1" intercept=".3"/>`)}<radialGradient id="s"><stop offset="0" stop-color="${hi}" stop-opacity=".07"/><stop offset="1" stop-color="${hi}" stop-opacity="0"/></radialGradient><radialGradient id="k"><stop offset="0" stop-color="${cr}" stop-opacity=".14"/><stop offset="1" stop-color="${cr}" stop-opacity="0"/></radialGradient></defs><g filter="url(#n)"><rect width="256" height="256" fill="${c1}"/><rect width="256" height="256" fill="${c2}" opacity=".6"/>`;
 for(let i=0;i<5;i++){const x=r()*S,y=r()*S,rx=f(80+r()*80),ry=f(rx*(.5+r()*.4)),a=f(r()*180);d+=wrap(x,y,rx,(X,Y)=>`<ellipse rx="${rx}" ry="${ry}" transform="translate(${X} ${Y}) rotate(${a})" fill="url(#${i%2?"s":"k"})"/>`);}
 for(let i=0;i<5;i++){const x=r()*S,y=r()*S,L=f(70+r()*120),a=f(r()*180),c=f((r()-.5)*40),c2b=f((r()-.5)*40),o=f(.25+r()*.3);d+=wrap(x,y,L/2,(X,Y)=>`<g transform="translate(${X} ${Y}) rotate(${a})" fill="none"><path d="M${f(-L/2)} 0c${f(L*.3)} ${c},${f(L*.6)} ${c2b},${L} 0" stroke="${cr}" stroke-width="1.2" opacity="${o}"/><path d="M${f(-L/2)} 1.3c${f(L*.3)} ${c},${f(L*.6)} ${c2b},${L} 0" stroke="${hi}" stroke-width=".7" opacity="${f(o*.55)}"/></g>`);}
 return d+`</g>`;};
// — Paille tissée (La Casa de Paja) : brins horizontaux de teintes variées, bombés, liés par des fils verticaux dessus/dessous.
T.paille=(p,r)=>{const{c1,c2}=p,th=dark(c2,.35),hl=light(c2,.45);let d=`<defs>${noise("0.012 0.32",2,.45)}<linearGradient id="v" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".3"/><stop offset=".35" stop-color="#fff" stop-opacity="0"/><stop offset=".7" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".42"/></linearGradient><pattern id="sh" width="256" height="8" patternUnits="userSpaceOnUse"><rect width="256" height="8" fill="url(#v)"/></pattern><pattern id="bd" width="32" height="16" patternUnits="userSpaceOnUse"><rect x="12" y="8" width="5.6" height="8" fill="#000" opacity=".08"/><rect x="13" y="-.6" width="3.4" height="9.2" rx="1.3" fill="${th}"/><rect x="14" y="-.6" width="1" height="9.2" fill="${hl}" opacity=".55"/><rect x="16.4" width="1.6" height="8.6" fill="#000" opacity=".14"/></pattern></defs><g filter="url(#n)">`;
 for(let i=0;i<32;i++){const t=f(r()*.9),c=mix(c1,c2,t);d+=`<rect y="${8*i}" width="256" height="8" fill="${c}"/>`;if(r()<.35){const x=f(r()*220),w=f(20+r()*60);d+=`<rect x="${x}" y="${8*i}" width="${w}" height="8" fill="${light(c,.25)}" opacity=".5"/>`;}}
 return d+`<rect width="256" height="256" fill="url(#sh)"/><rect width="256" height="256" fill="url(#bd)"/></g>`;};
// — Toile d'herbe / raphia (Herbe de rivière, Raphia) : brins végétaux horizontaux à bouts coupés qui se chevauchent (4 tons tirés de c2,
//   3 épaisseurs, légèrement bombés), cousus sur une toile fine (c1) visible dans les jours ; fils de chaîne discrets, nœuds, reflets.
//   Les segments sont regroupés par (ton, épaisseur) dans un seul <path> (~140 brins, ~5 Ko) ; rangs et brins recopiés aux bords.
T.grasscloth=(p,r)=>{const{c1,c2}=p,tn=[c2,light(c2,.16),mix(c2,c1,.3),dark(c2,.14)],W=[2.2,2.8,3.6],B={},rows=[];
 let y=.3;while(y<256){const wi=r()<.45?1:r()<.55?0:2,w=W[wi],yc=y+w/2,n=r()<.6?1:r()<.92?2:3,x0=r()*S;let x=x0;rows.push([yc,w,wi]);
  for(let k=0;k<n;k++){const L=k<n-1?256/n*(.65+r()*.7):x0+256-x+(r()-.5)*4,s=(r()-.5)*.8,c=f((r()-.5)*1.4),dy=(r()-.5)*.6,u=r(),key=(u<.4?0:u<.65?1:u<.85?2:3)*3+wi;
   B[key]=(B[key]||"")+wrap(x+L/2,yc+dy,L/2,(X,Y)=>`M${i0(X-L/2)} ${f(Y-s/2)}q${i0(L/2)} ${c} ${i0(L)} ${f(s)}`,w);x+=L+(r()<.5?-1-r()*2.5:1+r()*2.5);}
  y+=w+(r()<.3?.4+r()*.9:(r()-.4)*.4);}
 let d=`<defs>${noise("0.012 0.5",2,.5)}<pattern id="bk" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="${mix(c1,c2,.12)}"/><path d="M0 2.5h4M2.5 0v4" stroke="${dark(c1,.25)}" stroke-width=".8" opacity=".5"/></pattern><pattern id="st" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M3 0v8" stroke="#fff" stroke-width=".6" opacity=".07"/><path d="M3.6 0v8" stroke="#000" stroke-width=".5" opacity=".06"/></pattern></defs><g filter="url(#n)"><rect width="256" height="256" fill="url(#bk)"/><g fill="none">`;
 for(const k in B)d+=`<path d="${B[k]}" stroke="${tn[k/3|0]}" stroke-width="${W[k%3]}"/>`;
 // Nœuds (points sombres) et reflets (tirets clairs) : tirets à bouts ronds regroupés par épaisseur de brin.
 const K=["","",""],H=["","",""];
 for(let i=0;i<22;i++){const[yc,w,wi]=rows[Math.floor(r()*rows.length)],x=r()*S;K[wi]+=wrap(x,yc,w,(X,Y)=>`M${X} ${Y}h1.5`);}
 for(let i=0;i<10;i++){const[yc,w,wi]=rows[Math.floor(r()*rows.length)],x=r()*S,L=i0(5+r()*7);H[wi]+=wrap(x,yc,L,(X,Y)=>`M${f(X-L/2)} ${Y}h${L}`);}
 d+=`</g><g fill="none" stroke-linecap="round">`;
 K.forEach((k,i)=>{if(k)d+=`<path d="${k}" stroke="${dark(c2,.45)}" stroke-width="${f(W[i]*.9)}" opacity=".5"/>`;});
 H.forEach((h,i)=>{if(h)d+=`<path d="${h}" stroke="${light(c2,.45)}" stroke-width="${f(W[i]*.45)}" opacity=".28"/>`;});
 return d+`</g><rect width="256" height="256" fill="url(#st)"/></g>`;};
// — Papier sculpté (Pétales en relief) : pétales imbriqués en rangs décalés, une seule lumière en haut à gauche : dôme en dégradé radial,
//   rehaut sur l'arête gauche, arête droite assombrie, ombre portée douce (deux traits) sur le rang du dessous. Cellule 25,6 × 32 (2 rangs)
//   en <pattern> : les rangs voisins (y = 40 et y = −8) sont redessinés dans la cellule pour que l'imbrication traverse les cellules
//   sans trou ; nuage de luminance + grain par-dessus.
T.relief=(p,r)=>{const{c1,c2}=p,hi=light(c1,.5),arc="M-12.8 -3C-12.8 7 -6.4 14.5 0 16.5C6.4 14.5 12.8 7 12.8 -3",sh="M-5 13.8C-1 16 5 15.5 9 12.5C12 9.5 12.8 4 12.8 -3";
 let d=`<defs>${noise(".8",2,.26)}<radialGradient id="d" cx=".36" cy=".28" r=".8"><stop offset="0" stop-color="${hi}"/><stop offset=".42" stop-color="${c1}"/><stop offset="1" stop-color="${mix(c1,c2,.85)}"/></radialGradient><radialGradient id="b"><stop offset="0" stop-color="${c2}" stop-opacity=".2"/><stop offset="1" stop-color="${c2}" stop-opacity="0"/></radialGradient><g id="e" fill="none" stroke-linecap="round"><path d="${sh}" transform="translate(1.8 2.4)" stroke="${c2}" stroke-width="2.8" opacity=".3"/><path d="${sh}" transform="translate(.9 1.3)" stroke="${c2}" stroke-width="1.3" opacity=".45"/><path d="M-12.8 -16L${arc.slice(1)}L12.8 -16Z" fill="url(#d)"/><path d="M-12.8 -3C-12.8 5 -9.5 11 -3.5 15" stroke="#fff" stroke-width=".9" opacity=".55"/><path d="M3.5 15C9.5 11.5 12.8 6 12.8 -3" stroke="${c2}" stroke-width=".8" opacity=".5"/></g><pattern id="t" width="25.6" height="32" patternUnits="userSpaceOnUse"><use href="#e" x="12.8" y="40"/><use href="#e" x="-12.8" y="40"/><use href="#e" y="24"/><use href="#e" x="25.6" y="24"/><use href="#e" x="12.8" y="8"/><use href="#e" x="-12.8" y="8"/><use href="#e" y="-8"/><use href="#e" x="25.6" y="-8"/></pattern></defs><g filter="url(#n)"><rect width="256" height="256" fill="url(#t)"/>`;
 for(let i=0;i<5;i++){const x=r()*S,y=r()*S,rx=f(60+r()*70),ry=f(rx*(.5+r()*.4)),a=f(r()*180);d+=wrap(x,y,rx,(X,Y)=>`<ellipse rx="${rx}" ry="${ry}" transform="translate(${X} ${Y}) rotate(${a})" fill="url(#b)"/>`);}
 return d+`</g>`;};
// — Semis de roses (Roses sur fond bleu) : grandes roses stylisées (trois couronnes de pétales festonnés, cœur en spirale), feuillage en c2 ;
//   ton clair pour les rehauts, ton foncé pour les ombres ; deux roses en quinconce (raccord sauté visuel) + deux boutons + brins.
T.floral=(p,r)=>{const{c1,c2}=p,lt=light(c2,.3),dk=dark(c2,.32),lf=mix(c2,c1,.18);
 const scal=(n,R,ph)=>{let o="";for(let i=0;i<=n;i++){const a=ph+i/n*6.283,x=f(Math.cos(a)*R*.86),y=f(Math.sin(a)*R*.86);o+=i?`A${f(R*.56)} ${f(R*.56)} 0 0 1 ${x} ${y}`:`M${x} ${y}`;}return o+"Z";};
 // Couronne remplie + contour, séparations radiales aux creux des festons, ombre portée de la couronne suivante, cœur en spirale, rehauts.
 const ring=(n,R,ph,fill,sw)=>`<path d="${scal(n,R,ph)}" fill="${fill}" stroke="${dk}" stroke-width="${sw}" stroke-opacity=".6"/>`;
 const seps=(n,r0,r1,ph)=>{let o="";for(let i=0;i<n;i++){const a=ph+i/n*6.283,c=Math.cos(a),s=Math.sin(a);o+=`M${f(r0*c)} ${f(r0*s)}L${f(r1*c)} ${f(r1*s)}`;}return`<path d="${o}" stroke="${dk}" stroke-width="1.2" stroke-opacity=".65" stroke-linecap="round"/>`;};
 const rose=`<g id="R">${ring(7,36,0,c2,1)}${seps(7,21,31,0)}<path d="${scal(5,25,.5)}" transform="translate(2.5 3.5)" fill="${dk}" opacity=".55"/>${ring(5,24,.5,light(c2,.12),.9)}${seps(5,11,20,.5)}<path d="${scal(4,14,1.1)}" transform="translate(1.8 2.4)" fill="${dk}" opacity=".55"/>${ring(4,13,1.1,lt,.8)}<path d="M-5 -3a5.5 5.5 0 1 1 7 5a9 9 0 1 0 -11 -8M-1 -1a2.5 2.5 0 1 1 3 2" fill="none" stroke="${dk}" stroke-width="1.4" stroke-linecap="round"/><path d="M-27 -10a26 26 0 0 1 12 -18M-18 3a16 16 0 0 1 6 -13M-9 4a9 9 0 0 1 5 -7" fill="none" stroke="${light(c2,.55)}" stroke-width="2" stroke-linecap="round" opacity=".75"/></g>`;
 const leaf=`<g id="L"><path d="M0 0Q13 -11 27 0Q13 11 0 0Z"/><path d="M3 0h21" stroke="#000" stroke-width=".8" opacity=".25"/></g>`;
 const sprig=`<g id="S"><path d="M0 0Q30 -6 62 -22" fill="none" stroke="${lf}" stroke-width="1.6" stroke-linecap="round"/><use href="#L" transform="translate(10 -2)rotate(-60)scale(.8)" fill="${lf}"/><use href="#L" transform="translate(22 -5)rotate(40)scale(.9)" fill="${dk}"/><use href="#L" transform="translate(36 -10)rotate(-55)scale(.95)" fill="${lf}"/><use href="#L" transform="translate(48 -16)rotate(45)scale(.8)" fill="${dk}"/><use href="#L" transform="translate(62 -22)rotate(-25)scale(.9)" fill="${lf}"/></g>`;
 let d=`<defs>${noise(".8",2,.2)}${rose}${leaf}${sprig}</defs><rect width="256" height="256" fill="${c1}" filter="url(#n)"/>`;
 const R=[[64,60,1,10],[192,188,.92,-20],[196,56,.48,30],[60,196,.42,-40]];
 for(let i=0;i<8;i++){const x=r()*S,y=r()*S,a=f(r()*360),k=f(.75+r()*.4),fl=i%3?1:-1;d+=wrap(x,y,80,(X,Y)=>`<use href="#S" transform="translate(${X} ${Y})rotate(${a})scale(${k} ${f(k*fl)})"/>`);}
 for(let i=0;i<5;i++){const x=r()*S,y=r()*S,a=f(r()*360);d+=wrap(x,y,30,(X,Y)=>`<use href="#L" transform="translate(${X} ${Y})rotate(${a})" fill="${i%2?dk:lf}"/>`);}
 for(const[x,y,s,a]of R)d+=wrap(x,y,42*s,(X,Y)=>`<use href="#R" transform="translate(${X} ${Y})rotate(${a})scale(${s})"/>`);
 return d;};
// — Ondes cuivre : lignes fines ondulées parallèles (période 256 en x ; 32 lignes au pas de 8 → période verticale = la tuile), amplitude,
//   phase et épaisseur légèrement variables (3 épaisseurs regroupées) ; gaufrage = ombre portée 1 px + rehaut ; fond cuivre métallisé
//   (dégradé symétrique donc sans couture + grain fin). Les lignes qui mordent sur un bord haut/bas sont recopiées de l'autre côté.
T.waves=(p,r)=>{const{c1,c2}=p,W=[1,1.25,1.5],B=["","",""];
 for(let k=0;k<32;k++){const y=4+k*8,A=f(24+wob(r,4)),s=i0(30+wob(r,6)),wi=k%3?(r()<.5?0:1):2,ln=Y=>`M${-s} ${Y}q64 ${A} 128 0t128 0t128 0`;
  B[wi]+=ln(y)+(y<16?ln(y+256):"")+(y>240?ln(y-256):"");}
 return`<defs>${noise(".9",2,.3)}<linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${c1}"/><stop offset=".5" stop-color="${light(c1,.16)}"/><stop offset="1" stop-color="${c1}"/></linearGradient><g id="W" fill="none" stroke-linecap="round">${B.map((b,i)=>`<path d="${b}" stroke-width="${W[i]}"/>`).join("")}</g></defs><g filter="url(#n)"><rect width="256" height="256" fill="url(#g)"/><use href="#W" x=".8" y="1" stroke="${dark(c1,.5)}" opacity=".55"/><use href="#W" x="-.5" y="-.7" stroke="${light(c2,.5)}" opacity=".35"/><use href="#W" stroke="${c2}"/></g>`;};

// ---- Panoramiques 800 × 400 : décor unique (pas une tuile), 4–6 plans, brume, trait à main levée.
const P={};
const wob=(r,a)=>(r()-.5)*a;
P["pano-forest"]=(p,r)=>{const{c1,c2}=p,hz=light(c1,.6);
 // Sapin à main levée : 7 étages de branches tombantes (bords irréguliers), tronc visible sous la ramure. Base en (0,0), cime en (0,-100).
 const fir=(id)=>{const side=()=>{const P=[];for(let t=0;t<=9;t++){const y=-100+100*t/9+wob(r,3),w=(4+28*t/9)*(.82+r()*.36);P.push([w*.62,y-2],[w,y+3+wob(r,2)],[w*.56,y+5]);}return P;};const R=side(),L=side();
  let d=`M0 -104`;for(const[x,y]of R)d+=`L${f(x)} ${f(y)}`;d+=`L2.2 6L2.2 16L-2.2 16L-2.2 6`;for(let i=L.length-1;i>=0;i--)d+=`L${f(-L[i][0])} ${f(L[i][1])}`;return`<path id="${id}" d="${d}Z"/>`;};
 const tree=`<g id="d"><rect x="-1.8" y="-50" width="3.6" height="66"/><circle cy="-58" r="20"/><circle cx="-16" cy="-46" r="14"/><circle cx="15" cy="-45" r="15"/><circle cx="-4" cy="-74" r="12"/><circle cx="9" cy="-68" r="9"/></g>`;
 let d=`<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light(c1,.55)}"/><stop offset=".5" stop-color="${c1}"/><stop offset="1" stop-color="${mix(c1,c2,.1)}"/></linearGradient><linearGradient id="m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hz}" stop-opacity="0"/><stop offset="1" stop-color="${hz}" stop-opacity=".92"/></linearGradient><linearGradient id="r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>${fir("a")}${fir("b")}${fir("c")}${tree}</defs><rect width="800" height="400" fill="url(#s)"/>`;
 // Deux lisières lointaines : une seule silhouette dentelée chacune, noyées de brume.
 const ridge=(yb,h,step,col,op)=>{let o=`M-5 400L-5 ${yb}`;for(let x=0;x<=810;x+=step){const hh=h*(.5+r()*.6);o+=`L${i0(x+wob(r,6))} ${f(yb-hh)}L${i0(x+step*.5+wob(r,5))} ${f(yb-hh*.45)}`;}return`<path d="${o}L805 400Z" fill="${col}" opacity="${op}"/>`;};
 d+=ridge(212,44,16,mix(c1,c2,.24),.8)+`<rect y="170" width="800" height="50" fill="url(#m)" opacity=".7"/>`;
 d+=ridge(252,62,24,mix(c1,c2,.38),.85)+`<rect y="200" width="800" height="60" fill="url(#m)" opacity=".6"/>`;
 // Trois plans d'arbres individuels : de plus en plus grands, sombres et espacés ; le premier plan monte jusqu'au ciel.
 const planes=[[318,1.5,64,.55,0],[372,2.3,96,.74,1],[430,3.5,170,.96,2]];
 for(const[yb,sc,step,t,k]of planes){d+=`<g fill="${mix(c1,c2,t)}">`;let i=0;for(let x=-40+r()*40;x<840;x+=step*(.75+r()*.5),i++){const s=f(sc*(.8+r()*.4)),id=(i%3===1&&k<2)?"d":"abc"[i%3];d+=`<use href="#${id}" transform="translate(${i0(x)} ${yb})scale(${s})"/>`;}d+=`</g><rect y="${f(yb-60*sc)}" width="800" height="${f(60*sc+4)}" fill="url(#m)" opacity="${f(.55-k*.12)}"/>`;}
 // Rais de lumière diagonaux, voile de brume au sol.
 return d+`<g transform="rotate(12 400 0)"><rect x="170" y="-60" width="70" height="440" fill="url(#r)"/><rect x="520" y="-60" width="40" height="440" fill="url(#r)"/></g><rect y="330" width="800" height="70" fill="url(#m)" opacity=".5"/>`;};
P["pano-hills"]=(p,r)=>{const{c1,c2}=p,sun=light(c2,.7),dk=dark(c2,.35);
 let d=`<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix(light(c1,.4),"#c9d3dc",.35)}"/><stop offset=".6" stop-color="${c1}"/><stop offset="1" stop-color="${mix(c1,sun,.5)}"/></linearGradient><radialGradient id="g"><stop offset="0" stop-color="${sun}" stop-opacity=".8"/><stop offset=".45" stop-color="${sun}" stop-opacity=".3"/><stop offset="1" stop-color="${sun}" stop-opacity="0"/></radialGradient></defs><rect width="800" height="400" fill="url(#s)"/><circle cx="560" cy="150" r="250" fill="url(#g)"/><circle cx="560" cy="124" r="16" fill="${light(c2,.82)}"/>`;
 // Nuages légers au-dessus de l'aube.
 d+=`<g fill="${light(c1,.7)}" opacity=".55"><ellipse cx="150" cy="70" rx="90" ry="9"/><ellipse cx="190" cy="62" rx="50" ry="7"/><ellipse cx="420" cy="92" rx="70" ry="7"/><ellipse cx="690" cy="64" rx="60" ry="6"/></g>`;
 // Six collines, de la plus pâle (loin) à la plus soutenue (près), relief ondulé et contour à main levée.
 const ys=[204,230,258,290,324,360],bumps=[130,150,160,190,220,250];
 ys.forEach((y0,k)=>{const col=mix(mix(c1,c2,.08+k*.15),c1,(5-k)*.07),amp=20+k*8;let o=`M-5 400L-5 ${y0}`,x=-5,up=1;while(x<805){const st=bumps[k]*(.6+r()*.7);o+=`Q${i0(x+st*.5)} ${f(y0-up*amp*(.6+r()*.8))} ${i0(x+st)} ${f(y0+wob(r,10))}`;x+=st;up=-up;}
  d+=`<path d="${o}L805 400Z" fill="${col}"/><path d="${o.replace("M-5 400L-5 ","M-5 ")}" fill="none" stroke="${dark(col,.25)}" stroke-width=".9" opacity=".45"/>`;
  if(k>=2){for(let i=0;i<4+k;i++){const x=i0(r()*800),h=f((k-1)*4+r()*8),w=f(h*.28);d+=`<ellipse cx="${x}" cy="${f(y0+(k>=4?8:0)-h*.45+wob(r,6))}" rx="${w}" ry="${h}" fill="${dark(col,.45)}" opacity=".75"/>`;}}
  if(k>=3){for(let i=0;i<5;i++){const x=i0(r()*800),R=f(3+k+r()*6);d+=`<circle cx="${x}" cy="${f(y0+6+wob(r,10))}" r="${R}" fill="${dark(col,.3)}" opacity=".7"/>`;}}});
 // Chemin qui serpente vers la lumière, bords au trait pointillé.
 d+=`<path d="M310 400C370 362 260 348 430 322C480 312 522 304 548 288L554 288C540 304 492 322 444 332C310 356 406 368 356 400Z" fill="${light(c1,.55)}" opacity=".8"/><path d="M310 400C370 362 260 348 430 322C480 312 522 304 548 288M554 288C540 304 492 322 444 332C310 356 406 368 356 400" fill="none" stroke="${dk}" stroke-width=".9" stroke-dasharray="3 4" opacity=".5"/>`;
 // Hachures d'herbe au premier plan, oiseaux.
 let h="";for(let i=0;i<46;i++){const x=i0(r()*800),y=i0(362+r()*38),l=f(4+r()*6);h+=`M${x} ${y}l${f(wob(r,3))} ${-l}`;}
 d+=`<path d="${h}" stroke="${dk}" stroke-width=".9" opacity=".5" fill="none"/>`;
 let b="";for(let i=0;i<4;i++){const x=i0(120+r()*300),y=i0(60+r()*70),s=f(.6+r()*.6);b+=`<path d="M${x} ${y}q${f(5*s)} ${f(-4*s)} ${f(10*s)} 0q${f(5*s)} ${f(-4*s)} ${f(10*s)} 0" fill="none" stroke="${dk}" stroke-width="1" opacity=".55"/>`;}
 return d+b;};
P["pano-pines"]=(p,r)=>{const{c1,c2}=p,pine=dark(mix(c2,"#3a5a3a",.45),.3),pine2=mix(pine,c2,.3),trunk=dark(mix(c2,"#6b4a30",.75),.25),ground=mix("#c3a26f",c2,.15);
 const canopy=`<g id="c"><path d="M-80 0C-76 -14 -64 -24 -50 -25C-42 -38 -22 -42 -8 -36C8 -48 38 -42 52 -30C68 -28 80 -16 82 -4C70 4 52 10 36 5C20 14 2 12 -12 5C-32 12 -62 10 -80 0Z"/></g>`;
 let d=`<defs>${canopy}<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light(c1,.4)}"/><stop offset="1" stop-color="${mix(c1,c2,.06)}"/></linearGradient><linearGradient id="e" gradientUnits="userSpaceOnUse" x1="0" y1="202" x2="0" y2="330"><stop offset="0" stop-color="${light(c2,.5)}"/><stop offset=".45" stop-color="${light(c2,.2)}"/><stop offset="1" stop-color="${c2}"/></linearGradient><radialGradient id="h"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><rect width="800" height="400" fill="url(#s)"/><circle cx="640" cy="40" r="240" fill="url(#h)"/><g fill="#fff" opacity=".45"><ellipse cx="130" cy="60" rx="80" ry="8"/><ellipse cx="300" cy="86" rx="50" ry="6"/></g>`;
 // Horizon, caps lointains dans la brume, mer dégradée (claire au large, profonde près du rivage).
 d+=`<path d="M430 196Q560 172 700 188L800 184L800 204L430 204Z" fill="${mix(c1,c2,.28)}" opacity=".8"/><path d="M600 198Q700 180 800 192L800 206L600 206Z" fill="${mix(c1,c2,.42)}" opacity=".85"/><rect y="202" width="800" height="128" fill="url(#e)"/><rect y="202" width="800" height="2.5" fill="${light(c1,.6)}" opacity=".75"/>`;
 let sp="";for(let i=0;i<34;i++){const x=i0(r()*800),y=i0(208+r()*100),l=f(6+(y-200)*.5*r());sp+=`M${x} ${y}h${l}`;}
 d+=`<path d="${sp}" stroke="#fff" stroke-width="1.2" opacity=".5"/>`;
 // Pente sableuse au premier plan (rivage irrégulier), arbustes, ombres.
 d+=`<path d="M0 400L0 322C140 304 300 330 470 312C610 298 720 304 800 296L800 400Z" fill="${ground}"/><path d="M0 322C140 304 300 330 470 312C610 298 720 304 800 296" fill="none" stroke="${light(c1,.5)}" stroke-width="2" opacity=".6"/><path d="M0 326C140 308 300 334 470 316C610 302 720 308 800 300" fill="none" stroke="${dark(ground,.3)}" stroke-width="1" opacity=".4"/>`;
 for(let i=0;i<14;i++){const x=i0(r()*800),y=i0(318+r()*70),s=f(.12+r()*.18);d+=`<use href="#c" transform="translate(${x} ${y})scale(${s} ${f(s*.8)})" fill="${i%3?pine2:pine}" opacity=".85"/>`;}
 // Pins parasols : tronc effilé, 2–3 houppiers, branche, éclairage côté soleil.
 const trees=[[70,.78,22,1],[250,1,16,1],[640,.62,-14,1],[760,.5,-10,1],[440,.42,8,.9]];
 for(const[x,s,lean,op]of trees){const top=400-250*s,tx=x+lean*2.4*s;d+=`<g opacity="${op}"><ellipse cx="${x+40*s}" cy="${f(400-70*s)}" rx="${f(90*s)}" ry="${f(9*s)}" fill="#000" opacity=".12"/><path d="M${f(x-7*s)} 400Q${f(x+lean*.5*s)} ${f(400-120*s)} ${f(tx-3*s)} ${f(top+40*s)}L${f(tx+3*s)} ${f(top+40*s)}Q${f(x+lean*.6*s+10*s)} ${f(400-120*s)} ${f(x+8*s)} 400Z" fill="${trunk}"/><path d="M${f(tx)} ${f(top+40*s)}L${f(tx-44*s)} ${f(top+12*s)}M${f(tx)} ${f(top+40*s)}L${f(tx+46*s)} ${f(top+8*s)}M${f(tx)} ${f(top+40*s)}L${f(tx+6*s)} ${f(top)}" stroke="${trunk}" stroke-width="${f(4*s)}" fill="none" stroke-linecap="round"/><use href="#c" transform="translate(${f(tx-40*s)} ${f(top+14*s)})scale(${f(.9*s)})" fill="${pine}"/><use href="#c" transform="translate(${f(tx+44*s)} ${f(top+10*s)})scale(${f(.95*s)})" fill="${pine2}"/><use href="#c" transform="translate(${f(tx+4*s)} ${f(top-2*s)})scale(${f(1.1*s)})" fill="${pine}"/><use href="#c" transform="translate(${f(tx+14*s)} ${f(top-10*s)})scale(${f(.7*s)} ${f(.5*s)})" fill="${light(pine,.22)}" opacity=".7"/></g>`;}
 return d;};
// Crête à main levée : silhouette ondulée depuis y0 (bosses d'amplitude amp, pas step), remplie jusqu'en bas.
const ridge=(r,y0,amp,step,col,op)=>{let o=`M-5 400L-5 ${y0}`,x=-5,up=1;while(x<805){const st=step*(.6+r()*.8);o+=`Q${i0(x+st*.5)} ${f(y0-up*amp*(.4+r()*.9))} ${i0(x+st)} ${f(y0+wob(r,6))}`;x+=st;up=-up;}return`<path d="${o}L805 400Z" fill="${col}" opacity="${op}"/>`;};
// — Panoramique scénique peint (Jardin peint, Forêt de brume) : paysage classique XVIIIe–XIXe en 5 plans (collines, lisière lointaine,
//   lac et clairière, bosquets, repoussoirs). Feuillages tamponnés : gribouillis quadratiques parcourant une ellipse, tirets de longueur
//   nulle à bouts ronds = points (3 tailles, couleur héritée par currentColor) + points d'ombre en bas et de lumière en haut à gauche ;
//   troncs fins et sinueux ; brume entre les plans (opacités décroissantes) ; ciel lavé à grain papier ; oiseaux.
P["pano-scenic"]=(p,r)=>{const{c1,c2}=p,sep=dark(mix(c2,"#6b4a30",.7),.3),och=mix(c1,"#c8a064",.45),hz=light(c1,.5),veg=t=>mix(c1,c2,t);
 const sq=(n,rx,ry,ox,oy)=>{let o="";for(let i=0;i<n;i++){const a=i*2.4+r()*.6,k=.35+r()*.65;o+=(i?`Q${i0(ox+Math.cos(a-1.2)*rx*(.5+r()*.5))} ${i0(oy+Math.sin(a-1.2)*ry*(.5+r()*.5))} `:"M")+`${i0(ox+Math.cos(a)*rx*k)} ${i0(oy+Math.sin(a)*ry*k)}`;}return o;};
 const dots=(d,w,x)=>`<path d="${d}" stroke-width="${w}" stroke-dasharray="0 ${f(w*.85)}"${x||""}/>`;
 const clump=`<g id="k" fill="none" stroke="currentColor" stroke-linecap="round">${dots(sq(9,14,9,0,0),6.5)}${dots(sq(9,13,9,1,-1),4.5)}${dots(sq(7,15,10,0,0),3)}${dots(sq(6,12,5,2,6),5,' stroke="#000" opacity=".15"')}${dots(sq(5,8,4,-6,-6),3.5,' stroke="#fff" opacity=".2"')}</g><g id="j"><use href="#k" transform="scale(1.25 .8)"/><use href="#k" transform="translate(7 -8)scale(.65)"/></g>`;
 // Arbre : tronc effilé et sinueux (polygone), deux branches, 4–5 touffes ; la couleur du feuillage est héritée du <use color>.
 const tree=(id,h,ln,cl)=>{let o=`<g id="${id}"><path d="M-2.2 0C-1.4 ${f(-h*.25)} ${f(ln-1)} ${f(-h*.42)} ${f(ln*1.4-.7)} ${f(-h*.7)}L${f(ln*1.4+.7)} ${f(-h*.7)}C${f(ln+1)} ${f(-h*.42)} 1.6 ${f(-h*.25)} 2.6 0Z" fill="${sep}"/><path d="M${f(ln*.5)} ${f(-h*.46)}c-6 -7 -13 -11 -20 -14M${f(ln)} ${f(-h*.58)}c6 -5 12 -9 19 -11" fill="none" stroke="${sep}" stroke-width="1.2" stroke-linecap="round"/>`;
  for(const[x,y,s,c]of cl)o+=`<use href="#${c}" transform="translate(${x} ${f(-h*y)})scale(${s})"/>`;return o+`</g>`;};
 // Forme molle (lac) : n points autour d'une ellipse, rayons perturbés, raccordés par des quadratiques.
 const blob=(cx,cy,rx,ry,n,j)=>{const pt=[];for(let i=0;i<n;i++){const a=i/n*6.283,k=1+(r()-.5)*j;pt.push([cx+Math.cos(a)*rx*k,cy+Math.sin(a)*ry*k]);}let o="";
  for(let i=0;i<n;i++){const[x0,y0]=pt[i],[x1,y1]=pt[(i+1)%n],a=(i+.5)/n*6.283,k=1.08+(r()-.5)*j;o+=(i?"":`M${i0(x0)} ${i0(y0)}`)+`Q${i0(cx+Math.cos(a)*rx*k)} ${i0(cy+Math.sin(a)*ry*k)} ${i0(x1)} ${i0(y1)}`;}return o+"Z";};
 let d=`<defs>${noise(".9",2,.2,"fractalNoise",800,400)}<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light(c1,.5)}"/><stop offset=".55" stop-color="${c1}"/><stop offset="1" stop-color="${mix(c1,och,.5)}"/></linearGradient><linearGradient id="m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hz}" stop-opacity="0"/><stop offset="1" stop-color="${hz}" stop-opacity=".9"/></linearGradient><linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light(c1,.3)}"/><stop offset="1" stop-color="${veg(.3)}"/></linearGradient><radialGradient id="g"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>${clump}${tree("t",84,-5,[[-15,.74,1.15,"k"],[14,.8,1.3,"j"],[-3,.98,1,"k"],[26,.6,.85,"j"],[-28,.6,.8,"k"],[4,.68,.9,"j"]])}${tree("u",112,7,[[-10,.8,1.05,"j"],[13,.9,1.1,"k"],[2,1.04,.9,"j"],[-22,.66,.75,"k"],[12,.72,.8,"j"]])}</defs><rect width="800" height="400" fill="url(#s)" filter="url(#n)"/><circle cx="520" cy="215" r="280" fill="url(#g)"/>`;
 // Ciel : nuages doux (deux ellipses par nuage) ; plan 1 (collines pâles) + brume ; plan 2 (lisière pointillée) + brume.
 d+=`<g fill="${light(c1,.75)}">`;for(let i=0;i<5;i++){const x=i0(40+r()*720),y=i0(35+r()*120),rx=i0(40+r()*70),ry=i0(5+r()*7),o=f(.3+r()*.3);d+=`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" opacity="${o}"/><ellipse cx="${i0(x+rx*.3)}" cy="${i0(y-ry*.7)}" rx="${i0(rx*.5)}" ry="${i0(ry*.8)}" opacity="${o}"/>`;}
 d+=`</g>`+ridge(r,236,22,140,veg(.2),.75)+`<rect y="205" width="800" height="60" fill="url(#m)" opacity=".55"/><g color="${veg(.42)}">`;
 for(let i=0;i<9;i++)d+=`<use href="#${i%2?"k":"j"}" transform="translate(${i0(i*92+r()*60)} ${i0(254+r()*8)})scale(${f(.45+r()*.35)})"/>`;
 d+=`</g><rect y="240" width="800" height="62" fill="url(#m)" opacity=".45"/>`;
 // Plan 3 : clairière et lac (reflet sombre près de la rive lointaine, rides claires).
 d+=ridge(r,270,4,200,mix(och,c2,.35),1)+`<path d="${blob(505,306,250,24,10,.25)}" fill="url(#w)" stroke="${och}" stroke-width="1.5" stroke-opacity=".5"/><ellipse cx="505" cy="296" rx="225" ry="8" fill="${veg(.45)}" opacity=".3"/>`;
 for(let i=0;i<4;i++)d+=`<ellipse cx="${i0(300+r()*400)}" cy="${i0(302+r()*16)}" rx="${i0(30+r()*40)}" ry="${f(2.5+r()*2)}" fill="${veg(.55)}" opacity=".22"/>`;
 let rp="";for(let i=0;i<10;i++)rp+=`M${i0(280+r()*450)} ${i0(288+r()*36)}h${i0(10+r()*40)}`;d+=`<path d="${rp}" stroke="#fff" stroke-width="1" opacity=".45"/>`;
 // Plan 4 : bosquets (de plus en plus soutenus vers l'avant), buissons, brume au sol.
 for(const[x,y,s,id,t]of[[62,320,1,"t",.6],[150,332,1.15,"u",.68],[332,346,1.05,"t",.78],[425,352,1.2,"u",.84],[608,350,1.1,"t",.8],[702,340,.95,"u",.72],[786,324,.9,"t",.66]])d+=`<use href="#${id}" transform="translate(${i0(x+wob(r,16))} ${y})scale(${s})" color="${veg(t)}"/>`;
 d+=`<g color="${veg(.78)}">`;for(let i=0;i<4;i++)d+=`<use href="#${i%2?"k":"j"}" transform="translate(${i0(r()*800)} ${i0(330+r()*24)})scale(${f(.6+r()*.5)})"/>`;
 d+=`</g><rect y="326" width="800" height="48" fill="url(#m)" opacity=".3"/>`+ridge(r,362,8,180,dark(mix(och,c2,.5),.12),1);
 // Plan 5 : touffes d'herbe, deux grands arbres-repoussoirs, oiseaux.
 let gr="";for(let i=0;i<22;i++){const x=i0(r()*800),y=i0(366+r()*34),l=i0(5+r()*9);gr+=`M${x} ${y}q${i0(wob(r,4))} ${-i0(l*.6)} ${i0(1+wob(r,4))} ${-l}`;}
 d+=`<path d="${gr}" fill="none" stroke="${dark(c2,.3)}" stroke-width=".9" opacity=".55"/><use href="#t" transform="translate(70 420)scale(3.4)" color="${dark(c2,.25)}"/><use href="#u" transform="translate(760 415)scale(2.6)" color="${dark(c2,.18)}"/>`;
 let b="";for(let i=0;i<4;i++){const x=i0(300+r()*300),y=i0(70+r()*90),s=f(.6+r()*.7);b+=`M${x} ${y}q${f(4*s)} ${f(-3*s)} ${f(8*s)} 0q${f(4*s)} ${f(-3*s)} ${f(8*s)} 0`;}
 return d+`<path d="${b}" fill="none" stroke="${sep}" stroke-width="1" opacity=".6"/>`;};
// — Panoramique « gravure » (Palmiers) : palmiers de plusieurs hauteurs, bananiers au premier plan, ciel lavé. Tout est tracé à la plume en c2
//   (contours + hachures fines en <pattern>, la densité donne la valeur) sur fond c1. Palme (nervure arquée, folioles retombantes),
//   couronne (palmes droites + miroir) et feuille de bananier définies une fois ; anneaux des troncs = trait tireté ; lointains pâles.
P["pano-palms"]=(p,r)=>{const{c1,c2}=p,ink=c2,Q=(t,a,b,c)=>(1-t)*(1-t)*a+2*(1-t)*t*b+t*t*c;
 let lf="";for(let t=.08;t<.97;t+=.05){const x=i0(Q(t,0,46,84)),y=i0(Q(t,0,-36,12)),k=1-t*.55;lf+=`M${x} ${y}l${i0(7*k)} ${i0(-12*k)}M${x} ${y}q${i0(5*k)} ${i0(6*k)} ${i0(6*k)} ${i0(15*k)}`;}
 const frond=`<g id="F"><path d="M0 -2Q44 -48 90 8Q48 -24 0 2Z" fill="url(#h1)" opacity=".8"/><path d="M0 0Q46 -36 84 12" fill="none" stroke="${ink}" stroke-width="1.2"/><path d="${lf}" fill="none" stroke="${ink}" stroke-width=".7"/></g>`;
 let cr=`<g id="C">`;for(const[a,s]of[[-62,.85],[-34,1],[-8,1.05],[20,1],[48,.9],[76,.6]])cr+=`<use href="#F" transform="rotate(${a})scale(${s})"/><use href="#F" transform="scale(-1 1)rotate(${a+6})scale(${f(s*.95)})"/>`;
 cr+=`<circle cx="2" cy="4" r="3.2" fill="${ink}"/><circle cx="-4" cy="6" r="2.8" fill="${ink}"/><circle cx="6" cy="8" r="2.6" fill="url(#h2)" stroke="${ink}" stroke-width=".7"/></g>`;
 let vn="";for(let t=.1;t<.95;t+=.09){const x=i0(Q(t,0,75,150)),y=i0(Q(t,0,-45,-40)),u=1-t*.5;vn+=`M${x} ${y}q${i0(4*u)} ${i0(-14*u)} ${i0(12*u)} ${i0(-24*u)}M${x} ${y}q${i0(9*u)} ${i0(7*u)} ${i0(14*u)} ${i0(18*u)}`;}
 const ban=`<g id="B"><path d="M0 0C30 -70 100 -85 150 -40C120 -20 60 10 0 0Z" fill="url(#h1)" opacity=".85" stroke="${ink}" stroke-width="1.3"/><path d="M0 0Q75 -45 150 -40" fill="none" stroke="${ink}" stroke-width="1.6"/><path d="${vn}" fill="none" stroke="${ink}" stroke-width=".7" opacity=".9"/><path d="M58 -28l12 -24M100 -36l10 -20" stroke="${c1}" stroke-width="2.4"/></g>`;
 // Palmier : tronc effilé et courbe (hachuré, contour), anneaux en tirets, couronne posée au sommet.
 const palm=(x,yb,H,ln,s,op)=>{const tx=x+ln,ty=yb-H,cx=f(x+ln*.3),cy=f(yb-H*.5),w=5*s;return`<g opacity="${op}"><path d="M${f(x-w)} ${yb}Q${cx} ${cy} ${f(tx-w*.5)} ${ty}L${f(tx+w*.5)} ${ty}Q${f(cx+w*1.2)} ${cy} ${f(x+w)} ${yb}Z" fill="url(#h2)" stroke="${ink}" stroke-width="${f(.9*s)}"/><path d="M${x} ${yb}Q${cx} ${cy} ${tx} ${ty}" fill="none" stroke="${ink}" stroke-width="${f(6*s)}" stroke-dasharray="${f(.7*s)} ${f(10*s)}" opacity=".7"/><use href="#C" transform="translate(${tx} ${f(ty-3*s)})scale(${s})"/></g>`;};
 let d=`<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light(c1,.45)}"/><stop offset="1" stop-color="${c1}"/></linearGradient><pattern id="h1" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)"><path d="M0 2h4" stroke="${ink}" stroke-width=".6"/></pattern><pattern id="h2" width="2.6" height="2.6" patternUnits="userSpaceOnUse" patternTransform="rotate(-62)"><path d="M0 1.3h2.6" stroke="${ink}" stroke-width=".7"/></pattern><pattern id="h3" width="6" height="3.2" patternUnits="userSpaceOnUse"><path d="M0 1.6h6" stroke="${ink}" stroke-width=".55"/></pattern>${frond}${cr}${ban}</defs><rect width="800" height="400" fill="url(#s)"/>`;
 // Nuages à la plume (paquets de traits horizontaux décroissants), sol hachuré (horizon, hachures plus denses en bas), touffes.
 let cl="";for(let i=0;i<4;i++){const x=i0(60+r()*640),y=i0(40+r()*110),L=i0(60+r()*90);for(let k=0;k<5;k++)cl+=`M${i0(x+k*7+r()*6)} ${y+k*3}h${L-k*15}`;}
 d+=`<path d="${cl}" stroke="${ink}" stroke-width=".55" opacity=".45"/><path d="M0 302Q400 296 800 304L800 400L0 400Z" fill="url(#h3)" opacity=".55"/><path d="M0 302Q400 296 800 304" fill="none" stroke="${ink}" stroke-width=".8" opacity=".7"/><rect y="352" width="800" height="48" fill="url(#h1)" opacity=".5"/>`;
 let tf="";for(let i=0;i<22;i++){const x=i0(r()*800),y=i0(306+r()*90),l=i0(4+r()*8);tf+=`M${x} ${y}l${i0(wob(r,3))} ${-l}M${x} ${y}l${i0(2+wob(r,2))} ${-i0(l*.7)}`;}
 d+=`<path d="${tf}" fill="none" stroke="${ink}" stroke-width=".7" opacity=".7"/>`;
 // Palmiers lointains (pâles) sur l'horizon, buissons en éventail au sol, trois sujets principaux, bananiers en repoussoir, oiseaux.
 for(const[x,H,ln,s]of[[120,70,6,.45],[430,56,-5,.4],[650,64,7,.42]])d+=palm(i0(x+wob(r,10)),302,H,ln,s,.45);
 for(const x of[230,330,470,560,620,760])d+=`<use href="#C" transform="translate(${i0(x+wob(r,30))} ${i0(386+r()*10)})scale(${f(.28+r()*.14)})"/>`;
 d+=palm(430,404,165,-18,.62,.8)+palm(190,404,310,-45,1.15,1)+palm(585,404,262,34,1,1)+palm(700,404,175,12,.72,1);
 d+=`<use href="#B" transform="translate(-30 414)rotate(-38)scale(1.7)"/><use href="#B" transform="translate(30 426)rotate(-6)scale(1.45)"/><use href="#B" transform="translate(830 416)scale(-1.6 1.6)rotate(-30)"/><use href="#B" transform="translate(800 430)scale(-1.2 1.2)rotate(-72)"/>`;
 let b="";for(let i=0;i<3;i++){const x=i0(260+r()*300),y=i0(60+r()*80),s=f(.6+r()*.6);b+=`M${x} ${y}q${f(4*s)} ${f(-3*s)} ${f(8*s)} 0q${f(4*s)} ${f(-3*s)} ${f(8*s)} 0`;}
 return d+`<path d="${b}" fill="none" stroke="${ink}" stroke-width=".9" opacity=".7"/>`;};
// Clé connue → motif ; clé inconnue (ou couleurs manquantes) → repli : tuile unie c1 à grain léger, jamais d'exception ni d'« undefined ».
const keys=[...Object.keys(T),...Object.keys(P)],own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function tile(p){p=Object.assign({},p);p.c1=p.c1||"#d9d2c5";p.c2=p.c2||"#b9ad98";const pat=String(p.pat||"lin"),pano=own(P,pat),draw=pano?P[pat]:own(T,pat)?T[pat]:null,r=lcg(1+[...pat].reduce((a,c)=>a+c.charCodeAt(0),0));
 const body=draw?draw(p,r):`<defs>${noise(".8",2,.18)}</defs><rect width="256" height="256" fill="${p.c1}" filter="url(#n)"/>`;
 const w=pano?800:S,h=pano?400:S;
 return`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;}
return{tile,mix,keys};})();
function svgTile(p){return"data:image/svg+xml;utf8,"+encodeURIComponent(WS_PAT.tile(p));}
const tileCm=p=>p.rep>0?p.rep:Math.min(p.w,70);
const isPano=p=>p.unit==="m2";
const PATTERN_KEYS=WS_PAT.keys.slice();

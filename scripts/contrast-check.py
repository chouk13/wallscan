"""Vérifie les contrastes WCAG des paires du brief v3 (et de celles passées en argument : fg,bg,label)."""
import sys
def lum(h):
    h=h.lstrip('#'); r,g,b=[int(h[i:i+2],16)/255 for i in (0,2,4)]
    f=lambda c: c/12.92 if c<=0.03928 else ((c+0.055)/1.055)**2.4
    return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b)
def ratio(a,b):
    la,lb=lum(a),lum(b); hi,lo=max(la,lb),min(la,lb); return (hi+0.05)/(lo+0.05)
PAIRS=[("#F3F2EE","#161616","Papier sur Graphite (texte Atelier)"),("#9DB5A6","#161616","Sauge sur Graphite (secondaire Atelier)"),
       ("#1F3D36","#F3F2EE","Vert cabinet sur Papier (encre Carnet)"),("#5B6762","#F3F2EE","Secondaire sur Papier"),
       ("#1F3D36","#E6E1D6","Vert cabinet sur Lin"),("#F3F2EE","#1F3D36","Papier sur Vert cabinet (bouton)"),
       ("#B08D57","#161616","Laiton sur Graphite (accent)"),("#B08D57","#F3F2EE","Laiton sur Papier (filet, décoratif)"),
       ("#B8642E","#F3F2EE","Ocre brûlée sur Papier (alerte)"),("#B8642E","#161616","Ocre brûlée sur Graphite (alerte)")]
for a in sys.argv[1:]:
    fg,bg,lab=a.split(",",2); PAIRS.append((fg,bg,lab))
for fg,bg,lab in PAIRS:
    r=ratio(fg,bg); print(f"{r:5.2f}:1  {'AA' if r>=4.5 else ('AA-large' if r>=3 else 'FAIL')}  {lab} ({fg} / {bg})")

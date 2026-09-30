// ---------- plotting ----------
const NS="http://www.w3.org/2000/svg";
function niceTicks(lo,hi,target){
  if(!(hi>lo)){hi=lo+1;}
  const span=hi-lo, raw=span/target, mag=Math.pow(10,Math.floor(Math.log10(raw))), r=raw/mag;
  const step=(r<1.5?1:r<3?2:r<7?5:10)*mag, out=[];
  for(let v=Math.ceil(lo/step-1e-9)*step; v<=hi+step*1e-9; v+=step) out.push(+v.toPrecision(12));
  return out;
}
function fmt(v){ if(v===0)return "0"; const a=Math.abs(v); if(a>=1e5||a<1e-3) return v.toExponential(1).replace("e+","e"); return +v.toPrecision(4)+""; }
function plot(el,cfg){
  // cfg: {title,xlabel,ylabel,series:[{name,x,y,color,dash,w,pts}],ylog,xlog,ydom,xdom,id}
  const W=560,H=310,m={l:56,r:12,t:8,b:40};
  const S=cfg.series.filter(s=>s.x&&s.x.length);
  let xs=[],ys=[];
  S.forEach(s=>{for(let i=0;i<s.x.length;i++){const X=s.x[i],Y=s.y[i]; if(isFinite(X)&&isFinite(Y)&&(!cfg.ylog||Y>0)&&(!cfg.xlog||X>0)&&(!cfg.xdom||(X>=cfg.xdom[0]&&X<=cfg.xdom[1]))){xs.push(X);ys.push(Y);}}});
  let xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.min(...ys),ymax=Math.max(...ys);
  if(!xs.length){xmin=0;xmax=1;ymin=0;ymax=1;}
  if(cfg.xdom){[xmin,xmax]=cfg.xdom;} if(cfg.ydom){[ymin,ymax]=cfg.ydom;}
  const padY=(ymax-ymin)*0.05||1; if(!cfg.ydom&&!cfg.ylog){ymin-=padY;ymax+=padY;}
  const fx=cfg.xlog?Math.log10:(v=>v), fy=cfg.ylog?Math.log10:(v=>v);
  let X0=fx(xmin),X1=fx(xmax),Y0=fy(ymin),Y1=fy(ymax);
  if(cfg.ylog&&!cfg.ydom){Y0=Math.floor(Y0);Y1=Math.ceil(Y1);} if(cfg.xlog&&!cfg.xdom){X0=Math.floor(X0);X1=Math.ceil(X1);}
  if(X1===X0)X1=X0+1; if(Y1===Y0)Y1=Y0+1;
  const sx=v=>m.l+(fx(v)-X0)/(X1-X0)*(W-m.l-m.r), sy=v=>H-m.b-(fy(v)-Y0)/(Y1-Y0)*(H-m.t-m.b);
  let g=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${cfg.title}"><g class="axis">`;
  const xt=cfg.xlog?range(Math.ceil(X0),Math.floor(X1)).map(e=>Math.pow(10,e)):niceTicks(X0,X1,6);
  const yt=cfg.ylog?range(Math.ceil(Y0),Math.floor(Y1)).map(e=>Math.pow(10,e)):niceTicks(Y0,Y1,6);
  xt.forEach(v=>{const x=sx(v); if(x<m.l-1||x>W-m.r+1)return; g+=`<line x1="${x}" x2="${x}" y1="${m.t}" y2="${H-m.b}" stroke="var(--grid)"/><text x="${x}" y="${H-m.b+15}" text-anchor="middle">${cfg.xlog?"1e"+Math.round(Math.log10(v)):fmt(v)}</text>`;});
  yt.forEach(v=>{const y=sy(v); if(y<m.t-1||y>H-m.b+1)return; g+=`<line x1="${m.l}" x2="${W-m.r}" y1="${y}" y2="${y}" stroke="var(--grid)"/><text x="${m.l-6}" y="${y+3.5}" text-anchor="end">${cfg.ylog?"1e"+Math.round(Math.log10(v)):fmt(v)}</text>`;});
  g+=`<rect x="${m.l}" y="${m.t}" width="${W-m.l-m.r}" height="${H-m.t-m.b}" fill="none" stroke="var(--line)"/></g>`;
  g+=`<clipPath id="c-${cfg.id}"><rect x="${m.l}" y="${m.t}" width="${W-m.l-m.r}" height="${H-m.t-m.b}"/></clipPath><g clip-path="url(#c-${cfg.id})">`;
  const flat=[];
  S.forEach((s,si)=>{
    if(s.pts){ for(let i=0;i<s.x.length;i++){ if(!isFinite(s.x[i])||!isFinite(s.y[i]))continue; g+=`<circle cx="${sx(s.x[i]).toFixed(1)}" cy="${sy(s.y[i]).toFixed(1)}" r="${s.r||2.6}" fill="${s.color}" fill-opacity=".75"/>`; flat.push([sx(s.x[i]),sy(s.y[i]),si,i]); } return; }
    let d="",pen=false;
    for(let i=0;i<s.x.length;i++){
      const ok=isFinite(s.x[i])&&isFinite(s.y[i])&&(!cfg.ylog||s.y[i]>0)&&(!cfg.xlog||s.x[i]>0);
      if(!ok){pen=false;continue;}
      const X=sx(s.x[i]),Y=sy(s.y[i]); d+=(pen?"L":"M")+X.toFixed(1)+" "+Y.toFixed(1); pen=true; flat.push([X,Y,si,i]);
    }
    g+=`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.w||2}" ${s.dash?`stroke-dasharray="${s.dash}"`:""} stroke-linejoin="round" stroke-linecap="round" ${s.op?`opacity="${s.op}"`:""}/>`;
  });
  g+=`</g><text class="axlabel" x="${(m.l+W-m.r)/2}" y="${H-6}" text-anchor="middle">${cfg.xlabel}</text>`;
  g+=`<text class="axlabel" transform="translate(13 ${(m.t+H-m.b)/2}) rotate(-90)" text-anchor="middle">${cfg.ylabel}</text>`;
  g+=`<g class="hov" style="display:none"><line class="vl" y1="${m.t}" y2="${H-m.b}" stroke="var(--muted)" stroke-dasharray="3 3"/><circle r="4" fill="none" stroke="var(--ink)" stroke-width="1.6"/></g>`;
  g+=`<rect class="cap" x="${m.l}" y="${m.t}" width="${W-m.l-m.r}" height="${H-m.t-m.b}" fill="transparent"/></svg>`;
  const legend=S.filter(s=>s.name).map(s=>`<span style="color:${s.color}"><i class="${s.pts?"dot":s.dash?"dash":""}" style="border-color:${s.color}"></i><span style="color:var(--muted)">${s.name}</span></span>`).join("");
  el.classList.remove("isempty");
  el.innerHTML=`<h3><span>${cfg.title}</span><span class="tools"><button class="btn small" data-svg>SVG</button></span></h3>${g}<div class="legend">${legend}</div><div class="tip"></div>`;
  const svg=el.querySelector("svg"),tip=el.querySelector(".tip"),hov=svg.querySelector(".hov"),cap=svg.querySelector(".cap");
  cap.addEventListener("mousemove",ev=>{
    const sp=svg.createSVGPoint(); sp.x=ev.clientX; sp.y=ev.clientY; const q=sp.matrixTransform(svg.getScreenCTM().inverse()), px=q.x, py=q.y;
    let best=null,bd=1e9; for(const q of flat){const dd=(q[0]-px)**2+(q[1]-py)**2*0.25; if(dd<bd){bd=dd;best=q;}}
    if(!best||bd>1600){hov.style.display="none";tip.style.display="none";return;}
    const s=S[best[2]],i=best[3]; hov.style.display="";hov.querySelector("circle").setAttribute("cx",best[0]);hov.querySelector("circle").setAttribute("cy",best[1]);
    hov.querySelector(".vl").setAttribute("x1",best[0]);hov.querySelector(".vl").setAttribute("x2",best[0]);
    tip.style.display="block"; tip.innerHTML=`${s.name?`<b style="color:${s.color}">${s.name}</b><br>`:""}${cfg.xshort||"x"} = ${fmt(s.x[i])}<br>${cfg.yshort||"y"} = ${fmt(s.y[i])}`;
    const cr=el.getBoundingClientRect(); tip.style.left=Math.min(ev.clientX-cr.left+12,cr.width-150)+"px"; tip.style.top=(ev.clientY-cr.top-8)+"px";
  });
  cap.addEventListener("mouseleave",()=>{hov.style.display="none";tip.style.display="none";});
  el.querySelector("[data-svg]").addEventListener("click",()=>exportSVG(svg,cfg.id));
}
function range(a,b){const o=[];for(let i=a;i<=b;i++)o.push(i);return o;}
function exportSVG(svg,name){
  const cs=getComputedStyle(document.documentElement); let s=new XMLSerializer().serializeToString(svg);
  s=s.replace(/var\((--[a-z0-9-]+)\)/g,(_,v)=>cs.getPropertyValue(v).trim()||"#000");
  s=s.replace("<svg ",'<svg xmlns="http://www.w3.org/2000/svg" font-family="Helvetica,Arial,sans-serif" ').replace(/<text class="(axis|axlabel)?/g,'<text ');
  s=s.replace(/<g class="axis">/,'<g class="axis" fill="'+cs.getPropertyValue("--muted").trim()+'" font-size="11">').replace(/<text /g,'<text fill="'+cs.getPropertyValue("--ink").trim()+'" font-size="12" ');
  dl(new Blob([s],{type:"image/svg+xml"}),`TL_${name}.svg`);
}
function dl(blob,name){const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}


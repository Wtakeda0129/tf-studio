
// ---------- GeAsSe DSC dataset ----------
const DS = GEASSE_DATA.comps;
const DIRS = ["cooling","heating"];
const compNum = c => { const m=c.match(/Ge([\d.]+)As([\d.]+)Se([\d.]+)/); return m?[+m[1],+m[2]]:[0,0]; };
const DS_KEYS = Object.keys(DS).sort((a,b)=>{const A=compNum(a),B=compNum(b);return A[0]-B[0]||A[1]-B[1];});
const subFormula = c => c.replace(/([A-Z][a-z]?)([\d.]+)/g,(_,el,n)=>`${el}<sub>${n}</sub>`);
if(!DS_KEYS.length){ $("#dataCard").hidden=true; const gn=$("#geasseNote"); if(gn) gn.hidden=true; }   // public build without the Ge–As–Se data
DS_KEYS.forEach(c=>{const o=document.createElement("option");o.value=c;o.textContent=c+(DS[c].fit?"":"  (no TL fit)");$("#ds-comp").appendChild(o);});
state.ds=null;

function linfit(T,H,a,b){ let n=0,sx=0,sy=0,sxx=0,sxy=0; for(let i=0;i<T.length;i++){const x=T[i];if(x<a||x>b)continue;const y=H[i];n++;sx+=x;sy+=y;sxx+=x*x;sxy+=x*y;}
  if(n<3) return null; const s=(n*sxy-sx*sy)/(n*sxx-sx*sx); return [s,(sy-s*sx)/n]; }
function normalizeDS(){
  const ds=state.ds; if(!ds) return; ds.curves={}; ds.warn=[];
  for(const d of DIRS){
    const sc=DS[ds.comp].scans[d], r=ds.ranges[d]; if(!sc||!r) continue;
    const g=linfit(sc.T,sc.HF,r.glass[0],r.glass[1]), l=linfit(sc.T,sc.HF,r.liquid[0],r.liquid[1]);
    if(!g||!l){ ds.warn.push(`${d}: fewer than 3 points in a baseline window`); continue; }
    const lo=Math.min(r.glass[0],r.liquid[1]), hi=Math.max(r.glass[0],r.liquid[1]), T=[],cp=[];
    for(let i=0;i<sc.T.length;i++){const x=sc.T[i]; if(x<lo||x>hi)continue; const hg=g[0]*x+g[1], hl=l[0]*x+l[1]; T.push(x+273.15); cp.push((sc.HF[i]-hg)/(hl-hg));}
    ds.curves[d]={T:Float64Array.from(T),cp:Float64Array.from(cp),win:[lo+273.15,hi+273.15]};
  }
}
function renderRanges(){
  const ds=state.ds, box=$("#ds-ranges"); if(!ds){box.innerHTML="";return;}
  let h=`<span></span><span class="sub2">glass from</span><span class="sub2">glass to</span><span class="sub2">liquid from</span><span class="sub2">liquid to</span>`;
  for(const d of DIRS){ const r=ds.ranges[d]; if(!r) continue;
    const inp=(k,j)=>`<input type="number" step="any" data-d="${d}" data-k="${k}" data-j="${j}" value="${r[k][j]}" style="width:100%;min-width:0;padding:4px 2px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink);font-size:11.5px">`;
    h+=`<span class="sub2" style="align-self:center">${d}</span>${inp("glass",0)}${inp("glass",1)}${inp("liquid",0)}${inp("liquid",1)}`; }
  box.innerHTML=h;
}
$("#ds-ranges").addEventListener("input",e=>{const t=e.target; if(!t.dataset.d||!state.ds)return; const v=parseFloat(t.value); if(!isFinite(v))return;
  state.ds.ranges[t.dataset.d][t.dataset.k][+t.dataset.j]=v; normalizeDS(); if(state.runs)renderCal(); dsInfo();});
$("#ds-resetR").addEventListener("click",()=>{ if(!state.ds)return; state.ds.ranges=JSON.parse(JSON.stringify(DS[state.ds.comp].ranges)); renderRanges(); normalizeDS(); if(state.runs)renderCal(); dsInfo(); });

function dsInfo(extra){
  const ds=state.ds, el=$("#ds-info"); if(!ds){el.innerHTML="Pick a composition to overlay its measured dT<sub>f</sub>/dT on the C<sub>p</sub> plot.";return;}
  const e=DS[ds.comp]; let s=`<b style="color:var(--ink)">${subFormula(ds.comp)}</b> · folder “${e.folder}”. `;
  if(e.fit) s+=`TL fit (cooling 0.5/1/5 K/min, heating 10 K/min): T<sub>g</sub> = ${e.fit.Tg_K.toFixed(2)} K, m = ${e.fit.m}, log τ<sub>0</sub> = ${e.fit.log10_tau0.toFixed(3)}, f = ${e.fit.f.toFixed(4)} (used as ${(Math.round(e.fit.f*100)/100).toFixed(2)}: β-library step is 0.01), β<sub>0</sub> = ${e.fit.beta0}.`;
  else s+=`No TL fit on file for this composition — T<sub>g</sub> was estimated from the cooling curve (dT<sub>f</sub>/dT = 0.5); use “Fit a model”.`;
  if(ds.warn&&ds.warn.length) s+=` <span style="color:var(--warn)">${ds.warn.join("; ")}</span>`;
  if(extra) s+=" "+extra;
  el.innerHTML=s;
}
function dsTgEstimate(){ const c=state.ds.curves.cooling; if(!c) return null; for(let i=1;i<c.T.length;i++){ if((c.cp[i-1]-0.5)*(c.cp[i]-0.5)<=0){ const w=(0.5-c.cp[i-1])/(c.cp[i]-c.cp[i-1]); return c.T[i-1]+w*(c.T[i]-c.T[i-1]); } } return null; }
function dsApplyHistory(){
  const e=DS[state.ds.comp]; let Tmax=-Infinity,Tmin=Infinity;
  for(const d of DIRS){const sc=e.scans[d]; if(!sc)continue; for(const x of sc.T){Tmax=Math.max(Tmax,x);Tmin=Math.min(Tmin,x);}}
  const hi=+(Tmax+273.15).toFixed(2), lo=+(Tmin+273.15).toFixed(2), q=GEASSE_DATA.rate_Kmin||10;
  $("#T0").value=hi; state.segs=[{k:"ramp",T:lo,q},{k:"ramp",T:hi,q}]; renderSegs(); $("#proto").value="custom";
}
$("#ds-comp").addEventListener("change",()=>{
  const c=$("#ds-comp").value; $("#fit-status").textContent="";
  if(!c){ state.ds=null; renderRanges(); dsInfo(); if(state.runs){renderCal();renderDist();} return; }
  state.ds={comp:c, ranges:JSON.parse(JSON.stringify(DS[c].ranges))}; normalizeDS(); renderRanges();
  const e=DS[c];
  if(e.fit){ $("#Tg").value=+e.fit.Tg_K.toFixed(3); $("#m").value=e.fit.m; $("#l10").value=+e.fit.log10_tau0.toFixed(4);
    const f=(Math.round(e.fit.f*100)/100).toFixed(2); $("#f").value=f; $("#fr").value=f; $("#b0").value=e.fit.beta0; $("#N").value=e.fit.N||200; }
  else { const Tg=dsTgEstimate(); if(Tg) $("#Tg").value=+Tg.toFixed(2); }
  $("#preset").value=PRESETS.length-1;
  $("#tnm-link").checked=true; $("#rp-link").checked=true;   // new composition: TNM / RelaxPy start again from the shared T_g, m
  if($("#ds-hist").checked) dsApplyHistory();
  dsInfo(); syncLinked(); if(state.runs&&state.runs.TL) state.runs.TL.betaT=null; run();
});
["ds-showC","ds-showH"].forEach(id=>$("#"+id).addEventListener("change",()=>{if(state.runs)renderCal();}));
$("#ds-hist").addEventListener("change",()=>{ if($("#ds-hist").checked&&state.ds){dsApplyHistory(); schedule();} });

// data series for the Cp plot + x window
function dsCpSeries(){
  const ds=state.ds; if(!ds||!ds.curves) return {series:[],xdom:null};
  const o=unitOff(), S=[]; let lo=Infinity,hi=-Infinity;
  const show={cooling:$("#ds-showC").checked,heating:$("#ds-showH").checked};
  for(const d of DIRS){ const c=ds.curves[d]; if(!c||!show[d]) continue; lo=Math.min(lo,c.win[0]); hi=Math.max(hi,c.win[1]);
    // thin to ≈1 K spacing for drawing
    const x=[],y=[]; for(let i=0;i<c.T.length;i+=4){x.push(c.T[i]+o);y.push(c.cp[i]);}
    S.push({name:`${ds.comp} ${d} (data)`,x,y,color:d==="cooling"?css("--c6"):css("--ink"),pts:true,r:1.9}); }
  return {series:S, xdom:isFinite(lo)?[lo+o,hi+o]:null};
}

// ---------- β_KWW(T) along the TL run ----------
function tlBetaCurve(){
  const R=state.runs.TL; if(R.betaT) return R.betaT;
  const {dir,hist}=state, idx=[]; for(let i=1;i<dir.length;i++) if(dir[i]<0) idx.push(i);
  const pick=[]; const n=Math.min(45,idx.length); for(let q=0;q<n;q++) pick.push(idx[Math.round(q*(idx.length-1)/Math.max(1,n-1))]);
  const T=[],ne=[],eq=[]; for(const i of pick){const s=TL.snapshot(R.raw,i); T.push(hist.T[i]); ne.push(s.ne.beta); eq.push(s.eq.beta);}
  R.betaT={T,ne,eq,rate:(()=>{const k=state.segs.find(s=>s.k==="ramp"&&s.T<+$("#T0").value);return k?k.q:null;})()}; return R.betaT;
}
function renderBeta(){
  const el=$("#p-beta"); if($("#tab-dist").hidden) return;
  if(!state.runs||!state.runs.TL){empty(el,"β_KWW(T) is computed from the TL model — enable TL.");return;}
  const b=tlBetaCurve(), o=unitOff(); if(!b.T.length){empty(el,"β_KWW(T) is computed along cooling ramps — the current thermal history has none.");return;}
  const S=[{name:`TL β_KWW, non-equilibrium (cooling${b.rate?` ${b.rate} K/min`:""})`,x:b.T.map(v=>v+o),y:b.ne,color:css("--c1"),w:2.2},{name:"TL β_KWW, equilibrium (⟨T_f⟩ = T)",x:b.T.map(v=>v+o),y:b.eq,color:css("--eq"),dash:"5 3",w:2}];
  const lo=Math.min(...b.T), hi=Math.max(...b.T), ref=state.ds&&DS[state.ds.comp].beta;
  if(ref){ const x1=[],y1=[],x2=[],y2=[]; ref.T.forEach((t,i)=>{ if(t<lo||t>hi) return; if(ref.ne[i]!=null){x1.push(t+o);y1.push(ref.ne[i]);} if(ref.eq[i]!=null){x2.push(t+o);y2.push(ref.eq[i]);} });
    if(x1.length) S.push({name:`beta_vs_T.csv non-eq (${state.ds.comp}, file parameters, ${ref.rate_Kmin||10} K/min)`,x:x1,y:y1,color:css("--ink"),pts:true,r:3});
    if(x2.length) S.push({name:"beta_vs_T.csv equilibrium",x:x2,y:y2,color:css("--c5"),pts:true,r:3}); }
  plot(el,{id:"beta",title:"Nonexponentiality β_KWW(T) from χ(t′) (TL, along the cooling ramp)",xlabel:`Temperature (${uLabel()})`,ylabel:"β_KWW",series:S,xdom:[lo+o,hi+o],xshort:"T",yshort:"β"});
}

// ---------- fitting ----------
const FIT_PARAMS = {
  TL: [ {k:"Tg",id:"Tg",label:"T_g",on:true,step:3}, {k:"m",id:"m",label:"m",on:false,step:3,lo:12,hi:200}, {k:"log10tau0",id:"l10",label:"log τ₀",on:true,step:1,lo:-50,hi:-5},
        {k:"f",id:"f",label:"f",on:true,discrete:true,lo:0.10,hi:0.99}, {k:"beta0",id:"b0",label:"β₀",on:false,step:0.05,lo:0.2,hi:1} ],
  TNM:[ {k:"Tg",id:"tnm-Tg",label:"T_g",on:true,step:3}, {k:"m",id:"tnm-m",label:"m",on:true,step:3,lo:12,hi:200}, {k:"x",id:"tnm-x",label:"x",on:true,step:0.05,lo:0.02,hi:1}, {k:"beta",id:"tnm-b",label:"β",on:true,step:0.05,lo:0.15,hi:1} ],
  RP: [ {k:"Tg",id:"rp-Tg",label:"T_g",on:true,step:3}, {k:"m",id:"rp-m",label:"m",on:true,step:3,lo:12,hi:200},
        {k:"B",id:"rp-B",label:"B",on:true,step:500,lo:0,hi:300000}, {k:"C",id:"rp-C",label:"C",on:false,step:20,lo:0,hi:3000},
        {k:"pexp",id:"rp-p",label:"p",on:true,step:2,lo:0.1,hi:300}, {k:"A",id:"rp-A",label:"A",on:false,step:2,lo:-200,hi:300},
        {k:"eta_inf",id:"rp-ei",label:"log η∞",on:false,step:0.3,lo:-8,hi:2}, {k:"log10Ks",id:"rp-ks",label:"log K_s",on:false,step:0.3,lo:6,hi:14},
        {k:"beta",id:"rp-bc",label:"β (Prony)",on:false,discrete:true,lo:0.10,hi:1.00} ],
};
const RP_BETA={"3/7":3/7,"1/2":0.5,"3/5":0.6};
function renderFitFree(){ const m=$("#fit-model").value; $("#fit-free").innerHTML="<span class='sub2'>free:</span>"+FIT_PARAMS[m].map(p=>`<label class="chk"><input type="checkbox" data-fp="${p.k}" ${p.on?"checked":""}> ${p.label}</label>`).join("")
  +(m==="RP"?`<span class="note" style="margin:4px 0 0;flex-basis:100%">Parameters left fixed keep their current values; A follows the continuity rule and p = 0.3082·m while those boxes are ticked in the RelaxPy section (unless A or p is set free here). Freeing β switches RelaxPy to a custom fitted Prony series.</span>`:""); }
$("#fit-model").addEventListener("change",renderFitFree); renderFitFree();

function modelCpBranch(T,Tf,dirWanted){ // (T_mid, dTf/dT) on ramp steps of one direction, sorted by T
  const pts=[]; for(let i=1;i<T.length;i++){const d=T[i]-T[i-1]; if(Math.abs(d)<1e-12||(d<0?"cooling":"heating")!==dirWanted)continue; pts.push([(T[i]+T[i-1])/2,(Tf[i]-Tf[i-1])/d]);}
  pts.sort((a,b)=>a[0]-b[0]); return {x:pts.map(p=>p[0]),y:pts.map(p=>p[1])};
}
function interp(xs,ys,x){ let lo=0,hi=xs.length-1; if(hi<1||x<xs[0]||x>xs[hi]) return NaN; while(hi-lo>1){const m=(lo+hi)>>1; if(xs[m]<=x)lo=m; else hi=m;} const w=(x-xs[lo])/(xs[hi]-xs[lo]||1); return ys[lo]+w*(ys[hi]-ys[lo]); }
function* nelderMead(f,x0,step,maxIt){
  const n=x0.length; let S=[x0.slice()]; for(let i=0;i<n;i++){const x=x0.slice(); x[i]+=step[i]; S.push(x);}
  let F=S.map(f); yield 0;
  for(let it=0;it<maxIt;it++){
    const ord=F.map((v,i)=>i).sort((a,b)=>F[a]-F[b]); S=ord.map(i=>S[i]); F=ord.map(i=>F[i]);
    const size=Math.max(...S.slice(1).map(x=>Math.max(...x.map((v,j)=>Math.abs(v-S[0][j])/step[j]))));
    if(size<2e-3 || Math.abs(F[n]-F[0])<=1e-10*(1+Math.abs(F[0]))) break;
    const c=new Array(n).fill(0); for(let i=0;i<n;i++) for(let j=0;j<n;j++) c[j]+=S[i][j]/n;
    const pt=(a)=>c.map((v,j)=>v+a*(S[n][j]-v));
    const xr=pt(-1), fr=f(xr);
    if(fr<F[0]){ const xe=pt(-2), fe=f(xe); if(fe<fr){S[n]=xe;F[n]=fe;}else{S[n]=xr;F[n]=fr;} }
    else if(fr<F[n-1]){ S[n]=xr;F[n]=fr; }
    else { const xc=fr<F[n]?pt(-0.5):pt(0.5), fc=f(xc);
      if(fc<Math.min(fr,F[n])){S[n]=xc;F[n]=fc;}
      else { for(let i=1;i<=n;i++){S[i]=S[i].map((v,j)=>S[0][j]+0.5*(v-S[0][j])); F[i]=f(S[i]);} } }
    yield it+1;
  }
  const b=F.indexOf(Math.min(...F)); return {x:S[b],fx:F[b]};
}
let fitJob=null;
$("#fit-stop").addEventListener("click",()=>{ if(fitJob) fitJob.stop=true; });
$("#fit-undo").addEventListener("click",()=>{ const u=state.fitUndo; if(!u) return; for(const [id,v] of Object.entries(u.vals)){ const el=$("#"+id); if(el.type==="checkbox") el.checked=v; else el.value=v; } $("#fr").value=$("#f").value; state.fitUndo=null; $("#fit-undo").disabled=true; $("#fit-status").textContent="Restored the parameters from before the fit."; syncLinked(); run(); });
$("#fit-go").addEventListener("click",()=>{
  if(fitJob) return; const st=$("#fit-status");
  if(!state.ds||!state.ds.curves){ st.textContent="Pick a composition first."; return; }
  const model=$("#fit-model").value, scans=$("#fit-scans").value, useD=DIRS.filter(d=>(scans==="both"||scans===d)&&state.ds.curves[d]);
  if(!useD.length){ st.textContent="No normalised scan available for the chosen direction."; return; }
  const free=FIT_PARAMS[model].filter(p=>$(`[data-fp="${p.k}"]`).checked); if(!free.length){ st.textContent="Tick at least one free parameter."; return; }
  let h; try{ h=buildHistory(); }catch(e){ st.textContent=e.message; return; }
  // data: ≈1 K spacing
  const data=useD.map(d=>{const c=state.ds.curves[d],x=[],y=[]; for(let i=0;i<c.T.length;i+=4){x.push(c.T[i]);y.push(c.cp[i]);} return {d,x,y};});
  let ymean=0,np=0; data.forEach(D=>D.y.forEach(v=>{ymean+=v;np++;})); ymean/=np; let sst=0; data.forEach(D=>D.y.forEach(v=>sst+=(v-ymean)**2));
  // snapshot for undo
  const ids=["Tg","m","l10","f","b0","tnm-Tg","tnm-m","tnm-x","tnm-b","tnm-link","use-TL","use-TNM","rp-Tg","rp-m","rp-B","rp-C","rp-p","rp-A","rp-ei","rp-ks","rp-bc","rp-beta","rp-link","rp-Aauto","rp-pauto","use-RP"]; state.fitUndo={vals:Object.fromEntries(ids.map(id=>[id,$("#"+id).type==="checkbox"?$("#"+id).checked:$("#"+id).value]))};
  let base;
  if(model==="TL"){ try{ base=readTL(); }catch(e){ st.textContent=e.message; return; } $("#use-TL").checked=true; }
  else if(model==="TNM"){ $("#tnm-link").checked=false; syncLinked(); try{ base=readTNM(); }catch(e){ st.textContent=e.message; return; } base.kernel="prony"; $("#use-TNM").checked=true; }
  else { $("#rp-link").checked=false;
    if(free.some(p=>p.k==="A")) $("#rp-Aauto").checked=false;
    if(free.some(p=>p.k==="pexp")) $("#rp-pauto").checked=false;
    if(free.some(p=>p.k==="beta") && $("#rp-beta").value!=="custom"){ $("#rp-bc").value=(RP_BETA[$("#rp-beta").value]).toFixed(2); $("#rp-beta").value="custom"; }
    syncLinked(); try{ base=readRP(); }catch(e){ st.textContent=e.message; return; } $("#use-RP").checked=true;
    base.beta=Math.round(base.beta*100)/100; }
  const rpAauto=model==="RP"&&$("#rp-Aauto").checked, rpPauto=model==="RP"&&$("#rp-pauto").checked;
  const cont=free.filter(p=>!p.discrete), disc=free.find(p=>p.discrete);
  const TgLo=base.Tg-80, TgHi=base.Tg+80; let nEval=0;
  const sse=(p)=>{ nEval++;
    if(model==="RP"){ p={...p}; if(rpPauto) p.pexp=0.3082153*p.m; if(rpAauto) p.A=MODELS.continuityA(p); }
    for(const q of FIT_PARAMS[model]){ const v=p[q.k]; const lo=q.k==="Tg"?TgLo:q.lo, hi=q.k==="Tg"?TgHi:q.hi; if(!(v>=lo&&v<=hi)) return 1e6; }
    let r; try{ if(model==="TL"){ const d=TL.derived(p); if(!(d.D>0)||!(d.Tv>0)) return 1e6; r=TL.run(p,h.T,h.t); } else if(model==="TNM") r=MODELS.runTNM(p,h.T,h.t); else r=MODELS.runRelaxPy(p,h.T,h.t); }catch(e){ return 1e6; }
    let s=0; for(const D of data){ const br=modelCpBranch(h.T,r.Tf,D.d); for(let i=0;i<D.x.length;i++){ const m=interp(br.x,br.y,D.x[i]); s+=isFinite(m)?(m-D.y[i])**2:1; } }
    return isFinite(s)?s:1e6; };
  const cur={...base}; const vec=()=>cont.map(p=>cur[p.k]);
  const fvec=(x)=>{ const p={...cur}; cont.forEach((q,i)=>p[q.k]=x[i]); return sse(p); };
  fitJob={stop:false}; $("#fit-go").disabled=true; $("#fit-stop").disabled=false; const t0=performance.now();
  let best=sse(cur), round=0, gen=null, phase=cont.length?"nm":"disc";
  const finish=(msg)=>{
    fitJob=null; $("#fit-go").disabled=false; $("#fit-stop").disabled=true; $("#fit-undo").disabled=false;
    if(model==="TL"){ $("#Tg").value=+cur.Tg.toFixed(3); $("#m").value=+cur.m.toFixed(3); $("#l10").value=+cur.log10tau0.toFixed(4); $("#f").value=cur.f.toFixed(2); $("#fr").value=cur.f.toFixed(2); $("#b0").value=+cur.beta0.toFixed(3); $("#preset").value=PRESETS.length-1; }
    else if(model==="TNM"){ $("#tnm-Tg").value=+cur.Tg.toFixed(3); $("#tnm-m").value=+cur.m.toFixed(3); $("#tnm-x").value=+cur.x.toFixed(4); $("#tnm-b").value=+cur.beta.toFixed(4); }
    else { if(rpPauto) cur.pexp=0.3082153*cur.m; if(rpAauto) cur.A=MODELS.continuityA(cur);
      $("#rp-Tg").value=+cur.Tg.toFixed(3); $("#rp-m").value=+cur.m.toFixed(3); $("#rp-B").value=+cur.B.toFixed(2); $("#rp-C").value=+cur.C.toFixed(3); $("#rp-p").value=+cur.pexp.toFixed(4);
      $("#rp-A").value=+cur.A.toFixed(4); $("#rp-ei").value=+cur.eta_inf.toFixed(4); $("#rp-ks").value=+cur.log10Ks.toFixed(4); if($("#rp-beta").value==="custom") $("#rp-bc").value=cur.beta.toFixed(2); }
    const R2=1-best/sst, par=free.map(p=>`${p.label} = ${p.discrete?(+cur[p.k]).toFixed(2):(+cur[p.k]).toPrecision(p.k==="Tg"?6:4)}`).join(", ");
    st.innerHTML=`${msg} ${MODEL_NAME[model]} fit to ${useD.join(" + ")} (${np} points): ${par}. R² = ${R2.toFixed(4)}, ${nEval} model runs, ${((performance.now()-t0)/1000).toFixed(1)} s.`+(model==="TNM"?" (Fitted with the Prony kernel.)":"")+(model==="RP"?` Fixed: ${FIT_PARAMS.RP.filter(p=>!free.includes(p)&&!(p.k==="beta"&&$("#rp-beta").value!=="custom")).map(p=>p.label+(p.k==="A"&&rpAauto?" (continuity)":p.k==="pexp"&&rpPauto?" (0.3082·m)":"")).join(", ")}${$("#rp-beta").value!=="custom"?`, β = ${$("#rp-beta").value} (N = ${$("#rp-N").value})`:""}.`:"")+(model==="TL"&&!free.some(p=>p.k==="m")?" m held fixed.":"");
    syncLinked(); run();
  };
  const tick=()=>{
    const tEnd=performance.now()+40;
    while(performance.now()<tEnd){
      if(fitJob.stop){ finish("Stopped early."); return; }
      if(phase==="nm"){
        if(!gen) gen=nelderMead(fvec,vec(),cont.map(p=>p.step),round===0?300:120);
        const s=gen.next(); if(s.done){ const r=s.value; if(r.fx<=best){ best=r.fx; cont.forEach((q,i)=>cur[q.k]=r.x[i]); } gen=null; phase=disc?"disc":"done"; }
      } else if(phase==="disc"){
        // local search on a 0.01 grid (TL: β-library f; RelaxPy: fitted Prony β)
        let improved=false; const dk=disc.k; for(const df of [0.01,-0.01,0.02,-0.02,0.05,-0.05]){ const f2=Math.round((cur[dk]+df)*100)/100; if(f2<disc.lo||f2>disc.hi) continue; const v=sse({...cur,[dk]:f2}); if(v<best-1e-12){ best=v; cur[dk]=f2; improved=true; break; } }
        if(!improved){ round++; phase=(round<4&&cont.length&&round>=1&&state._fImproved)?"nm":"done"; state._fImproved=false; } else state._fImproved=true;
      } else { finish("Done."); return; }
    }
    st.textContent=`Fitting ${MODEL_NAME[model]}… ${nEval} model runs, R² = ${(1-best/sst).toFixed(4)}`;
    setTimeout(tick,0);
  };
  st.textContent=`Fitting ${MODEL_NAME[model]}…`; setTimeout(tick,0);
});
dsInfo();

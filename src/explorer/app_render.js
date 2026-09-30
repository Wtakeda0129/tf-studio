
// ---------- render ----------
const PIN_COLORS=["--c4","--c5","--c6","--c1","--c2","--c3"];
const css=v=>`var(${v})`;
function conv(a){const o=unitOff(),r=new Float64Array(a.length);for(let i=0;i<a.length;i++)r[i]=a[i]+o;return r;}
function split(arr,mask){const r=new Float64Array(arr.length).fill(NaN);for(let i=0;i<arr.length;i++)if(mask(i))r[i]=arr[i];return r;}
function empty(el,msg,hide){el.innerHTML=`<div class="empty">${msg}</div>`; el.classList.toggle("isempty",!!hide);}
function renderAll(){ renderStats(); renderDerived(); renderCal(); renderDyn(); renderHist(); renderDist(); }
function renderStats(){
  const {runs,hist}=state, n=hist.T.length; let Tmin=Infinity,Tmax=-Infinity;
  for(const v of hist.T){Tmin=Math.min(Tmin,v);Tmax=Math.max(Tmax,v);}
  const ms=Object.entries(runs).map(([k,r])=>`${MODEL_NAME[k]} ${r.ms<10?r.ms.toFixed(1):r.ms.toFixed(0)}`).join(" · ");
  $("#stats").innerHTML=[[n.toLocaleString(),"time steps"],[fmt(hist.t[n-1])+" s","total time"],[`${fmt(Tmin+unitOff())} → ${fmt(Tmax+unitOff())} ${uLabel()}`,"temperature range"],[ms,"compute time (ms)"]]
    .map(([a,b])=>`<div class="stat"><b style="${b.startsWith("compute")?"font-size:14px":""}">${a}</b><span>${b}</span></div>`).join("");
}
function renderDerived(){
  const G=[], R=state.runs;
  if(R.TL){ const p=R.TL.p,d=TL.derived(p),dist=R.TL.raw.dist, Tg23=dist.Tv*(1+d.D/Math.log(100/d.tau0));
    G.push(["TL",[["T_g (τ = 100 s)",p.Tg+" K"],["m",p.m],["log₁₀ τ₀",p.log10tau0],["f",p.f],["β₀",p.beta0],["N",p.N],["τ₀",d.tau0.toExponential(3)+" s"],["D (strength)",d.D.toFixed(3)],["⟨T_v,i⟩",dist.Tv.toFixed(3)+" K"],["m from Eq. 24",d.mCheck.toFixed(3)],["T_g from Eq. 23",Tg23.toFixed(3)+" K"]]]); }
  if(R.TNM){ const p=R.TNM.p; G.push(["TNM",[["T_g (τ = 100 s)",p.Tg+" K"],["m",p.m],["x",p.x],["β",p.beta],...Object.entries(R.TNM.info)]]); }
  if(R.RP){ const p=R.RP.p; G.push(["RelaxPy",[["T_g (η = 10¹² Pa·s)",p.Tg+" K"],["m",p.m],["log₁₀ η∞",p.eta_inf],["log₁₀ K_s",p.log10Ks],["A",(+p.A).toFixed(4)],["B",p.B],["C",p.C],["p (ergodicity)",(+p.pexp).toFixed(4)],...Object.entries(R.RP.info)]]); }
  const key={TL:"TL",TNM:"TNM",RelaxPy:"RP"};
  $("#derived").innerHTML=G.map(([name,rows])=>`<div class="dgroup" style="--mc:${MODEL_COLOR[key[name]]}"><h4 style="color:${MODEL_COLOR[key[name]]}">${name}</h4><dl>${rows.map(([k,v])=>`<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl></div>`).join("");
}
// per-model series: cooling dashed, heating solid, isothermal/jump dots
function modelSeries(get, opts={}){
  const {dir}=state, out=[], x=opts.x||conv(state.hist.T), many=Object.keys(state.runs).length>1;
  for(const k of MODEL_KEYS){ const r=state.runs[k]; if(!r) continue; const y=get(r,k); if(!y) continue; const c=MODEL_COLOR[k];
    if(opts.noSplit){ out.push({name:MODEL_NAME[k],x,y,color:c,w:2.2}); continue; }
    out.push({name:`${MODEL_NAME[k]} cooling`,x,y:split(y,i=>dir[i]<0),color:c,w:2,dash:"6 4"});
    out.push({name:`${MODEL_NAME[k]} heating`,x,y:split(y,i=>dir[i]>0),color:c,w:2.2});
    if(opts.iso!==false && dir.some((v,i)=>i>0&&v===0)) out.push({name:many?"":`${MODEL_NAME[k]} isothermal/jump`,x,y:split(y,i=>i>0&&dir[i]===0),color:c,pts:true,r:1.6});
  }
  return out;
}
function pinSeries(kind){
  const o=unitOff(), out=[];
  state.pins.forEach((pn,k)=>{
    const y=kind==="cp"?pn.cp:kind==="tf"?Float64Array.from(pn.Tf,v=>v+o):kind==="tau"?Float64Array.from(pn.tau,Math.log10):(pn.sig?Float64Array.from(pn.sig,Math.sqrt):null);
    if(!y) return;
    out.push({name:pn.label,x:Float64Array.from(pn.T,v=>v+o),y,color:css(PIN_COLORS[k%PIN_COLORS.length]),w:1.5,dash:"2 3"});
  });
  return out;
}
function renderCal(){
  const x=conv(state.hist.T), o=unitOff();
  const cpS=[...modelSeries(r=>r.cp,{iso:false}), ...pinSeries("cp")];
  if(state.exp) cpS.push({name:"Experiment",x:Float64Array.from(state.exp.T,v=>v+o),y:state.exp.cp,color:css("--ink"),pts:true,r:2.2});
  const dsS=dsCpSeries(); cpS.push(...dsS.series);
  plot($("#p-cp"),{id:"cp",title:"Normalised heat capacity  Cₚ = dT_f/dT",xlabel:`Temperature (${uLabel()})`,ylabel:"Cₚ,norm",series:cpS,xdom:dsS.xdom,xshort:"T",yshort:"Cp"});
  const tfS=[{name:"T_f = T",x,y:x,color:css("--eq"),dash:"4 4",w:1.2},...modelSeries(r=>Float64Array.from(r.Tf,v=>v+o)),...pinSeries("tf")];
  plot($("#p-tf"),{id:"Tf",title:"Fictive temperature T_f",xlabel:`Temperature (${uLabel()})`,ylabel:`T_f (${uLabel()})`,series:tfS,xshort:"T",yshort:"Tf"});
  // residuals vs measured data, or departure from equilibrium when no data is loaded
  const ds=state.ds;
  if(ds&&ds.curves&&Object.keys(ds.curves).length){
    const S=[{name:"",x:dsS.xdom||[x[0],x[x.length-1]],y:[0,0],color:css("--eq"),w:1,dash:"3 3"}]; const show={cooling:$("#ds-showC").checked,heating:$("#ds-showH").checked};
    for(const k of MODEL_KEYS){ const r=state.runs[k]; if(!r) continue;
      for(const d of ["cooling","heating"]){ const c=ds.curves[d]; if(!c||!show[d]) continue; const br=modelCpBranch(state.hist.T,r.Tf,d), xs=[],ys=[];
        for(let i=0;i<c.T.length;i+=2){ const m=interp(br.x,br.y,c.T[i]); if(isFinite(m)){xs.push(c.T[i]+o);ys.push(m-c.cp[i]);} }
        let ss=0; ys.forEach(v=>ss+=v*v);
        S.push({name:`${MODEL_NAME[k]} ${d} (rms ${Math.sqrt(ss/Math.max(1,ys.length)).toFixed(3)})`,x:xs,y:ys,color:MODEL_COLOR[k],w:1.8,dash:d==="cooling"?"6 4":null}); } }
    plot($("#p-res"),{id:"res",title:`Residual  model − data  (${ds.comp})`,xlabel:`Temperature (${uLabel()})`,ylabel:"ΔCₚ,norm",series:S,xdom:dsS.xdom,xshort:"T",yshort:"Δ"});
  } else {
    plot($("#p-res"),{id:"res",title:"Departure from equilibrium  T_f − T",xlabel:`Temperature (${uLabel()})`,ylabel:"T_f − T (K)",series:modelSeries(r=>Float64Array.from(r.Tf,(v,i)=>v-state.hist.T[i])),xshort:"T",yshort:"ΔT"});
  }
  const eqS=[]; for(const k of MODEL_KEYS){const r=state.runs[k]; if(r) eqS.push({name:`${MODEL_NAME[k]} τ_eq`,x,y:Float64Array.from(r.tauEq,Math.log10),color:MODEL_COLOR[k],dash:"1 3",w:1.6,op:.8});}
  plot($("#p-tau2"),{id:"tau2",title:"Relaxation time",xlabel:`Temperature (${uLabel()})`,ylabel:"log₁₀ τ (s)",series:[...eqS,...modelSeries(r=>Float64Array.from(r.tau,Math.log10))],xdom:dsS.xdom,xshort:"T",yshort:"log10 τ"});
}
function renderDyn(){
  const x=conv(state.hist.T);
  const eqS=[]; for(const k of MODEL_KEYS){const r=state.runs[k]; if(r) eqS.push({name:`${MODEL_NAME[k]} τ_eq`,x,y:Float64Array.from(r.tauEq,Math.log10),color:MODEL_COLOR[k],dash:"1 3",w:1.6,op:.8});}
  plot($("#p-tau"),{id:"tau",title:"Relaxation time (TL: exp⟨ln τ_i⟩_X · TNM: τ · RelaxPy: τ_K)",xlabel:`Temperature (${uLabel()})`,ylabel:"log₁₀ τ (s)",series:[...eqS,...modelSeries(r=>Float64Array.from(r.tau,Math.log10)),...pinSeries("tau")],xshort:"T",yshort:"log10 τ"});
  if(state.runs.TL){
    const sg=Float64Array.from(state.runs.TL.sigTf,Math.sqrt);
    const S2=modelSeries((r,k)=>k==="TL"?sg:null).concat(pinSeries("sig"));
    plot($("#p-sig"),{id:"sig",title:"TL fictive-temperature fluctuation  δT_f = √Σ Y_i (T_f,i − ⟨T_f⟩)²",xlabel:`Temperature (${uLabel()})`,ylabel:"δT_f (K)",series:S2,xshort:"T",yshort:"δTf"});
  } else empty($("#p-sig"),"δT_f is a TL-model quantity — enable TL to see it.");
  if(state.runs.RP){
    const r=state.runs.RP, f=MODELS.mapFns(r.p);
    const eqEta=Float64Array.from(state.hist.T,Ti=>f.eq(Ti));
    plot($("#p-eta"),{id:"eta",title:"RelaxPy nonequilibrium viscosity  log₁₀ η(T, T_f)",xlabel:`Temperature (${uLabel()})`,ylabel:"log₁₀ η (Pa·s)",series:[{name:"η_eq (MYEGA)",x,y:eqEta,color:css("--eq"),dash:"4 4",w:1.3},...modelSeries((q,k)=>k==="RP"?q.logEta:null)],xshort:"T",yshort:"log η"});
  } else empty($("#p-eta"),"Viscosity is computed by RelaxPy — enable RelaxPy to see it.",true);
  const cs=[]; const t=state.hist.t, logt=$("#logt").checked, tx=logt?t.map((v,i)=>i===0?NaN:v):t;
  for(const k of ["TNM","RP"]){ const r=state.runs[k]; if(!r||!r.comp) continue; const N=r.prony.w.length, n=t.length;
    for(let q=0;q<N;q++){ const y=new Float64Array(n); for(let i=0;i<n;i++) y[i]=r.comp[i*N+q]+unitOff(); cs.push({name:q===0?`${MODEL_NAME[k]} T_f,i (${N} Prony terms)`:"",x:tx,y,color:MODEL_COLOR[k],w:0.6+4*r.prony.w[q],op:.75}); } }
  if(cs.length){ cs.unshift({name:"T(t)",x:tx,y:conv(state.hist.T),color:css("--ink"),w:1.2,dash:"3 3"});
    plot($("#p-comp"),{id:"comp",title:"Prony fictive-temperature components T_f,i(t)  (line width ∝ w_i)",xlabel:"time (s)",ylabel:`T_f,i (${uLabel()})`,xlog:logt,series:cs,xshort:"t",yshort:"Tf,i"}); }
  else empty($("#p-comp"),"Prony components appear here for RelaxPy, or for TNM with the Prony kernel.",true);
}
function renderHist(){
  const {hist}=state, logt=$("#logt").checked, t=hist.t;
  const tx=logt?t.map((v,i)=>i===0?NaN:v):t, S=[{name:"T(t)",x:tx,y:conv(hist.T),color:css("--ink"),w:1.6,dash:"4 3"}], D=[];
  for(const k of MODEL_KEYS){const r=state.runs[k]; if(!r) continue;
    S.push({name:`${MODEL_NAME[k]} T_f(t)`,x:tx,y:conv(r.Tf),color:MODEL_COLOR[k],w:2.2});
    D.push({name:`${MODEL_NAME[k]}`,x:tx,y:Float64Array.from(r.Tf,(v,i)=>v-hist.T[i]),color:MODEL_COLOR[k],w:2.2});}
  plot($("#p-Tt"),{id:"Tt",title:"Thermal history and fictive temperature",xlabel:"time (s)",ylabel:`Temperature (${uLabel()})`,xlog:logt,series:S,xshort:"t",yshort:"T"});
  plot($("#p-dTf"),{id:"dTf",title:"Departure from equilibrium  T_f − T",xlabel:"time (s)",ylabel:"T_f − T (K)",xlog:logt,series:D,xshort:"t",yshort:"ΔT"});
}
function renderDist(){
  const box=["#p-G","#p-Y","#p-Tfi","#p-chi"];
  if(!state.runs.TL){ $("#snapInfo").textContent=""; $("#snapStats").innerHTML=""; box.forEach(id=>empty($(id),"Distributions are specific to the TL model (T_v,i domains) — enable TL.")); renderBeta(); return; }
  const res=state.runs.TL.raw, i=state.snapIdx, s=TL.snapshot(res,i), h=state.hist, o=unitOff();
  const segName=h.seg[i]<0?"start":(state.segs[h.seg[i]]?.k||"");
  $("#snapInfo").textContent=`step ${i}/${h.T.length-1} · t = ${fmt(h.t[i])} s · T = ${fmt(h.T[i]+o)} ${uLabel()} · ${segName}`;
  $("#snapStats").innerHTML=[[fmt(s.Tf+o)+" "+uLabel(),"⟨T_f⟩ (TL)"],[fmt(Math.sqrt(varW(res.dist.Yi,s.Tfi)))+" K","δT_f"],[isNaN(s.ne.beta)?"–":s.ne.beta.toFixed(3),"β_KWW (non-equilibrium)"],[isNaN(s.eq.beta)?"–":s.eq.beta.toFixed(3),"β_KWW (equilibrium at T)"]]
    .map(([a,b])=>`<div class="stat"><b>${a}</b><span>${b}</span></div>`).join("");
  plot($("#p-G"),{id:"G",title:"Relaxation-time distribution G(log₁₀ τ_i)",xlabel:"log₁₀ τ_i (s)",ylabel:"G",series:[
      {name:"equilibrium (⟨T_f⟩ = T)",x:s.eq.xs,y:s.eq.G,color:css("--eq"),dash:"5 3",w:2},{name:"non-equilibrium (⟨T_f⟩)",x:s.ne.xs,y:s.ne.G,color:css("--c1"),w:2.2}],xshort:"log10 τ",yshort:"G"});
  plot($("#p-Y"),{id:"Y",title:"Equilibrium weights  Y_i  vs  T_v,i",xlabel:"T_v,i (K)",ylabel:"Y_i",series:[{name:"Y_i",x:s.Tvi,y:s.Yi,color:css("--c4"),w:2}],xshort:"Tv,i",yshort:"Y"});
  const Tloc=Float64Array.from(s.Tvi,v=>s.T*(2-v/res.dist.Tv)+o);
  plot($("#p-Tfi"),{id:"Tfi",title:"Local fictive temperature T_f,i  vs  T_v,i",xlabel:"T_v,i (K)",ylabel:`T_f,i (${uLabel()})`,series:[
      {name:"local temperature T_i",x:s.Tvi,y:Tloc,color:css("--eq"),dash:"5 3",w:1.6},{name:"T_f,i",x:s.Tvi,y:Float64Array.from(s.Tfi,v=>v+o),color:css("--c2"),w:2.2}],xshort:"Tv,i",yshort:"Tf,i"});
  const chi=(sn)=>{const tt=[],c=[];const lo=Math.min(...sn.lt)-3,hi=Math.max(...sn.lt)+2;for(let q=0;q<160;q++){const l=lo+(hi-lo)*q/159,T=Math.exp(l);let v=0;for(let k=0;k<sn.X.length;k++)v+=sn.X[k]*Math.exp(-T/Math.exp(sn.lt[k]));tt.push(l/Math.LN10);c.push(v);}return [tt,c];};
  const [tx1,c1]=chi(s.ne),[tx2,c2]=chi(s.eq);
  plot($("#p-chi"),{id:"chi",title:"Instantaneous relaxation function χ(t′)",xlabel:"log₁₀ t′ (s)",ylabel:"χ",ydom:[0,1.02],series:[
      {name:"equilibrium",x:tx2,y:c2,color:css("--eq"),dash:"5 3",w:2},{name:"non-equilibrium",x:tx1,y:c1,color:css("--c1"),w:2.2}],xshort:"log10 t'",yshort:"χ"});
  renderBeta();
}
function varW(w,v){let m=0,s=0;for(let k=0;k<w.length;k++)m+=w[k]*v[k];for(let k=0;k<w.length;k++)s+=w[k]*(v[k]-m)**2;return s;}

// ---------- pins ----------
$("#pinBtn").addEventListener("click",()=>{
  if(!state.runs)return; const h=state.hist;
  const rates=state.segs.filter(s=>s.k==="ramp").map(s=>s.q); const hs=`${rates.length?"q="+[...new Set(rates)].join("/")+" K/min":"iso"}${state.segs.some(s=>s.k==="hold")?" +hold":""}`;
  for(const [k,r] of Object.entries(state.runs)){
    const par=k==="TL"?`f=${r.p.f}`:k==="TNM"?`x=${r.p.x}, β=${r.p.beta}`:`β=${r.p.betaName==="custom"?r.p.beta:r.p.betaName}`;
    state.pins.push({label:`${MODEL_NAME[k]} (${par}) · ${hs}`,T:h.T,Tf:r.Tf,cp:r.cp,tau:r.tau,sig:r.sigTf||null});
  }
  while(state.pins.length>6)state.pins.shift(); renderCal();renderDyn();
});
$("#clearBtn").addEventListener("click",()=>{state.pins=[];if(state.runs){renderCal();renderDyn();}});

// ---------- export / import ----------
$("#csvBtn").addEventListener("click",()=>{
  if(!state.runs)return; const {runs,hist}=state, ks=Object.keys(runs);
  const head=["t_s","T_K","segment"]; ks.forEach(k=>{const n=MODEL_NAME[k];head.push(`${n}_Tf_K`,`${n}_Cp_norm`,`${n}_tau_s`,`${n}_tau_eq_s`); if(k==="TL")head.push("TL_dTf_std_K"); if(k==="RP")head.push("RelaxPy_log10_eta_Pas");});
  const rows=[head.join(",")];
  for(let i=0;i<hist.T.length;i++){ const row=[hist.t[i],hist.T[i],hist.seg[i]+1];
    ks.forEach(k=>{const r=runs[k]; row.push(r.Tf[i],isNaN(r.cp[i])?"":r.cp[i],r.tau[i],r.tauEq[i]); if(k==="TL")row.push(Math.sqrt(r.sigTf[i])); if(k==="RP")row.push(r.logEta[i]);});
    rows.push(row.join(",")); }
  dl(new Blob([rows.join("\n")],{type:"text/csv"}),"relaxation_model_results.csv");
});
$("#expFile").addEventListener("change",async e=>{
  const f=e.target.files[0]; if(!f)return; const txt=await f.text(); const T=[],cp=[];
  txt.split(/\r?\n/).forEach(l=>{const a=l.split(/[,;\t ]+/).map(parseFloat); if(a.length>=2&&isFinite(a[0])&&isFinite(a[1])){T.push(a[0]);cp.push(a[1]);}});
  if(T.length<2){ $("#expNote").style.display="block"; $("#expNote").textContent="Could not read two numeric columns (T, Cp) from "+f.name+"."; return;}
  const guess=T.reduce((a,b)=>a+b,0)/T.length<+$("#Tg").value-100?"C":"K";
  state.exp={T:Float64Array.from(T,v=>guess==="C"?v+273.15:v),cp:Float64Array.from(cp)};
  $("#expNote").style.display="block"; $("#expNote").textContent=`Loaded ${T.length} points from ${f.name}; temperatures interpreted as ${guess==="C"?"°C (converted to K)":"K"}. Cp should already be normalised (0 = glass, 1 = liquid).`;
  $("#expClear").style.display=""; if(state.runs)renderCal(); e.target.value="";
});
$("#expClear").addEventListener("click",()=>{state.exp=null;$("#expNote").style.display="none";$("#expClear").style.display="none";if(state.runs)renderCal();});

// ---------- playback ----------
function stopPlay(){if(state.playing){clearInterval(state.playing);state.playing=null;$("#playBtn").textContent="▶ Play";}}
$("#playBtn").addEventListener("click",()=>{
  if(state.playing){stopPlay();return;} if(!state.runs||!state.runs.TL)return;
  $("#playBtn").textContent="❚❚ Pause"; const n=state.hist.T.length, step=Math.max(1,Math.round(n/150));
  state.playing=setInterval(()=>{state.snapIdx+=step;if(state.snapIdx>=n-1){state.snapIdx=n-1;stopPlay();}$("#snap").value=state.snapIdx;renderDist();},60);
});
$("#snap").addEventListener("input",e=>{state.snapIdx=+e.target.value;if(state.runs)renderDist();});

// ---------- wiring ----------
$("#preset").addEventListener("change",()=>{setMaterial(PRESETS[+$("#preset").value]); if($("#proto").value!=="custom")setProtocol($("#proto").value); schedule();});
$("#proto").addEventListener("change",()=>{setProtocol($("#proto").value);schedule();});
["Tg","m","l10","b0","N"].forEach(id=>$("#"+id).addEventListener("input",()=>{$("#preset").value=PRESETS.length-1; schedule();}));
["T0","dT","ppd","tnm-Tg","tnm-m","tnm-x","tnm-b","tnm-k","tnm-link","rp-link","rp-Tg","rp-m","rp-ei","rp-ks","rp-A","rp-B","rp-C","rp-p","rp-Aauto","rp-pauto","rp-beta","rp-N","rp-bc","use-TL","use-TNM","use-RP"]
  .forEach(id=>$("#"+id).addEventListener(/^(tnm-k|rp-beta)$/.test(id)||$("#"+id).type==="checkbox"?"change":"input",()=>{
    if(id.startsWith("use-")&&$("#"+id).checked) $("#sec-"+id.slice(4)).open=true; schedule();}));
$("#rp-example").addEventListener("click",()=>{
  // RelaxPy-v01.py defaults (example glass): Tg = 734.5 K, m = 35.3, log η∞ = −2.9, A = 45.19, B = 4136.7, C = 135.09, p = 10.88, β = 3/7, N = 8, Ks = 35 GPa
  $("#rp-link").checked=false; $("#rp-Tg").value=734.5; $("#rp-m").value=35.3; $("#rp-ei").value=-2.9; $("#rp-ks").value=10.544068;
  $("#rp-Aauto").checked=false; $("#rp-A").value=45.19; $("#rp-B").value=4136.7; $("#rp-C").value=135.09; $("#rp-pauto").checked=false; $("#rp-p").value=10.88;
  $("#rp-beta").value="3/7"; $("#rp-N").value=8; $("#use-RP").checked=true;
  const only=!$("#use-TL").checked&&!$("#use-TNM").checked;
  if(!only){ $("#use-TL").checked=false; $("#use-TNM").checked=false; }
  $("#T0").value=900; state.segs=[{k:"ramp",T:600,q:60},{k:"ramp",T:900,q:60}]; renderSegs(); $("#proto").value="custom"; $("#dT").value=1;
  schedule(); run();
});
$("#fr").addEventListener("input",()=>{$("#f").value=$("#fr").value;$("#preset").value=PRESETS.length-1;schedule();});
$("#f").addEventListener("input",()=>{$("#fr").value=$("#f").value;schedule();});
$("#runBtn").addEventListener("click",run);
$("#unit").addEventListener("change",()=>{if(state.runs)renderAll();});
$("#logt").addEventListener("change",()=>{if(state.runs){renderHist();renderDyn();}});
$("#themeBtn").addEventListener("click",()=>{const r=document.documentElement,cur=r.dataset.theme||"light";r.dataset.theme=cur==="dark"?"light":"dark";if(state.runs)renderAll();});
document.querySelectorAll(".tab").forEach(b=>b.addEventListener("click",()=>{
  document.querySelectorAll(".tab").forEach(x=>x.setAttribute("aria-selected",x===b));
  ["cal","dyn","dist","hist","par"].forEach(k=>$("#tab-"+k).hidden=(k!==b.dataset.tab)); if(b.dataset.tab!=="dist")stopPlay(); else if(state.runs)renderDist();
}));

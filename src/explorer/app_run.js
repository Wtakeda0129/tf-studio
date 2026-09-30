
// ---------- run ----------
function readTL(){
  const p={Tg:+$("#Tg").value,m:+$("#m").value,log10tau0:+$("#l10").value,f:Math.round(+$("#f").value*100)/100,beta0:+$("#b0").value,N:Math.round(+$("#N").value)};
  if(!(p.Tg>0)) throw new Error("TL: T_g must be positive (in K)");
  if(!(p.f>=0.1&&p.f<=0.99)) throw new Error("TL: f must lie between 0.10 and 0.99 (range of the β library)");
  if(!(p.beta0>0&&p.beta0<=1)) throw new Error("TL: β₀ must be in (0, 1]");
  if(!(p.N>=20&&p.N<=400)) throw new Error("TL: N must be between 20 and 400");
  const d=TL.derived(p); if(!(d.D>0)) throw new Error("TL: parameters give D ≤ 0 — need m·ln10 > ln(100/τ₀)");
  if(!(d.Tv>0)) throw new Error("TL: parameters give T_v ≤ 0");
  return p;
}
function readTNM(){
  const p={Tg:+$("#tnm-Tg").value,m:+$("#tnm-m").value,x:+$("#tnm-x").value,beta:+$("#tnm-b").value,kernel:$("#tnm-k").value};
  if(!(p.Tg>0&&p.m>0)) throw new Error("TNM: T_g and m must be positive");
  if(!(p.x>=0&&p.x<=1)) throw new Error("TNM: x must be in [0, 1]");
  if(!(p.beta>=0.1&&p.beta<=1)) throw new Error("TNM: β must be in [0.1, 1]");
  return p;
}
function readRP(){
  const bn=$("#rp-beta").value;
  const p={Tg:+$("#rp-Tg").value,m:+$("#rp-m").value,eta_inf:+$("#rp-ei").value,log10Ks:+$("#rp-ks").value,A:+$("#rp-A").value,B:+$("#rp-B").value,C:+$("#rp-C").value,pexp:+$("#rp-p").value,
    betaName:bn,N:Math.round(+$("#rp-N").value),beta:+$("#rp-bc").value};
  if(!(p.Tg>0&&p.m>0)) throw new Error("RelaxPy: T_g and m must be positive");
  if(!(p.eta_inf<12)) throw new Error("RelaxPy: log η∞ must be < 12");
  if(bn!=="custom"&&!(p.N>=1&&p.N<=12)) throw new Error("RelaxPy: N must be 1–12 for the RelaxPy table");
  if(bn==="custom"&&!(p.beta>=0.1&&p.beta<=1)) throw new Error("RelaxPy: custom β must be in [0.1, 1]");
  if([p.A,p.B,p.C,p.pexp,p.log10Ks].some(v=>!isFinite(v))) throw new Error("RelaxPy: fill in A, B, C, p and K_s");
  return p;
}
function cpOf(T,Tf){const n=T.length,cp=new Float64Array(n).fill(NaN);for(let i=1;i<n;i++){const d=T[i]-T[i-1];if(Math.abs(d)>1e-12)cp[i]=(Tf[i]-Tf[i-1])/d;}return cp;}
let timer=null;
function schedule(){ syncLinked(); if($("#auto").checked){clearTimeout(timer);timer=setTimeout(run,150);} }
function run(){
  const banner=$("#err"); banner.style.display="none"; state.notes=[];
  try{
    stopPlay(); syncLinked();
    const on=enabled(); if(!on.length) throw new Error("Select at least one model (TL, TNM or RelaxPy).");
    const h=buildHistory(), n=h.T.length, runs={};
    const dir=new Int8Array(n); for(let i=1;i<n;i++){const d=h.T[i]-h.T[i-1]; dir[i]=Math.abs(d)>1e-12?(d<0?-1:1):0;}
    if(on.includes("TL")){ const p=readTL(),t0=performance.now(); const r=TL.run(p,h.T,h.t,{keepTfi:true}); runs.TL={p,Tf:r.Tf,tau:r.tau,tauEq:r.tauEq,sigTf:r.sigTf,raw:r,ms:performance.now()-t0}; }
    if(on.includes("TNM")){
      const p=readTNM(); let nr=0; for(let i=1;i<n;i++) if(dir[i]!==0) nr++;
      if(p.kernel==="exact" && n*nr>4e8){ p.kernel="prony"; state.notes.push(`TNM: ${n.toLocaleString()} steps is too many for the exact O(n²) kernel — used the Prony kernel instead.`); }
      const t0=performance.now(); const r=MODELS.runTNM(p,h.T,h.t); runs.TNM={p,...r,ms:performance.now()-t0};
    }
    if(on.includes("RP")){ const p=readRP(),t0=performance.now(); const r=MODELS.runRelaxPy(p,h.T,h.t); runs.RP={p,...r,ms:performance.now()-t0}; }
    for(const k in runs) runs[k].cp=cpOf(h.T,runs[k].Tf);
    state.runs=runs; state.hist=h; state.dir=dir;
    const snap=$("#snap"); snap.max=n-1; state.snapIdx=Math.min(state.snapIdx,n-1); snap.value=state.snapIdx;
    if(state.notes.length){banner.textContent=state.notes.join(" ");banner.style.display="block";}
    renderAll();
  }catch(e){ banner.textContent=e.message; banner.style.display="block"; console.error(e); }
}

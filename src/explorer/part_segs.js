// ---------- segment editor ----------
function renderSegs(){
  const box=$("#segs"); box.innerHTML="";
  state.segs.forEach((s,i)=>{
    const d=document.createElement("div"); d.className="seg";
    const typeSel=`<label>Segment ${i+1}<select data-i="${i}" data-k="k"><option value="ramp">Ramp</option><option value="hold">Hold</option><option value="jump">T-jump</option></select></label>`;
    let a="",b="";
    if(s.k==="ramp"){a=`<label>To T (K)<input type="number" step="any" data-i="${i}" data-k="T" value="${s.T}"></label>`;b=`<label>Rate (K/min)<input type="number" step="any" min="0.0001" data-i="${i}" data-k="q" value="${s.q}"></label>`;}
    if(s.k==="hold"){a=`<label>Duration (s)<input type="number" step="any" min="0.2" data-i="${i}" data-k="t" value="${s.t}"></label>`;b=`<span></span>`;}
    if(s.k==="jump"){a=`<label>To T (K)<input type="number" step="any" data-i="${i}" data-k="T" value="${s.T}"></label>`;b=`<span></span>`;}
    d.innerHTML=typeSel+a+b+`<button class="x" data-del="${i}" title="Remove">×</button>`;
    d.querySelector("select").value=s.k; box.appendChild(d);
  });
}
$("#segs").addEventListener("input",e=>{
  const t=e.target,i=+t.dataset.i; if(isNaN(i))return; const k=t.dataset.k;
  if(k==="k"){const old=state.segs[i];const lastT=segEndT(i);state.segs[i]=t.value==="hold"?{k:"hold",t:1e3}:{k:t.value,T:old.T??lastT,q:old.q??10};renderSegs();}
  else state.segs[i][k]=parseFloat(t.value);
  $("#proto").value="custom"; schedule();
});
$("#segs").addEventListener("click",e=>{const i=e.target.dataset.del; if(i===undefined)return; state.segs.splice(+i,1); renderSegs(); $("#proto").value="custom"; schedule();});
function segEndT(i){let T=+$("#T0").value;for(let j=0;j<i;j++){if(state.segs[j].T!==undefined)T=state.segs[j].T;}return T;}
document.querySelectorAll("[data-add]").forEach(b=>b.addEventListener("click",()=>{
  const k=b.dataset.add,T=segEndT(state.segs.length);
  state.segs.push(k==="hold"?{k,t:1e3}:{k,T:T,q:10}); renderSegs(); $("#proto").value="custom"; schedule();}));

// ---------- protocol → T(t) ----------
function buildHistory(){
  const dT=Math.max(0.01,+$("#dT").value||0.5), ppd=Math.max(2,+$("#ppd").value||10);
  let T=+$("#T0").value, t=0; const Ta=[T], ta=[0], seg=[-1];
  for(let si=0;si<state.segs.length;si++){
    const s=state.segs[si];
    if(s.k==="ramp"){
      if(!(s.q>0)) throw new Error(`Segment ${si+1}: rate must be > 0`);
      const dist=Math.abs(s.T-T); if(dist<1e-12) continue;
      const n=Math.max(1,Math.ceil(dist/dT-1e-9)), dir=Math.sign(s.T-T), step=dist/n, dtt=step/(s.q/60);
      for(let k=1;k<=n;k++){T+=dir*step; if(k===n)T=s.T; t+=dtt; Ta.push(T); ta.push(t); seg.push(si);}
    } else if(s.k==="jump"){
      if(Math.abs(s.T-T)<1e-12) continue; T=s.T; Ta.push(T); ta.push(t); seg.push(si);   // Δt = 0
    } else if(s.k==="hold"){
      if(!(s.t>0)) throw new Error(`Segment ${si+1}: hold time must be > 0`);
      const t0=Math.min(0.1,s.t/100), decades=Math.log10(s.t/t0), n=Math.max(1,Math.ceil(decades*ppd));
      let tprev=0;
      for(let k=0;k<=n;k++){const tt=k===0?t0:t0*Math.pow(s.t/t0,k/n); if(tt<=tprev)continue; t+=tt-tprev; tprev=tt; Ta.push(T); ta.push(t); seg.push(si);}
    }
  }
  if(Ta.length<2) throw new Error("Protocol has no steps");
  if(Ta.length>60000) throw new Error(`Too many steps (${Ta.length}); increase ΔT or reduce points per decade`);
  return {T:Float64Array.from(Ta), t:Float64Array.from(ta), seg:Int16Array.from(seg)};
}


(function(){
"use strict";
const $ = s => document.querySelector(s);
const PRESETS = [
  {name:"Selenium",       Tg:308.13, m:64.14,  l10:-23.41, f:0.59, b0:1},
  {name:"Glycerol",       Tg:189.73, m:52.25,  l10:-25.40, f:0.64, b0:0.82},
  {name:"B₂O₃",           Tg:559.66, m:36.28,  l10:-15.39, f:0.60, b0:1},
  {name:"OTP",            Tg:246.15, m:106.16, l10:-25.48, f:0.59, b0:1},
  {name:"PVAc",           Tg:313.06, m:92.36,  l10:-37.87, f:0.52, b0:0.85},
  {name:"D-sorbitol",     Tg:265.7,  m:88.76,  l10:-35.61, f:0.57, b0:1},
  {name:"Custom",         Tg:200,    m:60,     l10:-24,    f:0.60, b0:1},
];
const PROTOS = {
  dsc:   {name:"Cool → heat (DSC)", build:Tg=>({T0:Tg+40, segs:[{k:'ramp',T:Tg-60,q:10},{k:'ramp',T:Tg+40,q:10}]})},
  rates: {name:"Cool → heat, slow cool (1 K/min)", build:Tg=>({T0:Tg+40, segs:[{k:'ramp',T:Tg-60,q:1},{k:'ramp',T:Tg+40,q:10}]})},
  anneal:{name:"Cool → anneal → heat", build:Tg=>({T0:Tg+40, segs:[{k:'ramp',T:Tg-15,q:10},{k:'hold',t:1e4},{k:'ramp',T:Tg-60,q:10},{k:'ramp',T:Tg+40,q:10}]})},
  kovacs:{name:"Kovacs T-jump", build:Tg=>({T0:Tg+5, segs:[{k:'jump',T:Tg-10},{k:'hold',t:1e5}]})},
  custom:{name:"Custom", build:null},
};
const MODEL_KEYS=["TL","TNM","RP"];
const MODEL_NAME={TL:"TL",TNM:"TNM",RP:"RelaxPy"};
const MODEL_COLOR={TL:"var(--mTL)",TNM:"var(--mTNM)",RP:"var(--mRP)"};
let state = {segs:[], pins:[], runs:null, hist:null, exp:null, snapIdx:0, playing:null, notes:[]};
const unitOff = () => $("#unit").value==="C" ? -273.15 : 0;
const uLabel = () => $("#unit").value==="C" ? "°C" : "K";
const enabled = () => MODEL_KEYS.filter(k=>$("#use-"+k).checked);

// ---------- populate selects ----------
PRESETS.forEach((p,i)=>{const o=document.createElement("option");o.value=i;o.textContent=p.name;$("#preset").appendChild(o);});
Object.entries(PROTOS).forEach(([k,v])=>{const o=document.createElement("option");o.value=k;o.textContent=v.name;$("#proto").appendChild(o);});

function syncLinked(){
  for(const pre of ["tnm","rp"]){
    const linked=$(`#${pre}-link`).checked;
    $(`#${pre}-Tg`).disabled=linked; $(`#${pre}-m`).disabled=linked;
    if(linked){$(`#${pre}-Tg`).value=$("#Tg").value; $(`#${pre}-m`).value=$("#m").value;}
  }
  const m=+$("#rp-m").value;
  $("#rp-p").disabled=$("#rp-pauto").checked; if($("#rp-pauto").checked&&isFinite(m)) $("#rp-p").value=+(0.3082153*m).toFixed(4);
  $("#rp-A").disabled=$("#rp-Aauto").checked;
  if($("#rp-Aauto").checked){ const p={eta_inf:+$("#rp-ei").value,Tg:+$("#rp-Tg").value,m,B:+$("#rp-B").value,C:+$("#rp-C").value}; const A=MODELS.continuityA(p); if(isFinite(A)) $("#rp-A").value=+A.toFixed(4); }
  const cust=$("#rp-beta").value==="custom"; $("#rp-N-l").hidden=cust; $("#rp-bc-l").hidden=!cust;
  MODEL_KEYS.forEach(k=>$("#sec-"+k).classList.toggle("off",!$("#use-"+k).checked));
}
function setMaterial(p){ $("#Tg").value=p.Tg; $("#m").value=p.m; $("#l10").value=p.l10; $("#f").value=p.f; $("#fr").value=p.f; $("#b0").value=p.b0; $("#N").value=$("#N").value||200; syncLinked(); }
function setProtocol(key){
  const P=PROTOS[key]; if(!P.build) return;
  const Tg=+$("#Tg").value, o=P.build(Tg);
  $("#T0").value=+o.T0.toFixed(2); state.segs=o.segs.map(s=>({...s})); renderSegs();
}

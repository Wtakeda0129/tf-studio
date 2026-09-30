global.TL=require('../tl_core.js');global.MODELS=require('../models_extra.js');
TL.setLibrary(require('../beta_library.json'));MODELS.setTables(require('../prony_fit.json'),require('../relaxpy_prony.json'));
const E=require('../engine.js');
const rng=E.mulberry(7), noise=s=>s*(rng()+rng()+rng()-1.5);
function synth(model,p,hist,segs,kind,si,xs,lin,noiseAmp){ // generate data from model
  const sim=E.simulate(model,p,hist); const ds={kind,seg:si,x:xs,y:xs.map(()=>0),enabled:true,weight:1};
  const rawK={cp_raw:'cp_norm',H_T:'tf_T',V_T:'tf_T',P_t:'tf_t'}[kind]||kind; const pr=E.predict({...ds,kind:rawK},hist,sim,segs); // raw base values
  let y=[]; const K=E.KINDS[kind];
  // raw curve (no scaling) at xs
  const c=pr.curve; y=xs.map(x=>E.interp(c.x,c.y,x));
  if(lin) y=y.map((v,i)=>lin(xs[i],v));
  ds.y=y.map(v=>v+noise(noiseAmp)); return ds;
}
function runFit(model,base,free,hist,segs,dsets,opts){ const g=E.fit(model,base,free,hist,segs,dsets,opts); let s; while(!(s=g.next()).done); return s.value; }
function range(a,b,n){return Array.from({length:n},(_,i)=>a+(b-a)*i/(n-1));}
const t0=Date.now();
// 1) TL, DSC cool (10) + heat (10) normalized Cp
{ const Tg=300; const segs=[{type:'ramp',T:230,rate:10,dT:0.5},{type:'ramp',T:350,rate:10,dT:0.5}];
  const h=E.compile(350,segs); const truth={Tg:300,m:50,log10tau0:-22,f:0.6,beta0:1,N:200};
  const d1=synth('TL',truth,h,segs,'cp_norm',0,range(250,340,120),null,0.01), d2=synth('TL',truth,h,segs,'cp_norm',1,range(250,340,120),null,0.01);
  const free=[{k:'Tg',lo:270,hi:330},{k:'log10tau0',lo:-40,hi:-10},{k:'f',lo:0.1,hi:0.99,discrete:0.01}];
  const r=runFit('TL',{...truth,Tg:292,log10tau0:-28,f:0.5},free,h,segs,[d1,d2],{maxEval:800});
  console.log('TL DSC  truth Tg=300 l10=-22 f=0.6 →',r.best.Tg.toFixed(2),r.best.log10tau0.toFixed(2),r.best.f.toFixed(2),'nev',r.nev);
  const u=E.uncertainty('TL',r.best,free,h,segs,[d1,d2]); console.log('   SE',u.names.map((n,i)=>n+'±'+u.se[i].toPrecision(2)).join(' '),'corr',u.corr[0][1].toFixed(3));
}
// 2) TNM annealing φ(t) + raw enthalpy with baselines (cp_raw)
{ const segs=[{type:'ramp',T:280,rate:20,dT:0.5},{type:'hold',dur:1e5,n:60,t1:0.5},{type:'ramp',T:230,rate:20,dT:1},{type:'ramp',T:340,rate:10,dT:0.5}];
  const h=E.compile(330,segs); const truth={Tg:300,m:60,x:0.45,beta:0.6};
  const d1=synth('TNM',truth,h,segs,'relax_t',1,[1,3,10,30,100,300,1000,3000,1e4,3e4,1e5],null,0.005);
  const d2=synth('TNM',truth,h,segs,'cp_raw',3,range(240,335,150),(T,c)=>0.3+0.001*T+(0.2+0.0002*T)*c,0.003);
  const free=[{k:'Tg',lo:270,hi:330},{k:'m',lo:20,hi:150},{k:'x',lo:0.05,hi:1},{k:'beta',lo:0.15,hi:1}];
  for(const [method,me] of [['local',2500],['global',2500],['global',6000]]){
  const r=runFit('TNM',{Tg:305,m:45,x:0.7,beta:0.8},free,h,segs,[d1,d2],{maxEval:me,method});
  console.log(`TNM anneal+rawCp (${method}) truth 300 60 0.45 0.6 →`,['Tg','m','x','beta'].map(k=>r.best[k].toFixed(3)).join(' '),'nev',r.nev,'sse',r.fbest.toExponential(2));
  const e=E.evaluate('TNM',r.best,h,segs,[d1,d2]); console.log('   R2',e.perDs.map(d=>d.R2.toFixed(4)).join(' '),'lin',e.perDs[1].pr.lin.b.map(v=>v.toPrecision(3)).join(','));}
}
// 3) RelaxPy volume vs T (dilatometry) cooling 3 K/min + MDSC Cp' / Cp''
{ const segs=[{type:'ramp',T:250,rate:3,dT:0.5},{type:'mdsc',T:340,rate:2,A:0.5,P:60,ppp:30}];
  const h=E.compile(340,segs); const truth={Tg:300,m:55,B:9000,C:135.09,pexp:12,A:0,eta_inf:-2.9,log10Ks:10.544068,beta:0.5,Aauto:true};
  const d1=synth('RP',truth,h,segs,'V_T',0,range(255,335,80),(T,tf)=>1+2e-5*T+3e-5*tf,1e-5);
  const d2=synth('RP',truth,h,segs,'mdsc_re',1,range(260,335,120),null,0.005);
  const d3=synth('RP',truth,h,segs,'mdsc_im',1,range(260,335,120),null,0.005);
  const free=[{k:'Tg',lo:270,hi:330},{k:'m',lo:20,hi:150},{k:'B',lo:0,hi:5e4},{k:'pexp',lo:0.5,hi:100}];
  const r=runFit('RP',{...truth,Tg:292,m:45,B:5000,pexp:20},free,h,segs,[d1,d2,d3],{maxEval:2000});
  console.log('RP V+MDSC truth 300 55 9000 12 →',['Tg','m','B','pexp'].map(k=>r.best[k].toPrecision(4)).join(' '),'nev',r.nev);
  const e=E.evaluate('RP',r.best,h,segs,[d1,d2,d3]); console.log('   R2',e.perDs.map(d=>d.R2.toFixed(4)).join(' '),'steps',h.T.length);
}
console.log('total',(Date.now()-t0)/1000,'s');

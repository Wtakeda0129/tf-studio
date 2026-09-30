global.TL=require('../tl_core.js');global.MODELS=require('../models_extra.js');
TL.setLibrary(require('../beta_library.json'));MODELS.setTables(require('../prony_fit.json'),require('../relaxpy_prony.json'));
const E=require('../engine.js');
// TNM x=1, beta=1 -> linear Debye response
const Tg=300,m=40; const Th=Tg+2; const dh=m*Math.log(10)*Tg, lnA=Math.log(100)-dh/Tg; const tau=Math.exp(lnA+dh/Th);
{for(const P of [20,60,200,600,2000]){
 const segs=[{type:'mdsc',rate:0,dur:P*30,A:0.02,P,ppp:120}];
 const h=E.compile(Th,segs); const sim=E.simulate('TNM',{Tg,m,x:1,beta:1},h);
 const s=E.mdscSeries(h,sim,0,segs[0]); const k=s.T.length-10; const w=2*Math.PI/P, wt=w*tau;
 console.log('P',P,'ωτ',wt.toFixed(3),'Cp\'',s.re[k].toFixed(4),'vs',(1/(1+wt*wt)).toFixed(4),' Cp"',s.im[k].toFixed(4),'vs',(wt/(1+wt*wt)).toFixed(4));
}}

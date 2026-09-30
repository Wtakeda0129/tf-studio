# Prony-series fits exp(-x^beta) ~ sum w_i exp(-k_i x) for beta = 0.10..1.00 (N=16), NNLS with sum(w)=1
import numpy as np, json
from scipy.optimize import nnls
x=np.logspace(-4,3,500)
def fit(beta,N,lo,hi):
    if beta>=0.999: return np.array([1.0]),np.array([1.0])
    K=10**np.linspace(lo,hi,N)
    xg=np.logspace(-4,min(12,np.log10(max(60,(12)**(1/beta)))),600)
    A=np.exp(-K[None,:]*xg[:,None]); b=np.exp(-xg**beta)
    sw=50; A=np.vstack([A,sw*np.ones(N)]); b=np.append(b,sw)
    w,_=nnls(A,b); keep=w>1e-10; return w[keep],K[keep]
out={}; worst=0
for kb in range(10,101):
    beta=kb/100; best=None
    NN=16 if beta>=0.35 else 24
    for lo in np.arange(-12 if beta<0.35 else -6,-1.0,0.5):
        for hi in (1.5,2,2.5,3,3.5,4):
            w,K=fit(beta,NN,lo,hi)
            e=np.max(np.abs((w[:,None]*np.exp(-K[:,None]*x[None,:])).sum(0)-np.exp(-x**beta)))
            if best is None or e<best[0]: best=(e,w,K)
    e,w,K=best; worst=max(worst,e)
    out[str(kb)]={'w':[float(f'{v:.8g}') for v in w/w.sum()],'k':[float(f'{v:.8g}') for v in K],'err':float(f'{e:.2g}')}
    if kb%10==0: print(beta,len(w),e)
print('worst',worst)
json.dump(out,open('prony_fit.json','w'),separators=(',',':'))

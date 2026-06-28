// Cloudflare Worker — live data engine for the Coolizi dashboard.
// Holds the GSC service-account key + Blitz affiliate key as SECRETS.
// Mints a Google token (RS256 JWT), queries Search Console + Blitz live for a date range,
// returns the dashboard JSON. Accepts ?start=YYYY-MM-DD&end=YYYY-MM-DD (default last 7 days).
const PROP = "sc-domain:trycoolizi.com";
const PROP_ENC = "sc-domain%3Atrycoolizi.com";
const SA_URL = `https://www.googleapis.com/webmasters/v3/sites/${PROP_ENC}/searchAnalytics/query`;
const INSPECT_URL = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";
const GEOS = ["en","de","fr","it","es","nl","pt","el"];
const URLS = ["https://trycoolizi.com/"].concat(GEOS.map(g=>`https://trycoolizi.com/${g}/`));
const CC = {gbr:["UK","🇬🇧","en"],deu:["Germany","🇩🇪","de"],aut:["Austria","🇦🇹","de"],che:["Switzerland","🇨🇭","de"],fra:["France","🇫🇷","fr"],bel:["Belgium","🇧🇪","fr"],ita:["Italy","🇮🇹","it"],esp:["Spain","🇪🇸","es"],nld:["Netherlands","🇳🇱","nl"],prt:["Portugal","🇵🇹","pt"],grc:["Greece","🇬🇷","el"],usa:["USA","🇺🇸","en"],can:["Canada","🇨🇦","en"],ind:["India","🇮🇳","en"],irl:["Ireland","🇮🇪","en"]};

const ymd = d => (typeof d==="string" ? d : d.toISOString().slice(0,10));
const addDays = (dstr, n) => { const d=new Date(ymd(dstr)+"T00:00:00Z"); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); };
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const enc = new TextEncoder();
function pemToDer(pem){ const b = pem.replace(/-----[^-]+-----/g,"").replace(/\s+/g,""); const bin = atob(b); const u = new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i); return u.buffer; }

async function getToken(sa){
  const now = Math.floor(Date.now()/1000);
  const header = b64url(enc.encode(JSON.stringify({alg:"RS256",typ:"JWT"})));
  const claim = b64url(enc.encode(JSON.stringify({iss:sa.client_email,scope:"https://www.googleapis.com/auth/webmasters.readonly",aud:"https://oauth2.googleapis.com/token",exp:now+3600,iat:now})));
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(sa.private_key), {name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"}, false, ["sign"]);
  const sig = b64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(header+"."+claim)));
  const jwt = `${header}.${claim}.${sig}`;
  const r = await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`});
  const j = await r.json();
  if(!j.access_token) throw new Error("token: "+JSON.stringify(j));
  return j.access_token;
}
async function saQ(tok, dims, {state="all", start, end}={}){
  const body = {startDate:ymd(start), endDate:ymd(end), dimensions:dims, rowLimit:2000, dataState:state};
  const r = await fetch(SA_URL,{method:"POST",headers:{Authorization:"Bearer "+tok,"Content-Type":"application/json"},body:JSON.stringify(body)});
  if(!r.ok) return []; return (await r.json()).rows||[];
}
const rf = r => ({keys:r.keys, impressions:Math.round(r.impressions||0), clicks:Math.round(r.clicks||0), ctr:Math.round((r.ctr||0)*10000)/100, position:Math.round((r.position||0)*10)/10});
async function inspect(tok, url){
  try{
    const r = await fetch(INSPECT_URL,{method:"POST",headers:{Authorization:"Bearer "+tok,"Content-Type":"application/json"},body:JSON.stringify({inspectionUrl:url,siteUrl:PROP,languageCode:"en"})});
    if(!r.ok) return {url,verdict:"ERR",coverage:`HTTP ${r.status}`,robots:"",fetch:"",indexing:"",lastCrawl:null};
    const x = ((await r.json()).inspectionResult||{}).indexStatusResult||{};
    return {url,verdict:x.verdict||"?",coverage:x.coverageState||"Unknown",robots:x.robotsTxtState||"?",fetch:x.pageFetchState||"?",indexing:x.indexingState||"?",lastCrawl:x.lastCrawlTime||null};
  }catch(e){ return {url,verdict:"ERR",coverage:"timeout",robots:"",fetch:"",indexing:"",lastCrawl:null}; }
}
const wpos = rows => { const i=rows.reduce((a,r)=>a+r.impressions,0); return i?Math.round(rows.reduce((a,r)=>a+r.position*r.impressions,0)/i*10)/10:0; };
async function getIndex(tok){
  try{
    const cache=caches.default, ck=new Request("https://cz-cache.local/index-status-v1");
    const hit=await cache.match(ck); if(hit) return await hit.json();
    const idx=await Promise.all(URLS.map(u=>inspect(tok,u)));
    await cache.put(ck,new Response(JSON.stringify(idx),{headers:{"Cache-Control":"max-age=7200","Content-Type":"application/json"}}));
    return idx;
  }catch(e){ return await Promise.all(URLS.map(u=>inspect(tok,u))); }
}

// ---- Affiliate (Blitz / CAKE). Coolizi isolated BY OFFER NAME; end_date is EXCLUSIVE so we add +1 day. ----
const GEO_BY_CC={"de":["DE/AT/CH","🇩🇪","de"],"uk":["UK","🇬🇧","en"],"fr":["FR/BE","🇫🇷","fr"],"it":["Italy","🇮🇹","it"],"es":["Spain","🇪🇸","es"],"nl":["NL","🇳🇱","nl"],"pt":["Portugal","🇵🇹","pt"],"gr":["Greece","🇬🇷","el"],"be":["Belgium","🇧🇪","fr"]};
const SUF_CC={"UK":"uk","DE/AT/CH":"de","FR/BE":"fr","IT":"it","ES":"es","NL":"nl","PT":"pt","GR":"gr","BE":"be"};
async function blitzPull(env, start, end){
  try{
    const key=env.BLITZ_KEY, aid=env.BLITZ_AID; if(!key) return {connected:false,error:"no key"};
    const base="https://affiliates.blitzadsgroup.com/affiliates/api";
    const sd=ymd(start), ed=addDays(end,1); // +1: Blitz end_date is exclusive
    async function get(ep,extra){ const r=await fetch(`${base}/${ep}?api_key=${key}&affiliate_id=${aid}&start_date=${sd}&end_date=${ed}${extra||""}`,{headers:{Accept:"application/json"}}); return r.ok?((await r.json()).data||[]):[]; }
    const oname=r=>(r.offer_name||(r.offer||{}).offer_name||""); // conversions: top-level; clicks: nested
    const s1of=r=>String(r.subid_1||"").toLowerCase();
    const isOurs=r=>{const s=s1of(r);const o=oname(r).toLowerCase();return s.startsWith("intl-")||s.startsWith("try-")||o.includes("coolizi")||o.includes("airabreeze");};
    const geocc=r=>{const s=s1of(r);for(const pre of ["intl-","try-"])if(s.startsWith(pre))return s.slice(pre.length);return SUF_CC[oname(r).split(" - ").pop().trim()]||"??";};
    const [clk, cnv] = await Promise.all([get("Reports/Clicks","&row_limit=50000"), get("Reports/Conversions","&row_limit=500")]);
    const cool=clk.filter(isOurs);
    const coolconv=cnv.filter(isOurs);
    const agg={};
    cool.forEach(r=>{const k=geocc(r);(agg[k]=agg[k]||{clicks:0,conversions:0,revenue:0}).clicks++;});
    coolconv.forEach(c=>{const k=geocc(c);const a=agg[k]=agg[k]||{clicks:0,conversions:0,revenue:0};a.conversions++;a.revenue+=(+c.price||+c.revenue||0);});
    const by_geo=Object.entries(agg).map(([k,v])=>{const g=GEO_BY_CC[k]||[k.toUpperCase(),"🏳️",""];const c2=v.clicks,cv=v.conversions,rev=Math.round(v.revenue*100)/100;return {sub:k,name:g[0],flag:g[1],geo:g[2],clicks:c2,conversions:cv,revenue:rev,epc:c2?Math.round(rev/c2*1000)/1000:0,cr:c2?Math.round(cv/c2*10000)/100:0};}).sort((a,b)=>b.clicks-a.clicks||b.revenue-a.revenue);
    const tclk=by_geo.reduce((a,x)=>a+x.clicks,0),tcv=by_geo.reduce((a,x)=>a+x.conversions,0),trev=by_geo.reduce((a,x)=>a+x.revenue,0);
    const recent=coolconv.slice(0,15).map(c=>({date:c.conversion_date||"",sub:geocc(c),offer:oname(c),revenue:Math.round((+c.price||+c.revenue||0)*100)/100}));
    return {connected:true,clicks:tclk,conversions:tcv,revenue:Math.round(trev*100)/100,epc:tclk?Math.round(trev/tclk*1000)/1000:0,cr:tclk?Math.round(tcv/tclk*10000)/100:0,currency:"$",goal:50,by_geo,recent};
  }catch(e){return {connected:false,error:String(e).slice(0,120)};}
}

async function buildData(sa, range, env){
  const start = range.start, end = range.end;
  const [affiliate, tok] = await Promise.all([blitzPull(env||{}, start, end), getToken(sa)]);
  const totalsR = async (s,e) => { const r=await saQ(tok,[],{start:s,end:e}); if(!r.length) return {impressions:0,clicks:0,ctr:0,position:0}; const x=r[0]; return {impressions:Math.round(x.impressions||0),clicks:Math.round(x.clicks||0),ctr:Math.round((x.ctr||0)*10000)/100,position:Math.round((x.position||0)*10)/10}; };
  const dailyStart = addDays(end, -27); // 28-day trend ending at the range end
  const [dailyR, hourlyR, byCountryR, byDeviceR, byQueryR, byPageR, byQPR, baseT, index] = await Promise.all([
    saQ(tok,["date"],{start:dailyStart,end}),
    saQ(tok,["HOUR"],{state:"HOURLY_ALL",start:end,end}),
    saQ(tok,["country"],{start,end}),
    saQ(tok,["device"],{start,end}),
    saQ(tok,["query"],{start,end}),
    saQ(tok,["page"],{start,end}),
    saQ(tok,["query","page"],{start,end}),
    totalsR(start,end),
    getIndex(tok),
  ]);
  const daily = dailyR.map(rf).map(d=>({date:d.keys[0],impressions:d.impressions,clicks:d.clicks,ctr:d.ctr,position:d.position}));
  const hourly = hourlyR.map(r=>({hour:r.keys[0],impressions:Math.round(r.impressions||0),clicks:Math.round(r.clicks||0)}));
  const byCountry=byCountryR.map(rf), byDevice=byDeviceR.map(rf), byQuery=byQueryR.map(rf), byPage=byPageR.map(rf), byQP=byQPR.map(rf);
  const timp = baseT.impressions, tclk = baseT.clicks;
  const summary = {...baseT, queries:byQuery.length, pages_seen:byPage.filter(p=>p.impressions>0).length};
  const geo = byCountry.map(r=>{const cc=r.keys[0];const[n,f,g]=CC[cc]||[cc.toUpperCase(),"🏳️",""];return {cc,name:n,flag:f,geo:g,impressions:r.impressions,clicks:r.clicks,ctr:r.ctr,position:r.position};}).sort((a,b)=>b.impressions-a.impressions);
  const brand = byQuery.filter(r=>r.keys[0].toLowerCase().includes("coolizi")).map(r=>({q:r.keys[0],impressions:r.impressions,clicks:r.clicks,ctr:r.ctr,position:r.position})).sort((a,b)=>b.impressions-a.impressions);
  const opp = byQuery.filter(r=>r.position>=3.5&&r.position<=20.5&&r.impressions>=3).map(r=>({q:r.keys[0],impressions:r.impressions,clicks:r.clicks,position:r.position,ctr:r.ctr,potential:Math.round(r.impressions*(Math.max(0,20-r.position)/20)*10)/10,hint:r.position<=10?"Improve title/meta CTR":"Push onto page 1"})).sort((a,b)=>b.potential-a.potential).slice(0,25);
  const qm={}; byQP.forEach(r=>{const q=r.keys[0];(qm[q]=qm[q]||[]).push({page:r.keys[1],impressions:r.impressions,position:r.position});});
  const cannibal = Object.entries(qm).filter(([,v])=>v.length>1).map(([q,v])=>({q,pages:v.sort((a,b)=>b.impressions-a.impressions)})).sort((a,b)=>b.pages.reduce((s,p)=>s+p.impressions,0)-a.pages.reduce((s,p)=>s+p.impressions,0)).slice(0,12);
  const funnel = {indexed:0,crawled_not_indexed:0,discovered:0,other:0};
  index.forEach(i=>{const c=(i.coverage||"").toLowerCase(); if(c.includes("indexed")&&!c.includes("not")&&!c.includes("discover")&&!c.includes("crawled"))funnel.indexed++; else if(c.includes("crawled"))funnel.crawled_not_indexed++; else if(c.includes("discover"))funnel.discovered++; else funnel.other++;});
  const positions = byQuery.filter(r=>r.position>0).map(r=>r.position); const best = positions.length?Math.min(...positions):99;
  const milestones = {first_impression:timp>0,first_click:tclk>0,top10:best<=10,top3:best<=3,number1:best<=1.5,best_position:best,indexed_pages:funnel.indexed};
  const now = new Date();
  return {generatedAt:now.toISOString().slice(0,16).replace("T"," ")+" UTC (live)",property:PROP,range:{start:ymd(start),end:ymd(end)},summary,daily,hourly,geo,device:byDevice,topQueries:byQuery.slice(0,40),topPages:byPage,brand,opportunities:opp,cannibal,indexation:index,funnel,milestones,affiliate};
}

const DASH_URL = "https://buckgray6366.github.io/cz-dash/";
export default {
  async fetch(request, env){
    const cors = {"Access-Control-Allow-Origin":"*","Cache-Control":"no-store","Content-Type":"application/json"};
    if(request.method==="OPTIONS") return new Response(null,{headers:cors});
    if(request.method==="GET" && (request.headers.get("Accept")||"").includes("text/html")){
      const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Coolizi · live data engine</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:radial-gradient(900px 500px at 50% -10%,rgba(34,211,168,.18),transparent),#0a0e14;color:#dfe7f1;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.card{max-width:520px;text-align:center;padding:38px 34px;background:#141b26;border:1px solid #243042;border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.4)}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#34d399;box-shadow:0 0 12px #34d399;margin-right:7px;animation:p 1.6s infinite}@keyframes p{50%{opacity:.4}}
h1{font-size:23px;margin:6px 0 4px;letter-spacing:-.02em}.s{color:#8a98ad;font-size:14.5px;margin:0 0 22px}
a.btn{display:inline-block;background:linear-gradient(90deg,#22d3a8,#3b9dff);color:#06121a;font-weight:800;text-decoration:none;padding:13px 26px;border-radius:11px;font-size:15px}
code{background:#0c1118;border:1px solid #243042;padding:2px 7px;border-radius:6px;font-size:12.5px;color:#9fe7d3}</style></head>
<body><div class="card"><div><span class="dot"></span><b>Live data engine — online</b></div>
<h1>This is the data API, not the dashboard 🔌</h1>
<p class="s">It feeds your dashboard live Search Console + affiliate numbers. Open the actual dashboard here:</p>
<a class="btn" href="${DASH_URL}">Open the Coolizi dashboard →</a>
<p class="s" style="margin-top:20px">Raw JSON lives at <code>?start=YYYY-MM-DD&end=YYYY-MM-DD</code></p></div></body></html>`;
      return new Response(html,{headers:{"Content-Type":"text/html;charset=utf-8","Access-Control-Allow-Origin":"*","Cache-Control":"no-store"}});
    }
    try{
      const sa = JSON.parse(env.GSC_SA_JSON);
      const u = new URL(request.url);
      let start = u.searchParams.get("start"), end = u.searchParams.get("end");
      const re = /^\d{4}-\d{2}-\d{2}$/;
      if(!re.test(start||"") || !re.test(end||"")){ const t=new Date(); end=t.toISOString().slice(0,10); start=new Date(t.getTime()-6*86400000).toISOString().slice(0,10); }
      const data = await buildData(sa, {start, end}, env);
      return new Response(JSON.stringify(data),{headers:cors});
    }catch(e){
      return new Response(JSON.stringify({error:String(e)}),{status:500,headers:cors});
    }
  }
};

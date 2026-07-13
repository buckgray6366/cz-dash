// Cloudflare Worker — CoolJet (trycoolizi) live data engine. Clone of oz_worker.js.
// GSC (trycoolizi rankings) + Everflow/Stellar-Yonder (CoolJet sales, sub1=cj-<geo>). Passcode-gated (?k=).
// Secrets are CF bindings: GSC_SA_JSON, EF_KEY (Stellar Yonder), PASSCODE. Caches 5 min; ?force=1 bypasses.
const PROP="sc-domain:trycoolizi.com";
const PROP_ENC="sc-domain%3Atrycoolizi.com";
const SA_URL=`https://www.googleapis.com/webmasters/v3/sites/${PROP_ENC}/searchAnalytics/query`;
const EF="https://api.eflow.team/v1/affiliates";
// [key, display name, flag, [GSC country codes], our sub1 tag]
const BUCKETS=[
 ["UK","UK · Ireland","🇬🇧",["gbr","irl"],"cj-uk"],
 ["DACH","DE · AT · CH","🇩🇪",["deu","aut","che"],"cj-de"],
 ["FR","France · BE","🇫🇷",["fra","bel"],"cj-fr"],
 ["IT","Italy","🇮🇹",["ita"],"cj-it"],
 ["ES","Spain","🇪🇸",["esp"],"cj-es"],
 ["NL","Netherlands","🇳🇱",["nld"],"cj-nl"],
];
// flag lookup for the sales table — Everflow gives FULL country names (country_code is null), so map both
const CCFLAG={
 gbr:"🇬🇧",irl:"🇮🇪",deu:"🇩🇪",aut:"🇦🇹",che:"🇨🇭",fra:"🇫🇷",bel:"🇧🇪",ita:"🇮🇹",esp:"🇪🇸",nld:"🇳🇱",usa:"🇺🇸",
 "united kingdom":"🇬🇧",ireland:"🇮🇪",germany:"🇩🇪",austria:"🇦🇹",switzerland:"🇨🇭",france:"🇫🇷",belgium:"🇧🇪",
 italy:"🇮🇹",spain:"🇪🇸",netherlands:"🇳🇱","united states":"🇺🇸"};

const enc=new TextEncoder();
const b64url=buf=>btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
function pemToDer(pem){const b=pem.replace(/-----[^-]+-----/g,"").replace(/\s+/g,"");const bin=atob(b);const u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u.buffer;}
const pad=n=>String(n).padStart(2,"0");
const ymdOf=d=>d.getUTCFullYear()+"-"+pad(d.getUTCMonth()+1)+"-"+pad(d.getUTCDate());
const shift=(base,n)=>{const x=new Date(base);x.setUTCDate(x.getUTCDate()+n);return x;};
const RANGE_LABEL={today:"Today",yesterday:"Yesterday","7d":"Last 7 days","14d":"Last 14 days",month:"This month",lastmonth:"Last month",year:"This year"};
function computeRange(name){
  const now=new Date(); const t=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));
  let from,to;
  switch(name){
    case "yesterday": from=to=shift(t,-1); break;
    case "7d": from=shift(t,-6); to=t; break;
    case "14d": from=shift(t,-13); to=t; break;
    case "month": from=new Date(Date.UTC(t.getUTCFullYear(),t.getUTCMonth(),1)); to=t; break;
    case "lastmonth": from=new Date(Date.UTC(t.getUTCFullYear(),t.getUTCMonth()-1,1)); to=new Date(Date.UTC(t.getUTCFullYear(),t.getUTCMonth(),0)); break;
    case "year": from=new Date(Date.UTC(t.getUTCFullYear(),0,1)); to=t; break;
    default: name="today"; from=to=t; break;
  }
  // Everflow `to` is INCLUSIVE — do NOT add +1 (that's the Blitz/CAKE rule; wrong for Everflow)
  return {from:ymdOf(from),to:ymdOf(to),efTo:ymdOf(to),name,label:RANGE_LABEL[name]||"Today"};
}

async function getToken(sa){
  const now=Math.floor(Date.now()/1000);
  const header=b64url(enc.encode(JSON.stringify({alg:"RS256",typ:"JWT"})));
  const claim=b64url(enc.encode(JSON.stringify({iss:sa.client_email,scope:"https://www.googleapis.com/auth/webmasters.readonly",aud:"https://oauth2.googleapis.com/token",exp:now+3600,iat:now})));
  const key=await crypto.subtle.importKey("pkcs8",pemToDer(sa.private_key),{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);
  const sig=b64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,enc.encode(header+"."+claim)));
  const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${header}.${claim}.${sig}`});
  const j=await r.json(); if(!j.access_token) throw new Error("token:"+JSON.stringify(j).slice(0,120)); return j.access_token;
}
async function saQ(tok,dims,rg){
  const body={startDate:rg.from,endDate:rg.to,dimensions:dims,rowLimit:5000,dataState:"all"};
  const r=await fetch(SA_URL,{method:"POST",headers:{Authorization:"Bearer "+tok,"Content-Type":"application/json"},body:JSON.stringify(body)});
  if(!r.ok) return []; return (await r.json()).rows||[];
}
async function efEntity(env,col,rg){
  const body={from:rg.from,to:rg.efTo,timezone_id:80,currency_id:"USD",columns:[{column:col}],query:{filters:[]}};
  const r=await fetch(`${EF}/reporting/entity`,{method:"POST",headers:{"X-Eflow-API-Key":env.EF_KEY,"Content-Type":"application/json"},body:JSON.stringify(body)});
  if(!r.ok) return {table:[],summary:{}}; const j=await r.json(); return {table:j.table||[],summary:j.summary||{}};
}
async function efConversions(env,rg){
  const body={from:rg.from,to:rg.efTo,timezone_id:80,currency_id:"USD",show_conversions:true,show_events:false,query:{filters:[]}};
  const r=await fetch(`${EF}/reporting/conversions`,{method:"POST",headers:{"X-Eflow-API-Key":env.EF_KEY,"Content-Type":"application/json"},body:JSON.stringify(body)});
  if(!r.ok) return []; return (await r.json()).conversions||[];
}
const efRows=table=>{const o={};(table||[]).forEach(r=>{const c=(r.columns&&r.columns[0])||{};const label=String(c.label||c.id||"").trim();const rp=r.reporting||{};o[label]={clicks:+rp.total_click||0,uclicks:+rp.unique_click||0,conv:+rp.cv||0,revenue:Math.round((+rp.revenue||0)*100)/100};});return o;};

async function buildData(env,rg){
  const sa=JSON.parse(env.GSC_SA_JSON);
  const [tok,efSubR,convs]=await Promise.all([getToken(sa),efEntity(env,"sub1",rg),efConversions(env,rg)]);
  const [totR,qcR,coR]=await Promise.all([saQ(tok,[],rg),saQ(tok,["query","country"],rg),saQ(tok,["country"],rg)]);
  const tot=totR[0]||{};
  const QC=qcR.map(r=>({q:r.keys[0],cc:r.keys[1],impressions:Math.round(r.impressions||0),clicks:Math.round(r.clicks||0),position:Math.round((r.position||0)*10)/10}));
  const CO={}; coR.forEach(r=>{CO[r.keys[0]]={impressions:Math.round(r.impressions||0),clicks:Math.round(r.clicks||0),position:Math.round((r.position||0)*10)/10};});
  const EFSUB=efRows(efSubR.table);

  const geos=BUCKETS.map(([key,name,flag,ccset,sub])=>{
    const rows=QC.filter(r=>ccset.includes(r.cc));
    const agg={};
    rows.forEach(r=>{const a=agg[r.q]=agg[r.q]||{q:r.q,impressions:0,clicks:0,pw:0};a.impressions+=r.impressions;a.clicks+=r.clicks;a.pw+=r.position*r.impressions;});
    let ql=Object.values(agg).map(a=>({q:a.q,impressions:a.impressions,clicks:a.clicks,ctr:a.impressions?Math.round(a.clicks/a.impressions*1000)/10:0,position:a.impressions?Math.round(a.pw/a.impressions*10)/10:0}));
    ql.sort((x,y)=>y.impressions-x.impressions);
    const cimp=ccset.reduce((s,cc)=>s+((CO[cc]||{}).impressions||0),0);
    const cclk=ccset.reduce((s,cc)=>s+((CO[cc]||{}).clicks||0),0);
    const pw=ccset.reduce((s,cc)=>{const o=CO[cc]||{};return s+(o.position||0)*(o.impressions||0);},0);
    const cpos=cimp?Math.round(pw/cimp*10)/10:0;
    const posv=ql.filter(q=>q.position>0).map(q=>q.position);
    const best=posv.length?Math.min(...posv):0;
    const ef=EFSUB[sub]||{clicks:0,uclicks:0,conv:0,revenue:0};
    return {key,name,flag,gsc:{impressions:cimp,clicks:cclk,position:cpos,best},ef,queries:ql.slice(0,9)};
  });

  // CoolJet-only sales: conversions whose sub1 is one of our cj-<geo> tags (the account also runs Ozem+)
  const sales=convs.filter(c=>String(c.sub1||"").toLowerCase().startsWith("cj-")).map(c=>{
    const ts=+(c.conversion_unix_timestamp||c.unix_timestamp||c.conversion_timestamp||0);
    let date=""; if(ts){const d=new Date(ts*1000);date=d.toLocaleString("en-GB",{timeZone:"UTC",day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}).replace(",","");}
    const cc=String(c.country_code||c.country||"").toLowerCase();
    return {date,cc:String(c.country||cc).replace(/^\w/,m=>m.toUpperCase()),flag:CCFLAG[cc]||"🏳️",device:String(c.device_type||c.platform||c.os||"—").split("/")[0]||"—",usd:Math.round(+c.revenue||+c.payout||0)};
  }).sort((a,b)=>a.date<b.date?1:-1);

  // KPI = CoolJet-only (sum of our geo buckets), NOT the whole-account Everflow summary
  const efClicks=geos.reduce((s,g)=>s+g.ef.clicks,0);
  const efUClicks=geos.reduce((s,g)=>s+g.ef.uclicks,0);
  const efConv=geos.reduce((s,g)=>s+g.ef.conv,0);
  const efRev=Math.round(geos.reduce((s,g)=>s+g.ef.revenue,0)*100)/100;
  return {
    gen:new Date().toLocaleString("en-GB",{timeZone:"UTC",day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}).replace(",","")+" UTC",
    win:rg.label, range:rg.name, from:rg.from, to:rg.to, live:true,
    kpi:{revenue:efRev,sales:efConv,ef_clicks:efClicks,ef_uclicks:efUClicks,cvr:efClicks?Math.round(efConv/efClicks*10000)/100:0,epc:efClicks?Math.round(efRev/efClicks*100)/100:0,
      impressions:Math.round(tot.impressions||0),gsc_clicks:Math.round(tot.clicks||0),pos:Math.round((tot.position||0)*10)/10},
    sales, geos,
    note:"Live · CoolJet on Stellar Yonder · sales carry sub1=cj-<geo> · refreshes on load"
  };
}

const DASH="https://buckgray6366.github.io/cz-dash/";
export default {
  async fetch(request, env){
    const cors={"Access-Control-Allow-Origin":"*","Cache-Control":"no-store","Content-Type":"application/json"};
    if(request.method==="OPTIONS") return new Response(null,{headers:{...cors,"Access-Control-Allow-Headers":"*"}});
    const u=new URL(request.url);
    if((request.headers.get("Accept")||"").includes("text/html") && !u.searchParams.get("k")){
      return new Response(`<!doctype html><meta charset=utf-8><title>CoolJet data engine</title><body style="font:16px system-ui;background:#0d1315;color:#e9eff1;display:flex;min-height:90vh;align-items:center;justify-content:center;text-align:center"><div><p>🔌 CoolJet live data engine — online.</p><p><a style="color:#2ed4b0" href="${DASH}">Open the dashboard →</a></p></div>`,{headers:{"Content-Type":"text/html;charset=utf-8","Access-Control-Allow-Origin":"*"}});
    }
    if((u.searchParams.get("k")||"")!==env.PASSCODE) return new Response(JSON.stringify({error:"unauthorized"}),{status:401,headers:cors});
    const rg=computeRange(u.searchParams.get("range")||"today");
    const cache=caches.default, ck=new Request("https://cz-cache.local/data-"+rg.name);
    if(!u.searchParams.get("force")){ const hit=await cache.match(ck); if(hit){const h=new Response(hit.body,{headers:cors}); h.headers.set("X-Cache","hit"); return h;} }
    try{
      const data=await buildData(env,rg);
      const body=JSON.stringify(data);
      await cache.put(ck,new Response(body,{headers:{"Cache-Control":"max-age=300","Content-Type":"application/json"}}));
      return new Response(body,{headers:{...cors,"X-Cache":"miss"}});
    }catch(e){ return new Response(JSON.stringify({error:String(e).slice(0,200)}),{status:500,headers:cors}); }
  }
};

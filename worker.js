// Cloudflare Worker — live GSC proxy for the Coolizi dashboard.
// Holds the service-account key as a SECRET (env.GSC_SA_JSON), mints a Google
// access token (RS256 JWT), queries Search Console live, returns the dashboard JSON.
// Deploy: Workers & Pages -> Create Worker -> paste this -> add Secret GSC_SA_JSON (the SA JSON).
const PROP = "sc-domain:trycoolizi.com";
const PROP_ENC = "sc-domain%3Atrycoolizi.com";
const SA_URL = `https://www.googleapis.com/webmasters/v3/sites/${PROP_ENC}/searchAnalytics/query`;
const INSPECT_URL = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";
const GEOS = ["en","de","fr","it","es","nl","pt","el"];
const URLS = ["https://trycoolizi.com/"].concat(GEOS.map(g=>`https://trycoolizi.com/${g}/`));
const CC = {gbr:["UK","🇬🇧","en"],deu:["Germany","🇩🇪","de"],aut:["Austria","🇦🇹","de"],che:["Switzerland","🇨🇭","de"],fra:["France","🇫🇷","fr"],bel:["Belgium","🇧🇪","fr"],ita:["Italy","🇮🇹","it"],esp:["Spain","🇪🇸","es"],nld:["Netherlands","🇳🇱","nl"],prt:["Portugal","🇵🇹","pt"],grc:["Greece","🇬🇷","el"],usa:["USA","🇺🇸","en"],can:["Canada","🇨🇦","en"],ind:["India","🇮🇳","en"],irl:["Ireland","🇮🇪","en"]};

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
async function saQ(tok, dims, {state="all", days=7, end=null}={}){
  const e = end||new Date(); const s = new Date(e.getTime()-days*86400000);
  const body = {startDate:s.toISOString().slice(0,10),endDate:e.toISOString().slice(0,10),dimensions:dims,rowLimit:2000,dataState:state};
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

async function buildData(sa, days){
  days = days || 7;
  const tok = await getToken(sa);
  async function totals(d){ const r=await saQ(tok,[],{days:d}); if(!r.length) return {impressions:0,clicks:0,ctr:0,position:0}; const x=r[0]; return {impressions:Math.round(x.impressions||0),clicks:Math.round(x.clicks||0),ctr:Math.round((x.ctr||0)*10000)/100,position:Math.round((x.position||0)*10)/10}; }
  const dailyR = await saQ(tok,["date"],{days:28});
  const daily = dailyR.map(rf).map(d=>({date:d.keys[0],impressions:d.impressions,clicks:d.clicks,ctr:d.ctr,position:d.position}));
  const hourlyR = await saQ(tok,["HOUR"],{state:"HOURLY_ALL",days:1});
  const hourly = hourlyR.map(r=>({hour:r.keys[0],impressions:Math.round(r.impressions||0),clicks:Math.round(r.clicks||0)}));
  const byCountry=(await saQ(tok,["country"],{days})).map(rf), byDevice=(await saQ(tok,["device"],{days})).map(rf);
  const byQuery=(await saQ(tok,["query"],{days})).map(rf), byPage=(await saQ(tok,["page"],{days})).map(rf);
  const byQP=(await saQ(tok,["query","page"],{days})).map(rf);
  const summaries={}; for(const dd of [1,7,28,90]) summaries[String(dd)]=await totals(dd);
  const base = await totals(days);
  const timp = base.impressions, tclk = base.clicks;
  const summary = {...base, queries:byQuery.length, pages_seen:byPage.filter(p=>p.impressions>0).length};
  const geo = byCountry.map(r=>{const cc=r.keys[0];const[n,f,g]=CC[cc]||[cc.toUpperCase(),"🏳️",""];return {cc,name:n,flag:f,geo:g,impressions:r.impressions,clicks:r.clicks,ctr:r.ctr,position:r.position};}).sort((a,b)=>b.impressions-a.impressions);
  const brand = byQuery.filter(r=>r.keys[0].toLowerCase().includes("coolizi")).map(r=>({q:r.keys[0],impressions:r.impressions,clicks:r.clicks,ctr:r.ctr,position:r.position})).sort((a,b)=>b.impressions-a.impressions);
  const opp = byQuery.filter(r=>r.position>=3.5&&r.position<=20.5&&r.impressions>=3).map(r=>({q:r.keys[0],impressions:r.impressions,clicks:r.clicks,position:r.position,ctr:r.ctr,potential:Math.round(r.impressions*(Math.max(0,20-r.position)/20)*10)/10,hint:r.position<=10?"Improve title/meta CTR":"Push onto page 1"})).sort((a,b)=>b.potential-a.potential).slice(0,25);
  const qm={}; byQP.forEach(r=>{const q=r.keys[0];(qm[q]=qm[q]||[]).push({page:r.keys[1],impressions:r.impressions,position:r.position});});
  const cannibal = Object.entries(qm).filter(([,v])=>v.length>1).map(([q,v])=>({q,pages:v.sort((a,b)=>b.impressions-a.impressions)})).sort((a,b)=>b.pages.reduce((s,p)=>s+p.impressions,0)-a.pages.reduce((s,p)=>s+p.impressions,0)).slice(0,12);
  const index = await Promise.all(URLS.map(u=>inspect(tok,u)));
  const funnel = {indexed:0,crawled_not_indexed:0,discovered:0,other:0};
  index.forEach(i=>{const c=(i.coverage||"").toLowerCase(); if(c.includes("indexed")&&!c.includes("not")&&!c.includes("discover")&&!c.includes("crawled"))funnel.indexed++; else if(c.includes("crawled"))funnel.crawled_not_indexed++; else if(c.includes("discover"))funnel.discovered++; else funnel.other++;});
  const positions = byQuery.filter(r=>r.position>0).map(r=>r.position); const best = positions.length?Math.min(...positions):99;
  const milestones = {first_impression:timp>0,first_click:tclk>0,top10:best<=10,top3:best<=3,number1:best<=1.5,best_position:best,indexed_pages:funnel.indexed};
  const now = new Date();
  return {generatedAt:now.toISOString().slice(0,16).replace("T"," ")+" UTC (live)",property:PROP,days,summary,summaries,daily,hourly,geo,device:byDevice,topQueries:byQuery.slice(0,40),topPages:byPage,brand,opportunities:opp,cannibal,indexation:index,funnel,milestones};
}

export default {
  async fetch(request, env){
    const cors = {"Access-Control-Allow-Origin":"*","Cache-Control":"no-store","Content-Type":"application/json"};
    if(request.method==="OPTIONS") return new Response(null,{headers:cors});
    try{
      const sa = JSON.parse(env.GSC_SA_JSON);
      let days = parseInt(new URL(request.url).searchParams.get("days")) || 7;
      days = Math.max(1, Math.min(180, days));
      const data = await buildData(sa, days);
      return new Response(JSON.stringify(data),{headers:cors});
    }catch(e){
      return new Response(JSON.stringify({error:String(e)}),{status:500,headers:cors});
    }
  }
};

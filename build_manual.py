#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build manual-backlinks.html (team posts by hand) from the article workflow output + resolved IPs."""
import json, os, html, datetime
HERE = os.path.dirname(os.path.abspath(__file__))
W = json.load(open("/tmp/claude-0/-root-workspace/465bc7a6-c5f4-49d0-8fec-6611f52dff18/tasks/wb5lx2smw.output"))
R = W.get("result", W); TASKS = R["tasks"]; ARTS = R["articles"]
IPS = {x["n"]: x for x in json.load(open("/tmp/manual_ips.json"))}
SIGNUP = {"Medium":"https://medium.com/new-story","Blogger":"https://www.blogger.com","WordPress.com":"https://wordpress.com/start",
          "Tumblr":"https://www.tumblr.com/register","Substack":"https://substack.com","LiveJournal":"https://www.livejournal.com/create",
          "Write.as":"https://write.as/new","Quora":"https://www.quora.com"}
FLAG = {"de":"🇩🇪","fr":"🇫🇷","it":"🇮🇹","es":"🇪🇸","nl":"🇳🇱","en":"🇬🇧"}
# Fresh, geo-matched, neutral personas — UNIQUE to Coolizi (never reuse a Jetterix/other-site account).
# No brand in any handle/subdomain. Email is a suggestion; any fresh inbox works.
NAMES = {
 1: {"name":"Lena Hoffmann","handle":"lenahoffmann91","blog":"medium.com/@lenahoffmann91","email":"lenahoffmann91@gmail.com"},
 2: {"name":"Markus Wagner","handle":"markuswagner85","blog":"markuswagner85.blogspot.com","email":"markuswagner85@gmail.com"},
 3: {"name":"Camille Laurent","handle":"camillelaurent","blog":"camillelaurent.wordpress.com","email":"camille.laurent.fr@gmail.com"},
 4: {"name":"Julien Moreau","handle":"julienmoreau","blog":"julienmoreau.tumblr.com","email":"julien.moreau.fr@gmail.com"},
 5: {"name":"Giulia Conti","handle":"giuliaconti","blog":"giuliaconti.substack.com","email":"giulia.conti.it@gmail.com"},
 6: {"name":"Sofía Ramírez","handle":"sofiaramirez26","blog":"sofiaramirez26.livejournal.com","email":"sofia.ramirez.es@gmail.com"},
 7: {"name":"Daan Visser","handle":"daanvisser","blog":"daanvisser.write.as","email":"daan.visser.nl@gmail.com"},
 8: {"name":"Emma Clarke","handle":"Emma-Clarke","blog":"quora.com/profile/Emma-Clarke","email":"emma.clarke.uk@gmail.com"},
}
def E(s): return html.escape(str(s), quote=True)
cards = []
for i, (t, a) in enumerate(zip(TASKS, ARTS), 1):
    if not a: continue
    ip = IPS.get(i, {}); nm = NAMES.get(i, {})
    n = t["n"]; plat = t["platform"]; geo = t["geo"]; url = t["url"]; su = SIGNUP.get(plat, "#")
    cards.append(f'''<div class="task">
  <div class="th"><h2>{n} · {E(plat)} <span class="fl">{FLAG.get(geo,'')} {geo.upper()}</span></h2>
    <a class="go" href="{E(su)}" target="_blank">sign up ↗</a></div>
  <div class="acctbox">
    <div class="al">👤 Create THIS account — fresh &amp; Coolizi-only <b>(never reuse a Jetterix / other-site login)</b></div>
    <div class="ipgrid">
      <span>name</span><code id="an{i}">{E(nm.get('name',''))}</code><button class="cp2" data-t="an{i}">copy</button>
      <span>username</span><code id="ah{i}">{E(nm.get('handle',''))}</code><button class="cp2" data-t="ah{i}">copy</button>
      <span>blog / url</span><code id="ab{i}">{E(nm.get('blog',''))}</code><button class="cp2" data-t="ab{i}">copy</button>
      <span>email</span><code id="ae{i}">{E(nm.get('email',''))}</code><button class="cp2" data-t="ae{i}">copy</button>
    </div>
  </div>
  <div class="ipbox">
    <div class="ipl">{FLAG.get(geo,'')} Use IP <b>{E(ip.get('ip','(rotates)'))}</b> &nbsp;·&nbsp; {E(ip.get('city',''))}, {E(t['cc'])} &nbsp;·&nbsp; {E(ip.get('org',''))}</div>
    <div class="ipgrid">
      <span>proxy</span><code id="ph{i}">connect.gonzoproxy.app</code><button class="cp2" data-t="ph{i}">copy</button>
      <span>port</span><code id="pp{i}">10000</code><button class="cp2" data-t="pp{i}">copy</button>
      <span>user</span><code id="pu{i}">{E(ip.get('user',''))}</code><button class="cp2" data-t="pu{i}">copy</button>
      <span>pass</span><code id="pw{i}">ZuBnaGgs</code><button class="cp2" data-t="pw{i}">copy</button>
    </div>
  </div>
  <ol class="steps">
    <li>Switch your proxy to the <b>IP above</b> (setup at top), then open <a href="{E(su)}" target="_blank">{E(su.replace('https://',''))}</a> and create a free account using the <b>name / username / email above</b> (set the blog address to the one shown — <b>no brand names</b>) → new post.</li>
    <li>Paste the <b>Title</b> and <b>Article</b> below into the post.</li>
    <li>Select the words <b>“{E(a['anchor'])}”</b>, click the link button, and paste this URL: <code>{E(url)}</code></li>
    <li>Publish, then send me the live post URL — I add it to the Backlinks tracker.</li>
  </ol>
  <div class="fld"><div class="fh"><label>Title</label><button class="cp" data-t="t{i}">Copy title</button></div><div class="v" id="t{i}">{E(a['title'])}</div></div>
  <div class="fld"><div class="fh"><label>Article</label><button class="cp" data-t="b{i}">Copy article</button></div><pre class="v body" id="b{i}">{E(a['body'])}</pre></div>
  <div class="link">🔗 Link the words <b>“{E(a['anchor'])}”</b> → <code>{E(url)}</code></div>
</div>''')
PAGE = f'''<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate"><title>Coolizi — Manual backlinks</title>
<style>
:root{{--bg:#080b12;--card:#121927;--card2:#172033;--line:#243046;--txt:#e6ecf6;--mut:#8595ad;--acc:#22d3a8;--acc2:#3b9dff;--good:#34d399;--coral:#ff7a4d;--warn:#ffb020}}
*{{box-sizing:border-box}}body{{margin:0;background:radial-gradient(1000px 480px at 84% -8%,rgba(34,211,168,.10),transparent),var(--bg);color:var(--txt);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}}
.wrap{{max-width:860px;margin:0 auto;padding:24px 18px 70px}}
a{{color:var(--acc2);text-decoration:none;font-weight:600}}
.topbar{{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap}}
.menu{{display:flex;gap:8px;flex-wrap:wrap}}
.menu a{{font-size:13px;font-weight:600;color:var(--mut);padding:8px 14px;border-radius:10px;border:1px solid var(--line);background:var(--card)}}
.menu a:hover{{color:var(--txt)}} .menu a.cur{{color:var(--acc);border-color:rgba(34,211,168,.4);background:rgba(34,211,168,.08)}}
h1{{font-size:24px;margin:6px 0 2px;letter-spacing:-.02em}}
.sub{{color:var(--mut);font-size:13px;margin:4px 0 18px}}
.setup{{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 18px;margin-bottom:18px}}
.setup h3{{font-size:14px;color:var(--coral);margin:0 0 8px}}
.setup ol{{margin:0;padding-left:18px;font-size:13px}}.setup li{{padding:2px 0;color:#d6dded}}.setup b{{color:#fff}}
.warn{{font-size:12px;color:var(--mut);margin-top:8px}}
.task{{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px 20px;margin-bottom:18px}}
.th{{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px}}
.th h2{{font-size:18px;margin:0;display:flex;align-items:center;gap:9px}}
.th .fl{{font-size:11px;font-weight:700;color:var(--mut);border:1px solid var(--line);padding:2px 8px;border-radius:6px}}
.go{{font-size:12.5px}}
.ipbox{{background:#0c1320;border:1px solid var(--line);border-left:4px solid var(--coral);border-radius:10px;padding:10px 13px;margin-bottom:12px}}
.ipl{{font-size:13px;color:#ffd9cf;margin-bottom:8px}}.ipl b{{color:#fff}}
.acctbox{{background:#0c1626;border:1px solid var(--line);border-left:4px solid var(--acc2);border-radius:10px;padding:10px 13px;margin-bottom:12px}}
.al{{font-size:13px;color:#cfe0ff;margin-bottom:8px}}.al b{{color:#fff}}
.ipgrid{{display:grid;grid-template-columns:auto 1fr auto;gap:5px 8px;align-items:center}}
.ipgrid span{{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--mut);font-weight:700}}
.ipgrid code{{background:#080b12;border:1px solid var(--line);padding:3px 8px;border-radius:6px;color:var(--acc2);font-size:11.5px;overflow:auto;white-space:nowrap}}
.cp2{{background:var(--line);color:var(--txt);border:0;border-radius:6px;padding:3px 9px;font-weight:700;font-size:10.5px;cursor:pointer}}.cp2.done{{background:var(--good);color:#04201f}}
.steps{{margin:0 0 14px;padding-left:20px;font-size:13.5px}}.steps li{{padding:3px 0;color:#d6dded}}.steps b{{color:#fff}}
.steps code,.link code{{background:#080b12;border:1px solid var(--line);padding:1px 6px;border-radius:5px;color:var(--acc2);font-size:12px;word-break:break-all}}
.fld{{margin:10px 0}}.fh{{display:flex;justify-content:space-between;align-items:center;margin-bottom:5px}}
label{{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);font-weight:700}}
.cp{{background:var(--acc);color:#04201f;border:0;border-radius:7px;padding:5px 12px;font-weight:800;font-size:11.5px;cursor:pointer}}.cp.done{{background:var(--good)}}
.v{{background:#080b12;border:1px solid var(--line);border-radius:9px;padding:11px 13px;font-size:13.5px;color:#e7ecf5}}
.body{{white-space:pre-wrap;line-height:1.6;max-height:240px;overflow:auto;margin:0;font-family:inherit}}
.link{{background:linear-gradient(90deg,rgba(34,211,168,.10),transparent);border:1px solid var(--line);border-left:4px solid var(--acc);border-radius:9px;padding:9px 13px;font-size:13px;margin-top:10px}}
.foot{{color:var(--mut);font-size:11.5px;text-align:center;margin-top:18px}}
</style></head><body><div class="wrap">
<div class="topbar"><a href="./">← Back to dashboard</a>
  <nav class="menu"><a href="./">📊 Dashboard</a><a href="offer-links.html">🔗 Change offer links</a><a href="backlinks.html">📰 Backlinks</a><a href="manual-backlinks.html" class="cur">📝 Manual backlinks</a></nav>
</div>
<h1>📝 Manual backlinks</h1>
<div class="sub">{len(cards)} high-authority platforms that block automated signup — post these by hand. Each card gives the exact <b>account to create</b> (fresh persona, never reused) + its own geo-matched residential IP + a written unique article. DE/FR-weighted.</div>
<div class="setup">
  <h3>⚙️ One-time setup — how to use the IPs</h3>
  <ol>
    <li>Install the free <b>Proxy SwitchyOmega</b> extension (Chrome / Edge).</li>
    <li>Add one profile per platform → Protocol <b>HTTP</b>, Server <b>connect.gonzoproxy.app</b>, Port <b>10000</b>, then that platform's <b>user</b> + <b>pass</b> (in each card).</li>
    <li>Switch to a platform's profile <b>before</b> signing up, and keep it on while you write &amp; publish.</li>
    <li>Use a separate browser profile (or Incognito) per platform so logins don't mix.</li>
  </ol>
  <div class="warn"><b style="color:var(--coral)">⚠ One account = one site.</b> Create the fresh persona shown in each card — <b>never log into a Jetterix (or any other site's) account to post Coolizi</b>, or you tie the two networks together. Residential IPs are live ~12 hours (tell me to refresh). Drip 1–2/day — don't publish all at once.</div>
</div>
{''.join(cards)}
<div class="foot">Confidential · internal · send each published URL back to add it to the Backlinks tracker · {datetime.date.today().isoformat()}</div>
<script>
function cpHandler(cls,label){{document.querySelectorAll(cls).forEach(function(b){{b.addEventListener("click",function(){{
  var el=document.getElementById(this.dataset.t),txt=el.innerText,self=this,orig=self.textContent;
  function done(){{self.textContent=label;self.classList.add("done");setTimeout(function(){{self.textContent=orig;self.classList.remove("done");}},1400);}}
  if(navigator.clipboard&&navigator.clipboard.writeText){{navigator.clipboard.writeText(txt).then(done).catch(function(){{fb(txt,done);}});}}else fb(txt,done);
}});}});}}
cpHandler(".cp","✓ Copied"); cpHandler(".cp2","✓");
function fb(txt,done){{var t=document.createElement("textarea");t.value=txt;t.style.position="fixed";t.style.opacity="0";document.body.appendChild(t);t.select();try{{document.execCommand("copy");done();}}catch(e){{}}document.body.removeChild(t);}}
</script>
</body></html>'''
open(os.path.join(HERE, "manual-backlinks.html"), "w", encoding="utf-8").write(PAGE)
print("manual-backlinks.html written:", len(cards), "platform tasks")

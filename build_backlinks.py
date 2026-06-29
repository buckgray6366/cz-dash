#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build backlinks.html from backlinks.json (screenshots in bl/). Re-run after adding links."""
import json, os, html, datetime
HERE = os.path.dirname(os.path.abspath(__file__))
arts = json.load(open(os.path.join(HERE, "backlinks.json")))
FLAG = {"de":"🇩🇪","fr":"🇫🇷","en":"🇬🇧","uk":"🇬🇧","it":"🇮🇹","es":"🇪🇸","nl":"🇳🇱","pt":"🇵🇹","el":"🇬🇷"}
def E(s): return html.escape(str(s), quote=True)
by = {}
for a in arts: by[a["lang"]] = by.get(a["lang"], 0) + 1
summ = " · ".join("%s %d" % (FLAG.get(k, k.upper()), v) for k, v in sorted(by.items()))
live = sum(1 for a in arts if a.get("verified"))
cards = []
for a in arts:
    tgt = a["target"].replace("https://trycoolizi.com", "") or "/"
    shot = a.get("shot", "")
    st = '<span class="ok">✓ live</span>' if a.get("verified") else '<span class="pend">pending</span>'
    px = ' · <span class="px">res-IP</span>' if a.get("proxied") else ''
    cards.append(f'''<div class="bl">
  <a class="thumb" href="{E(a['url'])}" target="_blank">{f'<img src="{E(shot)}" alt="" loading="lazy">' if shot else ''}</a>
  <div class="meta">
    <div class="t"><a href="{E(a['url'])}" target="_blank">{E(a['title'])}</a></div>
    <div class="r">{FLAG.get(a['lang'],a['lang'])} {E(a['lang'].upper())} · {E(a['platform'])} · {st}{px}</div>
    <div class="r">anchor: <b>“{E(a['anchor'])}”</b> → <code>{E(tgt)}</code></div>
    <div class="r by">by {E(a.get('author',''))}</div>
    <a class="open" href="{E(a['url'])}" target="_blank">open article ↗</a>
  </div>
</div>''')
PAGE = f'''<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate"><title>Coolizi — Backlinks</title>
<style>
:root{{--bg:#080b12;--card:#121927;--card2:#172033;--line:#243046;--txt:#e6ecf6;--mut:#8595ad;--acc:#22d3a8;--acc2:#3b9dff;--good:#34d399;--warn:#ffb020}}
*{{box-sizing:border-box}}body{{margin:0;background:radial-gradient(1000px 480px at 84% -8%,rgba(34,211,168,.10),transparent),var(--bg);color:var(--txt);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}}
.wrap{{max-width:980px;margin:0 auto;padding:24px 18px 70px}}
a{{color:var(--acc2);text-decoration:none}}
.topbar{{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px}}
.menu{{display:flex;gap:8px;flex-wrap:wrap}}
.menu a{{font-size:13px;font-weight:600;color:var(--mut);padding:8px 14px;border-radius:10px;border:1px solid var(--line);background:var(--card)}}
.menu a:hover{{color:var(--txt)}} .menu a.cur{{color:var(--acc);border-color:rgba(34,211,168,.4);background:rgba(34,211,168,.08)}}
h1{{font-size:23px;margin:6px 0 2px;letter-spacing:-.02em}}
.sub{{color:var(--mut);font-size:13px;margin:4px 0 20px}}
.grid{{display:grid;grid-template-columns:1fr 1fr;gap:16px}}
.bl{{background:var(--card);border:1px solid var(--line);border-radius:16px;overflow:hidden;display:flex;flex-direction:column}}
.bl .thumb{{display:block;height:170px;overflow:hidden;background:#fff;border-bottom:1px solid var(--line)}}
.bl .thumb img{{width:100%;display:block}}
.bl .meta{{padding:13px 15px}}
.bl .t{{font-weight:700;font-size:14.5px;line-height:1.3;margin-bottom:7px}}
.bl .t a{{color:var(--txt)}} .bl .t a:hover{{color:var(--acc)}}
.bl .r{{font-size:12px;color:var(--mut);margin:3px 0}} .bl .r.by{{font-style:italic}}
.bl .r b{{color:#dfeff0;font-weight:600}} .bl code{{background:#080b12;border:1px solid var(--line);padding:1px 6px;border-radius:5px;color:var(--acc2);font-size:11.5px}}
.ok{{color:var(--good);font-weight:700}} .pend{{color:var(--warn);font-weight:700}}
.px{{color:var(--acc);font-weight:700}}
.open{{display:inline-block;margin-top:8px;font-size:12.5px;font-weight:700}}
.foot{{color:var(--mut);font-size:11.5px;text-align:center;margin-top:22px}}
@media(max-width:720px){{.grid{{grid-template-columns:1fr}}}}
</style></head><body><div class="wrap">
<div class="topbar"><a href="./">← Back to dashboard</a>
  <nav class="menu"><a href="./">📊 Dashboard</a><a href="offer-links.html">🔗 Change offer links</a><a href="backlinks.html" class="cur">📰 Backlinks</a></nav>
</div>
<h1>📰 Backlinks</h1>
<div class="sub"><b>{live} live</b> · {summ} · native articles on Telegraph, each posted from a residential IP in-geo &amp; links once deep with a native anchor · click a card to open the live article</div>
<div class="grid">
{''.join(cards)}
</div>
<div class="foot">Updated {datetime.date.today().isoformat()} · screenshots are live captures · confidential / internal</div>
</div></body></html>'''
open(os.path.join(HERE, "backlinks.html"), "w", encoding="utf-8").write(PAGE)
print("backlinks.html written:", len(arts), "articles,", live, "verified live")

#!/root/.config/gsc/venv/bin/python
# -*- coding: utf-8 -*-
"""Coolizi SEO command-center data pull. Reads GSC (Search Analytics fresh+hourly + URL Inspection),
computes derived insight, writes data.json + appends history.json. Run daily via cron."""
import json, datetime, os, time
from google.oauth2 import service_account
import google.auth.transport.requests as gr
import requests

HERE = os.path.dirname(os.path.abspath(__file__))
KEY = "/root/.config/gsc/sa.json"
PROP = "sc-domain:trycoolizi.com"
PROP_ENC = "sc-domain%3Atrycoolizi.com"
SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly"]
SA_URL = f"https://www.googleapis.com/webmasters/v3/sites/{PROP_ENC}/searchAnalytics/query"
INSPECT_URL = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect"

GEOS = ["en", "de", "fr", "it", "es", "nl", "pt", "el"]
URLS = ["https://trycoolizi.com/"] + [f"https://trycoolizi.com/{g}/" for g in GEOS]
# ISO-3166 alpha-3 (lowercase, as GSC returns) -> display
CC = {
 "gbr": ("UK", "🇬🇧", "en"), "deu": ("Germany", "🇩🇪", "de"), "aut": ("Austria", "🇦🇹", "de"),
 "che": ("Switzerland", "🇨🇭", "de"), "fra": ("France", "🇫🇷", "fr"), "bel": ("Belgium", "🇧🇪", "fr"),
 "ita": ("Italy", "🇮🇹", "it"), "esp": ("Spain", "🇪🇸", "es"), "nld": ("Netherlands", "🇳🇱", "nl"),
 "prt": ("Portugal", "🇵🇹", "pt"), "grc": ("Greece", "🇬🇷", "el"), "usa": ("USA", "🇺🇸", "en"),
 "can": ("Canada", "🇨🇦", "en"), "ind": ("India", "🇮🇳", "en"), "irl": ("Ireland", "🇮🇪", "en"),
}

def auth():
    info = os.environ.get("GSC_SA_JSON")  # CI: key from encrypted secret; local: key file
    if info:
        c = service_account.Credentials.from_service_account_info(json.loads(info), scopes=SCOPES)
    else:
        c = service_account.Credentials.from_service_account_file(KEY, scopes=SCOPES)
    c.refresh(gr.Request())
    return c.token

def sa_query(token, dims, state="all", rl=2000, days=7, extra=None, end=None):
    end = end or datetime.date.today()
    start = end - datetime.timedelta(days=days)
    body = {"startDate": str(start), "endDate": str(end), "dimensions": dims,
            "rowLimit": rl, "dataState": state}
    if extra: body.update(extra)
    for attempt in range(3):
        try:
            r = requests.post(SA_URL, headers={"Authorization": "Bearer " + token,
                              "Content-Type": "application/json"}, json=body, timeout=30)
            if r.status_code == 200:
                return r.json().get("rows", [])
            if r.status_code in (429, 500, 503):
                time.sleep(2 + attempt * 2); continue
            return []
        except Exception:
            time.sleep(2)
    return []

def rowfmt(r):
    return {"keys": r.get("keys"), "impressions": int(r.get("impressions", 0)),
            "clicks": int(r.get("clicks", 0)), "ctr": round(r.get("ctr", 0) * 100, 2),
            "position": round(r.get("position", 0), 1)}

def inspect(token, url):
    for attempt in range(3):
        try:
            r = requests.post(INSPECT_URL, headers={"Authorization": "Bearer " + token,
                              "Content-Type": "application/json"},
                              json={"inspectionUrl": url, "siteUrl": PROP, "languageCode": "en"}, timeout=30)
            if r.status_code == 200:
                idx = r.json().get("inspectionResult", {}).get("indexStatusResult", {})
                return {"url": url, "verdict": idx.get("verdict", "?"),
                        "coverage": idx.get("coverageState", "Unknown"),
                        "robots": idx.get("robotsTxtState", "?"),
                        "fetch": idx.get("pageFetchState", "?"),
                        "indexing": idx.get("indexingState", "?"),
                        "lastCrawl": idx.get("lastCrawlTime", None),
                        "googleCanonical": idx.get("googleCanonical", ""),
                        "sitemaps": idx.get("sitemap", [])}
            if r.status_code in (429, 503):
                time.sleep(3 + attempt * 3); continue
            return {"url": url, "verdict": "ERR", "coverage": f"HTTP {r.status_code}", "robots": "", "fetch": "", "indexing": "", "lastCrawl": None}
        except Exception:
            time.sleep(2)
    return {"url": url, "verdict": "ERR", "coverage": "timeout", "robots": "", "fetch": "", "indexing": "", "lastCrawl": None}

def wavg_pos(rows):
    imp = sum(r["impressions"] for r in rows)
    if not imp: return 0
    return round(sum(r["position"] * r["impressions"] for r in rows) / imp, 1)

def main():
    token = auth()
    today = datetime.date.today()

    daily = [rowfmt(r) for r in sa_query(token, ["date"], days=28)]
    daily = [{"date": d["keys"][0], **{k: d[k] for k in ("impressions", "clicks", "ctr", "position")}} for d in daily]
    hourly = []
    for r in sa_query(token, ["HOUR"], state="HOURLY_ALL", days=1, end=today):
        hourly.append({"hour": r.get("keys", [""])[0], "impressions": int(r.get("impressions", 0)), "clicks": int(r.get("clicks", 0))})

    by_country = [rowfmt(r) for r in sa_query(token, ["country"], days=7)]
    by_device = [rowfmt(r) for r in sa_query(token, ["device"], days=7)]
    by_query = [rowfmt(r) for r in sa_query(token, ["query"], days=7)]
    by_page = [rowfmt(r) for r in sa_query(token, ["page"], days=7)]
    by_qp = [rowfmt(r) for r in sa_query(token, ["query", "page"], days=7)]

    # authoritative totals via no-dimension query (matches GSC exactly), per range
    def totals(days):
        rows = sa_query(token, [], days=days)
        if not rows: return {"impressions": 0, "clicks": 0, "ctr": 0, "position": 0}
        r = rows[0]
        return {"impressions": int(r.get("impressions", 0)), "clicks": int(r.get("clicks", 0)),
                "ctr": round(r.get("ctr", 0) * 100, 2), "position": round(r.get("position", 0), 1)}
    summaries = {str(dd): totals(dd) for dd in (1, 7, 28, 90)}
    base = summaries["7"]
    timp, tclk = base["impressions"], base["clicks"]
    summary = {**base, "queries": len(by_query), "pages_seen": len([p for p in by_page if p["impressions"] > 0])}

    # geo board (join country -> our page)
    geo = []
    for r in by_country:
        cc = r["keys"][0]
        name, flag, gp = CC.get(cc, (cc.upper(), "🏳️", ""))
        geo.append({"cc": cc, "name": name, "flag": flag, "geo": gp,
                    "impressions": r["impressions"], "clicks": r["clicks"], "ctr": r["ctr"], "position": r["position"]})
    geo.sort(key=lambda x: -x["impressions"])

    # brand terms (contain 'coolizi')
    brand = [{"q": r["keys"][0], **{k: r[k] for k in ("impressions", "clicks", "ctr", "position")}}
             for r in by_query if "coolizi" in r["keys"][0].lower()]
    brand.sort(key=lambda x: -x["impressions"])

    # striking-distance opportunities: pos 4-20, impressions>=3, ranked by potential
    opp = []
    for r in by_query:
        p = r["position"]
        if 3.5 <= p <= 20.5 and r["impressions"] >= 3:
            potential = round(r["impressions"] * (max(0, (20 - p)) / 20), 1)
            opp_hint = "Improve title/meta CTR" if p <= 10 else "Push onto page 1"
            opp_row = {"q": r["keys"][0], "impressions": r["impressions"], "clicks": r["clicks"],
                       "position": p, "ctr": r["ctr"], "potential": potential, "hint": opp_hint}
            opp.append(opp_row)
    opp.sort(key=lambda x: -x["potential"])

    # cannibalization: queries served by >1 of our pages
    qmap = {}
    for r in by_qp:
        q, pg = r["keys"][0], r["keys"][1]
        qmap.setdefault(q, []).append({"page": pg, "impressions": r["impressions"], "position": r["position"]})
    cannibal = [{"q": q, "pages": sorted(v, key=lambda x: -x["impressions"])} for q, v in qmap.items() if len(v) > 1]
    cannibal.sort(key=lambda x: -sum(p["impressions"] for p in x["pages"]))

    # indexation board
    index = [inspect(token, u) for u in URLS]
    funnel = {"indexed": 0, "crawled_not_indexed": 0, "discovered": 0, "other": 0}
    for i in index:
        c = (i["coverage"] or "").lower()
        if "indexed" in c and "not" not in c and "discover" not in c and "crawled" not in c:
            funnel["indexed"] += 1
        elif "crawled" in c:
            funnel["crawled_not_indexed"] += 1
        elif "discover" in c:
            funnel["discovered"] += 1
        else:
            funnel["other"] += 1

    # milestones
    best_pos = min([r["position"] for r in by_query if r["position"] > 0] or [99])
    milestones = {
        "first_impression": timp > 0,
        "first_click": tclk > 0,
        "top10": best_pos <= 10,
        "top3": best_pos <= 3,
        "number1": best_pos <= 1.5,
        "best_position": best_pos,
        "indexed_pages": funnel["indexed"],
    }

    data = {
        "generatedAt": datetime.datetime.now().strftime("%Y-%m-%d %H:%M UTC"),
        "property": PROP, "summary": summary, "summaries": summaries, "daily": daily, "hourly": hourly,
        "geo": geo, "device": by_device, "topQueries": by_query[:40], "topPages": by_page,
        "brand": brand, "opportunities": opp[:25], "cannibal": cannibal[:12],
        "indexation": index, "funnel": funnel, "milestones": milestones,
    }
    with open(os.path.join(HERE, "data.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)

    # history snapshot (one per day)
    hp = os.path.join(HERE, "history.json")
    hist = []
    if os.path.exists(hp):
        try: hist = json.load(open(hp, encoding="utf-8"))
        except Exception: hist = []
    hist = [h for h in hist if h.get("date") != str(today)]
    hist.append({"date": str(today), "impressions": timp, "clicks": tclk,
                 "position": summary["position"], "indexed": funnel["indexed"], "best_position": best_pos})
    hist.sort(key=lambda x: x["date"])
    json.dump(hist, open(hp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    print(f"OK impr={timp} clicks={tclk} pos={summary['position']} queries={len(by_query)} "
          f"indexed={funnel['indexed']}/{len(URLS)} hourly={len(hourly)} brand={len(brand)} opp={len(opp)}")

if __name__ == "__main__":
    main()

import httpx, re, json
h={"User-Agent":"Mozilla/5.0 Chrome/124"}
url="https://www.moneycontrol.com/stocks/marketstats/fii_dii_activity/index.php"
r=httpx.get(url,headers=h,follow_redirects=True,timeout=15)
t=r.text
m=re.search(r"<script id=\"__NEXT_DATA__\"[^>]*>(.*?)</script>",t,re.S)
print("NEXT_DATA found",bool(m))
if m:
    j=json.loads(m.group(1))
    def walk(o,p="",d=0):
        if d>5: return
        if isinstance(o,dict):
            for k,v in o.items():
                np=p+"/"+k
                if any(s in k.lower() for s in ["fii","dii","provis","summary","cash","today"]):
                    s=str(v)[:300]
                    print(np, type(v).__name__, s)
                walk(v,np,d+1)
        elif isinstance(o,list) and o:
            for i,it in enumerate(o[:2]):
                walk(it,p+f"[{i}]",d+1)
    walk(j)

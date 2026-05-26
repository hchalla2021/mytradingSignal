import httpx, re
h={"User-Agent":"Mozilla/5.0 Chrome/124"}
url="https://www.moneycontrol.com/stocks/marketstats/fii_dii_activity/index.php"
r=httpx.get(url,headers=h,follow_redirects=True,timeout=15)
t=r.text
# find script src URLs
scripts=re.findall(r"<script[^>]*src=\"([^\"]+)\"",t)
for s in scripts[:40]: print(s)
print("---")
# search for api/fii references
for m in re.finditer(r"https?://[^\s\"'<>]+(?:fii|dii|provis|summary)[^\s\"'<>]*",t,re.I):
    print(m.group())

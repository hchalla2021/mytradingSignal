import httpx, re
h={"User-Agent":"Mozilla/5.0 Chrome/124"}
# probe a few likely chunk bundles
chunks=["20216.2a3f8f42989a62ff.js","25675-d41febca00460168.js","30371.caf6105c3f435c69.js","8829.2f6f9a6fc86a7152.js","8637.c0081f4922911ed3.js","53701.748c474a68a7b88d.js","25719-1797931e3bec2648.js","66487.30764b8fc7c5d5f1.js","52922.9666a3873bf0afff.js","75901.abc91230f7944006.js","12212.399951c2ff4a054c.js","83225-d6f2c66a84819c5a.js","40853-3f8dac80468b41b3.js","85935-aedb5214e9e33561.js","6911-3546369bb222d5a8.js","75602-e9f0cc3921b56a39.js"]
for c in chunks:
    u="https://www.moneycontrol.com/mc-react/_next/static/chunks/"+c
    r=httpx.get(u,headers=h,timeout=15)
    t=r.text
    hits=set(re.findall(r"[\"'`][^\"'`<>\s]{4,120}(?:fii|dii|provis|summary|tab/summary|fnoCashData|getFii)[^\"'`<>\s]{0,160}[\"'`]",t,re.I))
    if hits:
        print("==",c,r.status_code,len(t))
        for h2 in list(hits)[:30]: print(" ",h2)

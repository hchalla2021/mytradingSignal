import httpx, re
h={"User-Agent":"Mozilla/5.0 Chrome/124"}
# fetch FiiDii page bundle
u="https://www.moneycontrol.com/mc-react/_next/static/chunks/pages/FiiDii-7a44f0db51fefda5.js"
r=httpx.get(u,headers=h,timeout=15)
print(r.status_code,len(r.text))
t=r.text
# search api endpoints
for m in set(re.findall(r"[\"'`]/[a-zA-Z0-9_\-/]*(?:fii|dii|summary|cash|provis|activity)[a-zA-Z0-9_\-/?=]*[\"'`]",t,re.I)):
    print(m)
print("---abs urls---")
for m in set(re.findall(r"https?://[a-zA-Z0-9_./\-]+(?:fii|dii|summary|cash|provis|activity)[a-zA-Z0-9_./?=\-]*",t,re.I)):
    print(m)

import httpx
h={"User-Agent":"Mozilla/5.0 Chrome/124","Referer":"https://www.moneycontrol.com/stocks/marketstats/fii_dii_activity/index.php","Accept":"application/json,*/*"}
urls=[
 "https://api.moneycontrol.com/mcapi/v1/fno/fii-dii-activity?deviceType=W&subSection=summary",
 "https://api.moneycontrol.com/mcapi/v1/fno/fii-dii-activity?deviceType=W",
 "https://api.moneycontrol.com/mcapi/v1/fii-dii/get-summary",
 "https://api.moneycontrol.com/mcapi/v1/fii-dii/summary",
 "https://priceapi.moneycontrol.com/pricefeed/notapplicable/fii_dii/today",
 "https://www.moneycontrol.com/mcapi/v1/fno/fii-dii-activity?deviceType=W&subSection=summary",
]
for u in urls:
    try:
        r=httpx.get(u,headers=h,timeout=10,follow_redirects=True)
        print(r.status_code,len(r.text),u)
        if r.status_code==200: print(r.text[:400]); print("---")
    except Exception as e:
        print("ERR",u,e)

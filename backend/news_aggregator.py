import requests
from apscheduler.schedulers.background import BackgroundScheduler
from datetime import datetime
import tensorflow as tf
import numpy as np

# List of news APIs to integrate
NEWS_APIS = {
    "moneycontrol": "https://api.moneycontrol.com/news",
    "economic_times": "https://api.economictimes.indiatimes.com/markets",
    "reuters": "https://api.reuters.com/news",
    "cnbc_tv18": "https://api.cnbctv18.com/news",
    "nse_india": "https://www.nseindia.com/api/news",
    "bse_india": "https://www.bseindia.com/api/news",
    "investing_com": "https://api.investing.com/news",
    "tradingview": "https://www.tradingview.com/api/news",
    "bloomberg": "https://www.bloomberg.com/api/news",
    "mint": "https://www.livemint.com/api/news",
    "tickertape": "https://api.tickertape.in/news",
    "trendlyne": "https://api.trendlyne.com/news",
    "screener": "https://api.screener.in/news",
    "marketwatch": "https://api.marketwatch.com/news",
    "forex_factory": "https://www.forexfactory.com/api/news",
    "trading_economics": "https://api.tradingeconomics.com/news",
    "yahoo_finance": "https://finance.yahoo.com/api/news",
    "sebi": "https://www.sebi.gov.in/api/news",
    "rbi": "https://www.rbi.org.in/api/news",
    "pib_india": "https://pib.gov.in/api/news",
    "fii_dii": "https://www.nseindia.com/api/fii-dii",
    "sgx_nifty": "https://www.sgx.com/api/nifty-news",
    "openinsider": "https://openinsider.com/api/news",
}

# Function to fetch news from a specific API
def fetch_news(api_name, api_url):
    try:
        response = requests.get(api_url)
        response.raise_for_status()
        news_data = response.json()
        print(f"[{datetime.now()}] Fetched news from {api_name}")
        return news_data
    except Exception as e:
        print(f"Error fetching news from {api_name}: {e}")
        return None

# Load pre-trained TensorFlow model for news impact analysis
news_model = tf.keras.models.load_model("models/news_impact_analyzer.h5")

def categorize_news(news_item):
    """Categorize news into high, medium, or low impact."""
    try:
        # Preprocess news data (example: convert to numerical features)
        input_data = np.array([news_item['features']])  # Replace 'features' with actual preprocessing logic
        
        # Predict impact
        prediction = news_model.predict(input_data)
        
        # Categorize based on prediction
        if prediction[0][0] > 0.8:
            return "high-impact"
        elif prediction[0][0] > 0.5:
            return "medium-impact"
        else:
            return "low-impact"
    except Exception as e:
        print(f"Error categorizing news: {e}")
        return "low-impact"

def filter_and_categorize_news(all_news):
    """Filter and categorize news items."""
    categorized_news = []
    for news_item in all_news:
        category = categorize_news(news_item)
        if category in ["high-impact", "medium-impact"]:
            news_item['category'] = category
            categorized_news.append(news_item)
    return categorized_news

# Function to aggregate news from all APIs
def aggregate_news():
    all_news = {}
    for api_name, api_url in NEWS_APIS.items():
        news = fetch_news(api_name, api_url)
        if news:
            all_news[api_name] = filter_and_categorize_news(news)
    print(f"[{datetime.now()}] Aggregated and categorized news from all sources")
    return all_news

# Scheduler to fetch news periodically
scheduler = BackgroundScheduler()
scheduler.add_job(aggregate_news, 'interval', minutes=30)
scheduler.start()

if __name__ == "__main__":
    print("Starting news aggregator...")
    aggregate_news()
    try:
        while True:
            pass
    except (KeyboardInterrupt, SystemExit):
        scheduler.shutdown()
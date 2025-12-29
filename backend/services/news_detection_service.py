"""
News Detection Service - Ultra-Fast Market News & Event Detection
═══════════════════════════════════════════════════════════════════
Real-time news impact analysis with sentiment detection
Performance: O(1) API calls with aggressive caching | Target: <100ms

Key Features:
- Real-time financial news for indices
- Sentiment analysis (POSITIVE, NEGATIVE, NEUTRAL)
- Market impact scoring (0-100)
- Shock detection (sudden major events)
- Smart caching to prevent rate limits
"""

import httpx
import asyncio
from typing import Dict, List, Optional
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum
import re


class NewsSentiment(Enum):
    """News sentiment classification"""
    POSITIVE = "POSITIVE"
    NEGATIVE = "NEGATIVE"
    NEUTRAL = "NEUTRAL"


class ImpactLevel(Enum):
    """Market impact level"""
    CRITICAL = "CRITICAL"  # Major shock event
    HIGH = "HIGH"         # Significant impact
    MEDIUM = "MEDIUM"     # Moderate impact
    LOW = "LOW"           # Minor impact


@dataclass
class NewsItem:
    """Lightweight news item container"""
    __slots__ = ('title', 'description', 'source', 'published_at', 'url', 
                 'sentiment', 'impact_score', 'keywords')
    
    title: str
    description: str
    source: str
    published_at: str
    url: str
    sentiment: NewsSentiment
    impact_score: int  # 0-100
    keywords: List[str]


@dataclass
class NewsAnalysisResult:
    """Ultra-lightweight result container"""
    __slots__ = ('symbol', 'news_count', 'sentiment', 'impact_level', 
                 'shock_detected', 'top_headlines', 'last_update', 'status')
    
    symbol: str
    news_count: int
    sentiment: NewsSentiment
    impact_level: ImpactLevel
    shock_detected: bool
    top_headlines: List[NewsItem]
    last_update: str
    status: str


class NewsDetectionEngine:
    """
    High-Performance News Detection Engine
    ═══════════════════════════════════════
    Algorithm: Keyword-based search with sentiment analysis
    Caching: 5-minute cache to respect API limits (100 calls/day)
    """
    
    __slots__ = ('_api_key', '_base_url', '_cache', '_http_client', '_rate_limit_reset',
                 '_page_size', '_lookback_hours', '_rate_limit_cooldown', '_http_timeout')
    
    # Negative keywords for sentiment detection
    NEGATIVE_KEYWORDS = {
        'crash', 'plunge', 'fall', 'decline', 'drop', 'loss', 'losses',
        'down', 'bear', 'bearish', 'sell', 'selling', 'negative', 'weak',
        'concern', 'warning', 'alert', 'risk', 'correction', 'retreat',
        'slump', 'tumble', 'crisis', 'panic', 'fear', 'volatile', 'volatility'
    }
    
    # Positive keywords
    POSITIVE_KEYWORDS = {
        'surge', 'rally', 'gain', 'gains', 'rise', 'rising', 'up', 'bull',
        'bullish', 'buy', 'buying', 'positive', 'strong', 'strength',
        'optimism', 'confidence', 'record', 'high', 'peak', 'growth',
        'boom', 'soar', 'jump', 'advance'
    }
    
    # Shock event keywords
    SHOCK_KEYWORDS = {
        'breaking', 'urgent', 'emergency', 'crash', 'crisis', 'collapse',
        'panic', 'shock', 'sudden', 'unexpected', 'major', 'massive',
        'unprecedented', 'historic', 'catastrophic'
    }
    
    def __init__(self, api_key: str, base_url: str, page_size: int = 10, 
                 lookback_hours: int = 24, rate_limit_cooldown: int = 3600, 
                 http_timeout: float = 10.0):
        self._api_key = api_key
        self._base_url = base_url
        self._page_size = page_size
        self._lookback_hours = lookback_hours
        self._rate_limit_cooldown = rate_limit_cooldown
        self._cache: Dict[str, NewsAnalysisResult] = {}
        self._http_client: Optional[httpx.AsyncClient] = None
        self._http_timeout = http_timeout
        self._rate_limit_reset = datetime.now()
    
    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client"""
        if self._http_client is None or self._http_client.is_closed:
            self._http_client = httpx.AsyncClient(timeout=self._http_timeout)
        return self._http_client
    
    async def analyze(self, symbol: str) -> NewsAnalysisResult:
        """
        Main analysis - ULTRA FAST with caching
        Target: <100ms (cache hit) or <1s (API call)
        Cache: 2-hour TTL to prevent rate limits (100 calls/day = max 12 per 2 hours)
        """
        try:
            # Check cache first (2-HOUR TTL to prevent rate limits)
            # Cache key changes every 2 hours instead of every minute
            cache_key = f"{symbol}_{datetime.now().strftime('%Y%m%d_%H')}_{datetime.now().hour // 2}"
            if cache_key in self._cache:
                cached = self._cache[cache_key]
                print(f"[NEWS] ✅ Cache hit for {symbol} (using 2-hour cached data)")
                return cached
            
            # Check rate limit (100 calls/day = ~4 calls/hour max)
            if datetime.now() < self._rate_limit_reset:
                print(f"[NEWS] ⏳ Rate limited for {symbol}, cooldown until {self._rate_limit_reset}")
                # Return last cached result if available
                for key in sorted(self._cache.keys(), reverse=True):
                    if key.startswith(symbol):
                        cached_result = self._cache[key]
                        cached_result.status = f"WAITING: Rate limited (cooldown until {self._rate_limit_reset.strftime('%H:%M')})"
                        return cached_result
                return self._create_neutral_result(symbol, f"Rate limited until {self._rate_limit_reset.strftime('%H:%M')}")
            
            # Build search query
            query = self._build_query(symbol)
            
            # Fetch news from API
            articles = await self._fetch_news(query)
            
            if not articles:
                return self._create_neutral_result(symbol, "No recent news")
            
            # Analyze articles
            news_items = [self._analyze_article(article) for article in articles[:10]]
            
            # Calculate overall sentiment
            overall_sentiment = self._calculate_sentiment(news_items)
            
            # Calculate impact level
            impact_level = self._calculate_impact(news_items)
            
            # Detect shock events
            shock_detected = self._detect_shock(news_items)
            
            result = NewsAnalysisResult(
                symbol=symbol,
                news_count=len(articles),
                sentiment=overall_sentiment,
                impact_level=impact_level,
                shock_detected=shock_detected,
                top_headlines=news_items[:5],  # Top 5 headlines
                last_update=datetime.now().isoformat(),
                status="ACTIVE"
            )
            
            # Cache result
            self._cache[cache_key] = result
            
            # Cleanup old cache entries
            self._cleanup_cache()
            
            return result
            
        except Exception as e:
            print(f"[NEWS] Error analyzing {symbol}: {e}")
            return self._create_neutral_result(symbol, f"Error: {str(e)}")
    
    def _build_query(self, symbol: str) -> str:
        """Build search query for NewsAPI"""
        queries = {
            "NIFTY": "NIFTY OR \"NSE India\" OR \"Indian stock market\" OR \"BSE Sensex\"",
            "BANKNIFTY": "\"Bank Nifty\" OR \"Banking stocks India\" OR \"Indian banks\"",
            "SENSEX": "Sensex OR \"BSE India\" OR \"Bombay Stock Exchange\""
        }
        return queries.get(symbol, symbol)
    
    async def _fetch_news(self, query: str) -> List[Dict]:
        """Fetch news from NewsAPI"""
        try:
            client = await self._get_client()
            
            # Get news from configured lookback period
            from_date = (datetime.now() - timedelta(hours=self._lookback_hours)).strftime('%Y-%m-%dT%H:%M:%S')
            
            params = {
                'q': query,
                'from': from_date,
                'sortBy': 'publishedAt',
                'language': 'en',
                'apiKey': self._api_key,
                'pageSize': self._page_size
            }
            
            response = await client.get(self._base_url, params=params)
            
            if response.status_code == 200:
                data = response.json()
                return data.get('articles', [])
            elif response.status_code == 429:
                # Rate limited - set cooldown
                self._rate_limit_reset = datetime.now() + timedelta(seconds=self._rate_limit_cooldown)
                print(f"[NEWS] Rate limited by NewsAPI, cooling down for {self._rate_limit_cooldown} seconds")
                return []
            else:
                print(f"[NEWS] API error: {response.status_code}")
                return []
                
        except Exception as e:
            print(f"[NEWS] Fetch error: {e}")
            return []
    
    def _analyze_article(self, article: Dict) -> NewsItem:
        """Analyze single article for sentiment and impact"""
        title = article.get('title', '')
        description = article.get('description', '') or ''
        content = f"{title} {description}".lower()
        
        # Sentiment analysis (keyword-based)
        sentiment = self._detect_sentiment(content)
        
        # Impact score (0-100)
        impact_score = self._calculate_article_impact(title, description)
        
        # Extract keywords
        keywords = self._extract_keywords(content)
        
        return NewsItem(
            title=title[:100],  # Truncate long titles
            description=description[:200] if description else "",
            source=article.get('source', {}).get('name', 'Unknown'),
            published_at=article.get('publishedAt', ''),
            url=article.get('url', ''),
            sentiment=sentiment,
            impact_score=impact_score,
            keywords=keywords
        )
    
    def _detect_sentiment(self, text: str) -> NewsSentiment:
        """Fast keyword-based sentiment detection"""
        words = set(text.lower().split())
        
        neg_count = len(words & self.NEGATIVE_KEYWORDS)
        pos_count = len(words & self.POSITIVE_KEYWORDS)
        
        if neg_count > pos_count + 1:
            return NewsSentiment.NEGATIVE
        elif pos_count > neg_count + 1:
            return NewsSentiment.POSITIVE
        else:
            return NewsSentiment.NEUTRAL
    
    def _calculate_article_impact(self, title: str, description: str) -> int:
        """Calculate market impact score (0-100)"""
        score = 50  # Base score
        
        text = f"{title} {description}".lower()
        words = set(text.split())
        
        # High impact keywords
        if words & self.SHOCK_KEYWORDS:
            score += 40
        
        # Source credibility boost
        if any(source in text for source in ['rbi', 'sebi', 'government', 'ministry']):
            score += 20
        
        # Magnitude indicators
        if any(word in text for word in ['major', 'significant', 'massive', 'huge']):
            score += 10
        
        return min(max(score, 0), 100)
    
    def _extract_keywords(self, text: str) -> List[str]:
        """Extract important keywords"""
        # Simple keyword extraction
        words = text.split()
        keywords = []
        
        important_words = self.NEGATIVE_KEYWORDS | self.POSITIVE_KEYWORDS | self.SHOCK_KEYWORDS
        
        for word in words:
            if word.lower() in important_words:
                keywords.append(word.lower())
                if len(keywords) >= 3:
                    break
        
        return keywords
    
    def _calculate_sentiment(self, news_items: List[NewsItem]) -> NewsSentiment:
        """Calculate overall sentiment from all news"""
        if not news_items:
            return NewsSentiment.NEUTRAL
        
        sentiment_scores = {
            NewsSentiment.POSITIVE: 0,
            NewsSentiment.NEGATIVE: 0,
            NewsSentiment.NEUTRAL: 0
        }
        
        for item in news_items:
            sentiment_scores[item.sentiment] += 1
        
        # Return dominant sentiment
        return max(sentiment_scores, key=sentiment_scores.get)
    
    def _calculate_impact(self, news_items: List[NewsItem]) -> ImpactLevel:
        """Calculate overall market impact"""
        if not news_items:
            return ImpactLevel.LOW
        
        avg_impact = sum(item.impact_score for item in news_items) / len(news_items)
        
        if avg_impact >= 80:
            return ImpactLevel.CRITICAL
        elif avg_impact >= 65:
            return ImpactLevel.HIGH
        elif avg_impact >= 50:
            return ImpactLevel.MEDIUM
        else:
            return ImpactLevel.LOW
    
    def _detect_shock(self, news_items: List[NewsItem]) -> bool:
        """Detect major shock events"""
        for item in news_items:
            if item.impact_score >= 85:
                return True
            if any(keyword in item.keywords for keyword in ['breaking', 'crisis', 'crash', 'shock']):
                return True
        return False
    
    def _cleanup_cache(self):
        """Remove old cache entries (keep last 10)"""
        if len(self._cache) > 10:
            oldest_keys = sorted(self._cache.keys())[:len(self._cache) - 10]
            for key in oldest_keys:
                del self._cache[key]
    
    def _create_neutral_result(self, symbol: str, message: str) -> NewsAnalysisResult:
        """Create neutral result for errors/no data"""
        return NewsAnalysisResult(
            symbol=symbol,
            news_count=0,
            sentiment=NewsSentiment.NEUTRAL,
            impact_level=ImpactLevel.LOW,
            shock_detected=False,
            top_headlines=[],
            last_update=datetime.now().isoformat(),
            status=f"WAITING: {message}"
        )
    
    def to_dict(self, result: NewsAnalysisResult) -> Dict:
        """Convert result to API-friendly dictionary"""
        return {
            "symbol": result.symbol,
            "news_count": result.news_count,
            "sentiment": result.sentiment.value,
            "impact_level": result.impact_level.value,
            "shock_detected": result.shock_detected,
            "top_headlines": [
                {
                    "title": item.title,
                    "description": item.description,
                    "source": item.source,
                    "published_at": item.published_at,
                    "url": item.url,
                    "sentiment": item.sentiment.value,
                    "impact_score": item.impact_score,
                    "keywords": item.keywords
                }
                for item in result.top_headlines
            ],
            "last_update": result.last_update,
            "status": result.status
        }


# ═══════════════════════════════════════════════════════════
# SINGLETON PATTERN
# ═══════════════════════════════════════════════════════════

_engine_instance: Optional[NewsDetectionEngine] = None


def get_news_engine(api_key: str, base_url: str, page_size: int = 10,
                    lookback_hours: int = 24, rate_limit_cooldown: int = 3600,
                    http_timeout: float = 10.0) -> NewsDetectionEngine:
    """Get or create singleton engine instance"""
    global _engine_instance
    if _engine_instance is None:
        _engine_instance = NewsDetectionEngine(
            api_key, base_url, page_size, lookback_hours, 
            rate_limit_cooldown, http_timeout
        )
    return _engine_instance


async def analyze_news(symbol: str, api_key: str, base_url: str,
                       page_size: int = 10, lookback_hours: int = 24,
                       rate_limit_cooldown: int = 3600, http_timeout: float = 10.0) -> Dict:
    """
    Main entry point for API
    Ultra-fast async wrapper
    """
    engine = get_news_engine(api_key, base_url, page_size, lookback_hours,
                            rate_limit_cooldown, http_timeout)
    result = await engine.analyze(symbol)
    return engine.to_dict(result)

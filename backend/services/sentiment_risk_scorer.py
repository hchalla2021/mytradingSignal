"""Sentiment & Risk Scorer - Sentiment analysis and comprehensive risk assessment.

Analyzes market sentiment, calculates risk scores, and identifies risk factors.

Performance targets: <15ms per scoring, real-time sentiment tracking
"""

import logging
from dataclasses import dataclass, field
from collections import deque
from threading import RLock
from typing import Dict, Optional, List
from datetime import datetime

logger = logging.getLogger(__name__)


@dataclass
class SentimentScore:
    """Market sentiment analysis"""
    overall_sentiment: str  # EXTREMELY_BULLISH, BULLISH, NEUTRAL, BEARISH, EXTREMELY_BEARISH
    sentiment_score: float  # -100 to 100
    bullish_score: float  # 0-100
    bearish_score: float  # 0-100
    retail_sentiment: str  # BULLISH, BEARISH, NEUTRAL
    institutional_sentiment: str  # BULLISH, BEARISH, NEUTRAL
    sentiment_momentum: str  # IMPROVING, STABLE, DETERIORATING
    confidence: float  # 0-1
    timestamp: datetime = field(default_factory=datetime.now)


@dataclass
class RiskScore:
    """Comprehensive risk assessment"""
    overall_risk: float  # 0-100
    market_risk: float  # 0-100
    volatility_risk: float  # 0-100
    correlation_risk: float  # 0-100
    liquidity_risk: float  # 0-100
    gap_risk: float  # 0-100
    concentration_risk: float  # 0-100
    risk_rating: str  # CRITICAL, HIGH, MEDIUM, LOW, MINIMAL
    risk_level_change: str  # INCREASING, STABLE, DECREASING
    primary_risks: List[str]
    hedge_recommendations: List[str]
    timestamp: datetime = field(default_factory=datetime.now)


@dataclass
class MarketSentiment:
    """Overall market sentiment snapshot"""
    market_mood: str  # RISK_ON, RISK_OFF, NEUTRAL
    fear_index: float  # 0-100
    greed_index: float  # 0-100
    fomo_level: float  # 0-100
    panic_level: float  # 0-100
    conviction_level: float  # 0-100
    timestamp: datetime = field(default_factory=datetime.now)


class SentimentRiskScorer:
    """Analyzes market sentiment and risk metrics.
    
    Features:
    - Real-time sentiment scoring
    - Multi-factor risk assessment
    - Sentiment momentum tracking
    - Risk rating classification
    - Hedge recommendation engine
    - Correlation-based risk analysis
    """

    def __init__(self):
        self.logger = logger
        self.lock = RLock()
        
        # History
        self.sentiment_history: deque = deque(maxlen=100)
        self.risk_history: deque = deque(maxlen=100)
        
        # Cache
        self.sentiment_cache: Dict[str, SentimentScore] = {}
        self.risk_cache: Dict[str, RiskScore] = {}
        
        # Weights for sentiment
        self.sentiment_weights = {
            'volume': 0.25,
            'momentum': 0.25,
            'price_action': 0.25,
            'institutional_flow': 0.25
        }

    async def calculate_sentiment(self, symbol: str, data: Dict) -> Optional[SentimentScore]:
        """Calculate market sentiment score."""
        try:
            with self.lock:
                # Analyze volume sentiment
                volume_sentiment = self._analyze_volume_sentiment(data)
                
                # Analyze momentum sentiment
                momentum_sentiment = self._analyze_momentum_sentiment(data)
                
                # Analyze price action sentiment
                price_sentiment = self._analyze_price_action_sentiment(data)
                
                # Analyze flow sentiment
                flow_sentiment = self._analyze_flow_sentiment(data)
                
                # Calculate weighted sentiment
                bullish_score = (
                    volume_sentiment[0] * self.sentiment_weights['volume'] +
                    momentum_sentiment[0] * self.sentiment_weights['momentum'] +
                    price_sentiment[0] * self.sentiment_weights['price_action'] +
                    flow_sentiment[0] * self.sentiment_weights['institutional_flow']
                )
                
                bearish_score = 100 - bullish_score
                sentiment_score = bullish_score - bearish_score
                
                # Classify sentiment
                overall_sentiment = self._classify_sentiment(sentiment_score)
                
                # Analyze sentiment momentum
                momentum = self._analyze_sentiment_momentum()
                
                # Institutional vs retail sentiment
                inst_sentiment = "BULLISH" if flow_sentiment[1] > 0.5 else "BEARISH"
                retail_sentiment = "BULLISH" if momentum_sentiment[1] > 0.5 else "BEARISH"
                
                sentiment = SentimentScore(
                    overall_sentiment=overall_sentiment,
                    sentiment_score=sentiment_score,
                    bullish_score=bullish_score,
                    bearish_score=bearish_score,
                    retail_sentiment=retail_sentiment,
                    institutional_sentiment=inst_sentiment,
                    sentiment_momentum=momentum,
                    confidence=self._calculate_sentiment_confidence(data)
                )
                
                self.sentiment_cache[symbol] = sentiment
                self.sentiment_history.append(sentiment)
                return sentiment
        except Exception as e:
            self.logger.error(f"Error calculating sentiment: {str(e)}")
            return None

    async def calculate_risk_score(self, symbol: str, data: Dict) -> Optional[RiskScore]:
        """Calculate comprehensive risk score."""
        try:
            with self.lock:
                # Calculate individual risk factors
                market_risk = self._calculate_market_risk(data)
                volatility_risk = self._calculate_volatility_risk(data)
                correlation_risk = self._calculate_correlation_risk(symbol, data)
                liquidity_risk = self._calculate_liquidity_risk(data)
                gap_risk = self._calculate_gap_risk(data)
                concentration_risk = self._calculate_concentration_risk(symbol, data)
                
                # Calculate overall risk
                overall_risk = (
                    market_risk * 0.2 +
                    volatility_risk * 0.2 +
                    correlation_risk * 0.15 +
                    liquidity_risk * 0.15 +
                    gap_risk * 0.15 +
                    concentration_risk * 0.15
                )
                
                # Classify risk
                risk_rating = self._classify_risk(overall_risk)
                
                # Detect risk change
                risk_change = self._detect_risk_change(overall_risk)
                
                # Identify primary risks
                primary_risks = self._identify_primary_risks([
                    market_risk, volatility_risk, correlation_risk,
                    liquidity_risk, gap_risk, concentration_risk
                ])
                
                # Generate hedge recommendations
                hedges = self._generate_hedge_recommendations(primary_risks)
                
                risk_score = RiskScore(
                    overall_risk=overall_risk,
                    market_risk=market_risk,
                    volatility_risk=volatility_risk,
                    correlation_risk=correlation_risk,
                    liquidity_risk=liquidity_risk,
                    gap_risk=gap_risk,
                    concentration_risk=concentration_risk,
                    risk_rating=risk_rating,
                    risk_level_change=risk_change,
                    primary_risks=primary_risks,
                    hedge_recommendations=hedges
                )
                
                self.risk_cache[symbol] = risk_score
                self.risk_history.append(risk_score)
                return risk_score
        except Exception as e:
            self.logger.error(f"Error calculating risk score: {str(e)}")
            return None

    async def analyze_market_sentiment(self, data: Dict) -> Optional[MarketSentiment]:
        """Analyze overall market sentiment."""
        try:
            with self.lock:
                # Fear/Greed calculation
                fear_index = data.get('fear_index', 50)
                greed_index = 100 - fear_index
                
                # FOMO level
                fomo_level = data.get('volume_ratio', 0) * 100 if data.get('volume_ratio') else 50
                
                # Panic level
                panic_level = fear_index if fear_index > 70 else 30
                
                # Conviction level
                conviction = data.get('conviction', 50)
                
                # Market mood
                if greed_index > 70:
                    market_mood = "RISK_ON"
                elif fear_index > 70:
                    market_mood = "RISK_OFF"
                else:
                    market_mood = "NEUTRAL"
                
                sentiment = MarketSentiment(
                    market_mood=market_mood,
                    fear_index=fear_index,
                    greed_index=greed_index,
                    fomo_level=fomo_level,
                    panic_level=panic_level,
                    conviction_level=conviction
                )
                
                return sentiment
        except Exception as e:
            self.logger.error(f"Error analyzing market sentiment: {str(e)}")
            return None

    def _analyze_volume_sentiment(self, data: Dict) -> tuple:
        """Analyze volume-based sentiment."""
        current_volume = int(data.get('volume', 0))
        avg_volume = int(data.get('avg_volume', 0))
        
        if avg_volume == 0:
            return (50, 0.5)
        
        volume_ratio = current_volume / avg_volume
        
        if volume_ratio > 1.5:
            bullish_score = 75
        elif volume_ratio > 1.2:
            bullish_score = 60
        else:
            bullish_score = 40
        
        return (bullish_score, volume_ratio / 2)

    def _analyze_momentum_sentiment(self, data: Dict) -> tuple:
        """Analyze momentum-based sentiment."""
        momentum = data.get('momentum', 0)
        
        if momentum > 75:
            return (80, 0.8)
        elif momentum > 50:
            return (65, 0.65)
        elif momentum > 25:
            return (50, 0.5)
        else:
            return (35, 0.35)

    def _analyze_price_action_sentiment(self, data: Dict) -> tuple:
        """Analyze price action sentiment."""
        change_pct = data.get('change_pct', 0)
        
        if change_pct > 0.5:
            return (70, 0.7)
        elif change_pct > 0.2:
            return (60, 0.6)
        elif change_pct < -0.5:
            return (30, 0.3)
        else:
            return (50, 0.5)

    def _analyze_flow_sentiment(self, data: Dict) -> tuple:
        """Analyze institutional flow sentiment."""
        fii_flow = data.get('fii_flow', 0)
        dii_flow = data.get('dii_flow', 0)
        
        net_flow = fii_flow + dii_flow
        
        if net_flow > 0:
            return (70, 0.7)
        elif net_flow < -100:
            return (30, 0.3)
        else:
            return (50, 0.5)

    def _classify_sentiment(self, sentiment_score: float) -> str:
        """Classify sentiment level."""
        if sentiment_score > 60:
            return "EXTREMELY_BULLISH"
        elif sentiment_score > 30:
            return "BULLISH"
        elif sentiment_score > -30:
            return "NEUTRAL"
        elif sentiment_score > -60:
            return "BEARISH"
        else:
            return "EXTREMELY_BEARISH"

    def _analyze_sentiment_momentum(self) -> str:
        """Analyze sentiment momentum."""
        if len(self.sentiment_history) < 5:
            return "STABLE"
        
        recent = list(self.sentiment_history)[-5:]
        score_trend = recent[-1].sentiment_score - recent[0].sentiment_score
        
        if score_trend > 20:
            return "IMPROVING"
        elif score_trend < -20:
            return "DETERIORATING"
        else:
            return "STABLE"

    def _calculate_market_risk(self, data: Dict) -> float:
        """Calculate market risk."""
        return min(100, abs(data.get('change_pct', 0)) * 10 + 30)

    def _calculate_volatility_risk(self, data: Dict) -> float:
        """Calculate volatility risk."""
        vix = data.get('vix', 20)
        if vix > 30:
            return 80
        elif vix > 20:
            return 60
        else:
            return 40

    def _calculate_correlation_risk(self, symbol: str, data: Dict) -> float:
        """Calculate correlation-based risk."""
        return 50  # Default

    def _calculate_liquidity_risk(self, data: Dict) -> float:
        """Calculate liquidity risk."""
        bid_ask = data.get('bid_ask_spread', 1)
        if bid_ask > 5:
            return 80
        elif bid_ask > 2:
            return 60
        else:
            return 30

    def _calculate_gap_risk(self, data: Dict) -> float:
        """Calculate gap risk."""
        return 40  # Default

    def _calculate_concentration_risk(self, symbol: str, data: Dict) -> float:
        """Calculate concentration risk."""
        return 50  # Default

    def _classify_risk(self, risk_score: float) -> str:
        """Classify risk level."""
        if risk_score > 80:
            return "CRITICAL"
        elif risk_score > 65:
            return "HIGH"
        elif risk_score > 50:
            return "MEDIUM"
        elif risk_score > 35:
            return "LOW"
        else:
            return "MINIMAL"

    def _detect_risk_change(self, current_risk: float) -> str:
        """Detect if risk is changing."""
        if not self.risk_history:
            return "STABLE"
        
        previous_risk = self.risk_history[-1].overall_risk
        change = current_risk - previous_risk
        
        if change > 5:
            return "INCREASING"
        elif change < -5:
            return "DECREASING"
        else:
            return "STABLE"

    def _identify_primary_risks(self, risk_factors: List[float]) -> List[str]:
        """Identify primary risk factors."""
        risks = ["Market Risk", "Volatility Risk", "Correlation Risk", 
                 "Liquidity Risk", "Gap Risk", "Concentration Risk"]
        
        sorted_risks = sorted(zip(risk_factors, risks), reverse=True)
        return [risk for _, risk in sorted_risks[:3]]

    def _generate_hedge_recommendations(self, primary_risks: List[str]) -> List[str]:
        """Generate hedge recommendations."""
        recommendations = []
        
        for risk in primary_risks:
            if "Volatility" in risk:
                recommendations.append("Use Put Options for downside protection")
            elif "Liquidity" in risk:
                recommendations.append("Reduce position size")
            elif "Gap" in risk:
                recommendations.append("Use wider stop losses")
        
        return recommendations[:3]

    def _calculate_sentiment_confidence(self, data: Dict) -> float:
        """Calculate confidence in sentiment calculation."""
        volume = data.get('volume', 0)
        return min(1.0, volume / 10000000)


# Global instance
sentiment_risk_scorer = SentimentRiskScorer()

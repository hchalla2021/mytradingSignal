"""
AI Engine Package
Professional Trading Intelligence System
"""
try:
    from .feature_builder import FeatureBuilder
    from .risk_engine import RiskEngine, AlertLevel
    from .llm_client import LLMClient
    from .decision_engine import DecisionEngine
    from .alert_service import TwilioAlertService
    from .scheduler import AIScheduler
except ImportError as e:
    print(f"⚠️ AI Engine import warning: {e}")
    print("   Backend will continue with InstantSignal analysis only")
    # Provide dummy classes if imports fail
    FeatureBuilder = None
    RiskEngine = None
    AlertLevel = None
    LLMClient = None
    DecisionEngine = None
    TwilioAlertService = None
    AIScheduler = None

__all__ = [
    'FeatureBuilder',
    'RiskEngine',
    'AlertLevel',
    'LLMClient',
    'DecisionEngine',
    'TwilioAlertService',
    'AIScheduler',
]

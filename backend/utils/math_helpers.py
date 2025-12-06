"""
Mathematical utilities for option calculations
Custom norm class to replace scipy.stats.norm
"""
import math


class norm:
    """Custom normal distribution functions replacing scipy.stats.norm"""
    
    @staticmethod
    def cdf(x: float) -> float:
        """Cumulative distribution function for standard normal distribution"""
        return (1.0 + math.erf(x / math.sqrt(2.0))) / 2.0
    
    @staticmethod
    def pdf(x: float) -> float:
        """Probability density function for standard normal distribution"""
        return math.exp(-x * x / 2.0) / math.sqrt(2.0 * math.pi)

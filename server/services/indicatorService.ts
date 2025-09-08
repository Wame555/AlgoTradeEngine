export interface IndicatorResult {
  value: number;
  signal: 'LONG' | 'SHORT' | 'WAIT';
  confidence: number;
}

export interface CombinedSignal {
  signal: 'LONG' | 'SHORT' | 'WAIT';
  confidence: number;
  indicators: { [key: string]: IndicatorResult };
}

export class IndicatorService {
  
  calculateRSI(prices: number[], period: number = 14): IndicatorResult {
    if (prices.length < period + 1) {
      return { value: 50, signal: 'WAIT', confidence: 0 };
    }

    const gains: number[] = [];
    const losses: number[] = [];

    for (let i = 1; i < prices.length; i++) {
      const diff = prices[i] - prices[i - 1];
      gains.push(diff > 0 ? diff : 0);
      losses.push(diff < 0 ? Math.abs(diff) : 0);
    }

    const avgGain = gains.slice(-period).reduce((sum, gain) => sum + gain, 0) / period;
    const avgLoss = losses.slice(-period).reduce((sum, loss) => sum + loss, 0) / period;

    if (avgLoss === 0) {
      return { value: 100, signal: 'WAIT', confidence: 0 };
    }

    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));

    let signal: 'LONG' | 'SHORT' | 'WAIT' = 'WAIT';
    let confidence = 0;

    if (rsi < 30) {
      signal = 'LONG';
      confidence = Math.min((30 - rsi) * 2, 100);
    } else if (rsi > 70) {
      signal = 'SHORT';
      confidence = Math.min((rsi - 70) * 2, 100);
    } else {
      confidence = Math.abs(50 - rsi);
    }

    return { value: rsi, signal, confidence };
  }

  calculateMACD(prices: number[], fastPeriod: number = 12, slowPeriod: number = 26, signalPeriod: number = 9): IndicatorResult {
    if (prices.length < slowPeriod) {
      return { value: 0, signal: 'WAIT', confidence: 0 };
    }

    const fastEMA = this.calculateEMA(prices, fastPeriod);
    const slowEMA = this.calculateEMA(prices, slowPeriod);
    
    const macdLine = fastEMA[fastEMA.length - 1] - slowEMA[slowEMA.length - 1];
    
    // For simplicity, using a mock signal line calculation
    const signalLine = macdLine * 0.8; // Simplified
    
    const histogram = macdLine - signalLine;
    
    let signal: 'LONG' | 'SHORT' | 'WAIT' = 'WAIT';
    let confidence = 0;

    if (histogram > 0 && macdLine > signalLine) {
      signal = 'LONG';
      confidence = Math.min(Math.abs(histogram) * 100, 100);
    } else if (histogram < 0 && macdLine < signalLine) {
      signal = 'SHORT';
      confidence = Math.min(Math.abs(histogram) * 100, 100);
    } else {
      confidence = Math.abs(histogram) * 50;
    }

    return { value: macdLine, signal, confidence };
  }

  calculateMA(prices: number[], period: number = 20, type: 'SMA' | 'EMA' = 'SMA'): IndicatorResult {
    if (prices.length < period) {
      return { value: 0, signal: 'WAIT', confidence: 0 };
    }

    let ma: number;
    if (type === 'SMA') {
      ma = prices.slice(-period).reduce((sum, price) => sum + price, 0) / period;
    } else {
      const ema = this.calculateEMA(prices, period);
      ma = ema[ema.length - 1];
    }

    const currentPrice = prices[prices.length - 1];
    const priceAboveMA = currentPrice > ma;
    const distance = Math.abs(currentPrice - ma) / ma;

    let signal: 'LONG' | 'SHORT' | 'WAIT' = 'WAIT';
    let confidence = Math.min(distance * 1000, 100);

    if (priceAboveMA && distance > 0.01) {
      signal = 'LONG';
    } else if (!priceAboveMA && distance > 0.01) {
      signal = 'SHORT';
    }

    return { value: ma, signal, confidence };
  }

  calculateBollingerBands(prices: number[], period: number = 20, multiplier: number = 2): IndicatorResult {
    if (prices.length < period) {
      return { value: 0, signal: 'WAIT', confidence: 0 };
    }

    const recentPrices = prices.slice(-period);
    const sma = recentPrices.reduce((sum, price) => sum + price, 0) / period;
    
    const variance = recentPrices.reduce((sum, price) => sum + Math.pow(price - sma, 2), 0) / period;
    const stdDev = Math.sqrt(variance);
    
    const upperBand = sma + (multiplier * stdDev);
    const lowerBand = sma - (multiplier * stdDev);
    
    const currentPrice = prices[prices.length - 1];
    
    let signal: 'LONG' | 'SHORT' | 'WAIT' = 'WAIT';
    let confidence = 0;

    if (currentPrice <= lowerBand) {
      signal = 'LONG';
      confidence = Math.min(((lowerBand - currentPrice) / lowerBand) * 1000, 100);
    } else if (currentPrice >= upperBand) {
      signal = 'SHORT';
      confidence = Math.min(((currentPrice - upperBand) / upperBand) * 1000, 100);
    }

    return { value: sma, signal, confidence };
  }

  private calculateEMA(prices: number[], period: number): number[] {
    const k = 2 / (period + 1);
    const emaArray: number[] = [prices[0]];

    for (let i = 1; i < prices.length; i++) {
      const ema = (prices[i] * k) + (emaArray[i - 1] * (1 - k));
      emaArray.push(ema);
    }

    return emaArray;
  }

  combineSignals(
    indicators: { [key: string]: IndicatorResult },
    weights: { [key: string]: number }
  ): CombinedSignal {
    let totalLongScore = 0;
    let totalShortScore = 0;
    let totalWeight = 0;

    Object.entries(indicators).forEach(([name, indicator]) => {
      const weight = weights[name] || 1;
      const score = indicator.confidence * weight;

      if (indicator.signal === 'LONG') {
        totalLongScore += score;
      } else if (indicator.signal === 'SHORT') {
        totalShortScore += score;
      }

      totalWeight += weight;
    });

    if (totalWeight === 0) {
      return {
        signal: 'WAIT',
        confidence: 0,
        indicators
      };
    }

    const longScore = totalLongScore / totalWeight;
    const shortScore = totalShortScore / totalWeight;
    const maxScore = Math.max(longScore, shortScore);

    let signal: 'LONG' | 'SHORT' | 'WAIT' = 'WAIT';
    
    if (maxScore > 30) { // Minimum confidence threshold
      if (longScore > shortScore) {
        signal = 'LONG';
      } else {
        signal = 'SHORT';
      }
    }

    return {
      signal,
      confidence: Math.min(maxScore, 100),
      indicators
    };
  }

  generateMockSignal(symbol: string): CombinedSignal {
    // Generate realistic mock signals for demonstration
    const indicators: { [key: string]: IndicatorResult } = {
      RSI: {
        value: 30 + Math.random() * 40,
        signal: Math.random() > 0.5 ? 'LONG' : 'SHORT',
        confidence: 50 + Math.random() * 40
      },
      MACD: {
        value: (Math.random() - 0.5) * 2,
        signal: Math.random() > 0.6 ? 'LONG' : Math.random() > 0.3 ? 'SHORT' : 'WAIT',
        confidence: 40 + Math.random() * 50
      },
      MA: {
        value: 100 + Math.random() * 50,
        signal: Math.random() > 0.4 ? 'LONG' : 'SHORT',
        confidence: 30 + Math.random() * 60
      },
      BollingerBands: {
        value: 100 + Math.random() * 20,
        signal: Math.random() > 0.7 ? 'LONG' : Math.random() > 0.3 ? 'SHORT' : 'WAIT',
        confidence: 20 + Math.random() * 70
      }
    };

    const weights = {
      RSI: 0.3,
      MACD: 0.25,
      MA: 0.25,
      BollingerBands: 0.2
    };

    return this.combineSignals(indicators, weights);
  }
}

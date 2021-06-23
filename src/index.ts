import _ from "lodash";

export type IOHLCV = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type OHLCV = [
  number,
  number,
  number,
  number,
  number,
  number,
]

export type TradeTick = {
  price: number;
  quantity: number;
  time: number;
}

export enum OHLCVField {
  TIME = 0,
  OPEN = 1,
  HIGH = 2,
  LOW = 3,
  CLOSE = 4,
  VOLUME = 5
}

export type Trade = TradeTick;

export const batchCandleArray = (candledata: OHLCV[],
  baseFrame: number = 60,
  newFrame: number = 300): OHLCV[] => {
  const result: OHLCV[] = [];
  baseFrame *= 1000;
  newFrame *= 1000;

  const convertRatio = Math.floor(newFrame / baseFrame);

  if (convertRatio % 1 !== 0) {
    throw new Error("Convert ratio should integer an >= 2");
  }

  if (Array.isArray(candledata)) {
    if (candledata.length == 0 || candledata.length < convertRatio) {
      return result;
    }
  } else {
    throw new Error("Candledata is empty or not an array!");
  }

  // Sort Data to ascending by Time
  candledata.sort((a, b) => a[OHLCVField.TIME] - b[OHLCVField.TIME]);

  // Buffer values
  let open = 0;
  let high = 0;
  let close = 0;
  let low = 0;
  let volume = 0;
  let timeOpen = null;
  let j = 0;

  for (let i = 0; i < candledata.length; i++) {
    const candle = candledata[i];

    // Type convert
    candle[OHLCVField.TIME] = Number(candle[OHLCVField.TIME]);
    candle[OHLCVField.OPEN] = Number(candle[OHLCVField.OPEN]);
    candle[OHLCVField.HIGH] = Number(candle[OHLCVField.HIGH]);
    candle[OHLCVField.LOW] = Number(candle[OHLCVField.LOW]);
    candle[OHLCVField.CLOSE] = Number(candle[OHLCVField.CLOSE]);
    candle[OHLCVField.VOLUME] = Number(candle[OHLCVField.VOLUME]);


    // First / Force New Candle
    if(timeOpen === null){
      timeOpen = candle[OHLCVField.TIME];

      if(candle[OHLCVField.TIME] % newFrame > 0){
        timeOpen = candle[OHLCVField.TIME] - candle[OHLCVField.TIME] % newFrame;
      }

      open = candle[OHLCVField.OPEN];
      high = candle[OHLCVField.HIGH];
      low = candle[OHLCVField.LOW];
      close = candle[OHLCVField.CLOSE];
      volume = 0;
      j = 1;

    }

      // New Candle
    if( candle[OHLCVField.TIME] - candle[OHLCVField.TIME] % newFrame !== timeOpen){

      result.push([timeOpen, open, high, low, close, volume]);

      timeOpen = candle[OHLCVField.TIME] - candle[OHLCVField.TIME] % newFrame;
      open = candle[OHLCVField.OPEN];
      high = candle[OHLCVField.HIGH];
      low = candle[OHLCVField.LOW];
      close = candle[OHLCVField.CLOSE];
      volume = 0;
      j = 1;
    }

    high = Math.max(candle[OHLCVField.HIGH], high);
    low = Math.min(candle[OHLCVField.LOW], low);
    close = candle[OHLCVField.CLOSE];
    volume =  volume + candle[OHLCVField.VOLUME];

    // Batch counter


    if(j === convertRatio){
      result.push([timeOpen, open, high, low, close, volume]);
      timeOpen = null;
    }

    j = j+1;

  }

  return result;

}

export const batchCandleJSON = (candledata: IOHLCV[], baseFrame = 60, newFrame = 300): IOHLCV[] => {

  const ohlcvArray: OHLCV[] = candledata.map(e => [e.time,e.open,e.high,e.low,e.close,e.volume]);

  const batchedOhlcvArray = batchCandleArray(ohlcvArray,baseFrame,newFrame);

  return batchedOhlcvArray.map(candle => ({
    time: candle[OHLCVField.TIME],
    open: candle[OHLCVField.OPEN],
    high:candle[OHLCVField.HIGH],
    low: candle[OHLCVField.LOW],
    close: candle[OHLCVField.CLOSE],
    volume: candle[OHLCVField.VOLUME],
  }));
}

const tickGroupToOhlcv = (time: number, ticks: Array<TradeTick>) => {
  const prices = ticks.map(tick => Number(tick.price));
  const volume = _.sum(ticks.map(tick => Number(tick.quantity))) || 0;
  return {
    time,
    open: prices[0] || 0,
    high: _.max(prices) || 0,
    low: _.min(prices) || 0,
    close: prices[prices.length - 1] || 0,
    volume
  }
}

/**
 * Convert ticks for candles grouped by intervals in seconds
 * @param tradedata 
 * @param interval 
 * @param includeOpenCandle 
 */

export const batchTicksToCandle = (tradedata: Trade[], interval: number = 60, includeOpenCandle = false): IOHLCV[] => {
  interval *= Math.floor(1000);
  const tickGroups = _.groupBy(tradedata, (tick) => tick.time - (tick.time % interval));
  const candles: IOHLCV[] = [];
  Object.keys(tickGroups).forEach(timeOpen => {
    const ticks = tickGroups[timeOpen];
    candles.push(tickGroupToOhlcv(Number(timeOpen), ticks));
  });
  const sortedCandles = _.sortBy(candles, (candle) => candle.time);

  if(includeOpenCandle === false) {
    sortedCandles.pop();
  }
  return sortedCandles;
}

/**
 * Covert ticks to candles by linear groups
 * @param tradedata 
 * @param tickSize 
 */

export const ticksToTickChart = (tradedata: Trade[], tickSize: number = 5): IOHLCV[] => {
  if (tickSize < 1) {
    throw new Error("Convert cannot be smaller than 1");
  }
  const candles: IOHLCV[] = [];
  const tickGroups = _.chunk(tradedata, tickSize);
  tickGroups.forEach(ticks => {
    candles.push(tickGroupToOhlcv(Number(ticks[ticks.length-1].time), ticks));
  });
  return candles;
}

export default {
  array: batchCandleArray,
  json: batchCandleJSON,
  trade_to_candle: batchTicksToCandle,
  tick_chart: ticksToTickChart
};

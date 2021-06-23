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
  time: number;
  price: number;
  quantity: number;
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

 /**
 * Resample OHLCV to different timeframe
  * @param ohlcvData 
  * @param param1 
  */

export const resampleOhlcv = (
  ohlcvData: OHLCV[] | IOHLCV[],
  { baseTimeframe = 60, newTimeframe = 300 }: { baseTimeframe: number, newTimeframe: number }
  ) : OHLCV[] | IOHLCV[] => {

  if(ohlcvData.length === 0) {
    throw new Error("input OHLCV data has no candles");
  }
  if(_.isPlainObject(ohlcvData[0])) {
    const data = ohlcvData as IOHLCV[];
    const candledata: OHLCV[] = data.map(e => [e.time,e.open,e.high,e.low,e.close,e.volume]);
    const result = resampleOhlcvArray(candledata, baseTimeframe, newTimeframe);
    return result.map(candle => ({
      time: candle[OHLCVField.TIME],
      open: candle[OHLCVField.OPEN],
      high:candle[OHLCVField.HIGH],
      low: candle[OHLCVField.LOW],
      close: candle[OHLCVField.CLOSE],
      volume: candle[OHLCVField.VOLUME],
    }));
  } else {
    const candledata: OHLCV[] = ohlcvData as OHLCV[];
    return resampleOhlcvArray(candledata, baseTimeframe, newTimeframe);
  }
}

/**
 * Resample OHLCV in object format to different timeframe
 * @param candledata 
 * @param baseFrame 
 * @param newFrame 
 */

const resampleOhlcvArray = (candledata: OHLCV[],
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

/**
 * Aggregate group of ticks to one OHLCV object
 * @param time 
 * @param ticks 
 */

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
 * Convert ticks for candles grouped by intervals in seconds or tick count
 * @param tradedata 
 * @param options
 * @param options.timeframe
 * @param options.includeLatestCandle
 */

export const resampleTicksByTime = (
  tickData: Trade[],
  { timeframe = 60, includeLatestCandle = false } : { timeframe?: number, includeLatestCandle?: boolean } = {}
  ): IOHLCV[] => {

    timeframe *= Math.floor(1000);
    const tickGroups = _.groupBy(tickData, (tick) => tick.time - (tick.time % timeframe));
    const candles: IOHLCV[] = [];
    Object.keys(tickGroups).forEach(timeOpen => {
      const ticks = tickGroups[timeOpen];
      candles.push(tickGroupToOhlcv(Number(timeOpen), ticks));
    });
    const sortedCandles = _.sortBy(candles, (candle) => candle.time);

    if(includeLatestCandle === false) {
      sortedCandles.pop();
    }
    return sortedCandles;
}

/**
 * Covert ticks to candles by linear groups
 * @param tradedata 
 * @param tickSize 
 */

export const resampleTicksByCount = (tickData: Trade[],
  { tickCount = 5 } : { tickCount?: number } = {}
  ): IOHLCV[] => {
  if (tickCount < 1) {
    throw new Error("Convert cannot be smaller than 1");
  }
  const candles: IOHLCV[] = [];
  const tickGroups = _.chunk(tickData, tickCount);
  tickGroups.forEach(ticks => {
    candles.push(tickGroupToOhlcv(Number(ticks[ticks.length-1].time), ticks));
  });
  return candles;
}

export default {
  resample_ohlcv: resampleOhlcv,
  array: resampleOhlcv,
  json: resampleOhlcv,
  trade_to_candle: resampleTicksByTime,
  tick_chart: resampleTicksByCount
};
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const lodash_1 = __importDefault(require("lodash"));
var OHLCVField;
(function (OHLCVField) {
    OHLCVField[OHLCVField["TIME"] = 0] = "TIME";
    OHLCVField[OHLCVField["OPEN"] = 1] = "OPEN";
    OHLCVField[OHLCVField["HIGH"] = 2] = "HIGH";
    OHLCVField[OHLCVField["LOW"] = 3] = "LOW";
    OHLCVField[OHLCVField["CLOSE"] = 4] = "CLOSE";
    OHLCVField[OHLCVField["VOLUME"] = 5] = "VOLUME";
})(OHLCVField = exports.OHLCVField || (exports.OHLCVField = {}));
/**
* Resample OHLCV to different timeframe
 * @param ohlcvData
 * @param param1
 */
exports.resampleOhlcv = (ohlcvData, { baseTimeframe = 60, newTimeframe = 300 }) => {
    if (ohlcvData.length === 0) {
        throw new Error("input OHLCV data has no candles");
    }
    if (lodash_1.default.isPlainObject(ohlcvData[0])) {
        const data = ohlcvData;
        const candledata = data.map(e => [e.time, e.open, e.high, e.low, e.close, e.volume]);
        const result = resampleOhlcvArray(candledata, baseTimeframe, newTimeframe);
        return result.map(candle => ({
            time: candle[OHLCVField.TIME],
            open: candle[OHLCVField.OPEN],
            high: candle[OHLCVField.HIGH],
            low: candle[OHLCVField.LOW],
            close: candle[OHLCVField.CLOSE],
            volume: candle[OHLCVField.VOLUME],
        }));
    }
    else {
        const candledata = ohlcvData;
        return resampleOhlcvArray(candledata, baseTimeframe, newTimeframe);
    }
};
/**
 * Resample OHLCV in object format to different timeframe
 * @param candledata
 * @param baseFrame
 * @param newFrame
 */
const resampleOhlcvArray = (candledata, baseFrame = 60, newFrame = 300) => {
    const result = [];
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
    }
    else {
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
        if (timeOpen === null) {
            timeOpen = candle[OHLCVField.TIME];
            if (candle[OHLCVField.TIME] % newFrame > 0) {
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
        if (candle[OHLCVField.TIME] - candle[OHLCVField.TIME] % newFrame !== timeOpen) {
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
        volume = volume + candle[OHLCVField.VOLUME];
        // Batch counter
        if (j === convertRatio) {
            result.push([timeOpen, open, high, low, close, volume]);
            timeOpen = null;
        }
        j = j + 1;
    }
    return result;
};
/**
 * Aggregate group of ticks to one OHLCV object
 * @param time
 * @param ticks
 */
const tickGroupToOhlcv = (time, ticks) => {
    const prices = ticks.map(tick => Number(tick.price));
    const volume = lodash_1.default.sum(ticks.map(tick => Number(tick.quantity))) || 0;
    return {
        time,
        open: prices[0] || 0,
        high: lodash_1.default.max(prices) || 0,
        low: lodash_1.default.min(prices) || 0,
        close: prices[prices.length - 1] || 0,
        volume
    };
};
/**
 * Convert ticks for candles grouped by intervals in seconds or tick count
 * @param tradedata
 * @param options
 * @param options.timeframe
 * @param options.includeLatestCandle
 */
exports.resampleTicksByTime = (tickData, { timeframe = 60, includeLatestCandle = false } = {}) => {
    timeframe *= Math.floor(1000);
    const tickGroups = lodash_1.default.groupBy(tickData, (tick) => tick.time - (tick.time % timeframe));
    const candles = [];
    Object.keys(tickGroups).forEach(timeOpen => {
        const ticks = tickGroups[timeOpen];
        candles.push(tickGroupToOhlcv(Number(timeOpen), ticks));
    });
    const sortedCandles = lodash_1.default.sortBy(candles, (candle) => candle.time);
    if (includeLatestCandle === false) {
        sortedCandles.pop();
    }
    return sortedCandles;
};
/**
 * Covert ticks to candles by linear groups
 * @param tradedata
 * @param tickSize
 */
exports.resampleTicksByCount = (tickData, { tickCount = 5 } = {}) => {
    if (tickCount < 1) {
        throw new Error("Convert cannot be smaller than 1");
    }
    const candles = [];
    const tickGroups = lodash_1.default.chunk(tickData, tickCount);
    tickGroups.forEach(ticks => {
        candles.push(tickGroupToOhlcv(Number(ticks[ticks.length - 1].time), ticks));
    });
    return candles;
};
exports.default = {
    resample_ohlcv: exports.resampleOhlcv,
    array: exports.resampleOhlcv,
    json: exports.resampleOhlcv,
    trade_to_candle: exports.resampleTicksByTime,
    tick_chart: exports.resampleTicksByCount
};
//# sourceMappingURL=index.js.map
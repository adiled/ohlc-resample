export declare type IOHLCV = {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
};
export declare type OHLCV = [number, number, number, number, number, number];
export declare type TradeTick = {
    time: number;
    price: number;
    quantity: number;
};
export declare enum OHLCVField {
    TIME = 0,
    OPEN = 1,
    HIGH = 2,
    LOW = 3,
    CLOSE = 4,
    VOLUME = 5
}
export declare type Trade = TradeTick;
/**
* Resample OHLCV to different timeframe
 * @param ohlcvData
 * @param param1
 */
export declare const resampleOhlcv: (ohlcvData: OHLCV[] | IOHLCV[], { baseTimeframe, newTimeframe }: {
    baseTimeframe: number;
    newTimeframe: number;
}) => OHLCV[] | IOHLCV[];
/**
 * Convert ticks for candles grouped by intervals in seconds or tick count
 * @param tradedata
 * @param options
 * @param options.timeframe
 * @param options.includeLatestCandle
 */
export declare const resampleTicksByTime: (tickData: TradeTick[], { timeframe, includeLatestCandle }?: {
    timeframe?: number | undefined;
    includeLatestCandle?: boolean | undefined;
}) => IOHLCV[];
/**
 * Covert ticks to candles by linear groups
 * @param tradedata
 * @param tickSize
 */
export declare const resampleTicksByCount: (tickData: TradeTick[], { tickCount }?: {
    tickCount?: number | undefined;
}) => IOHLCV[];
declare const _default: {
    resample_ohlcv: (ohlcvData: OHLCV[] | IOHLCV[], { baseTimeframe, newTimeframe }: {
        baseTimeframe: number;
        newTimeframe: number;
    }) => OHLCV[] | IOHLCV[];
    array: (ohlcvData: OHLCV[] | IOHLCV[], { baseTimeframe, newTimeframe }: {
        baseTimeframe: number;
        newTimeframe: number;
    }) => OHLCV[] | IOHLCV[];
    json: (ohlcvData: OHLCV[] | IOHLCV[], { baseTimeframe, newTimeframe }: {
        baseTimeframe: number;
        newTimeframe: number;
    }) => OHLCV[] | IOHLCV[];
    trade_to_candle: (tickData: TradeTick[], { timeframe, includeLatestCandle }?: {
        timeframe?: number | undefined;
        includeLatestCandle?: boolean | undefined;
    }) => IOHLCV[];
    tick_chart: (tickData: TradeTick[], { tickCount }?: {
        tickCount?: number | undefined;
    }) => IOHLCV[];
};
export default _default;

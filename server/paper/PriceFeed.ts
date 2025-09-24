const lastPriceMap = new Map<string, number>();

export function setLastPrice(symbol: string, price: number) {
    lastPriceMap.set(symbol, price);
}

export function getLastPrice(symbol: string): number | undefined {
    return lastPriceMap.get(symbol);
}

export function getAllLastPrices(): Record<string, number> {
    const obj: Record<string, number> = {};
    for (const [k, v] of lastPriceMap.entries()) obj[k] = v;
    return obj;
}

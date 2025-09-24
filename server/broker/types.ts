// server/broker/types.ts
export type Side = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT";
export interface OrderRequest {
    symbol: string;
    side: Side;
    type: OrderType;
    qty: number;         // base qty
    price?: number;      // limithez
}
export interface Fill {
    price: number; qty: number; fee: number; ts: number;
}
export interface Position {
    symbol: string; qty: number; avgPrice: number; unrealizedPnL: number;
}
export interface AccountSnapshot {
    balance: number; equity: number; marginUsed: number;
}
export interface Broker {
    placeOrder(req: OrderRequest): Promise<{ orderId: string; fills: Fill[] }>;
    cancelOrder(orderId: string): Promise<boolean>;
    positions(): Promise<Position[]>;
    account(): Promise<AccountSnapshot>;
}
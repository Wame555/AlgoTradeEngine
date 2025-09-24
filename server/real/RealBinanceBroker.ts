// server/real/RealBinanceBroker.ts
import { Broker, OrderRequest, Position, AccountSnapshot } from "../broker/types";

export class RealBinanceBroker implements Broker {
    async placeOrder(_req: OrderRequest) {
        throw new Error("RealBinanceBroker: not implemented yet (signed endpoints/HMAC needed).");
    }
    async cancelOrder(_orderId: string) { return false; }
    async positions(): Promise<Position[]> { return []; }
    async account(): Promise<AccountSnapshot> {
        return { balance: 0, equity: 0, marginUsed: 0 };
    }
}

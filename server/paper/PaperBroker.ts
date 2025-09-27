// server/paper/PaperBroker.ts
import { db } from "../db";
import {
    paperAccounts,
    paperPositions,
    paperOrders,
    paperTrades,
} from "@shared/schemaPaper";
import {
    Broker,
    OrderRequest,
    Fill,
    Position,
    AccountSnapshot,
} from "../broker/types";
import { getLastPrice } from "./PriceFeed";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { updateAccountSnapshot } from "../state/accountSnapshot";

export class PaperBroker implements Broker {
    private async accountRow() {
        const [a] = await db.select().from(paperAccounts).limit(1);
        if (a) return a;
        await db.insert(paperAccounts).values({}).returning();
        const [b] = await db.select().from(paperAccounts).limit(1);
        return b!;
    }

    async account(): Promise<AccountSnapshot> {
        const a = await this.accountRow();
        const pos = await db.select().from(paperPositions);
        const equityAdj = await this.markToMarket(pos);
        const marginUsed = 0; // egyszerstve
        return {
            balance: Number(a.balance),
            equity: Number(a.balance) + equityAdj,
            marginUsed,
        };
    }

    async positions(): Promise<Position[]> {
        const rows = await db.select().from(paperPositions);
        return rows.map((r) => {
            const lp = getLastPrice(r.symbol) ?? Number(r.avgPrice);
            const unreal = (lp - Number(r.avgPrice)) * Number(r.qty);
            return {
                symbol: r.symbol,
                qty: Number(r.qty),
                avgPrice: Number(r.avgPrice),
                unrealizedPnL: unreal,
            };
        });
    }

    async placeOrder(req: OrderRequest): Promise<{ orderId: string; fills: Fill[] }> {
        const a = await this.accountRow();

        const px0 = getLastPrice(req.symbol);
        if (!px0) throw new Error(`No price for ${req.symbol} yet`);

        const bps = Number(a.slippageBps) / 1e4;
        const taker = Number(a.feeTakerBps) / 1e4;

        // latency szimulci
        await new Promise((r) => setTimeout(r, Number(a.latencyMs)));

        const signed = req.side === "BUY" ? +1 : -1;
        const fillPrice =
            req.type === "MARKET" ? px0 * (1 + signed * bps) : req.price ?? px0;

        const qty = Number(req.qty);
        const notional = fillPrice * qty;
        const fee = notional * taker;

        // pozci update (egyszer tlagrasts)
        const [pos] = await db
            .select()
            .from(paperPositions)
            .where(eq(paperPositions.symbol, req.symbol))
            .limit(1);

        if (!pos || Number(pos.qty) === 0) {
            await db.insert(paperPositions).values({
                symbol: req.symbol,
                qty: (signed * qty).toString(),
                avgPrice: fillPrice.toString(),
            });
        } else {
            const oldQty = Number(pos.qty);
            const newQty = oldQty + signed * qty;

            const avg =
                newQty === 0
                    ? 0
                    : (oldQty * Number(pos.avgPrice) + signed * qty * fillPrice) / newQty;

            await db
                .update(paperPositions)
                .set({ qty: newQty.toString(), avgPrice: avg.toString(), updatedAt: new Date() })
                .where(eq(paperPositions.symbol, req.symbol));
        }

        // balance  egyszer cash elszmols
        const newBalance = Number(a.balance) - notional * signed - fee;
        await db
            .update(paperAccounts)
            .set({ balance: newBalance.toString() })
            .where(eq(paperAccounts.id, a.id));
        updateAccountSnapshot({ totalBalance: newBalance });

        // order + trade ments
        const [ord] = await db
            .insert(paperOrders)
            .values({
                clientId: randomUUID(),
                symbol: req.symbol,
                side: req.side,
                type: req.type,
                qty: qty.toString(),
                price: fillPrice.toString(),
                status: "FILLED",
            })
            .returning();

        await db.insert(paperTrades).values({
            orderId: ord.id,
            symbol: req.symbol,
            price: fillPrice.toString(),
            qty: qty.toString(),
            fee: fee.toString(),
        });

        const fill: Fill = { price: fillPrice, qty, fee, ts: Date.now() };
        return { orderId: String(ord.id), fills: [fill] };
    }

    async cancelOrder(): Promise<boolean> {
        // market-only papr trade; ksbb limit/queue
        return false;
    }

    private async markToMarket(posRows: any[]) {
        let pnl = 0;
        for (const p of posRows) {
            const lp = getLastPrice(p.symbol);
            if (!lp) continue;
            pnl += (lp - Number(p.avgPrice)) * Number(p.qty);
        }
        return pnl;
    }
}

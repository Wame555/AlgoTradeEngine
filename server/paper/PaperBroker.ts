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
        let marginUsed = 0;
        for (const row of pos) {
            const qty = Number(row.qty);
            const avg = Number(row.avgPrice);
            if (!Number.isFinite(qty) || !Number.isFinite(avg)) {
                continue;
            }
            const used = Math.abs(qty) * Math.max(avg, 0);
            if (Number.isFinite(used)) {
                marginUsed += used;
            }
        }
        const balance = Number(a.balance);
        const equity = balance - marginUsed + equityAdj;
        return {
            balance,
            equity,
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

        let realizedPnl = 0;
        let newQtyValue = signed * qty;
        let newAvgPrice = fillPrice;

        if (!pos || Math.abs(Number(pos.qty)) === 0) {
            await db.insert(paperPositions).values({
                symbol: req.symbol,
                qty: newQtyValue.toFixed(8),
                avgPrice: fillPrice.toFixed(8),
            });
        } else {
            const oldQty = Number(pos.qty);
            const entryPrice = Number(pos.avgPrice);
            const fillQty = signed * qty;
            const combinedQty = oldQty + fillQty;
            const sameDirection = oldQty === 0 || oldQty * fillQty >= 0;

            if (sameDirection) {
                const numerator = oldQty * entryPrice + fillQty * fillPrice;
                newQtyValue = combinedQty;
                newAvgPrice = combinedQty === 0 ? 0 : numerator / combinedQty;
            } else {
                const oldAbs = Math.abs(oldQty);
                const fillAbs = Math.abs(fillQty);
                const closeQty = Math.min(oldAbs, fillAbs);
                if (closeQty > 0 && Number.isFinite(entryPrice)) {
                    const pnlPerUnit = oldQty > 0 ? fillPrice - entryPrice : entryPrice - fillPrice;
                    realizedPnl += pnlPerUnit * closeQty;
                }

                newQtyValue = combinedQty;
                if (Math.abs(newQtyValue) < 1e-8) {
                    newQtyValue = 0;
                    newAvgPrice = 0;
                } else if (fillAbs > oldAbs) {
                    newAvgPrice = fillPrice;
                } else {
                    newAvgPrice = entryPrice;
                }
            }

            await db
                .update(paperPositions)
                .set({
                    qty: newQtyValue.toFixed(8),
                    avgPrice: newAvgPrice.toFixed(8),
                    updatedAt: new Date(),
                })
                .where(eq(paperPositions.symbol, req.symbol));
        }

        // balance  egyszer cash elszmols csak realizlt pnl + dj
        const newBalance = Number(a.balance) + realizedPnl - fee;
        await db
            .update(paperAccounts)
            .set({ balance: newBalance.toFixed(8) })
            .where(eq(paperAccounts.id, a.id));

        const accountState = await this.account();
        const openPnL = accountState.equity - accountState.balance + accountState.marginUsed;
        updateAccountSnapshot({
            totalBalance: accountState.balance,
            equity: accountState.equity,
            openPnL,
        });

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

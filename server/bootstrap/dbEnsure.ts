// server/bootstrap/dbEnsure.ts
import { sql } from "drizzle-orm";
import { db } from "../db";

/**
 * Ensure minimal runtime prerequisites exist even if migrations
 * have not been executed yet. All DDL is idempotent.
 */
export async function ensureRuntimePrereqs(): Promise<void> {
  // system_state table (used by settings/balance + snapshot)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS public."system_state" (
      id INT PRIMARY KEY DEFAULT 1,
      total_balance numeric(18,8) NOT NULL DEFAULT 0,
      equity numeric(18,8) NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT now()
    );
  `);

  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM public."system_state" WHERE id = 1) THEN
        INSERT INTO public."system_state"(id,total_balance,equity,updated_at)
        VALUES (1, 0, 0, now());
      END IF;
    END $$;
  `);

  // users.username UNIQUE constraint canonical name
  await db.execute(sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'users_username_unique'
          AND conrelid = 'public.users'::regclass
      ) THEN
        ALTER TABLE public."users" DROP CONSTRAINT users_username_unique;
      END IF;
    END $$;
  `);

  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'users_username_uniq'
          AND conrelid = 'public.users'::regclass
      ) THEN
        ALTER TABLE public."users" ADD CONSTRAINT users_username_uniq UNIQUE ("username");
      END IF;
    END $$;
  `);

  // positions.request_id unique constraint (runtime guard)
  await db.execute(sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname='public' AND indexname='idx_positions_request_id'
      ) THEN
        DROP INDEX idx_positions_request_id;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname='positions_request_id_uniq'
          AND conrelid='public.positions'::regclass
      ) THEN
        ALTER TABLE public."positions" ADD CONSTRAINT positions_request_id_uniq UNIQUE (request_id);
      END IF;
    END $$;
  `);

  // trading_pairs.symbol unique constraint (runtime guard for early upserts)
  await db.execute(sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'trading_pairs_symbol_unique'
          AND conrelid = 'public.trading_pairs'::regclass
      ) THEN
        ALTER TABLE public."trading_pairs" DROP CONSTRAINT trading_pairs_symbol_unique;
      END IF;

      IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'trading_pairs_symbol_unique'
      ) THEN
        DROP INDEX public."trading_pairs_symbol_unique";
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'trading_pairs_symbol_uniq'
          AND conrelid = 'public.trading_pairs'::regclass
      ) THEN
        ALTER TABLE public."trading_pairs"
          ADD CONSTRAINT trading_pairs_symbol_uniq UNIQUE ("symbol");
      END IF;
    END $$;
  `);

  // pair_timeframes (symbol,timeframe) unique constraint (runtime guard)
  await db.execute(sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname='public' AND indexname='pair_timeframes_symbol_timeframe_unique'
      ) THEN
        DROP INDEX pair_timeframes_symbol_timeframe_unique;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname='pair_timeframes_symbol_timeframe_uniq'
          AND conrelid='public.pair_timeframes'::regclass
      ) THEN
        ALTER TABLE public."pair_timeframes" ADD CONSTRAINT pair_timeframes_symbol_timeframe_uniq UNIQUE (symbol, timeframe);
      END IF;
    END $$;
  `);
}

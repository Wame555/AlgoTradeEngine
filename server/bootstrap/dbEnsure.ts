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
}

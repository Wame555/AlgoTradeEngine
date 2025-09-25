import type { Client, Pool, PoolClient } from "pg";

const DEFAULT_SESSION_USERNAME = process.env.DEFAULT_USER ?? "demo";
const DEFAULT_SESSION_PASSWORD = process.env.DEFAULT_USER_PASSWORD ?? "demo";

function isPool(db: Pool | Client): db is Pool {
  return typeof (db as Pool).connect === "function" && typeof (db as Pool).end === "function";
}

export async function ensureUserSettingsGuard(db: Pool | Client): Promise<void> {
  const isPoolInstance = isPool(db);
  const client = isPoolInstance ? await db.connect() : db;
  const releasable = isPoolInstance ? (client as PoolClient) : null;

  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

    const tableExistsResult = await client.query<{ exists: boolean }>(
      "SELECT to_regclass('public.user_settings') IS NOT NULL AS exists;",
    );

    if (!tableExistsResult.rows[0]?.exists) {
      console.info(
        "[userSettingsGuard] table public.user_settings missing -> skipping constraint guard",
      );
      return;
    }

    const usersTableExistsResult = await client.query<{ exists: boolean }>(
      "SELECT to_regclass('public.users') IS NOT NULL AS exists;",
    );
    const usersTableExists = Boolean(usersTableExistsResult.rows[0]?.exists);

    await client.query("BEGIN");
    try {
      const idColumnResult = await client.query<{ exists: boolean }>(
        `
          SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'user_settings'
              AND column_name = 'id'
          ) AS exists;
        `,
      );

      if (!idColumnResult.rows[0]?.exists) {
        await client.query(`ALTER TABLE public.user_settings ADD COLUMN id uuid`);
      }

      await client.query(`UPDATE public.user_settings SET id = COALESCE(id, gen_random_uuid())`);
      await client.query(`ALTER TABLE public.user_settings ALTER COLUMN id SET DEFAULT gen_random_uuid()`);
      await client.query(`ALTER TABLE public.user_settings ALTER COLUMN id SET NOT NULL`);

      const pkInfo = await client.query<{ constraint_name: string; column_name: string }>(
        `
          SELECT tc.constraint_name, kcu.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
           AND tc.table_schema = kcu.table_schema
          WHERE tc.table_schema = 'public'
            AND tc.table_name = 'user_settings'
            AND tc.constraint_type = 'PRIMARY KEY'
        `,
      );

      if (pkInfo.rowCount > 0) {
        const pkConstraintName = pkInfo.rows[0]!.constraint_name;
        const pkCoversOnlyId = pkInfo.rows.every((row) => row.column_name === "id");
        if (!pkCoversOnlyId) {
          await client.query(
            `ALTER TABLE public.user_settings DROP CONSTRAINT "${pkConstraintName}"`,
          );
        }
      }

      const pkCheck = await client.query<{ constraint_name: string }>(
        `
          SELECT constraint_name
          FROM information_schema.table_constraints
          WHERE table_schema = 'public'
            AND table_name = 'user_settings'
            AND constraint_type = 'PRIMARY KEY'
          LIMIT 1;
        `,
      );

      if (pkCheck.rowCount === 0) {
        await client.query(
          `ALTER TABLE public.user_settings ADD CONSTRAINT user_settings_pkey PRIMARY KEY (id)`,
        );
      }

      await client.query(`
        WITH ranked AS (
          SELECT id,
                 row_number() OVER (
                   PARTITION BY user_id
                   ORDER BY updated_at DESC NULLS LAST,
                            created_at DESC NULLS LAST,
                            id ASC
                 ) AS rn
          FROM public.user_settings
          WHERE user_id IS NOT NULL
        )
        DELETE FROM public.user_settings us
        USING ranked r
        WHERE us.id = r.id AND r.rn > 1;
      `);

      await client.query(`DELETE FROM public.user_settings WHERE user_id IS NULL`);

      const uniqueInfo = await client.query<{ constraint_name: string }>(
        `
          SELECT tc.constraint_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
           AND tc.table_schema = kcu.table_schema
          WHERE tc.table_schema = 'public'
            AND tc.table_name = 'user_settings'
            AND tc.constraint_type = 'UNIQUE'
            AND kcu.column_name = 'user_id'
          LIMIT 1;
        `,
      );

      if (uniqueInfo.rowCount > 0) {
        const constraintName = uniqueInfo.rows[0]!.constraint_name;
        if (constraintName !== "user_settings_user_id_unique") {
          await client.query(
            `ALTER TABLE public.user_settings RENAME CONSTRAINT "${constraintName}" TO user_settings_user_id_unique`,
          );
        }
      } else {
        await client.query(
          `ALTER TABLE public.user_settings ADD CONSTRAINT user_settings_user_id_unique UNIQUE (user_id)`,
        );
      }

      await client.query(`ALTER TABLE public.user_settings ALTER COLUMN user_id SET NOT NULL`);

      if (usersTableExists) {
        const upsertUserResult = await client.query<{ id: string }>(
          `
            INSERT INTO public.users (id, username, password)
            VALUES (gen_random_uuid(), $1, $2)
            ON CONFLICT (username)
            DO UPDATE SET username = EXCLUDED.username
            RETURNING id;
          `,
          [DEFAULT_SESSION_USERNAME, DEFAULT_SESSION_PASSWORD],
        );

        let defaultUserId: string | undefined = upsertUserResult.rows[0]?.id;
        if (!defaultUserId) {
          const existingUserResult = await client.query<{ id: string }>(
            `SELECT id FROM public.users WHERE username = $1 LIMIT 1`,
            [DEFAULT_SESSION_USERNAME],
          );
          defaultUserId = existingUserResult.rows[0]?.id;
        }

        if (defaultUserId) {
          await client.query(
            `
              INSERT INTO public.user_settings (
                id,
                user_id,
                is_testnet,
                default_leverage,
                risk_percent,
                demo_enabled,
                default_tp_pct,
                default_sl_pct
              )
              VALUES (gen_random_uuid(), $1, true, 1, 2, true, '1.00', '0.50')
              ON CONFLICT (user_id) DO NOTHING;
            `,
            [defaultUserId],
          );
        }
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    if (releasable) {
      releasable.release();
    }
  }
}

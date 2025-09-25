import type { Client, Pool, PoolClient } from "pg";

const DEFAULT_SESSION_USERNAME = process.env.DEFAULT_USER ?? "demo";
const DEFAULT_SESSION_PASSWORD = process.env.DEFAULT_USER_PASSWORD ?? "demo";
const DEMO_USER_ID = "00000000-0000-0000-0000-000000000001";

function isPool(db: Pool | Client): db is Pool {
  return typeof (db as Pool).connect === "function" && typeof (db as Pool).end === "function";
}

async function tableExists(client: Client | PoolClient, tableName: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS exists;`,
    [`public.${tableName}`],
  );
  return Boolean(result.rows[0]?.exists);
}

async function columnExists(
  client: Client | PoolClient,
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = $2
      ) AS exists;
    `,
    [tableName, columnName],
  );
  return Boolean(result.rows[0]?.exists);
}

async function getColumnType(
  client: Client | PoolClient,
  tableName: string,
  columnName: string,
): Promise<string | null> {
  const result = await client.query<{ data_type: string | null }>(
    `
      SELECT data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2;
    `,
    [tableName, columnName],
  );
  return result.rows[0]?.data_type ?? null;
}

async function ensureUsersTable(client: Client | PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      username text NOT NULL UNIQUE,
      password text NOT NULL,
      created_at timestamptz DEFAULT now()
    );
  `);

  if (!(await columnExists(client, "users", "id"))) {
    await client.query(`ALTER TABLE public.users ADD COLUMN id uuid`);
  }

  const idType = await getColumnType(client, "users", "id");
  if (idType && idType !== "uuid") {
    await client.query(`ALTER TABLE public.users ALTER COLUMN id TYPE uuid USING id::uuid`);
  }

  await client.query(`UPDATE public.users SET id = gen_random_uuid() WHERE id IS NULL`);
  await client.query(`ALTER TABLE public.users ALTER COLUMN id SET DEFAULT gen_random_uuid()`);
  await client.query(`ALTER TABLE public.users ALTER COLUMN id SET NOT NULL`);

  await client.query(`ALTER TABLE public.users ALTER COLUMN username SET NOT NULL`);
  await client.query(`ALTER TABLE public.users ALTER COLUMN password SET NOT NULL`);

  const pkInfo = await client.query<{ constraint_name: string; column_name: string }>(
    `
      SELECT tc.constraint_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = 'public'
        AND tc.table_name = 'users'
        AND tc.constraint_type = 'PRIMARY KEY';
    `,
  );

  if (pkInfo.rowCount > 0) {
    const constraintName = pkInfo.rows[0]!.constraint_name;
    const onlyId = pkInfo.rows.every((row) => row.column_name === "id");
    if (!onlyId) {
      await client.query(`ALTER TABLE public.users DROP CONSTRAINT "${constraintName}"`);
    }
  }

  const pkCheck = await client.query<{ constraint_name: string }>(
    `
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'users'
        AND constraint_type = 'PRIMARY KEY'
      LIMIT 1;
    `,
  );

  if (pkCheck.rowCount === 0) {
    await client.query(`ALTER TABLE public.users ADD CONSTRAINT users_pkey PRIMARY KEY (id)`);
  }

  const uniqueInfo = await client.query<{ constraint_name: string }>(
    `
      SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = 'public'
        AND tc.table_name = 'users'
        AND tc.constraint_type = 'UNIQUE'
        AND kcu.column_name = 'username'
      LIMIT 1;
    `,
  );

  if (uniqueInfo.rowCount > 0) {
    const constraintName = uniqueInfo.rows[0]!.constraint_name;
    if (constraintName !== "users_username_unique") {
      await client.query(
        `ALTER TABLE public.users RENAME CONSTRAINT "${constraintName}" TO users_username_unique`,
      );
    }
  } else {
    await client.query(`ALTER TABLE public.users ADD CONSTRAINT users_username_unique UNIQUE (username)`);
  }
}

async function ensureUserSettingsTable(client: Client | PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.user_settings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
      telegram_bot_token text,
      telegram_chat_id text,
      binance_api_key text,
      binance_api_secret text,
      is_testnet boolean DEFAULT true,
      default_leverage integer DEFAULT 1,
      risk_percent real DEFAULT 2,
      demo_enabled boolean DEFAULT true,
      default_tp_pct numeric(5, 2) DEFAULT 1.00,
      default_sl_pct numeric(5, 2) DEFAULT 0.50,
      created_at timestamp DEFAULT now(),
      updated_at timestamp DEFAULT now()
    );
  `);

  if (!(await columnExists(client, "user_settings", "id"))) {
    await client.query(`ALTER TABLE public.user_settings ADD COLUMN id uuid`);
  }

  const idType = await getColumnType(client, "user_settings", "id");
  if (idType && idType !== "uuid") {
    await client.query(`ALTER TABLE public.user_settings ALTER COLUMN id TYPE uuid USING id::uuid`);
  }

  await client.query(`UPDATE public.user_settings SET id = gen_random_uuid() WHERE id IS NULL`);
  await client.query(`ALTER TABLE public.user_settings ALTER COLUMN id SET DEFAULT gen_random_uuid()`);
  await client.query(`ALTER TABLE public.user_settings ALTER COLUMN id SET NOT NULL`);

  if (!(await columnExists(client, "user_settings", "user_id"))) {
    await client.query(`ALTER TABLE public.user_settings ADD COLUMN user_id uuid`);
  }

  const userIdType = await getColumnType(client, "user_settings", "user_id");
  if (userIdType && userIdType !== "uuid") {
    await client.query(
      `ALTER TABLE public.user_settings ALTER COLUMN user_id TYPE uuid USING user_id::uuid`,
    );
  }

  await client.query(`DELETE FROM public.user_settings WHERE user_id IS NULL`);

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
    )
    DELETE FROM public.user_settings us
    USING ranked r
    WHERE us.id = r.id AND r.rn > 1;
  `);

  await client.query(`ALTER TABLE public.user_settings ALTER COLUMN user_id SET NOT NULL`);
  await client.query(`UPDATE public.user_settings SET created_at = COALESCE(created_at, now())`);
  await client.query(`UPDATE public.user_settings SET updated_at = COALESCE(updated_at, now())`);
  await client.query(`ALTER TABLE public.user_settings ALTER COLUMN created_at SET DEFAULT now()`);
  await client.query(`ALTER TABLE public.user_settings ALTER COLUMN updated_at SET DEFAULT now()`);

  const pkInfo = await client.query<{ constraint_name: string; column_name: string }>(
    `
      SELECT tc.constraint_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = 'public'
        AND tc.table_name = 'user_settings'
        AND tc.constraint_type = 'PRIMARY KEY';
    `,
  );

  if (pkInfo.rowCount > 0) {
    const constraintName = pkInfo.rows[0]!.constraint_name;
    const onlyId = pkInfo.rows.every((row) => row.column_name === "id");
    if (!onlyId) {
      await client.query(`ALTER TABLE public.user_settings DROP CONSTRAINT "${constraintName}"`);
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
    await client.query(`ALTER TABLE public.user_settings ADD CONSTRAINT user_settings_pkey PRIMARY KEY (id)`);
  }

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

  const fkInfo = await client.query<{ constraint_name: string; delete_rule: string; referenced_table: string }>(
    `
      SELECT rc.constraint_name,
             rc.delete_rule,
             tc2.table_name AS referenced_table
      FROM information_schema.referential_constraints rc
      JOIN information_schema.table_constraints tc
        ON rc.constraint_name = tc.constraint_name
       AND rc.constraint_schema = tc.constraint_schema
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
       AND kcu.constraint_schema = tc.constraint_schema
      JOIN information_schema.table_constraints tc2
        ON rc.unique_constraint_name = tc2.constraint_name
       AND rc.unique_constraint_schema = tc2.constraint_schema
      WHERE tc.table_schema = 'public'
        AND tc.table_name = 'user_settings'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'user_id'
      LIMIT 1;
    `,
  );

  if (fkInfo.rowCount > 0) {
    const { constraint_name: constraintName, delete_rule: deleteRule, referenced_table: referencedTable } = fkInfo.rows[0]!;
    if (referencedTable !== "users" || deleteRule !== "CASCADE") {
      await client.query(`ALTER TABLE public.user_settings DROP CONSTRAINT "${constraintName}"`);
    }
  }

  const fkCheck = await client.query<{ constraint_name: string }>(
    `
      SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = 'public'
        AND tc.table_name = 'user_settings'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'user_id'
      LIMIT 1;
    `,
  );

  if (fkCheck.rowCount === 0) {
    await client.query(
      `ALTER TABLE public.user_settings ADD CONSTRAINT user_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE`,
    );
  }
}

async function ensureUuidColumn(
  client: Client | PoolClient,
  tableName: string,
  columnName: string,
  options: { notNull?: boolean; fillWithDemoId?: boolean } = {},
): Promise<void> {
  if (!(await tableExists(client, tableName))) {
    return;
  }

  if (!(await columnExists(client, tableName, columnName))) {
    await client.query(`ALTER TABLE public.${tableName} ADD COLUMN ${columnName} uuid`);
  }

  const columnType = await getColumnType(client, tableName, columnName);
  if (columnType && columnType !== "uuid") {
    await client.query(
      `ALTER TABLE public.${tableName} ALTER COLUMN ${columnName} TYPE uuid USING ${columnName}::uuid`,
    );
  }

  if (options.fillWithDemoId) {
    await client.query(
      `UPDATE public.${tableName} SET ${columnName} = $1::uuid WHERE ${columnName} IS NULL`,
      [DEMO_USER_ID],
    );
  }

  if (options.notNull) {
    await client.query(`ALTER TABLE public.${tableName} ALTER COLUMN ${columnName} SET NOT NULL`);
  }
}

async function ensureAuxiliaryUserColumns(client: Client | PoolClient): Promise<void> {
  await ensureUuidColumn(client, "indicator_configs", "user_id", { notNull: true, fillWithDemoId: true });
  await ensureUuidColumn(client, "positions", "user_id", { notNull: true, fillWithDemoId: true });
  await ensureUuidColumn(client, "closed_positions", "user_id", { notNull: true, fillWithDemoId: true });
}

async function ensureDemoUser(client: Client | PoolClient): Promise<void> {
  if (!(await tableExists(client, "users"))) {
    console.warn("[userSettingsGuard] table public.users missing, skipping demo user upsert.");
    return;
  }

  const [{ rows: demoByIdRows }, { rows: legacyRows }] = await Promise.all([
    client.query<{ id: string }>(
      `SELECT id::text AS id FROM public.users WHERE id = $1::uuid LIMIT 1;`,
      [DEMO_USER_ID],
    ),
    client.query<{ id: string }>(
      `SELECT id::text AS id FROM public.users WHERE username = $1 LIMIT 1;`,
      [DEFAULT_SESSION_USERNAME],
    ),
  ]);

  const existingDemoById = demoByIdRows[0]?.id ?? null;
  const legacyId = legacyRows[0]?.id ?? null;

  const hasUserSettings = await tableExists(client, "user_settings");
  const hasIndicatorConfigs = await tableExists(client, "indicator_configs");
  const hasPositions = await tableExists(client, "positions");
  const hasClosedPositions = await tableExists(client, "closed_positions");

  if (legacyId && legacyId !== DEMO_USER_ID) {
    if (hasUserSettings) {
      const [legacySettings, demoSettings] = await Promise.all([
        client.query<{ exists: boolean }>(
          `SELECT EXISTS(SELECT 1 FROM public.user_settings WHERE user_id = $1::uuid) AS exists;`,
          [legacyId],
        ),
        client.query<{ exists: boolean }>(
          `SELECT EXISTS(SELECT 1 FROM public.user_settings WHERE user_id = $1::uuid) AS exists;`,
          [DEMO_USER_ID],
        ),
      ]);

      if (legacySettings.rows[0]?.exists) {
        if (demoSettings.rows[0]?.exists) {
          await client.query(`DELETE FROM public.user_settings WHERE user_id = $1::uuid`, [legacyId]);
        } else {
          await client.query(
            `UPDATE public.user_settings SET user_id = $1::uuid WHERE user_id = $2::uuid`,
            [DEMO_USER_ID, legacyId],
          );
        }
      }
    }

    if (hasIndicatorConfigs) {
      await client.query(
        `UPDATE public.indicator_configs SET user_id = $1::uuid WHERE user_id = $2::uuid`,
        [DEMO_USER_ID, legacyId],
      );
    }

    if (hasPositions) {
      await client.query(
        `UPDATE public.positions SET user_id = $1::uuid WHERE user_id = $2::uuid`,
        [DEMO_USER_ID, legacyId],
      );
    }

    if (hasClosedPositions) {
      await client.query(
        `UPDATE public.closed_positions SET user_id = $1::uuid WHERE user_id = $2::uuid`,
        [DEMO_USER_ID, legacyId],
      );
    }

    if (existingDemoById) {
      await client.query(`DELETE FROM public.users WHERE id = $1::uuid`, [legacyId]);
    } else {
      await client.query(
        `UPDATE public.users SET id = $1::uuid, username = $2, password = $3 WHERE id = $4::uuid`,
        [DEMO_USER_ID, DEFAULT_SESSION_USERNAME, DEFAULT_SESSION_PASSWORD, legacyId],
      );
    }
  }

  await client.query(
    `
      INSERT INTO public.users (id, username, password)
      VALUES ($1::uuid, $2, $3)
      ON CONFLICT (id) DO UPDATE SET
        username = EXCLUDED.username,
        password = EXCLUDED.password;
    `,
    [DEMO_USER_ID, DEFAULT_SESSION_USERNAME, DEFAULT_SESSION_PASSWORD],
  );

  if (hasUserSettings) {
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
        VALUES (gen_random_uuid(), $1::uuid, true, 1, 2, true, '1.00', '0.50')
        ON CONFLICT (user_id) DO NOTHING;
      `,
      [DEMO_USER_ID],
    );

    await client.query(
      `UPDATE public.user_settings SET updated_at = COALESCE(updated_at, now()) WHERE user_id = $1::uuid`,
      [DEMO_USER_ID],
    );
  }
}

export async function ensureUserSettingsGuard(db: Pool | Client): Promise<void> {
  const isPoolInstance = isPool(db);
  const client = isPoolInstance ? await db.connect() : db;
  const releasable = isPoolInstance ? (client as PoolClient) : null;

  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

    await client.query("BEGIN");
    try {
      await ensureUsersTable(client);
      await ensureUserSettingsTable(client);
      await ensureAuxiliaryUserColumns(client);
      await ensureDemoUser(client);
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

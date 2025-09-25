import type { Client, Pool, PoolClient } from "pg";

const DEFAULT_SESSION_USERNAME = process.env.DEFAULT_USER ?? "demo";
const DEFAULT_SESSION_PASSWORD = process.env.DEFAULT_USER_PASSWORD ?? "demo";
const DEMO_USER_ID = "00000000-0000-0000-0000-000000000001";

type IndexSpec = {
  name: string;
  table: string;
  columns: string[];
  unique?: boolean;
};

type ConstraintType = "p" | "u" | "f" | "c" | "x" | "t" | "e";

function isPool(db: Pool | Client): db is Pool {
  return typeof (db as Pool).connect === "function" && typeof (db as Pool).end === "function";
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function tableExists(client: Client | PoolClient, tableName: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS exists;`,
    [`public.${tableName}`],
  );
  return Boolean(result.rows[0]?.exists);
}

type IndexMetadata = {
  tableName: string;
  columns: string[];
  isUnique: boolean;
  predicate: string | null;
};

async function getIndexMetadata(
  client: Client | PoolClient,
  indexName: string,
): Promise<IndexMetadata | null> {
  const result = await client.query<{
    table_name: string;
    is_unique: boolean;
    predicate: string | null;
    column_name: string;
    ordinality: number;
  }>(
    `
      SELECT
        t.relname AS table_name,
        ix.indisunique AS is_unique,
        pg_get_expr(ix.indpred, ix.indrelid) AS predicate,
        a.attname AS column_name,
        k.ordinality
      FROM pg_class i
      JOIN pg_namespace n ON n.oid = i.relnamespace
      JOIN pg_index ix ON ix.indexrelid = i.oid
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ordinality) ON TRUE
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      WHERE n.nspname = 'public'
        AND i.relname = $1
      ORDER BY k.ordinality;
    `,
    [indexName],
  );

  if (result.rowCount === 0) {
    return null;
  }

  const columns = result.rows
    .sort((left, right) => left.ordinality - right.ordinality)
    .map((row) => row.column_name)
    .filter((column) => column.length > 0);

  const { table_name: tableName, is_unique: isUnique, predicate } = result.rows[0]!;
  return { tableName, columns, isUnique, predicate };
}

async function getConstraintForIndex(client: Client | PoolClient, indexName: string): Promise<string | null> {
  const result = await client.query<{ constraint_name: string }>(
    `
      SELECT c.conname AS constraint_name
      FROM pg_constraint c
      JOIN pg_class i ON i.oid = c.conindid
      JOIN pg_namespace n ON n.oid = i.relnamespace
      WHERE n.nspname = 'public'
        AND i.relname = $1
      LIMIT 1;
    `,
    [indexName],
  );
  return result.rows[0]?.constraint_name ?? null;
}

async function constraintExists(
  client: Client | PoolClient,
  tableName: string,
  constraintName: string,
  type: ConstraintType,
): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = $1
          AND conrelid = $2::regclass
          AND contype = $3
      ) AS exists;
    `,
    [constraintName, `public.${tableName}`, type],
  );
  return Boolean(result.rows[0]?.exists);
}

async function findMatchingUniqueIndex(
  client: Client | PoolClient,
  tableName: string,
  columns: string[],
): Promise<string | null> {
  const result = await client.query<{ index_name: string }>(
    `
      SELECT i.relname AS index_name
      FROM pg_class t
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_index ix ON ix.indrelid = t.oid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ordinality) ON TRUE
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      WHERE n.nspname = 'public'
        AND t.relname = $1
        AND ix.indisunique
        AND ix.indpred IS NULL
      GROUP BY i.relname
      HAVING array_agg(lower(a.attname) ORDER BY k.ordinality) = $2::text[]
      LIMIT 1;
    `,
    [tableName, columns.map((column) => column.toLowerCase())],
  );
  return result.rows[0]?.index_name ?? null;
}

function isDuplicateObjectError(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return code === "42710" || code === "42P07";
}

async function renameIndexIfNeeded(
  client: Client | PoolClient,
  currentName: string,
  desiredName: string,
): Promise<string> {
  if (currentName === desiredName) {
    return currentName;
  }

  const currentMetadata = await getIndexMetadata(client, currentName);
  if (!currentMetadata) {
    return currentName;
  }

  const desiredMetadata = await getIndexMetadata(client, desiredName);
  if (desiredMetadata) {
    console.warn(
      `[userSettingsGuard] target index public.${desiredName} already exists; skipping rename from public.${currentName}.`,
    );
    return currentName;
  }

  try {
    await client.query(
      `ALTER INDEX public.${quoteIdentifier(currentName)} RENAME TO ${quoteIdentifier(desiredName)};`,
    );
    return desiredName;
  } catch (error) {
    if (isDuplicateObjectError(error)) {
      console.warn(
        `[userSettingsGuard] unable to rename index public.${currentName} to ${desiredName}: ${String(
          (error as Error).message ?? error,
        )}`,
      );
      return currentName;
    }
    throw error;
  }
}

async function ensureIndex(
  client: Client | PoolClient,
  { name, table, columns, unique }: IndexSpec,
): Promise<void> {
  if (!(await tableExists(client, table))) {
    console.warn(`[userSettingsGuard] table public.${table} missing, unable to ensure index ${name}.`);
    return;
  }

  const metadata = await getIndexMetadata(client, name);
  const expectedColumns = columns.map((column) => column.toLowerCase());
  const createSql = `${unique ? "CREATE UNIQUE INDEX" : "CREATE INDEX"} IF NOT EXISTS ${quoteIdentifier(
    name,
  )} ON public.${quoteIdentifier(table)}(${columns.map(quoteIdentifier).join(", ")});`;

  if (metadata) {
    const tableMatches = metadata.tableName.toLowerCase() === table.toLowerCase();
    const predicateMatches = metadata.predicate == null;
    const columnsMatch =
      metadata.columns.length === expectedColumns.length &&
      metadata.columns.every((column, index) => column.toLowerCase() === expectedColumns[index]);
    const uniquenessMatches = metadata.isUnique === Boolean(unique);

    if (tableMatches && predicateMatches && columnsMatch && uniquenessMatches) {
      return;
    }

    const attachedConstraint = await getConstraintForIndex(client, name);
    if (attachedConstraint) {
      console.warn(
        `[userSettingsGuard] index public.${name} is attached to constraint ${attachedConstraint}; expected definition mismatch detected, skipping rebuild.`,
      );
      return;
    }

    await client.query(`DROP INDEX IF EXISTS public.${quoteIdentifier(name)};`);
    console.warn(`[userSettingsGuard] rebuilt index public.${name} with canonical definition.`);
  }

  await client.query(createSql);
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

async function ensureUserSettingsUniqueConstraint(client: Client | PoolClient): Promise<void> {
  const tableName = "user_settings";
  const constraintName = "user_settings_user_id_unique";
  const canonicalIndexName = "user_settings_user_id_unique";
  const constraintColumns = ["user_id"];

  if (!(await tableExists(client, tableName))) {
    console.warn(
      `[userSettingsGuard] table public.${tableName} missing, unable to ensure constraint ${constraintName}.`,
    );
    return;
  }

  const existingConstraint = await client.query<{ constraint_name: string }>(
    `
      SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = 'public'
        AND tc.table_name = $1
        AND tc.constraint_type = 'UNIQUE'
        AND kcu.column_name = $2
      LIMIT 1;
    `,
    [tableName, constraintColumns[0]],
  );

  if (existingConstraint.rowCount > 0) {
    const currentName = existingConstraint.rows[0]!.constraint_name;
    if (currentName !== constraintName) {
      try {
        await client.query(
          `ALTER TABLE public.${tableName} RENAME CONSTRAINT ${quoteIdentifier(currentName)} TO ${quoteIdentifier(
            constraintName,
          )};`,
        );
      } catch (error) {
        if (!isDuplicateObjectError(error)) {
          throw error;
        }
        console.warn(
          `[userSettingsGuard] unable to rename constraint ${currentName} on public.${tableName} to ${constraintName}: ${String(
            (error as Error).message ?? error,
          )}`,
        );
      }
    }
    return;
  }

  if (await constraintExists(client, tableName, constraintName, "u")) {
    return;
  }

  let indexName = await findMatchingUniqueIndex(client, tableName, constraintColumns);

  if (!indexName) {
    indexName = "user_settings_user_id_unique_idx";
    await ensureIndex(client, {
      name: indexName,
      table: tableName,
      columns: constraintColumns,
      unique: true,
    });
  }

  try {
    await client.query(
      `ALTER TABLE public.${tableName} ADD CONSTRAINT ${quoteIdentifier(constraintName)} UNIQUE USING INDEX ${quoteIdentifier(
        indexName,
      )};`,
    );
  } catch (error) {
    if (!isDuplicateObjectError(error)) {
      throw error;
    }
    console.warn(
      `[userSettingsGuard] constraint ${constraintName} already exists on public.${tableName}, skipping attach.`,
    );
  }

  await renameIndexIfNeeded(client, indexName, canonicalIndexName);
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

async function ensureClosedPositionsIndexes(client: Client | PoolClient): Promise<void> {
  await ensureIndex(client, {
    name: "idx_closed_positions_symbol_time",
    table: "closed_positions",
    columns: ["symbol", "closed_at"],
  });

  await ensureIndex(client, {
    name: "idx_closed_positions_user",
    table: "closed_positions",
    columns: ["user_id"],
  });
}

async function ensureIndicatorIndexes(client: Client | PoolClient): Promise<void> {
  await ensureIndex(client, {
    name: "idx_indicator_configs_user_name",
    table: "indicator_configs",
    columns: ["user_id", "name"],
    unique: true,
  });
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
        ON CONFLICT ON CONSTRAINT user_settings_user_id_unique DO NOTHING;
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
      await ensureUserSettingsUniqueConstraint(client);
      await ensureAuxiliaryUserColumns(client);
      await ensureIndicatorIndexes(client);
      await ensureClosedPositionsIndexes(client);
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

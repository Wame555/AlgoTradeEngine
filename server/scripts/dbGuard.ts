import type { Client, Pool, PoolClient } from "pg";

const DEFAULT_SESSION_USERNAME = process.env.DEFAULT_USER ?? "demo";
const DEFAULT_SESSION_PASSWORD = process.env.DEFAULT_USER_PASSWORD ?? "demo";
const LEGACY_DEMO_USER_ID = "00000000-0000-0000-0000-000000000001";
const DEMO_EMAIL = "demo@local";

type ColumnMetadata = {
  dataType: string;
  isNullable: boolean;
  defaultValue: string | null;
};

type UniqueConstraintSpec = {
  table: string;
  name: string;
  columns: string[];
};

type IndexSpec = {
  table: string;
  name: string;
  columns: string[];
  unique: boolean;
};

type UniqueIndexInfo = {
  name: string;
  columns: string[];
  attachedConstraint: string | null;
};

type IndexDefinition = {
  tableName: string;
  columns: string[];
  isUnique: boolean;
  hasPredicate: boolean;
};

type PgClient = Client | PoolClient;

function isPool(db: Pool | Client): db is Pool {
  return typeof (db as Pool).connect === "function" && typeof (db as Pool).end === "function";
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function normalizeIdentifier(identifier: string): string {
  return identifier.toLowerCase();
}

function columnsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => normalizeIdentifier(value) === normalizeIdentifier(right[index] ?? ""));
}

async function tableExists(client: PgClient, tableName: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS exists;`,
    [`public.${tableName}`],
  );
  return Boolean(result.rows[0]?.exists);
}

async function getColumnMetadata(client: PgClient, table: string, column: string): Promise<ColumnMetadata | null> {
  const result = await client.query<{
    data_type: string;
    is_nullable: "YES" | "NO";
    column_default: string | null;
  }>(
    `
      SELECT data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2;
    `,
    [table, column],
  );

  if (result.rowCount === 0) {
    return null;
  }

  return {
    dataType: result.rows[0]!.data_type,
    isNullable: result.rows[0]!.is_nullable === "YES",
    defaultValue: result.rows[0]!.column_default ?? null,
  };
}

async function ensureColumn(client: PgClient, table: string, column: string, definitionSql: string): Promise<void> {
  await client.query(
    `ALTER TABLE public.${quoteIdentifier(table)} ADD COLUMN IF NOT EXISTS ${quoteIdentifier(column)} ${definitionSql};`,
  );
}

async function ensureUuidColumn(client: PgClient, table: string, column: string): Promise<void> {
  await ensureColumn(client, table, column, "uuid");
  const metadata = await getColumnMetadata(client, table, column);
  if (!metadata) {
    return;
  }
  if (normalizeIdentifier(metadata.dataType) !== "uuid") {
    await client.query(
      `ALTER TABLE public.${quoteIdentifier(table)} ALTER COLUMN ${quoteIdentifier(column)} TYPE uuid USING ${quoteIdentifier(
        column,
      )}::uuid;`,
    );
  }
}

async function ensureColumnDefault(client: PgClient, table: string, column: string, defaultSql: string): Promise<void> {
  await client.query(
    `ALTER TABLE public.${quoteIdentifier(table)} ALTER COLUMN ${quoteIdentifier(column)} SET DEFAULT ${defaultSql};`,
  );
}

async function ensureNotNull(client: PgClient, table: string, column: string): Promise<void> {
  const result = await client.query<{ has_nulls: boolean }>(
    `
      SELECT EXISTS(
        SELECT 1 FROM public.${quoteIdentifier(table)} WHERE ${quoteIdentifier(column)} IS NULL
      ) AS has_nulls;
    `,
  );
  if (!result.rows[0]?.has_nulls) {
    await client.query(
      `ALTER TABLE public.${quoteIdentifier(table)} ALTER COLUMN ${quoteIdentifier(column)} SET NOT NULL;`,
    );
  }
}

async function getUniqueConstraints(client: PgClient, table: string): Promise<{ name: string; columns: string[] }[]> {
  const result = await client.query<{
    constraint_name: string;
    column_name: string | null;
    ordinal_position: number | null;
  }>(
    `
      SELECT tc.constraint_name, kcu.column_name, kcu.ordinal_position
      FROM information_schema.table_constraints tc
      LEFT JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
       AND tc.table_name = kcu.table_name
      WHERE tc.table_schema = 'public'
        AND tc.table_name = $1
        AND tc.constraint_type = 'UNIQUE'
      ORDER BY tc.constraint_name, kcu.ordinal_position;
    `,
    [table],
  );

  const map = new Map<string, string[]>();
  for (const row of result.rows) {
    const columns = map.get(row.constraint_name) ?? [];
    if (row.column_name) {
      columns.push(row.column_name);
    }
    map.set(row.constraint_name, columns);
  }

  return Array.from(map.entries()).map(([name, columns]) => ({
    name,
    columns: columns.sort((left, right) => left.localeCompare(right)),
  }));
}

async function findMatchingUniqueIndex(client: PgClient, table: string, columns: string[]): Promise<UniqueIndexInfo | null> {
  const result = await client.query<{
    index_name: string;
    column_name: string;
    ordinality: number;
    attached_constraint: string | null;
  }>(
    `
      SELECT
        i.relname AS index_name,
        a.attname AS column_name,
        k.ordinality,
        con.conname AS attached_constraint
      FROM pg_class t
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_index ix ON ix.indrelid = t.oid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ordinality) ON TRUE
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      LEFT JOIN pg_constraint con ON con.conindid = i.oid AND con.contype = 'u'
      WHERE n.nspname = 'public'
        AND t.relname = $1
        AND ix.indisunique
        AND ix.indpred IS NULL
      ORDER BY i.relname, k.ordinality;
    `,
    [table],
  );

  const grouped = new Map<string, { columns: string[]; attachedConstraint: string | null }>();
  for (const row of result.rows) {
    const entry = grouped.get(row.index_name) ?? { columns: [], attachedConstraint: row.attached_constraint };
    entry.columns.push(row.column_name);
    entry.attachedConstraint = row.attached_constraint;
    grouped.set(row.index_name, entry);
  }

  const normalized = columns
    .map((column) => normalizeIdentifier(column))
    .sort((left, right) => left.localeCompare(right));

  for (const [name, info] of Array.from(grouped.entries())) {
    const candidateColumns = info.columns
      .slice()
      .sort((left: string, right: string) => left.localeCompare(right))
      .map((column: string) => normalizeIdentifier(column));
    if (columnsEqual(candidateColumns, normalized)) {
      return { name, columns: info.columns, attachedConstraint: info.attachedConstraint };
    }
  }

  return null;
}

async function ensureUniqueConstraint(client: PgClient, spec: UniqueConstraintSpec): Promise<void> {
  if (!(await tableExists(client, spec.table))) {
    console.warn(
      `[dbGuard] table public.${spec.table} missing, unable to ensure unique constraint ${spec.name}.`,
    );
    return;
  }

  const constraints = await getUniqueConstraints(client, spec.table);
  const normalizedColumns = spec.columns.map((column) => normalizeIdentifier(column)).sort();

  const canonical = constraints.find((constraint) =>
    columnsEqual(
      constraint.columns.map((column) => normalizeIdentifier(column)).sort(),
      normalizedColumns,
    ),
  );

  if (canonical) {
    if (canonical.name !== spec.name) {
      console.warn(
        `[dbGuard] found unique constraint ${canonical.name} on public.${spec.table}; expected ${spec.name}. Manual remediation required.`,
      );
    }
    return;
  }

  const conflictingConstraint = constraints.find(
    (constraint) => normalizeIdentifier(constraint.name) === normalizeIdentifier(spec.name),
  );
  if (conflictingConstraint) {
    console.warn(
      `[dbGuard] constraint ${spec.name} already exists on public.${spec.table} but covers unexpected columns (${conflictingConstraint.columns.join(", ")}). Manual remediation required.`,
    );
    return;
  }

  const canonicalIndexResult = await client.query<{ exists: boolean }>(
    `
      SELECT EXISTS(
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = $1
          AND indexname = $2
      ) AS exists;
    `,
    [spec.table, spec.name],
  );

  if (canonicalIndexResult.rows[0]?.exists) {
    console.warn(
      `[dbGuard] index public.${spec.name} exists without matching constraint on public.${spec.table}; manual cleanup required before creating constraint.`,
    );
    return;
  }

  const matchingIndex = await findMatchingUniqueIndex(client, spec.table, spec.columns);
  if (matchingIndex) {
    if (matchingIndex.attachedConstraint) {
      return;
    }
    try {
      await client.query(
        `ALTER TABLE public.${quoteIdentifier(spec.table)} ADD CONSTRAINT ${quoteIdentifier(spec.name)} UNIQUE USING INDEX ${quoteIdentifier(
          matchingIndex.name,
        )};`,
      );
      return;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "42710" && code !== "42P07") {
        throw error;
      }
      return;
    }
  }

  await client.query(
    `ALTER TABLE public.${quoteIdentifier(spec.table)} ADD CONSTRAINT ${quoteIdentifier(spec.name)} UNIQUE (${spec.columns
      .map(quoteIdentifier)
      .join(", ")});`,
  );
}

async function getIndexDefinition(client: PgClient, indexName: string): Promise<IndexDefinition | null> {
  const result = await client.query<{
    table_name: string;
    column_name: string;
    ordinality: number;
    is_unique: boolean;
    has_predicate: boolean;
  }>(
    `
      SELECT
        t.relname AS table_name,
        a.attname AS column_name,
        k.ordinality,
        ix.indisunique AS is_unique,
        ix.indpred IS NOT NULL AS has_predicate
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

  return {
    tableName: result.rows[0]!.table_name,
    columns: result.rows.map((row) => row.column_name),
    isUnique: result.rows[0]!.is_unique,
    hasPredicate: result.rows[0]!.has_predicate,
  };
}

async function ensureIndex(client: PgClient, spec: IndexSpec): Promise<void> {
  const definition = await getIndexDefinition(client, spec.name);

  if (definition) {
    const tableMatches = normalizeIdentifier(definition.tableName) === normalizeIdentifier(spec.table);
    const uniquenessMatches = definition.isUnique === spec.unique;
    const predicateMatches = !definition.hasPredicate;
    const columnMatches = columnsEqual(
      definition.columns.map((column) => normalizeIdentifier(column)),
      spec.columns.map((column) => normalizeIdentifier(column)),
    );

    if (!tableMatches || !uniquenessMatches || !predicateMatches || !columnMatches) {
      console.warn(
        `[dbGuard] index public.${spec.name} exists with unexpected definition; manual remediation required.`,
      );
    }
    return;
  }

  if (!(await tableExists(client, spec.table))) {
    console.warn(`[dbGuard] table public.${spec.table} missing, unable to create index ${spec.name}.`);
    return;
  }

  const columnChecks = await Promise.all(
    spec.columns.map(async (column) => (await getColumnMetadata(client, spec.table, column)) != null),
  );
  if (columnChecks.some((exists) => !exists)) {
    console.warn(
      `[dbGuard] skipping creation of index public.${spec.name} because required columns are missing on public.${spec.table}.`,
    );
    return;
  }

  await client.query(
    `CREATE ${spec.unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${quoteIdentifier(spec.name)} ON public.${quoteIdentifier(
      spec.table,
    )} (${spec.columns.map(quoteIdentifier).join(", ")});`,
  );
}

async function ensureUsersTable(client: PgClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      username text NOT NULL UNIQUE,
      password text NOT NULL,
      created_at timestamptz DEFAULT now()
    );
  `);

  await ensureUuidColumn(client, "users", "id");
  await client.query(`UPDATE public.users SET id = gen_random_uuid() WHERE id IS NULL;`);
  await ensureColumnDefault(client, "users", "id", "gen_random_uuid()");
  await ensureNotNull(client, "users", "id");

  await ensureColumn(client, "users", "email", "varchar(255)");
  await ensureColumn(client, "users", "username", "text");
  await ensureNotNull(client, "users", "username");
  await ensureColumn(client, "users", "password", "text");
  await ensureNotNull(client, "users", "password");
  await ensureColumn(client, "users", "created_at", "timestamptz DEFAULT now()");
  await ensureColumnDefault(client, "users", "created_at", "now()");

  await ensureUniqueConstraint(client, {
    table: "users",
    name: "users_email_uniq",
    columns: ["email"],
  });
  await ensureUniqueConstraint(client, {
    table: "users",
    name: "users_username_uniq",
    columns: ["username"],
  });
}

async function ensureUserSettingsTable(client: PgClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.user_settings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
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

  await ensureUuidColumn(client, "user_settings", "id");
  await client.query(`UPDATE public.user_settings SET id = gen_random_uuid() WHERE id IS NULL;`);
  await ensureColumnDefault(client, "user_settings", "id", "gen_random_uuid()");
  await ensureNotNull(client, "user_settings", "id");

  await ensureUuidColumn(client, "user_settings", "user_id");
  await client.query(`DELETE FROM public.user_settings WHERE user_id IS NULL;`);
  await ensureNotNull(client, "user_settings", "user_id");

  await ensureColumn(client, "user_settings", "telegram_bot_token", "text");
  await ensureColumn(client, "user_settings", "telegram_chat_id", "text");
  await ensureColumn(client, "user_settings", "binance_api_key", "text");
  await ensureColumn(client, "user_settings", "binance_api_secret", "text");
  await ensureColumn(client, "user_settings", "is_testnet", "boolean DEFAULT true");
  await client.query(`UPDATE public.user_settings SET is_testnet = true WHERE is_testnet IS NULL;`);
  await ensureColumnDefault(client, "user_settings", "is_testnet", "true");
  await ensureNotNull(client, "user_settings", "is_testnet");

  await ensureColumn(client, "user_settings", "default_leverage", "integer DEFAULT 1");
  await client.query(`UPDATE public.user_settings SET default_leverage = 1 WHERE default_leverage IS NULL;`);
  await ensureColumnDefault(client, "user_settings", "default_leverage", "1");
  await ensureNotNull(client, "user_settings", "default_leverage");

  await ensureColumn(client, "user_settings", "risk_percent", "real DEFAULT 2");
  await client.query(`UPDATE public.user_settings SET risk_percent = 2 WHERE risk_percent IS NULL;`);
  await ensureColumnDefault(client, "user_settings", "risk_percent", "2");
  await ensureNotNull(client, "user_settings", "risk_percent");

  await ensureColumn(client, "user_settings", "demo_enabled", "boolean DEFAULT true");
  await client.query(`UPDATE public.user_settings SET demo_enabled = true WHERE demo_enabled IS NULL;`);
  await ensureColumnDefault(client, "user_settings", "demo_enabled", "true");
  await ensureNotNull(client, "user_settings", "demo_enabled");

  await ensureColumn(client, "user_settings", "default_tp_pct", "numeric(5, 2) DEFAULT 1.00");
  await client.query(`UPDATE public.user_settings SET default_tp_pct = '1.00' WHERE default_tp_pct IS NULL;`);
  await ensureColumnDefault(client, "user_settings", "default_tp_pct", "1.00");
  await ensureNotNull(client, "user_settings", "default_tp_pct");

  await ensureColumn(client, "user_settings", "default_sl_pct", "numeric(5, 2) DEFAULT 0.50");
  await client.query(`UPDATE public.user_settings SET default_sl_pct = '0.50' WHERE default_sl_pct IS NULL;`);
  await ensureColumnDefault(client, "user_settings", "default_sl_pct", "0.50");
  await ensureNotNull(client, "user_settings", "default_sl_pct");

  await ensureColumn(client, "user_settings", "created_at", "timestamp DEFAULT now()");
  await client.query(`UPDATE public.user_settings SET created_at = COALESCE(created_at, now());`);
  await ensureColumnDefault(client, "user_settings", "created_at", "now()");

  await ensureColumn(client, "user_settings", "updated_at", "timestamp DEFAULT now()");
  await client.query(`UPDATE public.user_settings SET updated_at = COALESCE(updated_at, now());`);
  await ensureColumnDefault(client, "user_settings", "updated_at", "now()");

  await client.query(`
    WITH ranked AS (
      SELECT
        id,
        row_number() OVER (
          PARTITION BY user_id
          ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id ASC
        ) AS rn
      FROM public.user_settings
    )
    DELETE FROM public.user_settings us
    USING ranked r
    WHERE us.id = r.id AND r.rn > 1;
  `);

  await ensureUniqueConstraint(client, {
    table: "user_settings",
    name: "user_settings_user_id_uniq",
    columns: ["user_id"],
  });
}

async function ensureIndicatorConfigsArtifacts(client: PgClient): Promise<void> {
  if (!(await tableExists(client, "indicator_configs"))) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.indicator_configs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        name text NOT NULL,
        payload jsonb DEFAULT '{}'::jsonb,
        created_at timestamptz DEFAULT now()
      );
    `);
  }

  await ensureUuidColumn(client, "indicator_configs", "id");
  await ensureUuidColumn(client, "indicator_configs", "user_id");
  await ensureColumn(client, "indicator_configs", "name", "text");
  await ensureNotNull(client, "indicator_configs", "name");
  await ensureColumn(client, "indicator_configs", "payload", "jsonb DEFAULT '{}'::jsonb");
  await ensureColumnDefault(client, "indicator_configs", "payload", "'{}'::jsonb");
  await ensureColumn(client, "indicator_configs", "created_at", "timestamptz DEFAULT now()");
  await ensureColumnDefault(client, "indicator_configs", "created_at", "now()");
  await ensureColumn(client, "indicator_configs", "type", "text DEFAULT 'GENERIC'");
  await ensureColumnDefault(client, "indicator_configs", "type", "'GENERIC'");
  await ensureNotNull(client, "indicator_configs", "type");

  await ensureIndex(client, {
    table: "indicator_configs",
    name: "idx_indicator_configs_user_name",
    columns: ["user_id", "name"],
    unique: true,
  });
}

async function ensureClosedPositionsIndexes(client: PgClient): Promise<void> {
  if (!(await tableExists(client, "closed_positions"))) {
    return;
  }

  await ensureIndex(client, {
    table: "closed_positions",
    name: "idx_closed_positions_symbol_time",
    columns: ["symbol", "closed_at"],
    unique: false,
  });

  await ensureIndex(client, {
    table: "closed_positions",
    name: "idx_closed_positions_user",
    columns: ["user_id"],
    unique: false,
  });
}

async function ensurePairTimeframesArtifacts(client: PgClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.pair_timeframes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      symbol text,
      timeframe text,
      created_at timestamptz DEFAULT now()
    );
  `);

  await ensureUuidColumn(client, "pair_timeframes", "id");
  await ensureColumnDefault(client, "pair_timeframes", "id", "gen_random_uuid()");
  await ensureColumn(client, "pair_timeframes", "symbol", "text");
  await ensureColumn(client, "pair_timeframes", "timeframe", "text");
  await ensureColumn(client, "pair_timeframes", "created_at", "timestamptz DEFAULT now()");
  await ensureColumnDefault(client, "pair_timeframes", "created_at", "now()");

  const hasTfColumn = await getColumnMetadata(client, "pair_timeframes", "tf");
  if (hasTfColumn) {
    await client.query(
      `UPDATE public.pair_timeframes SET timeframe = CASE WHEN timeframe IS NULL THEN tf ELSE timeframe END;`,
    );
    await client.query(`ALTER TABLE public.pair_timeframes DROP COLUMN IF EXISTS tf;`);
  }

  const nullTimeframes = await client.query<{ has_nulls: boolean }>(
    `
      SELECT EXISTS(
        SELECT 1 FROM public.pair_timeframes WHERE timeframe IS NULL
      ) AS has_nulls;
    `,
  );
  if (!nullTimeframes.rows[0]?.has_nulls) {
    await client.query(`ALTER TABLE public.pair_timeframes ALTER COLUMN timeframe SET NOT NULL;`);
  }

  const nullSymbols = await client.query<{ has_nulls: boolean }>(
    `
      SELECT EXISTS(
        SELECT 1 FROM public.pair_timeframes WHERE symbol IS NULL
      ) AS has_nulls;
    `,
  );
  if (!nullSymbols.rows[0]?.has_nulls) {
    await client.query(`ALTER TABLE public.pair_timeframes ALTER COLUMN symbol SET NOT NULL;`);
  }

  await ensureIndex(client, {
    table: "pair_timeframes",
    name: "pair_timeframes_symbol_timeframe_unique",
    columns: ["symbol", "timeframe"],
    unique: true,
  });
}

async function ensureTradingPairsColumns(client: PgClient): Promise<void> {
  if (!(await tableExists(client, "trading_pairs"))) {
    return;
  }

  await ensureColumn(client, "trading_pairs", "min_qty", "numeric(18, 8)");
  await ensureColumn(client, "trading_pairs", "min_notional", "numeric(18, 8)");
  await ensureColumn(client, "trading_pairs", "step_size", "numeric(18, 8)");
  await ensureColumn(client, "trading_pairs", "tick_size", "numeric(18, 8)");

  await ensureUniqueConstraint(client, {
    table: "trading_pairs",
    name: "trading_pairs_symbol_uniq",
    columns: ["symbol"],
  });
}

async function ensureDemoUser(client: PgClient): Promise<void> {
  if (!(await tableExists(client, "users"))) {
    return;
  }

  const demoByEmail = await client.query<{ id: string }>(
    `SELECT id::text AS id FROM public.users WHERE email = $1 LIMIT 1;`,
    [DEMO_EMAIL],
  );
  const demoEmailId = demoByEmail.rows[0]?.id ?? null;

  const legacyById = await client.query<{ id: string }>(
    `SELECT id::text AS id FROM public.users WHERE id = $1::uuid LIMIT 1;`,
    [LEGACY_DEMO_USER_ID],
  );
  const legacyId = legacyById.rows[0]?.id ?? null;

  const legacyByUsername = await client.query<{ id: string }>(
    `SELECT id::text AS id FROM public.users WHERE username = $1 LIMIT 1;`,
    [DEFAULT_SESSION_USERNAME],
  );
  const legacyUsernameId = legacyByUsername.rows[0]?.id ?? null;

  const candidateForEmail = demoEmailId ?? legacyUsernameId ?? legacyId ?? null;
  if (!demoEmailId && candidateForEmail) {
    await client.query(
      `UPDATE public.users SET email = $1, username = $2, password = $3 WHERE id = $4::uuid;`,
      [DEMO_EMAIL, DEFAULT_SESSION_USERNAME, DEFAULT_SESSION_PASSWORD, candidateForEmail],
    );
  }

  const upsertResult = await client.query<{ id: string }>(
    `
      INSERT INTO public.users (email, username, password)
      VALUES ($1, $2, $3)
      ON CONFLICT ON CONSTRAINT users_email_uniq DO UPDATE
      SET
        username = EXCLUDED.username,
        password = EXCLUDED.password
      RETURNING id::text AS id;
    `,
    [DEMO_EMAIL, DEFAULT_SESSION_USERNAME, DEFAULT_SESSION_PASSWORD],
  );

  const demoUserId =
    upsertResult.rows[0]?.id ??
    demoEmailId ??
    legacyUsernameId ??
    legacyId ??
    null;

  if (!demoUserId) {
    throw new Error("[ensureDemoUser] failed to resolve demo user identifier");
  }

  await client.query(
    `UPDATE public.users SET email = $1, username = $2, password = $3 WHERE id = $4::uuid;`,
    [DEMO_EMAIL, DEFAULT_SESSION_USERNAME, DEFAULT_SESSION_PASSWORD, demoUserId],
  );

  const legacyCandidates = new Set<string>();
  for (const candidate of [legacyId, legacyUsernameId]) {
    if (candidate && candidate !== demoUserId) {
      legacyCandidates.add(candidate);
    }
  }

  const hasUserSettings = await tableExists(client, "user_settings");
  const hasIndicatorConfigs = await tableExists(client, "indicator_configs");
  const hasPositions = await tableExists(client, "positions");
  const hasClosedPositions = await tableExists(client, "closed_positions");

  for (const legacy of Array.from(legacyCandidates)) {
    if (hasUserSettings) {
      await client.query(
        `UPDATE public.user_settings SET user_id = $1::uuid WHERE user_id = $2::uuid;`,
        [demoUserId, legacy],
      );
    }

    if (hasIndicatorConfigs) {
      await client.query(
        `UPDATE public.indicator_configs SET user_id = $1::uuid WHERE user_id = $2::uuid;`,
        [demoUserId, legacy],
      );
    }

    if (hasPositions) {
      await client.query(
        `UPDATE public.positions SET user_id = $1::uuid WHERE user_id = $2::uuid;`,
        [demoUserId, legacy],
      );
    }

    if (hasClosedPositions) {
      await client.query(
        `UPDATE public.closed_positions SET user_id = $1::uuid WHERE user_id = $2::uuid;`,
        [demoUserId, legacy],
      );
    }

    await client.query(
      `DELETE FROM public.users WHERE id = $1::uuid AND id <> $2::uuid;`,
      [legacy, demoUserId],
    );
  }

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
        VALUES (gen_random_uuid(), $1::uuid, true, 1, 2, true, 1.00, 0.50)
        ON CONFLICT ON CONSTRAINT user_settings_user_id_uniq DO UPDATE
        SET
          demo_enabled = EXCLUDED.demo_enabled,
          default_tp_pct = COALESCE(EXCLUDED.default_tp_pct, user_settings.default_tp_pct),
          default_sl_pct = COALESCE(EXCLUDED.default_sl_pct, user_settings.default_sl_pct),
          is_testnet = COALESCE(EXCLUDED.is_testnet, user_settings.is_testnet),
          default_leverage = COALESCE(EXCLUDED.default_leverage, user_settings.default_leverage),
          risk_percent = COALESCE(EXCLUDED.risk_percent, user_settings.risk_percent);
      `,
      [demoUserId],
    );

    await client.query(
      `UPDATE public.user_settings SET updated_at = COALESCE(updated_at, now()) WHERE user_id = $1::uuid;`,
      [demoUserId],
    );
  }
}

function isConnectionError(error: unknown): boolean {
  const errors = error instanceof AggregateError ? Array.from(error.errors) : [error];
  return errors.some((candidate) => {
    const code = (candidate as { code?: string }).code;
    return code === "ECONNREFUSED" || code === "57P03";
  });
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export async function ensureUserSettingsGuard(db: Pool | Client): Promise<void> {
  const usingPool = isPool(db);
  let client: PgClient;

  try {
    client = usingPool ? await (db as Pool).connect() : (db as Client);
  } catch (error) {
    if (isConnectionError(error)) {
      console.error(
        `[userSettingsGuard] unable to obtain database connection: ${extractErrorMessage(error)}`,
      );
    }
    throw error;
  }

  const releasable: PoolClient | null = usingPool ? (client as PoolClient) : null;

  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

    await client.query("BEGIN");
    try {
      await ensureUsersTable(client);
      await ensureUserSettingsTable(client);
      await ensureIndicatorConfigsArtifacts(client);
      await ensureClosedPositionsIndexes(client);
      await ensurePairTimeframesArtifacts(client);
      await ensureTradingPairsColumns(client);
      await ensureDemoUser(client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } catch (error) {
    if (isConnectionError(error)) {
      console.error(
        `[userSettingsGuard] database self-heal aborted due to connection failure: ${extractErrorMessage(error)}`,
      );
    }
    throw error;
  } finally {
    if (releasable) {
      releasable.release();
    }
  }
}

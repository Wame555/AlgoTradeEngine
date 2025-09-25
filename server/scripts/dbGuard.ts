import type { Client, Pool, PoolClient } from "pg";

const DEFAULT_SESSION_USERNAME = process.env.DEFAULT_USER ?? "demo";
const DEFAULT_SESSION_PASSWORD = process.env.DEFAULT_USER_PASSWORD ?? "demo";
const DEMO_USER_ID = "00000000-0000-0000-0000-000000000001";

export type IndexSpec = {
  name: string;
  table: string;
  columns: string[];
  unique?: boolean;
};

type ConstraintKind = "PRIMARY KEY" | "UNIQUE";

type ConstraintInfo = {
  name: string;
  columns: string[];
  type: ConstraintKind;
};

type ConstraintTypeLetter = "p" | "u" | "f" | "c" | "x" | "t" | "e";

type ColumnMetadata = {
  dataType: string;
  isNullable: boolean;
  columnDefault: string | null;
};

type IndexMetadata = {
  tableName: string;
  columns: string[];
  isUnique: boolean;
  predicate: string | null;
};

type SchemaInspector = {
  tableExists: (tableName: string) => Promise<boolean>;
  getColumns: (tableName: string) => Promise<Map<string, ColumnMetadata>>;
  invalidateTable: (tableName: string) => void;
  getIndexMetadata: (indexName: string) => Promise<IndexMetadata | null>;
  invalidateIndex: (indexName: string) => void;
  clear: () => void;
};

type GuardContext = {
  client: Client | PoolClient;
  schema: SchemaInspector;
};

function isPool(db: Pool | Client): db is Pool {
  return typeof (db as Pool).connect === "function" && typeof (db as Pool).end === "function";
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function normalizeName(value: string): string {
  return value.toLowerCase();
}

function columnsMatch(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((column, index) => normalizeName(column) === normalizeName(right[index] ?? ""));
}

function normalizeDefault(value: string | null): string | null {
  if (!value) {
    return null;
  }
  return value
    .replace(/::[a-z_\s]+/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function defaultMatches(value: string | null, expectations: string[]): boolean {
  const normalized = normalizeDefault(value);
  if (!normalized) {
    return false;
  }
  return expectations.some((expectation) => normalized.includes(expectation.toLowerCase()));
}
function createSchemaInspector(client: Client | PoolClient): SchemaInspector {
  const tableExistsCache = new Map<string, boolean>();
  const columnCache = new Map<string, Map<string, ColumnMetadata>>();
  const indexCache = new Map<string, IndexMetadata | null>();

  const normalizeTableKey = (tableName: string) => normalizeName(tableName);
  const normalizeIndexKey = (indexName: string) => normalizeName(indexName);

  async function tableExists(tableName: string): Promise<boolean> {
    const cacheKey = normalizeTableKey(tableName);
    if (tableExistsCache.has(cacheKey)) {
      return tableExistsCache.get(cacheKey)!;
    }
    const result = await client.query<{ exists: boolean }>(
      `SELECT to_regclass($1) IS NOT NULL AS exists;`,
      [`public.${tableName}`],
    );
    const exists = Boolean(result.rows[0]?.exists);
    tableExistsCache.set(cacheKey, exists);
    return exists;
  }

  async function getColumns(tableName: string): Promise<Map<string, ColumnMetadata>> {
    const cacheKey = normalizeTableKey(tableName);
    if (columnCache.has(cacheKey)) {
      return columnCache.get(cacheKey)!;
    }

    if (!(await tableExists(tableName))) {
      const empty = new Map<string, ColumnMetadata>();
      columnCache.set(cacheKey, empty);
      return empty;
    }

    const result = await client.query<{
      column_name: string;
      data_type: string;
      is_nullable: "YES" | "NO";
      column_default: string | null;
    }>(
      `
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1;
      `,
      [tableName],
    );

    const metadata = new Map<string, ColumnMetadata>();
    for (const row of result.rows) {
      metadata.set(row.column_name, {
        dataType: row.data_type,
        isNullable: row.is_nullable === "YES",
        columnDefault: row.column_default ?? null,
      });
    }

    columnCache.set(cacheKey, metadata);
    return metadata;
  }

  async function getIndexMetadata(indexName: string): Promise<IndexMetadata | null> {
    const cacheKey = normalizeIndexKey(indexName);
    if (indexCache.has(cacheKey)) {
      return indexCache.get(cacheKey)!;
    }

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
      indexCache.set(cacheKey, null);
      return null;
    }

    const columns = result.rows
      .sort((left, right) => left.ordinality - right.ordinality)
      .map((row) => row.column_name)
      .filter((column) => column.length > 0);
    const { table_name: tableName, is_unique: isUnique, predicate } = result.rows[0]!;
    const metadata: IndexMetadata = { tableName, columns, isUnique, predicate };
    indexCache.set(cacheKey, metadata);
    return metadata;
  }

  function invalidateTable(tableName: string): void {
    const cacheKey = normalizeTableKey(tableName);
    tableExistsCache.delete(cacheKey);
    columnCache.delete(cacheKey);
    indexCache.forEach((metadata, indexKey) => {
      if (metadata && normalizeTableKey(metadata.tableName) === cacheKey) {
        indexCache.delete(indexKey);
      }
    });
  }

  function invalidateIndex(indexName: string): void {
    indexCache.delete(normalizeIndexKey(indexName));
  }

  function clear(): void {
    tableExistsCache.clear();
    columnCache.clear();
    indexCache.clear();
  }

  return { tableExists, getColumns, invalidateTable, getIndexMetadata, invalidateIndex, clear };
}
async function getConstraints(
  context: GuardContext,
  tableName: string,
  type: ConstraintKind,
): Promise<ConstraintInfo[]> {
  const { client } = context;
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
        AND tc.constraint_type = $2
      ORDER BY tc.constraint_name, kcu.ordinal_position;
    `,
    [tableName, type],
  );

  const grouped = new Map<string, { type: ConstraintKind; columns: { name: string; ordinal: number }[] }>();
  for (const row of result.rows) {
    const entry = grouped.get(row.constraint_name) ?? {
      type,
      columns: [],
    };
    if (row.column_name) {
      entry.columns.push({ name: row.column_name, ordinal: row.ordinal_position ?? Number.MAX_SAFE_INTEGER });
    }
    grouped.set(row.constraint_name, entry);
  }

  return Array.from(grouped.entries()).map(([name, details]) => ({
    name,
    type: details.type,
    columns: details.columns
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((column) => column.name),
  }));
}

async function dropConstraint(context: GuardContext, tableName: string, constraintName: string): Promise<void> {
  await context.client.query(
    `ALTER TABLE public.${quoteIdentifier(tableName)} DROP CONSTRAINT ${quoteIdentifier(constraintName)};`,
  );
  context.schema.invalidateTable(tableName);
  context.schema.invalidateIndex(constraintName);
}

async function renameConstraint(
  context: GuardContext,
  tableName: string,
  currentName: string,
  desiredName: string,
): Promise<void> {
  if (currentName === desiredName) {
    return;
  }
  await context.client.query(
    `ALTER TABLE public.${quoteIdentifier(tableName)} RENAME CONSTRAINT ${quoteIdentifier(currentName)} TO ${quoteIdentifier(
      desiredName,
    )};`,
  );
  context.schema.invalidateIndex(currentName);
  context.schema.invalidateIndex(desiredName);
}

async function tableExists(context: GuardContext, tableName: string): Promise<boolean> {
  return context.schema.tableExists(tableName);
}

async function columnExists(context: GuardContext, tableName: string, columnName: string): Promise<boolean> {
  const columns = await context.schema.getColumns(tableName);
  return columns.has(columnName);
}

async function ensureColumnExists(
  context: GuardContext,
  tableName: string,
  columnName: string,
  definitionSql: string,
): Promise<void> {
  if (!(await tableExists(context, tableName))) {
    return;
  }
  const columns = await context.schema.getColumns(tableName);
  if (!columns.has(columnName)) {
    await context.client.query(
      `ALTER TABLE public.${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier(columnName)} ${definitionSql};`,
    );
    context.schema.invalidateTable(tableName);
  }
}

async function ensureColumnType(
  context: GuardContext,
  tableName: string,
  columnName: string,
  expectedType: string,
  usingExpression?: string,
): Promise<void> {
  if (!(await tableExists(context, tableName))) {
    return;
  }
  const columns = await context.schema.getColumns(tableName);
  const column = columns.get(columnName);
  if (!column) {
    return;
  }
  if (normalizeName(column.dataType) !== normalizeName(expectedType)) {
    const using = usingExpression ?? `${quoteIdentifier(columnName)}::${expectedType}`;
    await context.client.query(
      `ALTER TABLE public.${quoteIdentifier(tableName)} ALTER COLUMN ${quoteIdentifier(columnName)} TYPE ${expectedType} USING ${using};`,
    );
    context.schema.invalidateTable(tableName);
  }
}

async function ensureColumnDefault(
  context: GuardContext,
  tableName: string,
  columnName: string,
  defaultSql: string,
  matchers: string[] = [defaultSql],
): Promise<void> {
  if (!(await tableExists(context, tableName))) {
    return;
  }
  const columns = await context.schema.getColumns(tableName);
  const column = columns.get(columnName);
  if (!column) {
    return;
  }
  if (!defaultMatches(column.columnDefault, matchers)) {
    await context.client.query(
      `ALTER TABLE public.${quoteIdentifier(tableName)} ALTER COLUMN ${quoteIdentifier(columnName)} SET DEFAULT ${defaultSql};`,
    );
    context.schema.invalidateTable(tableName);
  }
}

async function ensureColumnNotNull(
  context: GuardContext,
  tableName: string,
  columnName: string,
  options: { skipIfNullsExist?: boolean } = {},
): Promise<void> {
  if (!(await tableExists(context, tableName))) {
    return;
  }

  const columns = await context.schema.getColumns(tableName);
  const column = columns.get(columnName);
  if (!column || !column.isNullable) {
    return;
  }

  if (options.skipIfNullsExist) {
    const result = await context.client.query<{ has_nulls: boolean }>(
      `
        SELECT EXISTS(
          SELECT 1
          FROM public.${quoteIdentifier(tableName)}
          WHERE ${quoteIdentifier(columnName)} IS NULL
        ) AS has_nulls;
      `,
    );
    if (result.rows[0]?.has_nulls) {
      console.warn(
        `[userSettingsGuard] skipping NOT NULL enforcement for public.${tableName}.${columnName} because NULL values exist.`,
      );
      return;
    }
  }

  await context.client.query(
    `ALTER TABLE public.${quoteIdentifier(tableName)} ALTER COLUMN ${quoteIdentifier(columnName)} SET NOT NULL;`,
  );
  context.schema.invalidateTable(tableName);
}

async function ensurePrimaryKey(
  context: GuardContext,
  tableName: string,
  constraintName: string,
  columns: string[],
): Promise<void> {
  if (!(await tableExists(context, tableName))) {
    return;
  }
  const constraints = await getConstraints(context, tableName, "PRIMARY KEY");
  const canonical = constraints.find((constraint) => columnsMatch(constraint.columns, columns));

  for (const constraint of constraints) {
    if (!columnsMatch(constraint.columns, columns)) {
      await dropConstraint(context, tableName, constraint.name);
    }
  }

  if (!canonical) {
    await context.client.query(
      `ALTER TABLE public.${quoteIdentifier(tableName)} ADD CONSTRAINT ${quoteIdentifier(constraintName)} PRIMARY KEY (${columns
        .map(quoteIdentifier)
        .join(", ")});`,
    );
    context.schema.invalidateTable(tableName);
  } else if (canonical.name !== constraintName) {
    await renameConstraint(context, tableName, canonical.name, constraintName);
  }
}
async function getConstraintName(
  context: GuardContext,
  tableName: string,
  constraintName: string,
  type: ConstraintTypeLetter,
): Promise<string | null> {
  const result = await context.client.query<{ constraint_name: string }>(
    `
      SELECT c.conname AS constraint_name
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = $1
        AND c.conname = $2
        AND c.contype = $3
      LIMIT 1;
    `,
    [tableName, constraintName, type],
  );
  return result.rows[0]?.constraint_name ?? null;
}

async function constraintExists(
  context: GuardContext,
  tableName: string,
  constraintName: string,
  type: ConstraintTypeLetter,
): Promise<boolean> {
  return (await getConstraintName(context, tableName, constraintName, type)) != null;
}

async function findMatchingUniqueIndex(
  context: GuardContext,
  tableName: string,
  columns: string[],
): Promise<string | null> {
  const result = await context.client.query<{ index_name: string }>(
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

async function renameIndexIfNeeded(
  context: GuardContext,
  currentName: string,
  desiredName: string,
): Promise<string> {
  if (currentName === desiredName) {
    return currentName;
  }

  const currentMetadata = await context.schema.getIndexMetadata(currentName);
  if (!currentMetadata) {
    return currentName;
  }

  const desiredMetadata = await context.schema.getIndexMetadata(desiredName);
  if (desiredMetadata) {
    console.warn(
      `[userSettingsGuard] target index public.${desiredName} already exists; skipping rename from public.${currentName}.`,
    );
    return currentName;
  }

  try {
    await context.client.query(
      `ALTER INDEX public.${quoteIdentifier(currentName)} RENAME TO ${quoteIdentifier(desiredName)};`,
    );
    context.schema.invalidateIndex(currentName);
    context.schema.invalidateIndex(desiredName);
    return desiredName;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "42710" || code === "42P07") {
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

async function ensureIndex(context: GuardContext, spec: IndexSpec): Promise<void> {
  const { name, table, columns, unique } = spec;
  if (!(await tableExists(context, table))) {
    console.warn(`[userSettingsGuard] table public.${table} missing, unable to ensure index ${name}.`);
    return;
  }

  const metadata = await context.schema.getIndexMetadata(name);
  const expectedColumns = columns.map((column) => column.toLowerCase());
  const createSql = `${unique ? "CREATE UNIQUE INDEX" : "CREATE INDEX"} IF NOT EXISTS ${quoteIdentifier(name)} ON public.${quoteIdentifier(
    table,
  )}(${columns.map(quoteIdentifier).join(", ")});`;

  if (metadata) {
    const tableMatches = normalizeName(metadata.tableName) === normalizeName(table);
    const predicateMatches = metadata.predicate == null;
    const columnsMatchExpected =
      metadata.columns.length === expectedColumns.length &&
      metadata.columns.every((column, index) => column.toLowerCase() === expectedColumns[index]);
    const uniquenessMatches = metadata.isUnique === Boolean(unique);

    if (tableMatches && predicateMatches && columnsMatchExpected && uniquenessMatches) {
      return;
    }

    const attachedConstraint = await getConstraintName(context, table, name, "u");
    if (attachedConstraint) {
      console.warn(
        `[userSettingsGuard] index public.${name} is attached to constraint ${attachedConstraint}; expected definition mismatch detected, skipping rebuild.`,
      );
      return;
    }

    await context.client.query(`DROP INDEX IF EXISTS public.${quoteIdentifier(name)};`);
    context.schema.invalidateIndex(name);
    console.warn(`[userSettingsGuard] rebuilt index public.${name} with canonical definition.`);
  }

  await context.client.query(createSql);
  context.schema.invalidateIndex(name);
}

async function ensureUuidColumn(
  context: GuardContext,
  tableName: string,
  columnName: string,
  options: { notNull?: boolean; fillWithDemoId?: boolean } = {},
): Promise<void> {
  if (!(await tableExists(context, tableName))) {
    return;
  }

  let columns = await context.schema.getColumns(tableName);
  if (!columns.has(columnName)) {
    await context.client.query(`ALTER TABLE public.${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier(columnName)} uuid`);
    context.schema.invalidateTable(tableName);
    columns = await context.schema.getColumns(tableName);
  }

  let column = columns.get(columnName);
  if (!column) {
    return;
  }

  if (normalizeName(column.dataType) !== "uuid") {
    await context.client.query(
      `ALTER TABLE public.${quoteIdentifier(tableName)} ALTER COLUMN ${quoteIdentifier(columnName)} TYPE uuid USING ${quoteIdentifier(
        columnName,
      )}::uuid`,
    );
    context.schema.invalidateTable(tableName);
    column = (await context.schema.getColumns(tableName)).get(columnName);
    if (!column) {
      return;
    }
  }

  if (options.fillWithDemoId) {
    await context.client.query(
      `UPDATE public.${quoteIdentifier(tableName)} SET ${quoteIdentifier(columnName)} = $1::uuid WHERE ${quoteIdentifier(
        columnName,
      )} IS NULL`,
      [DEMO_USER_ID],
    );
  }

  if (options.notNull) {
    await ensureColumnNotNull(context, tableName, columnName);
  }
}
async function ensureUsersTable(context: GuardContext): Promise<void> {
  await context.client.query(`
    CREATE TABLE IF NOT EXISTS public.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      username text NOT NULL UNIQUE,
      password text NOT NULL,
      created_at timestamptz DEFAULT now()
    );
  `);
  context.schema.invalidateTable("users");

  const hasId = await columnExists(context, "users", "id");
  if (!hasId) {
    await context.client.query(`ALTER TABLE public.users ADD COLUMN id uuid`);
    context.schema.invalidateTable("users");
  }

  await ensureColumnType(context, "users", "id", "uuid");
  await context.client.query(`UPDATE public.users SET id = gen_random_uuid() WHERE id IS NULL`);
  await ensureColumnDefault(context, "users", "id", "gen_random_uuid()", ["gen_random_uuid()"]);
  await ensureColumnNotNull(context, "users", "id");
  await ensureColumnNotNull(context, "users", "username");
  await ensureColumnNotNull(context, "users", "password");
  await ensureColumnDefault(context, "users", "created_at", "now()", ["now()", "current_timestamp"]);

  await ensurePrimaryKey(context, "users", "users_pkey", ["id"]);

  const uniqueConstraints = await getConstraints(context, "users", "UNIQUE");
  const usernameConstraint = uniqueConstraints.find((constraint) =>
    columnsMatch(constraint.columns, ["username"]),
  );

  if (!usernameConstraint) {
    await context.client.query(
      `ALTER TABLE public.users ADD CONSTRAINT users_username_unique UNIQUE (username);`,
    );
    context.schema.invalidateTable("users");
  } else if (usernameConstraint.name !== "users_username_unique") {
    await renameConstraint(context, "users", usernameConstraint.name, "users_username_unique");
  }
}
async function ensureUserSettingsTable(context: GuardContext): Promise<void> {
  await context.client.query(`
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
  context.schema.invalidateTable("user_settings");

  await ensureUuidColumn(context, "user_settings", "id");
  await context.client.query(`UPDATE public.user_settings SET id = gen_random_uuid() WHERE id IS NULL`);
  await ensureColumnDefault(context, "user_settings", "id", "gen_random_uuid()", ["gen_random_uuid()"]);
  await ensureColumnNotNull(context, "user_settings", "id");

  await ensureUuidColumn(context, "user_settings", "user_id");
  await context.client.query(`DELETE FROM public.user_settings WHERE user_id IS NULL`);
  await ensureColumnNotNull(context, "user_settings", "user_id");

  await context.client.query(`
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

  await context.client.query(`UPDATE public.user_settings SET created_at = COALESCE(created_at, now())`);
  await context.client.query(`UPDATE public.user_settings SET updated_at = COALESCE(updated_at, now())`);
  await ensureColumnDefault(context, "user_settings", "created_at", "now()", ["now()", "current_timestamp"]);
  await ensureColumnDefault(context, "user_settings", "updated_at", "now()", ["now()", "current_timestamp"]);
}
async function ensureUserSettingsUniqueConstraint(context: GuardContext): Promise<void> {
  const tableName = "user_settings";
  const constraintName = "user_settings_user_id_unique";
  const canonicalIndexName = "user_settings_user_id_unique";
  const constraintColumns = ["user_id"];

  if (!(await tableExists(context, tableName))) {
    console.warn(
      `[userSettingsGuard] table public.${tableName} missing, unable to ensure constraint ${constraintName}.`,
    );
    return;
  }

  const constraints = await getConstraints(context, tableName, "UNIQUE");
  const canonical = constraints.find((constraint) => columnsMatch(constraint.columns, constraintColumns));

  if (canonical) {
    if (canonical.name !== constraintName) {
      if (await constraintExists(context, tableName, constraintName, "u")) {
        console.warn(
          `[userSettingsGuard] dropping redundant constraint ${canonical.name} on public.${tableName} because canonical constraint ${constraintName} already exists.`,
        );
        await dropConstraint(context, tableName, canonical.name);
        return;
      }

      const conflictingIndex = await context.schema.getIndexMetadata(constraintName);
      if (conflictingIndex) {
        console.warn(
          `[userSettingsGuard] skipping rename of constraint ${canonical.name} on public.${tableName} to ${constraintName} because the target name is already used by an index.`,
        );
        return;
      }

      try {
        await renameConstraint(context, tableName, canonical.name, constraintName);
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code !== "42710" && code !== "42P07") {
          throw error;
        }
        console.warn(
          `[userSettingsGuard] unable to rename constraint ${canonical.name} on public.${tableName} to ${constraintName}: ${String(
            (error as Error).message ?? error,
          )}`,
        );
      }
    }
    return;
  }

  if (await constraintExists(context, tableName, constraintName, "u")) {
    return;
  }

  let indexName = await findMatchingUniqueIndex(context, tableName, constraintColumns);

  if (!indexName) {
    indexName = "user_settings_user_id_unique_idx";
    await ensureIndex(context, {
      name: indexName,
      table: tableName,
      columns: constraintColumns,
      unique: true,
    });
  }

  try {
    await context.client.query(
      `ALTER TABLE public.${tableName} ADD CONSTRAINT ${quoteIdentifier(constraintName)} UNIQUE USING INDEX ${quoteIdentifier(
        indexName,
      )};`,
    );
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== "42710" && code !== "42P07") {
      throw error;
    }
    console.warn(
      `[userSettingsGuard] constraint ${constraintName} already exists on public.${tableName}, skipping attach.`,
    );
  }

  await renameIndexIfNeeded(context, indexName, canonicalIndexName);
}
async function ensureAuxiliaryUserColumns(context: GuardContext): Promise<void> {
  await ensureUuidColumn(context, "indicator_configs", "user_id", { notNull: true, fillWithDemoId: true });
  await ensureUuidColumn(context, "positions", "user_id", { notNull: true, fillWithDemoId: true });
  await ensureUuidColumn(context, "closed_positions", "user_id", { notNull: true, fillWithDemoId: true });
}
async function ensureClosedPositionsIndexes(context: GuardContext): Promise<void> {
  await ensureIndex(context, {
    name: "idx_closed_positions_symbol_time",
    table: "closed_positions",
    columns: ["symbol", "closed_at"],
  });

  await ensureIndex(context, {
    name: "idx_closed_positions_user",
    table: "closed_positions",
    columns: ["user_id"],
  });
}
async function ensureIndicatorArtifacts(context: GuardContext): Promise<void> {
  if (!(await tableExists(context, "indicator_configs"))) {
    console.warn("[userSettingsGuard] table public.indicator_configs missing, skipping indicator guards.");
    return;
  }

  await ensureIndex(context, {
    name: "idx_indicator_configs_user_name",
    table: "indicator_configs",
    columns: ["user_id", "name"],
    unique: true,
  });

  let columns = await context.schema.getColumns("indicator_configs");
  if (columns.has("updated_at")) {
    await context.client.query(
      `UPDATE public.indicator_configs SET created_at = COALESCE(created_at, updated_at)`,
    );
    await context.client.query(`ALTER TABLE public.indicator_configs DROP COLUMN IF EXISTS updated_at`);
    context.schema.invalidateTable("indicator_configs");
    columns = await context.schema.getColumns("indicator_configs");
  }

  if (columns.has("created_at")) {
    await ensureColumnDefault(context, "indicator_configs", "created_at", "now()", ["now()", "current_timestamp"]);
  }

  await ensureColumnNotNull(context, "indicator_configs", "name");
  await ensureUuidColumn(context, "indicator_configs", "user_id", { notNull: true });
}
async function ensurePairTimeframesArtifacts(context: GuardContext): Promise<void> {
  await context.client.query(`
    CREATE TABLE IF NOT EXISTS public.pair_timeframes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      symbol text,
      timeframe text,
      created_at timestamp DEFAULT now()
    );
  `);
  context.schema.invalidateTable("pair_timeframes");

  await ensureUuidColumn(context, "pair_timeframes", "id", { notNull: true });
  await ensureColumnDefault(context, "pair_timeframes", "id", "gen_random_uuid()", ["gen_random_uuid()"]);

  let columns = await context.schema.getColumns("pair_timeframes");
  const hasTf = columns.has("tf");
  const hasTimeframe = columns.has("timeframe");

  if (hasTf && !hasTimeframe) {
    await context.client.query(`ALTER TABLE public.pair_timeframes RENAME COLUMN tf TO timeframe`);
    context.schema.invalidateTable("pair_timeframes");
    columns = await context.schema.getColumns("pair_timeframes");
  } else if (hasTf && hasTimeframe) {
    await context.client.query(
      `UPDATE public.pair_timeframes SET timeframe = COALESCE(timeframe, tf)`,
    );
    await context.client.query(`ALTER TABLE public.pair_timeframes DROP COLUMN tf`);
    context.schema.invalidateTable("pair_timeframes");
    columns = await context.schema.getColumns("pair_timeframes");
  }

  if (!columns.has("timeframe")) {
    await context.client.query(`ALTER TABLE public.pair_timeframes ADD COLUMN timeframe text`);
    context.schema.invalidateTable("pair_timeframes");
    columns = await context.schema.getColumns("pair_timeframes");
  }

  await ensureColumnNotNull(context, "pair_timeframes", "timeframe", { skipIfNullsExist: true });
  await ensureColumnNotNull(context, "pair_timeframes", "symbol", { skipIfNullsExist: true });
  await ensureColumnDefault(context, "pair_timeframes", "created_at", "now()", ["now()", "current_timestamp"]);

  await ensureIndex(context, {
    name: "pair_timeframes_symbol_timeframe_unique",
    table: "pair_timeframes",
    columns: ["symbol", "timeframe"],
    unique: true,
  });
}
async function ensureDemoUser(context: GuardContext): Promise<void> {
  if (!(await tableExists(context, "users"))) {
    console.warn("[userSettingsGuard] table public.users missing, skipping demo user upsert.");
    return;
  }

  const [{ rows: demoByIdRows }, { rows: legacyRows }] = await Promise.all([
    context.client.query<{ id: string }>(
      `SELECT id::text AS id FROM public.users WHERE id = $1::uuid LIMIT 1;`,
      [DEMO_USER_ID],
    ),
    context.client.query<{ id: string }>(
      `SELECT id::text AS id FROM public.users WHERE username = $1 LIMIT 1;`,
      [DEFAULT_SESSION_USERNAME],
    ),
  ]);

  const existingDemoById = demoByIdRows[0]?.id ?? null;
  const legacyId = legacyRows[0]?.id ?? null;

  const [hasUserSettings, hasIndicatorConfigs, hasPositions, hasClosedPositions] = await Promise.all([
    tableExists(context, "user_settings"),
    tableExists(context, "indicator_configs"),
    tableExists(context, "positions"),
    tableExists(context, "closed_positions"),
  ]);

  if (legacyId && legacyId !== DEMO_USER_ID) {
    if (hasUserSettings) {
      const [legacySettings, demoSettings] = await Promise.all([
        context.client.query<{ exists: boolean }>(
          `SELECT EXISTS(SELECT 1 FROM public.user_settings WHERE user_id = $1::uuid) AS exists;`,
          [legacyId],
        ),
        context.client.query<{ exists: boolean }>(
          `SELECT EXISTS(SELECT 1 FROM public.user_settings WHERE user_id = $1::uuid) AS exists;`,
          [DEMO_USER_ID],
        ),
      ]);

      if (legacySettings.rows[0]?.exists) {
        if (demoSettings.rows[0]?.exists) {
          await context.client.query(`DELETE FROM public.user_settings WHERE user_id = $1::uuid`, [legacyId]);
        } else {
          await context.client.query(
            `UPDATE public.user_settings SET user_id = $1::uuid WHERE user_id = $2::uuid`,
            [DEMO_USER_ID, legacyId],
          );
        }
      }
    }

    if (hasIndicatorConfigs) {
      await context.client.query(
        `UPDATE public.indicator_configs SET user_id = $1::uuid WHERE user_id = $2::uuid`,
        [DEMO_USER_ID, legacyId],
      );
    }

    if (hasPositions) {
      await context.client.query(
        `UPDATE public.positions SET user_id = $1::uuid WHERE user_id = $2::uuid`,
        [DEMO_USER_ID, legacyId],
      );
    }

    if (hasClosedPositions) {
      await context.client.query(
        `UPDATE public.closed_positions SET user_id = $1::uuid WHERE user_id = $2::uuid`,
        [DEMO_USER_ID, legacyId],
      );
    }

    if (existingDemoById) {
      await context.client.query(`DELETE FROM public.users WHERE id = $1::uuid`, [legacyId]);
    } else {
      await context.client.query(
        `UPDATE public.users SET id = $1::uuid, username = $2, password = $3 WHERE id = $4::uuid`,
        [DEMO_USER_ID, DEFAULT_SESSION_USERNAME, DEFAULT_SESSION_PASSWORD, legacyId],
      );
    }
  }

  await context.client.query(
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
    await context.client.query(
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

    await context.client.query(
      `UPDATE public.user_settings SET updated_at = COALESCE(updated_at, now()) WHERE user_id = $1::uuid`,
      [DEMO_USER_ID],
    );
  }
}
function enumerateErrors(error: unknown): unknown[] {
  if (error instanceof AggregateError) {
    return Array.from(error.errors);
  }
  const errors = (error as { errors?: unknown[] }).errors;
  if (Array.isArray(errors) && errors.length > 0) {
    return errors;
  }
  return [error];
}

function isConnectionError(error: unknown): boolean {
  return enumerateErrors(error).some((candidate) => {
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
  const isPoolInstance = isPool(db);
  let client: Client | PoolClient;

  try {
    client = isPoolInstance ? await db.connect() : db;
  } catch (error) {
    if (isConnectionError(error)) {
      console.error(
        `[userSettingsGuard] unable to obtain database connection: ${extractErrorMessage(error)}`,
      );
    }
    throw error;
  }

  const releasable = isPoolInstance ? (client as PoolClient) : null;
  const schema = createSchemaInspector(client);
  const context: GuardContext = { client, schema };

  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

    await client.query("BEGIN");
    try {
      await ensureUsersTable(context);
      await ensureUserSettingsTable(context);
      await ensureUserSettingsUniqueConstraint(context);
      await ensureAuxiliaryUserColumns(context);
      await ensureIndicatorArtifacts(context);
      await ensureClosedPositionsIndexes(context);
      await ensurePairTimeframesArtifacts(context);
      await ensureDemoUser(context);
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
    schema.clear();
    if (releasable) {
      releasable.release();
    }
  }
}

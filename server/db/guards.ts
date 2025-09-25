import type { Client, Pool } from "pg";

const DISABLE_AUTOHEAL = (process.env.AUTOHEAL_DISABLE ?? "").toLowerCase() === "true";

export async function ensureSchema(db: Pool | Client): Promise<void> {
    if (DISABLE_AUTOHEAL) {
        console.info("[ensureSchema] AUTOHEAL_DISABLE=true -> skipping database guard");
        return;
    }

    console.info("[ensureSchema] running database guard to self-heal schema anomalies");

    const guardBlock = `
DO $$
DECLARE
    v_exists BOOLEAN;
    v_has_tf BOOLEAN;
    v_has_timeframe BOOLEAN;
    v_has_null BOOLEAN;
    v_has_closed_symbol_time BOOLEAN;
    v_has_closed_user BOOLEAN;
    v_has_indicator_index BOOLEAN;
    v_existing_constraint TEXT;
    v_matching_index TEXT;
    v_canonical_index TEXT := 'user_settings_user_id_unique';
    v_canonical_regclass REGCLASS;
    rows_deleted INTEGER := 0;
    rows_updated INTEGER := 0;
    col_rec RECORD;
BEGIN
    -- closed_positions indexes
    BEGIN
        SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'closed_positions'
        ) INTO v_exists;

        IF NOT v_exists THEN
            RAISE NOTICE '[ensureSchema] table public.closed_positions missing, skipping closed_positions guards.';
        ELSE
            SELECT EXISTS (
                SELECT 1
                FROM pg_class i
                JOIN pg_namespace n ON n.oid = i.relnamespace
                JOIN pg_index ix ON ix.indexrelid = i.oid
                JOIN pg_class t ON t.oid = ix.indrelid
                JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ordinality) ON TRUE
                JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
                WHERE n.nspname = 'public'
                  AND t.relname = 'closed_positions'
                  AND i.relname = 'idx_closed_positions_symbol_time'
                  AND ix.indpred IS NULL
                GROUP BY i.relname
                HAVING array_agg(lower(a.attname) ORDER BY k.ordinality) = ARRAY['symbol', 'closed_at']
            ) INTO v_has_closed_symbol_time;

            IF NOT v_has_closed_symbol_time THEN
                RAISE NOTICE '[ensureSchema] rebuilding index public.idx_closed_positions_symbol_time';
                EXECUTE 'DROP INDEX IF EXISTS public.idx_closed_positions_symbol_time';
                EXECUTE 'CREATE INDEX IF NOT EXISTS public.idx_closed_positions_symbol_time ON public.closed_positions(symbol, closed_at)';
            ELSE
                RAISE NOTICE '[ensureSchema] index public.idx_closed_positions_symbol_time already canonical';
            END IF;

            SELECT EXISTS (
                SELECT 1
                FROM pg_class i
                JOIN pg_namespace n ON n.oid = i.relnamespace
                JOIN pg_index ix ON ix.indexrelid = i.oid
                JOIN pg_class t ON t.oid = ix.indrelid
                JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ordinality) ON TRUE
                JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
                WHERE n.nspname = 'public'
                  AND t.relname = 'closed_positions'
                  AND i.relname = 'idx_closed_positions_user'
                  AND ix.indpred IS NULL
                GROUP BY i.relname
                HAVING array_agg(lower(a.attname) ORDER BY k.ordinality) = ARRAY['user_id']
            ) INTO v_has_closed_user;

            IF NOT v_has_closed_user THEN
                RAISE NOTICE '[ensureSchema] rebuilding index public.idx_closed_positions_user';
                EXECUTE 'DROP INDEX IF EXISTS public.idx_closed_positions_user';
                EXECUTE 'CREATE INDEX IF NOT EXISTS public.idx_closed_positions_user ON public.closed_positions(user_id)';
            ELSE
                RAISE NOTICE '[ensureSchema] index public.idx_closed_positions_user already canonical';
            END IF;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[ensureSchema] closed_positions guard failed: %', SQLERRM;
    END;

    -- indicator_configs guard
    BEGIN
        SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'indicator_configs'
        ) INTO v_exists;

        IF NOT v_exists THEN
            RAISE NOTICE '[ensureSchema] table public.indicator_configs missing, skipping indicator_configs guards.';
        ELSE
            SELECT EXISTS (
                SELECT 1
                FROM pg_class i
                JOIN pg_namespace n ON n.oid = i.relnamespace
                JOIN pg_index ix ON ix.indexrelid = i.oid
                JOIN pg_class t ON t.oid = ix.indrelid
                JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ordinality) ON TRUE
                JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
                WHERE n.nspname = 'public'
                  AND t.relname = 'indicator_configs'
                  AND i.relname = 'idx_indicator_configs_user_name'
                  AND ix.indisunique
                  AND ix.indpred IS NULL
                GROUP BY i.relname
                HAVING array_agg(lower(a.attname) ORDER BY k.ordinality) = ARRAY['user_id', 'name']
            ) INTO v_has_indicator_index;

            IF NOT v_has_indicator_index THEN
                RAISE NOTICE '[ensureSchema] rebuilding index public.idx_indicator_configs_user_name';
                EXECUTE 'DROP INDEX IF EXISTS public.idx_indicator_configs_user_name';
                EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS public.idx_indicator_configs_user_name ON public.indicator_configs(user_id, name)';
            ELSE
                RAISE NOTICE '[ensureSchema] index public.idx_indicator_configs_user_name already canonical';
            END IF;

            IF EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'indicator_configs'
                  AND column_name = 'created_at'
            ) AND EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'indicator_configs'
                  AND column_name = 'updated_at'
            ) THEN
                rows_updated := 0;
                EXECUTE 'UPDATE public.indicator_configs SET created_at = COALESCE(created_at, updated_at)';
                GET DIAGNOSTICS rows_updated = ROW_COUNT;
                RAISE NOTICE '[ensureSchema] indicator_configs created_at backfilled from updated_at (% updates).', rows_updated;
                RAISE NOTICE '[ensureSchema] dropping legacy column indicator_configs.updated_at';
                EXECUTE 'ALTER TABLE public.indicator_configs DROP COLUMN IF EXISTS updated_at';
            ELSE
                RAISE NOTICE '[ensureSchema] indicator_configs timestamps already normalized, no drop needed.';
            END IF;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[ensureSchema] indicator_configs guard failed: %', SQLERRM;
    END;

    -- pair_timeframes guard
    BEGIN
        SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'pair_timeframes'
        ) INTO v_exists;

        IF NOT v_exists THEN
            RAISE NOTICE '[ensureSchema] creating table public.pair_timeframes';
            EXECUTE '
                CREATE TABLE IF NOT EXISTS public.pair_timeframes (
                    id uuid PRIMARY KEY,
                    symbol text,
                    timeframe text,
                    created_at timestamptz DEFAULT now()
                )
            ';
        ELSE
            RAISE NOTICE '[ensureSchema] table public.pair_timeframes already exists';
        END IF;

        SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'pair_timeframes'
              AND column_name = 'tf'
        ) INTO v_has_tf;

        SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'pair_timeframes'
              AND column_name = 'timeframe'
        ) INTO v_has_timeframe;

        IF v_has_tf AND NOT v_has_timeframe THEN
            RAISE NOTICE '[ensureSchema] renaming column public.pair_timeframes.tf to timeframe';
            EXECUTE 'ALTER TABLE public.pair_timeframes RENAME COLUMN tf TO timeframe';
        ELSIF v_has_tf AND v_has_timeframe THEN
            rows_updated := 0;
            RAISE NOTICE '[ensureSchema] merging legacy tf values into timeframe';
            EXECUTE 'UPDATE public.pair_timeframes SET timeframe = COALESCE(timeframe, tf)';
            GET DIAGNOSTICS rows_updated = ROW_COUNT;
            RAISE NOTICE '[ensureSchema] pair_timeframes timeframe backfill updated % rows.', rows_updated;
            RAISE NOTICE '[ensureSchema] dropping legacy column public.pair_timeframes.tf';
            EXECUTE 'ALTER TABLE public.pair_timeframes DROP COLUMN IF EXISTS tf';
        ELSE
            RAISE NOTICE '[ensureSchema] no legacy tf column adjustments required';
        END IF;

        SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'pair_timeframes'
              AND column_name = 'timeframe'
        ) INTO v_has_timeframe;

        IF v_has_timeframe THEN
            SELECT EXISTS (
                SELECT 1 FROM public.pair_timeframes WHERE timeframe IS NULL
            ) INTO v_has_null;

            IF v_has_null THEN
                RAISE NOTICE '[ensureSchema] skipping NOT NULL enforcement for pair_timeframes.timeframe because nulls exist.';
            ELSE
                RAISE NOTICE '[ensureSchema] enforcing NOT NULL on pair_timeframes.timeframe';
                EXECUTE 'ALTER TABLE public.pair_timeframes ALTER COLUMN timeframe SET NOT NULL';
            END IF;
        ELSE
            RAISE NOTICE '[ensureSchema] column pair_timeframes.timeframe missing, cannot enforce NOT NULL.';
        END IF;

        IF to_regclass('public.pair_timeframes_symbol_timeframe_unique') IS NULL THEN
            RAISE NOTICE '[ensureSchema] creating unique index public.pair_timeframes_symbol_timeframe_unique';
        ELSE
            RAISE NOTICE '[ensureSchema] unique index public.pair_timeframes_symbol_timeframe_unique already exists';
        END IF;
        EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS public.pair_timeframes_symbol_timeframe_unique ON public.pair_timeframes(symbol, timeframe)';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[ensureSchema] pair_timeframes guard failed: %', SQLERRM;
    END;

    -- trading_pairs guard
    BEGIN
        SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'trading_pairs'
        ) INTO v_exists;

        IF NOT v_exists THEN
            RAISE NOTICE '[ensureSchema] table public.trading_pairs missing, skipping trading_pairs guards.';
        ELSE
            FOR col_rec IN
                SELECT col_name, col_type
                FROM (VALUES
                    ('min_qty', 'numeric(18,8)'),
                    ('min_notional', 'numeric(18,8)'),
                    ('step_size', 'numeric(18,8)'),
                    ('tick_size', 'numeric(18,8)')
                ) AS cols(col_name, col_type)
            LOOP
                SELECT EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'trading_pairs'
                      AND column_name = col_rec.col_name
                ) INTO v_exists;

                IF NOT v_exists THEN
                    RAISE NOTICE '[ensureSchema] adding column trading_pairs.%', col_rec.col_name;
                    EXECUTE format('ALTER TABLE public.trading_pairs ADD COLUMN IF NOT EXISTS %I %s', col_rec.col_name, col_rec.col_type);
                ELSE
                    RAISE NOTICE '[ensureSchema] column trading_pairs.% already exists', col_rec.col_name;
                END IF;
            END LOOP;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[ensureSchema] trading_pairs guard failed: %', SQLERRM;
    END;

    -- user_settings guard
    BEGIN
        SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'user_settings'
        ) INTO v_exists;

        IF NOT v_exists THEN
            RAISE NOTICE '[ensureSchema] table public.user_settings missing, skipping user_settings guards.';
        ELSE
            rows_deleted := 0;
            EXECUTE '
                WITH ranked AS (
                    SELECT ctid,
                           ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY ctid) AS rn
                    FROM public.user_settings
                )
                DELETE FROM public.user_settings AS u
                USING ranked
                WHERE u.ctid = ranked.ctid
                  AND ranked.rn > 1
            ';
            GET DIAGNOSTICS rows_deleted = ROW_COUNT;
            RAISE NOTICE '[ensureSchema] removed % duplicate user_settings rows', rows_deleted;

            SELECT tc.constraint_name
            INTO v_existing_constraint
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
            WHERE tc.table_schema = 'public'
              AND tc.table_name = 'user_settings'
              AND tc.constraint_type = 'UNIQUE'
              AND kcu.column_name = 'user_id'
            LIMIT 1;

            IF v_existing_constraint IS NOT NULL THEN
                IF v_existing_constraint <> v_canonical_index THEN
                    BEGIN
                        RAISE NOTICE '[ensureSchema] renaming constraint % to %', v_existing_constraint, v_canonical_index;
                        EXECUTE format(
                            'ALTER TABLE public.user_settings RENAME CONSTRAINT %I TO %I',
                            v_existing_constraint,
                            v_canonical_index
                        );
                    EXCEPTION
                        WHEN duplicate_object THEN
                            RAISE NOTICE '[ensureSchema] duplicate when renaming constraint %, skipping', v_existing_constraint;
                    END;
                ELSE
                    RAISE NOTICE '[ensureSchema] constraint % already canonical', v_canonical_index;
                END IF;
            ELSE
                SELECT i.relname
                INTO v_matching_index
                FROM pg_class t
                JOIN pg_namespace n ON n.oid = t.relnamespace
                JOIN pg_index ix ON ix.indrelid = t.oid
                JOIN pg_class i ON i.oid = ix.indexrelid
                JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ordinality) ON TRUE
                JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
                WHERE n.nspname = 'public'
                  AND t.relname = 'user_settings'
                  AND ix.indisunique
                  AND ix.indpred IS NULL
                GROUP BY i.relname
                HAVING array_agg(lower(a.attname) ORDER BY k.ordinality) = ARRAY['user_id']
                LIMIT 1;

                IF v_matching_index IS NULL THEN
                    v_matching_index := 'user_settings_user_id_unique_idx';
                    RAISE NOTICE '[ensureSchema] creating fallback index %', v_matching_index;
                    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS user_settings_user_id_unique_idx ON public.user_settings(user_id)';
                ELSE
                    RAISE NOTICE '[ensureSchema] attaching constraint using existing index %', v_matching_index;
                END IF;

                BEGIN
                    EXECUTE format(
                        'ALTER TABLE public.user_settings ADD CONSTRAINT %I UNIQUE USING INDEX %I',
                        v_canonical_index,
                        v_matching_index
                    );
                EXCEPTION
                    WHEN duplicate_object THEN
                        RAISE NOTICE '[ensureSchema] constraint % already exists, skipping attach', v_canonical_index;
                END;

                SELECT to_regclass('public.' || v_canonical_index)
                INTO v_canonical_regclass;

                IF v_canonical_regclass IS NULL AND v_matching_index <> v_canonical_index THEN
                    BEGIN
                        RAISE NOTICE '[ensureSchema] renaming index % to %', v_matching_index, v_canonical_index;
                        EXECUTE format(
                            'ALTER INDEX public.%I RENAME TO %I',
                            v_matching_index,
                            v_canonical_index
                        );
                    EXCEPTION
                        WHEN duplicate_object THEN
                            RAISE NOTICE '[ensureSchema] duplicate when renaming index %, skipping', v_matching_index;
                    END;
                ELSE
                    RAISE NOTICE '[ensureSchema] index % already canonical', v_canonical_index;
                END IF;
            END IF;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[ensureSchema] user_settings guard failed: %', SQLERRM;
    END;
END $$;
`;

    try {
        await (db as unknown as { query: (sql: string) => Promise<unknown> }).query(guardBlock);
        console.info("[ensureSchema] database guard completed");
    } catch (error) {
        console.error("[ensureSchema] guard execution failed", error);
    }
}

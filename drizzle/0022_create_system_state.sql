-- Idempotent system_state bootstrap (safe re-run)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='system_state'
  ) THEN
    CREATE TABLE public."system_state" (
      id INT PRIMARY KEY DEFAULT 1,
      total_balance numeric(18,8) NOT NULL DEFAULT 0,
      equity numeric(18,8) NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT now()
    );
  END IF;
END $$;

ALTER TABLE public."system_state"
  ADD COLUMN IF NOT EXISTS id INT,
  ADD COLUMN IF NOT EXISTS total_balance numeric(18,8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS equity numeric(18,8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='system_state_pkey'
      AND conrelid='public.system_state'::regclass
  ) THEN
    ALTER TABLE public."system_state" ADD CONSTRAINT system_state_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public."system_state" WHERE id=1) THEN
    INSERT INTO public."system_state"(id,total_balance,equity,updated_at)
    VALUES (1,0,0,now());
  END IF;
END $$;

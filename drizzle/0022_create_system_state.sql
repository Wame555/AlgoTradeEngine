-- Persist total balance & equity (idempotent, safe to re-run)
CREATE TABLE IF NOT EXISTS public."system_state" (
  id INT PRIMARY KEY DEFAULT 1,
  total_balance numeric(18,8) NOT NULL DEFAULT 0,
  equity numeric(18,8) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public."system_state" WHERE id = 1) THEN
    INSERT INTO public."system_state"(id,total_balance,equity,updated_at)
    VALUES (1, 0, 0, now());
  END IF;
END $$;

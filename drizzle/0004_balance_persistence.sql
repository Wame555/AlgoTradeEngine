-- Persist equity/balance between restarts
CREATE TABLE IF NOT EXISTS public."system_state" (
    "id" integer PRIMARY KEY DEFAULT 1,
    "total_balance" numeric(18, 8) NOT NULL,
    "equity" numeric(18, 8) NOT NULL,
    "updated_at" timestamp DEFAULT now()
);

// server/db.ts — helyi PostgreSQL (TCP) + drizzle
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error('DATABASE_URL must be set for local Postgres.');
}

// Ha SSL kellene, itt állíthatod: ssl: { rejectUnauthorized: false }
const pool = new Pool({
    connectionString,
    // WSL alatti lokális DB-hez általában nem kell SSL:
    ssl: false,
});

export const db = drizzle(pool);

// Opcionális: nyers lekérdezéshez
export async function raw<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const client = await pool.connect();
    try {
        const res = await client.query(sql, params);
        return res.rows as T[];
    } finally {
        client.release();
    }
}

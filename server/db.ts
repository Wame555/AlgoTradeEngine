// server/db.ts � helyi PostgreSQL (TCP) + drizzle
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error('DATABASE_URL must be set for local Postgres.');
}

// Ha SSL kellene, itt �ll�thatod: ssl: { rejectUnauthorized: false }
const pool = new Pool({
    connectionString,
    // WSL alatti lok�lis DB-hez �ltal�ban nem kell SSL:
    ssl: false,
});

export const db = drizzle(pool);

// Opcion�lis: nyers lek�rdez�shez
export async function raw<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const client = await pool.connect();
    try {
        const res = await client.query(sql, params);
        return res.rows as T[];
    } finally {
        client.release();
    }
}

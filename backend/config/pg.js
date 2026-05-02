import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.PG_CONNECTION_STRING,
  ssl: {
    rejectUnauthorized: false,
  },
});

// ✅ Simple query
export const query = (text, params) => pool.query(text, params);

// ✅ For transactions
export const getClient = async () => {
  const client = await pool.connect();
  return client;
};

export default pool;
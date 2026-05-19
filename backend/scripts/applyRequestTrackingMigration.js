import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const { query } = await import('../config/pg.js');

const migrationPath = path.resolve(
  __dirname,
  '../db/2026-05-18-request-tracking.sql'
);

try {
  const sql = await fs.readFile(migrationPath, 'utf8');
  await query(sql);

  const { rows } = await query(`
    SELECT
      to_regclass('request_tracking.requests') AS requests_table,
      to_regclass('request_tracking.request_flow_status') AS flow_view
  `);

  console.log('Request tracking migration applied successfully');
  console.log(rows[0]);
  process.exit(0);
} catch (error) {
  console.error('Failed to apply request tracking migration');
  console.error(error.message);
  if (Array.isArray(error.errors)) {
    for (const nestedError of error.errors) {
      console.error(nestedError.message);
    }
  }
  process.exit(1);
}

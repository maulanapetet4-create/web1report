import { neon } from '@neondatabase/serverless';

export const getSql = () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL belum dikonfigurasi.');
  }
  return neon(databaseUrl);
};

let schemaReady: Promise<void> | undefined;
/** Membuat tabel bila belum ada. Dipanggil sekali per instance server. */
export const ensureSchema = (): Promise<void> => {
  if (!schemaReady) {
    const sql = getSql();
    schemaReady = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS public.users (
        uid TEXT PRIMARY KEY, email TEXT NOT NULL, display_name TEXT, photo_url TEXT,
        created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW())`;
      await sql`CREATE TABLE IF NOT EXISTS public.cnc_reports (
        id TEXT PRIMARY KEY, sasa_no TEXT NOT NULL, project TEXT NOT NULL,
        operator_name TEXT NOT NULL, shift TEXT NOT NULL, day_and_date TEXT NOT NULL,
        status TEXT NOT NULL, supervisor_token TEXT, gm_token TEXT,
        supervisor_name TEXT DEFAULT 'Mulyana', gm_name TEXT DEFAULT 'Arifin',
        report_data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW())`;
    })().catch((err) => {
      schemaReady = undefined; // izinkan retry pada request berikutnya
      throw err;
    });
  }
  return schemaReady;
};

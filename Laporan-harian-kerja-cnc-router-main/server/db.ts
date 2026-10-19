import { neon } from '@neondatabase/serverless';

/**
 * Satu-satunya pintu masuk ke Neon. Memakai driver HTTP serverless sehingga
 * cocok untuk Vercel (tanpa pool koneksi yang bocor) maupun dev lokal.
 */
export const getSql = () => {
  const url = DATABASE_URL=postgresql://neondb_owner:npg_MvVuNR9xmG2c@ep-curly-dawn-az2xmcaj-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require;
  if (!url) {
    throw new Error('DATABASE_URL belum dikonfigurasi (isi di .env lokal atau Environment Variables Vercel).');
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('DATABASE_URL bukan URL yang valid. Format: postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require');
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol) || !parsed.username || !parsed.pathname.slice(1)) {
    throw new Error(
      'DATABASE_URL salah format (user/host/database kosong). Salin ulang connection string dari dashboard Neon: ' +
        'postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require'
    );
  }
  return neon(url, { fullResults: false });
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

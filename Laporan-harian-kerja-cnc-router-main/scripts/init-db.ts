// Jalankan: npm run db:init
// Membuat tabel di Neon dan (opsional) mengimpor reports_store.json bila tabel masih kosong.
import 'dotenv/config';
import fs from 'node:fs';
import { ensureSchema, getSql } from '../server/db.js';
import { saveReport } from '../server/neonReports.js';

await ensureSchema();
console.log('Tabel users & cnc_reports siap.');

const sql = getSql();
const [{ total }] = await sql`SELECT COUNT(*)::int AS total FROM public.cnc_reports`;
if (total === 0 && fs.existsSync('reports_store.json')) {
  const reports = JSON.parse(fs.readFileSync('reports_store.json', 'utf-8'));
  for (const r of reports) await saveReport(r);
  console.log(`Mengimpor ${reports.length} laporan dari reports_store.json.`);
} else {
  console.log(`Tabel berisi ${total} laporan; impor dilewati.`);
}

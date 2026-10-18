import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { ensureSchema, getSql } from './db.js';
import { getUser, requireAdmin, requireUser } from './auth.js';
import {
  approveReport,
  getReportByIdOrToken,
  getReports,
  HttpError,
  redactForRole,
  isReportPayload,
  removeAllReports,
  removeReport,
  saveReport,
} from './neonReports.js';

const app = express();
app.use(express.json({ limit: '15mb' }));

// Bungkus handler async agar error masuk ke error-handler (Express 4 tidak menangkapnya sendiri).
const wrap =
  (fn: (req: any, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

app.get('/api/health', wrap(async (_req, res) => {
  await ensureSchema();
  const rows = await getSql()`SELECT COUNT(*)::int AS total FROM public.cnc_reports`;
  res.json({ ok: true, database: 'neon', reports: rows[0].total });
}));

// --- Users (sinkron akun Google) ---
app.post('/api/users/sync', requireUser, wrap(async (req, res) => {
  const { uid, email, displayName, photoUrl } = req.body ?? {};
  // Hanya boleh menyinkronkan akun milik token yang sedang login.
  if (!uid || !email || uid !== req.user.uid) {
    return res.status(400).json({ error: 'Data user tidak valid.' });
  }
  await ensureSchema();
  const rows = await getSql()`
    INSERT INTO public.users (uid, email, display_name, photo_url, updated_at)
    VALUES (${uid}, ${email}, ${displayName || null}, ${photoUrl || null}, NOW())
    ON CONFLICT (uid) DO UPDATE SET
      email = EXCLUDED.email, display_name = EXCLUDED.display_name,
      photo_url = EXCLUDED.photo_url, updated_at = NOW()
    RETURNING uid, email, display_name AS "displayName", photo_url AS "photoUrl"`;
  res.json({ success: true, user: rows[0] });
}));

// --- Reports ---
app.get('/api/reports', requireUser, wrap(async (_req, res) => {
  res.json(await getReports());
}));

// Akses lewat TOKEN approval = publik tapi hanya untuk satu laporan (token peran lain disembunyikan).
// Akses lewat ID laporan = wajib login.
app.get('/api/reports/:idOrToken', wrap(async (req, res) => {
  const found = await getReportByIdOrToken(req.params.idOrToken);
  if (!found) return res.status(404).json({ error: 'Laporan tidak ditemukan.' });
  const user = await getUser(req);
  if (user) return res.json(found.report);
  if (found.matchedBy === 'id') {
    return res.status(401).json({ error: 'Silakan login Google terlebih dahulu.' });
  }
  res.json(redactForRole(found.report, found.matchedBy === 'gm_token' ? 'GM' : 'SUPERVISOR'));
}));

// Simpan / perbarui. Mengembalikan objek laporan langsung (sesuai ekspektasi client).
app.post('/api/reports', requireUser, wrap(async (req, res) => {
  if (!isReportPayload(req.body)) {
    return res.status(400).json({ error: 'Data laporan tidak valid.' });
  }
  res.json(await saveReport(req.body));
}));

app.post('/api/reports/clear', requireAdmin, wrap(async (_req, res) => {
  await removeAllReports();
  res.json({ success: true });
}));

app.post('/api/reports/:id/approval', wrap(async (req, res) => {
  const { role, decision, notes, approverName, token } = req.body ?? {};
  if (!['SUPERVISOR', 'GM'].includes(role) || !['APPROVED', 'REJECTED'].includes(decision)) {
    return res.status(400).json({ error: 'Data persetujuan tidak valid.' });
  }
  const updated = await approveReport(
    req.params.id,
    role,
    decision,
    String(notes || ''),
    String(approverName || (role === 'GM' ? 'Arifin' : 'Mulyana')),
    String(token || '')
  );
  if (!updated) {
    return res.status(409).json({ error: 'Laporan tidak ditemukan atau status sudah berubah. Muat ulang halaman.' });
  }
  res.json((await getUser(req)) ? updated : redactForRole(updated, role));
}));

app.delete('/api/reports/:id', requireUser, wrap(async (req, res) => {
  await removeReport(req.params.id);
  res.json({ success: true });
}));

// --- SQL Editor (khusus admin, transaksi READ ONLY) ---
app.post('/api/sql-editor/query', requireAdmin, wrap(async (req, res) => {
  const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
  if (!query) return res.status(400).json({ error: 'Query tidak boleh kosong.' });
  const MAX_ROWS = 500;
  try {
    const sql = getSql();
    const [result] = (await sql.transaction(
      (txn) => [txn.query(query)],
      { readOnly: true, fullResults: true }
    )) as unknown as [{ rows: Record<string, unknown>[]; fields: { name: string }[]; rowCount: number }];
    res.json({
      columns: result.fields.map((f) => f.name),
      rows: result.rows.slice(0, MAX_ROWS),
      rowCount: result.rowCount ?? result.rows.length,
      truncated: result.rows.length > MAX_ROWS,
    });
  } catch (err) {
    // Error SQL (typo, tabel tidak ada, mencoba menulis) ditampilkan apa adanya ke admin.
    res.status(400).json({ error: err instanceof Error ? err.message : 'Query gagal dijalankan.' });
  }
}));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan.' }));

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('API error:', err);
  const status = err instanceof HttpError ? err.status : 500;
  res.status(status).json({ error: err instanceof Error ? err.message : 'Terjadi kesalahan server.' });
});

export default app;

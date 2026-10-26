import express, { type NextFunction, type Request, type Response } from 'express';
import { neon } from '@neondatabase/serverless';
import { authenticateOptional, requireAdmin, requireAuth, type AuthedRequest } from './auth.js';
import { ensureSchema, getSql } from './db.js';
import {
  approveReport,
  getReportByIdOrToken,
  getReports,
  HttpError,
  isReportPayload,
  redactForRole,
  removeAllReports,
  removeReport,
  saveReport,
} from './neonReports.js';

const app = express();
const MAX_ROWS = 500;

app.use(express.json({ limit: '1mb' }));

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;
const asyncRoute = (handler: AsyncHandler) =>
  (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res, next).catch(next);
  };

app.post('/api/users/sync', requireAuth, asyncRoute(async (req, res) => {
  const { uid, email, displayName, photoUrl } = req.body ?? {};
  const authenticatedUser = (req as AuthedRequest).user;
  if (
    typeof uid !== 'string' ||
    typeof email !== 'string' ||
    uid !== authenticatedUser?.uid
  ) {
    return res.status(400).json({ error: 'Profil pengguna tidak valid.' });
  }

  await ensureSchema();
  const sql = getSql();
  await sql`
    INSERT INTO public.users (uid, email, display_name, photo_url, updated_at)
    VALUES (${uid}, ${email}, ${typeof displayName === 'string' ? displayName : null},
      ${typeof photoUrl === 'string' ? photoUrl : null}, NOW())
    ON CONFLICT (uid) DO UPDATE SET
      email = EXCLUDED.email,
      display_name = EXCLUDED.display_name,
      photo_url = EXCLUDED.photo_url,
      updated_at = NOW()
  `;
  res.json({ success: true });
}));

app.get('/api/reports', requireAuth, asyncRoute(async (_req, res) => {
  res.json(await getReports());
}));

app.post('/api/reports', requireAuth, asyncRoute(async (req, res) => {
  if (!isReportPayload(req.body)) {
    return res.status(400).json({ error: 'Format laporan tidak valid.' });
  }
  res.json(await saveReport(req.body));
}));

app.post('/api/reports/clear', requireAdmin, asyncRoute(async (_req, res) => {
  await removeAllReports();
  res.json({ success: true });
}));

app.get('/api/reports/:idOrToken', authenticateOptional, asyncRoute(async (req, res) => {
  const lookup = await getReportByIdOrToken(req.params.idOrToken);
  if (!lookup) return res.status(404).json({ error: 'Laporan tidak ditemukan.' });

  if (lookup.matchedBy === 'supervisor_token') {
    return res.json(redactForRole(lookup.report, 'SUPERVISOR'));
  }
  if (lookup.matchedBy === 'gm_token') {
    return res.json(redactForRole(lookup.report, 'GM'));
  }
  if (!(req as AuthedRequest).user) {
    return res.status(401).json({ error: 'Silakan login Google terlebih dahulu.' });
  }
  res.json(lookup.report);
}));

app.delete('/api/reports/:id', requireAdmin, asyncRoute(async (req, res) => {
  await removeReport(req.params.id);
  res.status(204).end();
}));

app.post('/api/reports/:id/approval', asyncRoute(async (req, res) => {
  const { role, decision, notes, approverName, token } = req.body ?? {};
  if (
    (role !== 'SUPERVISOR' && role !== 'GM') ||
    (decision !== 'APPROVED' && decision !== 'REJECTED') ||
    typeof token !== 'string' ||
    typeof approverName !== 'string' ||
    typeof notes !== 'string'
  ) {
    return res.status(400).json({ error: 'Data persetujuan tidak valid.' });
  }

  const report = await approveReport(
    req.params.id,
    role,
    decision,
    notes,
    approverName,
    token
  );
  if (!report) return res.status(404).json({ error: 'Laporan tidak ditemukan.' });
  res.json(report);
}));

app.post('/api/sql-editor/query', requireAdmin, asyncRoute(async (req, res) => {
  const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
  if (!query || !/^SELECT\b/i.test(query) || /;\s*\S/.test(query)) {
    return res.status(400).json({ error: 'SQL Editor hanya menerima satu query baca.' });
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL belum dikonfigurasi.');
  const sql = neon(databaseUrl, { fullResults: true });
  try {
    const result = await sql.query(query);
    res.json({
      columns: result.fields.map((field) => field.name),
      rows: result.rows.slice(0, MAX_ROWS),
      rowCount: result.rowCount ?? result.rows.length,
      truncated: result.rows.length > MAX_ROWS,
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Query gagal dijalankan.' });
  }
}));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan.' }));
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('API error:', err);
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof Error ? err.message : 'Terjadi kesalahan server.';
  const safeMessage =
    process.env.NODE_ENV === 'production' && status === 500
      ? 'Terjadi kesalahan server. Silakan coba lagi.'
      : message;
  res.status(status).json({ error: safeMessage });
});

export default app;

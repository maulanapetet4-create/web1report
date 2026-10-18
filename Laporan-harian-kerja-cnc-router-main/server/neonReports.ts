import { ensureSchema, getSql } from './db.js';
import type { ApprovalStep, CncDailyReport, ReportStatus } from '../src/types.js';

type SqlRow = {
  id: string;
  report_data: CncDailyReport;
};

const reportRows = (rows: Record<string, unknown>[]): SqlRow[] =>
  rows.map((row) => {
    if (
      typeof row.id !== 'string' ||
      typeof row.report_data !== 'object' ||
      row.report_data === null
    ) {
      throw new Error('Database mengembalikan format laporan yang tidak valid.');
    }
    return {
      id: row.id,
      report_data: row.report_data as CncDailyReport,
    };
  });

const database = async () => {
  await ensureSchema();
  return getSql();
};

const reportFromRow = (row: SqlRow): CncDailyReport => ({
  ...row.report_data,
  id: row.id,
});

export const isReportPayload = (value: unknown): value is CncDailyReport => {
  if (typeof value !== 'object' || value === null) return false;
  const report = value as Record<string, unknown>;
  return (
    typeof report.id === 'string' &&
    typeof report.operatorName === 'string' &&
    typeof report.project === 'string' &&
    typeof report.sasaNo === 'string' &&
    ['DRAFT', 'PENDING_SUPERVISOR', 'PENDING_GM', 'APPROVED', 'REJECTED']
      .includes(String(report.status))
  );
};

export const validateReport = (report: CncDailyReport): string | null => {
  if (!report.id.trim()) return 'ID laporan wajib diisi.';
  if (report.status !== 'DRAFT') {
    if (!report.operatorName?.trim()) return 'Nama operator wajib diisi.';
    if (!report.project?.trim()) return 'Nama project wajib diisi.';
    if (!report.sasaNo?.trim()) return 'Nomor SPK wajib diisi.';
  }
  return null;
};

export const getReports = async (): Promise<CncDailyReport[]> => {
  const sql = await database();
  const rows = reportRows(await sql`
    SELECT id, report_data
    FROM public.cnc_reports
    ORDER BY created_at DESC
  `);
  return rows.map(reportFromRow);
};

export const saveReport = async (
  incoming: CncDailyReport
): Promise<CncDailyReport> => {
  const validationError = validateReport(incoming);
  if (validationError) throw new Error(validationError);

  const sql = await database();
  const now = new Date().toISOString();
  const report: CncDailyReport = {
    ...incoming,
    createdAt: incoming.createdAt || now,
    updatedAt: now,
  };

  // Upsert atomik. ID dari client dipertahankan (mis. CNC-202609-001) agar link
  // approval & cetak tidak berubah; created_at asli tidak ditimpa saat update.
  const rows = reportRows(await sql`
    INSERT INTO public.cnc_reports (
      id, sasa_no, project, operator_name, shift, day_and_date, status,
      supervisor_token, gm_token, supervisor_name, gm_name, report_data,
      created_at, updated_at
    ) VALUES (
      ${report.id}, ${report.sasaNo || ''}, ${report.project || ''},
      ${report.operatorName || ''}, ${report.shift || ''},
      ${report.dayAndDate || ''}, ${report.status},
      ${report.supervisorToken || null}, ${report.gmToken || null},
      ${report.supervisorName || 'Mulyana'}, ${report.gmName || 'Arifin'},
      ${JSON.stringify(report)}::jsonb, ${report.createdAt}, ${now}
    )
    ON CONFLICT (id) DO UPDATE SET
      sasa_no = EXCLUDED.sasa_no,
      project = EXCLUDED.project,
      operator_name = EXCLUDED.operator_name,
      shift = EXCLUDED.shift,
      day_and_date = EXCLUDED.day_and_date,
      status = EXCLUDED.status,
      supervisor_token = EXCLUDED.supervisor_token,
      gm_token = EXCLUDED.gm_token,
      supervisor_name = EXCLUDED.supervisor_name,
      gm_name = EXCLUDED.gm_name,
      report_data = jsonb_set(EXCLUDED.report_data, '{createdAt}', to_jsonb(COALESCE(public.cnc_reports.report_data->>'createdAt', EXCLUDED.report_data->>'createdAt'))),
      updated_at = EXCLUDED.updated_at
    RETURNING id, report_data
  `);
  if (!rows[0]) throw new Error('Database tidak mengembalikan laporan yang disimpan.');
  return reportFromRow(rows[0]);
};

export type ReportLookup = {
  report: CncDailyReport;
  matchedBy: 'id' | 'supervisor_token' | 'gm_token';
};

export const getReportByIdOrToken = async (
  idOrToken: string
): Promise<ReportLookup | null> => {
  const sql = await database();
  const rows = await sql`
    SELECT id, report_data, supervisor_token, gm_token FROM public.cnc_reports
    WHERE id = ${idOrToken} OR supervisor_token = ${idOrToken} OR gm_token = ${idOrToken}
    LIMIT 1
  `;
  if (!rows[0]) return null;
  const [row] = reportRows(rows);
  const matchedBy =
    rows[0].supervisor_token === idOrToken ? 'supervisor_token'
    : rows[0].gm_token === idOrToken ? 'gm_token'
    : 'id';
  return { report: reportFromRow(row), matchedBy };
};

/** Sembunyikan token milik peran lain agar pemegang link tidak bisa menyetujui sebagai peran lain. */
export const redactForRole = (
  report: CncDailyReport,
  role: 'SUPERVISOR' | 'GM'
): CncDailyReport =>
  role === 'SUPERVISOR' ? { ...report, gmToken: '' } : { ...report, supervisorToken: '' };

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const updateReport = async (
  id: string,
  incoming: CncDailyReport
): Promise<CncDailyReport | null> => {
  const validationError = validateReport(incoming);
  if (validationError) throw new Error(validationError);

  const sql = await database();
  const now = new Date().toISOString();
  const report: CncDailyReport = { ...incoming, id, updatedAt: now };
  const rows = reportRows(await sql`
    UPDATE public.cnc_reports
    SET sasa_no = ${report.sasaNo || ''},
        project = ${report.project || ''},
        operator_name = ${report.operatorName || ''},
        shift = ${report.shift || ''},
        day_and_date = ${report.dayAndDate || ''},
        status = ${report.status},
        supervisor_token = ${report.supervisorToken || null},
        gm_token = ${report.gmToken || null},
        supervisor_name = ${report.supervisorName || 'Mulyana'},
        gm_name = ${report.gmName || 'Arifin'},
        report_data = ${JSON.stringify(report)}::jsonb,
        updated_at = ${now}
    WHERE id = ${id}
    RETURNING id, report_data
  `);
  return rows[0] ? reportFromRow(rows[0]) : null;
};

export const removeReport = async (id: string): Promise<void> => {
  const sql = await database();
  await sql`DELETE FROM public.cnc_reports WHERE id = ${id}`;
};

export const removeAllReports = async (): Promise<void> => {
  const sql = await database();
  await sql`DELETE FROM public.cnc_reports`;
};

export const approveReport = async (
  id: string,
  role: 'SUPERVISOR' | 'GM',
  decision: 'APPROVED' | 'REJECTED',
  notes: string,
  approverName: string,
  token: string
): Promise<CncDailyReport | null> => {
  const sql = await database();
  const rows = reportRows(await sql`
    SELECT id, report_data FROM public.cnc_reports WHERE id = ${id} LIMIT 1
  `);
  if (!rows[0]) return null;
  const report = reportFromRow(rows[0]);
  const expectedToken = role === 'SUPERVISOR' ? report.supervisorToken : report.gmToken;
  if (!token || !expectedToken || token !== expectedToken) {
    throw new HttpError(403, 'Token persetujuan tidak valid untuk laporan ini.');
  }
  const expectedStatus = role === 'SUPERVISOR' ? 'PENDING_SUPERVISOR' : 'PENDING_GM';
  if (report.status !== expectedStatus) {
    throw new Error(`Laporan tidak berada pada status ${expectedStatus}.`);
  }

  const now = new Date().toISOString();
  const nextStatus: ReportStatus = decision === 'REJECTED'
    ? 'REJECTED'
    : role === 'SUPERVISOR' ? 'PENDING_GM' : 'APPROVED';
  const timelineItem: ApprovalStep = {
    role,
    actorName: approverName,
    action: decision,
    fromStatus: report.status,
    toStatus: nextStatus,
    timestamp: now,
    note: notes || (role === 'SUPERVISOR'
      ? decision === 'APPROVED' ? 'Disetujui oleh Supervisor' : 'Ditolak untuk revisi'
      : decision === 'APPROVED' ? 'Disetujui Final oleh GM' : 'Ditolak oleh GM'),
  };
  const updated: CncDailyReport = {
    ...report,
    status: nextStatus,
    updatedAt: now,
    ...(role === 'SUPERVISOR'
      ? { supervisorApproval: { approvedAt: now, approverName, notes, decision } }
      : { gmApproval: { approvedAt: now, approverName, notes, decision } }),
    timeline: [...(report.timeline || []), timelineItem],
  };

  const savedRows = reportRows(await sql`
    UPDATE public.cnc_reports
    SET status = ${nextStatus},
        report_data = ${JSON.stringify(updated)}::jsonb,
        updated_at = ${now}
    WHERE id = ${id} AND status = ${expectedStatus}
    RETURNING id, report_data
  `);
  return savedRows[0] ? reportFromRow(savedRows[0]) : null;
};

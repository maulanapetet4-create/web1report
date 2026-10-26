import { CncDailyReport, ApprovalStep } from '../types';
import { auth } from '../lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';

const LEGACY_STORAGE_KEY = 'cnc_daily_reports_db_v1';
let legacyMigration: Promise<void> | undefined;

const responseError = async (response: Response): Promise<Error> => {
  const body = await response.json().catch(() => ({})) as { error?: string };
  return new Error(body.error || `Permintaan gagal (HTTP ${response.status}).`);
};

const authHeaders = async (): Promise<Record<string, string>> => {
  await new Promise<void>((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      () => {
        unsubscribe();
        resolve();
      },
      (error) => {
        unsubscribe();
        reject(error);
      }
    );
  });
  const token = await auth.currentUser?.getIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const request = async <T>(url: string, options: RequestInit = {}): Promise<T> => {
  const response = await fetch(url, {
    ...options,
    headers: { ...(await authHeaders()), ...(options.headers as Record<string, string>) },
  });
  if (!response.ok) throw await responseError(response);
  return response.json() as Promise<T>;
};

const postReportToServer = async (report: CncDailyReport): Promise<CncDailyReport> => {
  try {
    return await request<CncDailyReport>('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    });
  } catch (err) {
    console.error('Failed to save report to database:', err);
    throw err;
  }
};

export const syncReportToServer = async (report: CncDailyReport): Promise<void> => {
  await postReportToServer(report);
};

const migrateLegacyReports = async (): Promise<void> => {
  if (legacyMigration) return legacyMigration;
  legacyMigration = (async () => {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw === null) return;

    let legacyReports: CncDailyReport[];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error('Format laporan lokal lama tidak valid.');
      }
      legacyReports = parsed as CncDailyReport[];
    } catch (err) {
      console.error('Failed to read legacy reports from localStorage:', err);
      throw new Error('Data laporan lama di browser tidak dapat dibaca.');
    }

    try {
      while (legacyReports.length > 0) {
        try {
          await syncReportToServer(legacyReports[0]);
        } catch (err) {
          // Data lama yang ditolak server (HTTP 400) dibuang agar tidak memblokir aplikasi selamanya.
          if (!/tidak valid|wajib diisi/i.test(err instanceof Error ? err.message : '')) throw err;
          console.warn('Laporan lokal lama dilewati:', legacyReports[0]?.id, err);
        }
        legacyReports = legacyReports.slice(1);
        if (legacyReports.length > 0) {
          localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(legacyReports));
        } else {
          localStorage.removeItem(LEGACY_STORAGE_KEY);
        }
      }
    } catch (err) {
      legacyMigration = undefined;
      throw err;
    }
  })();
  return legacyMigration;
};

export const fetchReportsFromServer = async (): Promise<CncDailyReport[]> => {
  await migrateLegacyReports();
  try {
    return await request<CncDailyReport[]>('/api/reports');
  } catch (err) {
    console.error('Failed to load reports from database:', err);
    throw err;
  }
};

export const loadReportsFromStorage = async (): Promise<CncDailyReport[]> =>
  fetchReportsFromServer();

export const saveReportsToStorage = async (reports: CncDailyReport[]): Promise<void> => {
  for (const report of reports) {
    await syncReportToServer(report);
  }
};

export const deleteReportFromServer = async (id: string): Promise<void> => {
  await request(`/api/reports/${encodeURIComponent(id)}`, { method: 'DELETE' });
};

export const clearReportsOnServer = async (): Promise<void> => {
  await request('/api/reports/clear', { method: 'POST' });
};

const fetchOne = async (idOrToken: string): Promise<CncDailyReport | null> => {
  const response = await fetch(`/api/reports/${encodeURIComponent(idOrToken)}`, {
    headers: await authHeaders(),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw await responseError(response);
  return response.json() as Promise<CncDailyReport>;
};

export const getReportById = async (id: string): Promise<CncDailyReport | undefined> =>
  (await fetchOne(id)) ?? undefined;

export const getReportByToken = async (
  token: string
): Promise<{ report: CncDailyReport; role: 'SUPERVISOR' | 'GM' } | null> => {
  const report = await fetchOne(token);
  if (!report) return null;
  if (report.supervisorToken === token) return { report, role: 'SUPERVISOR' };
  if (report.gmToken === token) return { report, role: 'GM' };
  return null;
};

export const saveOrUpdateReportWithResult = async (
  report: CncDailyReport
): Promise<CncDailyReport> => {
  const updatedReport = { ...report, updatedAt: new Date().toISOString() };
  return postReportToServer(updatedReport);
};

export const saveOrUpdateReport = async (report: CncDailyReport): Promise<void> => {
  await saveOrUpdateReportWithResult(report);
};

export const submitReportByOperator = async (
  report: CncDailyReport
): Promise<CncDailyReport> => {
  const now = new Date().toISOString();
  const timelineItem: ApprovalStep = {
    role: 'OPERATOR',
    actorName: report.operatorName || 'Operator',
    action: 'SUBMITTED',
    fromStatus: report.status || 'DRAFT',
    toStatus: 'PENDING_SUPERVISOR',
    timestamp: now,
    note: `Laporan diajukan untuk SPK ${report.sasaNo} (${report.project})`,
  };
  const updated: CncDailyReport = {
    ...report,
    status: 'PENDING_SUPERVISOR',
    updatedAt: now,
    timeline: [
      ...(report.timeline || []).filter((item) => item.action !== 'SUBMITTED'),
      timelineItem,
    ],
  };
  return saveOrUpdateReportWithResult(updated);
};

const processApproval = async (
  reportId: string,
  role: 'SUPERVISOR' | 'GM',
  decision: 'APPROVED' | 'REJECTED',
  notes: string,
  approverName: string,
  token: string
): Promise<CncDailyReport> => {
  const path = `/api/reports/${encodeURIComponent(reportId)}/approval`;
  try {
    return await request<CncDailyReport>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, decision, notes, approverName, token }),
    });
  } catch (err) {
    console.error(`Failed to process ${role} approval:`, err);
    throw err;
  }
};

export const processSupervisorApproval = (
  reportId: string,
  decision: 'APPROVED' | 'REJECTED',
  notes: string,
  token: string,
  approverName = 'Mulyana'
): Promise<CncDailyReport> =>
  processApproval(reportId, 'SUPERVISOR', decision, notes, approverName, token);

export const processGmApproval = (
  reportId: string,
  decision: 'APPROVED' | 'REJECTED',
  notes: string,
  token: string,
  approverName = 'Arifin'
): Promise<CncDailyReport> =>
  processApproval(reportId, 'GM', decision, notes, approverName, token);

export const resetReportsToDemo = async (): Promise<CncDailyReport[]> => {
  await clearReportsOnServer();
  const { INITIAL_REPORTS } = await import('./mockReports');
  const saved: CncDailyReport[] = [];
  for (const report of INITIAL_REPORTS) {
    saved.push(await postReportToServer(report));
  }
  return saved;
};

export const deleteReport = async (id: string): Promise<void> => {
  await deleteReportFromServer(id);
};

export const clearAllReportsToZero = async (): Promise<void> => {
  await clearReportsOnServer();
};

export const getApprovalUrl = (
  token: string,
  role: 'supervisor' | 'gm',
  _reportId?: string
): string => {
  const baseUrl = window.location.origin + window.location.pathname;
  const roleCode = role === 'supervisor' ? 'spv' : 'gm';
  return `${baseUrl}#/${roleCode}/${token}`;
};

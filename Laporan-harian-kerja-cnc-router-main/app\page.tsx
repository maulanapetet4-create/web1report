import React, { useState, useEffect } from 'react';
import { 
  saveOrUpdateReportWithResult,
  submitReportByOperator, 
  resetReportsToDemo, 
  getReportById,
  deleteReport,
  clearAllReportsToZero,
  fetchReportsFromServer,
  getReportByToken
} from './services/reportStorage';
import { createNewBlankReport } from './services/mockReports';
import { CncDailyReport } from './types';
import { HeaderNav } from './components/HeaderNav';
import { OperatorForm } from './components/OperatorForm';
import { TrackingDashboard } from './components/TrackingDashboard';
import { ApprovalView } from './components/ApprovalView';
import { PhysicalFormPrint } from './components/PhysicalFormPrint';
import { ApprovalShareModal } from './components/ApprovalShareModal';
import { SqlEditor } from './components/SqlEditor';
import { initAuth, googleSignIn, logout as googleLogout } from './lib/firebase';
import { syncUserToServer } from './services/userSync';
import { User } from 'firebase/auth';
import { CheckCircle2 } from 'lucide-react';

export default function App() {
  const [reports, setReports] = useState<CncDailyReport[]>([]);
  const [currentView, setCurrentView] = useState<'dashboard' | 'form' | 'approval' | 'print' | 'sql'>('dashboard');
  const [activeReport, setActiveReport] = useState<CncDailyReport | null>(null);
  const [approvalRole, setApprovalRole] = useState<'supervisor' | 'gm'>('supervisor');
  const [shareModalReport, setShareModalReport] = useState<CncDailyReport | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Google Drive & Firebase User State
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [driveAccessToken, setDriveAccessToken] = useState<string | null>(null);

  // Listen to Google Auth state
  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => {
        setCurrentUser(user);
        setDriveAccessToken(token || null);
        syncUserToServer(user);
      },
      () => {
        setCurrentUser(null);
        setDriveAccessToken(null);
      }
    );
    return () => unsubscribe();
  }, []);

  const handleGoogleSignIn = async () => {
    try {
      const res = await googleSignIn();
      if (res) {
        setCurrentUser(res.user);
        setDriveAccessToken(res.accessToken);
        showToast(`Berhasil login Google: ${res.user.displayName || res.user.email}`);

        syncUserToServer(res.user);
      }
    } catch (err: any) {
      console.error('Google Sign In failed:', err);
      showToast('Gagal menghubungkan akun Google.');
    }
  };

  const handleGoogleSignOut = async () => {
    try {
      await googleLogout();
      setCurrentUser(null);
      setDriveAccessToken(null);
      showToast('Berhasil keluar dari akun Google.');
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  // Muat laporan dari database Neon setelah login (daftar laporan wajib login).
  useEffect(() => {
    if (!currentUser) {
      setReports([]);
      return;
    }
    let isMounted = true;
    fetchReportsFromServer().then((serverReports) => {
      if (isMounted) {
        setReports(serverReports);
        setActiveReport((prev) => prev ?? serverReports[0] ?? null);
      }
    }).catch((err: unknown) => {
      console.error('Failed to initialize reports:', err);
      if (isMounted) showToast(err instanceof Error ? err.message : 'Gagal memuat laporan dari database.');
    });
    return () => { isMounted = false; };
  }, [currentUser?.uid]);

  // Check URL hash for direct approval links (#/spv/CNC-... or #/gm/CNC-... or legacy #approval?...)
  useEffect(() => {
    const checkHashRoute = async () => {
      const hash = window.location.hash;
      if (!hash) return;

      let role: 'supervisor' | 'gm' = 'supervisor';
      let searchKey = '';

      // Pattern 1: Short Clean Format (e.g. #/spv/CNC-2026-001 or #/gm/CNC-2026-001)
      const shortMatch = hash.match(/^#\/(spv|gm)\/([^?&]+)/i);
      if (shortMatch) {
        role = shortMatch[1].toLowerCase() === 'gm' ? 'gm' : 'supervisor';
        searchKey = decodeURIComponent(shortMatch[2]);
      } 
      // Pattern 2: Legacy query format (#approval?token=...&role=...&id=...)
      else if (hash.startsWith('#approval')) {
        const queryStr = hash.split('?')[1];
        if (queryStr) {
          const params = new URLSearchParams(queryStr);
          const legacyRole = params.get('role');
          role = legacyRole === 'gm' ? 'gm' : 'supervisor';
          searchKey = params.get('id') || params.get('token') || '';
        }
      }

      if (searchKey) {
        // Fetch latest state from central server first
        // Link approval memakai token (publik, tanpa login). ID laporan hanya untuk user yang login.
        const byToken = await getReportByToken(searchKey);
        const target = byToken?.report ?? (currentUser ? await getReportById(searchKey) : undefined);

        if (!target) {
          showToast('Laporan tidak ditemukan atau link tidak valid.');
          return;
        }
        if (byToken) role = byToken.role === 'GM' ? 'gm' : 'supervisor';
        setActiveReport(target);
        setApprovalRole(role);
        setCurrentView('approval');
      }
    };

    checkHashRoute().catch((err: unknown) => {
      console.error('Failed to open approval link:', err);
      showToast(err instanceof Error ? err.message : 'Gagal memuat laporan approval.');
    });
    window.addEventListener('hashchange', checkHashRoute);
    return () => window.removeEventListener('hashchange', checkHashRoute);
  }, [currentUser?.uid]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Actions
  const handleNewReport = () => {
    const fresh = createNewBlankReport('');
    setActiveReport(fresh);
    setCurrentView('form');
  };

  const handleSaveDraft = async (report: CncDailyReport): Promise<CncDailyReport> => {
    const saved = await saveOrUpdateReportWithResult(report);
    setReports((prev) => [saved, ...prev.filter((item) => item.id !== saved.id)]);
    setActiveReport(saved);
    showToast('Draft berhasil disimpan ke database.');
    return saved;
  };

  const handleSubmitReport = async (report: CncDailyReport): Promise<CncDailyReport> => {
    const submitted = await submitReportByOperator(report);
    setReports((prev) => [submitted, ...prev.filter((item) => item.id !== submitted.id)]);
    setActiveReport(submitted);
    setShareModalReport(submitted);
    showToast('Laporan berhasil disimpan ke database; tautan persetujuan telah diterbitkan.');
    return submitted;
  };

  const handleUpdateReportFromApproval = (updated: CncDailyReport) => {
    setReports((prev) => prev.map((item) => item.id === updated.id ? updated : item));
    setActiveReport(updated);
  };

  const handleResetData = async () => {
    if (confirm('Reset seluruh data ke data contoh pabrik bawaan?')) {
      try {
        const resetList = await resetReportsToDemo();
        setReports(resetList);
        setActiveReport(resetList[0] || null);
        setCurrentView('dashboard');
        showToast('Data demo berhasil disimpan ke database.');
      } catch (err) {
        console.error('Failed to reset demo reports:', err);
        showToast(err instanceof Error ? err.message : 'Gagal mereset data demo.');
      }
    }
  };

  const handleDeleteReport = async (id: string) => {
    try {
      await deleteReport(id);
      const updated = await fetchReportsFromServer();
      setReports(updated);
      if (activeReport?.id === id) {
        setActiveReport(updated[0] || null);
      }
      showToast(`Laporan ${id} telah dihapus.`);
    } catch (err) {
      console.error('Failed to delete report:', err);
      showToast(err instanceof Error ? err.message : 'Gagal menghapus laporan.');
    }
  };

  const handleClearAllReports = async () => {
    try {
      await clearAllReportsToZero();
      setReports([]);
      setActiveReport(null);
      showToast('Seluruh data laporan berhasil dibersihkan.');
    } catch (err) {
      console.error('Failed to clear reports:', err);
      showToast(err instanceof Error ? err.message : 'Gagal membersihkan laporan.');
    }
  };

  const handleOpenApproval = async (reportId: string, role: 'supervisor' | 'gm') => {
    try {
      const target = reports.find((r) => r.id === reportId) || await getReportById(reportId);
      if (!target) {
        showToast('Laporan tidak ditemukan di database.');
        return;
      }
      setActiveReport(target);
      setApprovalRole(role);
      setCurrentView('approval');
    } catch (err) {
      console.error('Failed to load report for approval:', err);
      showToast(err instanceof Error ? err.message : 'Gagal memuat laporan.');
    }
  };

  const handleNavigatePrint = (report: CncDailyReport) => {
    setActiveReport(report);
    setCurrentView('print');
  };

  // Stats calculation
  const stats = {
    total: reports.length,
    pendingSupervisor: reports.filter((r) => r.status === 'PENDING_SUPERVISOR').length,
    pendingGm: reports.filter((r) => r.status === 'PENDING_GM').length,
    approved: reports.filter((r) => r.status === 'APPROVED').length,
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-20 right-4 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-2xl border border-slate-700 flex items-center gap-3 text-xs animate-in slide-in-from-top-4 duration-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Header */}
      {currentView !== 'print' && (
        <HeaderNav
          currentView={currentView}
          onNavigate={(v: 'dashboard' | 'form' | 'approval' | 'print' | 'sql') => {
            setCurrentView(v);
            if (v === 'dashboard') {
              window.location.hash = '';
            }
          }}
          onNewReport={handleNewReport}
          onResetData={handleResetData}
          currentUser={currentUser}
          onGoogleSignIn={handleGoogleSignIn}
          onGoogleSignOut={handleGoogleSignOut}
          stats={stats}
        />
      )}

      {/* Main Content Area */}
      <main className="flex-1 pb-16">
        {currentView === 'dashboard' && !currentUser && (
          <div className="mx-auto max-w-3xl px-4 pt-8 text-center text-sm text-slate-600">
            Login dengan akun Google (tombol di pojok atas) untuk melihat dan mengelola laporan.
          </div>
        )}

        {currentView === 'dashboard' && currentUser && (
          <TrackingDashboard
            reports={reports}
            onSelectReport={(r) => {
              setActiveReport(r);
              setCurrentView('form');
            }}
            onEditReport={(r) => {
              setActiveReport(r);
              setCurrentView('form');
            }}
            onOpenApproval={handleOpenApproval}
            onNavigatePrint={handleNavigatePrint}
            onOpenShareModal={(r) => setShareModalReport(r)}
            onNewReport={handleNewReport}
            onDeleteReport={handleDeleteReport}
            onClearAllReports={handleClearAllReports}
            onResetData={handleResetData}
          />
        )}

        {currentView === 'form' && activeReport && (
          <OperatorForm
            report={activeReport}
            onSaveDraft={handleSaveDraft}
            onSubmitReport={handleSubmitReport}
            onCancel={() => setCurrentView('dashboard')}
          />
        )}

        {currentView === 'approval' && activeReport && (
          <ApprovalView
            report={activeReport}
            role={approvalRole}
            onUpdateReport={handleUpdateReportFromApproval}
            onNavigateDashboard={() => {
              window.location.hash = '';
              setCurrentView('dashboard');
            }}
            onNavigatePrint={handleNavigatePrint}
            onOpenShareModal={(r) => setShareModalReport(r)}
          />
        )}

        {currentView === 'print' && activeReport && (
          <PhysicalFormPrint
            report={activeReport}
            onBack={() => setCurrentView('dashboard')}
          />
        )}

        {currentView === 'sql' && currentUser && <SqlEditor currentUser={currentUser} />}
      </main>

      {/* Share / Unique Link & Google Drive Modal */}
      {shareModalReport && (
        <ApprovalShareModal
          report={shareModalReport}
          isOpen={!!shareModalReport}
          onClose={() => setShareModalReport(null)}
          onOpenApproval={(id, role) => {
            setShareModalReport(null);
            handleOpenApproval(id, role);
          }}
          currentUser={currentUser}
          accessToken={driveAccessToken}
          onGoogleSignIn={handleGoogleSignIn}
          onGoogleSignOut={handleGoogleSignOut}
        />
      )}
    </div>
  );
}

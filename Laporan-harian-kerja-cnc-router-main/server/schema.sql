-- Skema database Neon untuk aplikasi Laporan Harian CNC.
-- Aman dijalankan berulang kali (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS public.users (
  uid          TEXT PRIMARY KEY,
  email        TEXT NOT NULL,
  display_name TEXT,
  photo_url    TEXT,
  created_at   TIMESTAMP DEFAULT NOW(),
  updated_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.cnc_reports (
  id              TEXT PRIMARY KEY,
  sasa_no         TEXT NOT NULL,
  project         TEXT NOT NULL,
  operator_name   TEXT NOT NULL,
  shift           TEXT NOT NULL,
  day_and_date    TEXT NOT NULL,
  status          TEXT NOT NULL,
  supervisor_token TEXT,
  gm_token        TEXT,
  supervisor_name TEXT DEFAULT 'Mulyana',
  gm_name         TEXT DEFAULT 'Arifin',
  report_data     JSONB NOT NULL,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cnc_reports_supervisor_token_idx ON public.cnc_reports (supervisor_token);
CREATE INDEX IF NOT EXISTS cnc_reports_gm_token_idx ON public.cnc_reports (gm_token);
CREATE INDEX IF NOT EXISTS cnc_reports_created_at_idx ON public.cnc_reports (created_at DESC);

import React, { useState } from 'react';
import { User } from 'firebase/auth';
import { AlertCircle, Database, Play, Table2 } from 'lucide-react';

interface SqlEditorProps {
  currentUser: User | null;
}

interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
}

const STARTER_QUERY = `SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY table_schema, table_name;`;

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export const SqlEditor: React.FC<SqlEditorProps> = ({ currentUser }) => {
  const [query, setQuery] = useState(STARTER_QUERY);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const runQuery = async () => {
    if (!currentUser) {
      setError('Silakan login terlebih dahulu untuk menggunakan SQL Editor.');
      return;
    }

    setIsRunning(true);
    setError(null);
    setResult(null);
    try {
      const idToken = await currentUser.getIdToken();
      const response = await fetch('/api/sql-editor/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ query }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Query gagal dijalankan.');
      }
      setResult(data as QueryResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan saat menjalankan query.');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-start gap-3">
        <div className="rounded-xl bg-blue-100 p-3 text-blue-700">
          <Database className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-slate-900">SQL Editor</h2>
          <p className="mt-1 text-sm text-slate-600">
            Jalankan query baca saja ke database PostgreSQL Neon. Maksimal 500 baris per hasil.
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Table2 className="h-4 w-4 text-slate-500" />
            Query PostgreSQL
          </div>
          <button
            type="button"
            onClick={runQuery}
            disabled={isRunning || !query.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            {isRunning ? 'Menjalankan...' : 'Jalankan'}
          </button>
        </div>

        <textarea
          aria-label="Query SQL"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          spellCheck={false}
          className="min-h-56 w-full resize-y bg-slate-950 p-4 font-mono text-sm leading-6 text-emerald-300 outline-none placeholder:text-slate-500"
          placeholder="SELECT * FROM nama_tabel LIMIT 100;"
        />
        <div className="border-t border-slate-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          Hanya satu perintah <code className="font-bold">SELECT</code>/<code className="font-bold">WITH</code> yang
          diterima. Transaksi database juga dipaksa read-only.
        </div>
      </div>

      {error && (
        <div role="alert" className="mt-5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 text-sm">
            <strong className="text-slate-800">Hasil Query</strong>
            <span className="text-slate-500">
              {result.rowCount} baris{result.truncated ? ' (hasil dipotong, tampilkan LIMIT lebih kecil)' : ''}
            </span>
          </div>
          {result.columns.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">Query berhasil, tidak ada kolom/baris untuk ditampilkan.</p>
          ) : result.rows.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">Query berhasil, tidak ada data yang cocok.</p>
          ) : (
            <div className="custom-scrollbar max-h-[60vh] overflow-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                <thead className="sticky top-0 bg-slate-50">
                  <tr>
                    {result.columns.map((column, index) => (
                      <th key={`${column}-${index}`} className="whitespace-nowrap px-4 py-3 font-semibold text-slate-700">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {result.rows.map((row, rowIndex) => (
                    <tr key={rowIndex} className="hover:bg-slate-50">
                      {result.columns.map((column, columnIndex) => {
                        const value = formatCell(row[column]);
                        return (
                          <td
                            key={`${column}-${columnIndex}`}
                            title={value}
                            className="max-w-sm whitespace-nowrap px-4 py-2.5 text-slate-600"
                          >
                            <span className="block max-w-sm truncate">{value}</span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

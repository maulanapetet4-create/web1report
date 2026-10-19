      columns: result.fields.map((f) => f.name),
      rows: result.rows.slice(0, MAX_ROWS),
      rowCount: result.rowCount ?? result.rows.length,
      truncated: result.rows.length > MAX_ROWS,
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Query gagal dijalankan." });
  }
}));
app.use("/api", (_req, res) => res.status(404).json({ error: "Endpoint tidak ditemukan." }));
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("API error:", err);
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof Error ? err.message : "Terjadi kesalahan server.";
  // Jangan ekspose detail error DATABASE_URL di production
  const safeMessage =
    process.env.NODE_ENV === "production" && status === 500
      ? "Terjadi kesalahan server. Silakan coba lagi."
      : message;
  res.status(status).json({ error: safeMessage });
});
export default app;

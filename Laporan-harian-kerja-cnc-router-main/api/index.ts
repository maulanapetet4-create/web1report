// Entry point serverless Vercel: semua /api/* diarahkan ke sini (lihat vercel.json).
import 'dotenv/config';
import app from '../server/app.js';

export default app;

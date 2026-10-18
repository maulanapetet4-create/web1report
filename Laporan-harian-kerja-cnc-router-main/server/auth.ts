import type { NextFunction, Request, Response } from 'express';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// Project ID Firebase bukan rahasia; bisa di-override lewat env.
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'web1report';

if (!getApps().length) initializeApp({ projectId: PROJECT_ID });

export type AuthedRequest = Request & { user?: { uid: string; email?: string } };

const adminEmails = () =>
  (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

const verify = async (req: Request) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  try {
    return await getAuth().verifyIdToken(token);
  } catch {
    return null;
  }
};

/** Mengembalikan user bila token valid, selain itu null (tanpa menolak request). */
export const getUser = async (req: Request) => {
  const decoded = await verify(req);
  return decoded ? { uid: decoded.uid, email: decoded.email } : null;
};

/** Wajib login Google (token Firebase valid). */
export const requireUser = async (req: AuthedRequest, res: Response, next: NextFunction) => {
  const decoded = await verify(req);
  if (!decoded) return res.status(401).json({ error: 'Silakan login Google terlebih dahulu.' });
  req.user = { uid: decoded.uid, email: decoded.email };
  next();
};

/** Wajib login DAN email terdaftar di ADMIN_EMAILS. */
export const requireAdmin = async (req: AuthedRequest, res: Response, next: NextFunction) => {
  const decoded = await verify(req);
  if (!decoded) return res.status(401).json({ error: 'Silakan login Google terlebih dahulu.' });
  const admins = adminEmails();
  if (admins.length === 0) {
    return res.status(403).json({ error: 'ADMIN_EMAILS belum dikonfigurasi di server.' });
  }
  if (!decoded.email || !decoded.email_verified || !admins.includes(decoded.email.toLowerCase())) {
    return res.status(403).json({ error: 'Akun ini tidak memiliki akses admin.' });
  }
  req.user = { uid: decoded.uid, email: decoded.email };
  next();
};


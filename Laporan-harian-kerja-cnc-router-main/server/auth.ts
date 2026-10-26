import { getAuth, FirebaseAuthError, type DecodedIdToken } from 'firebase-admin/auth';
import { getApps, initializeApp } from 'firebase-admin/app';
import type { NextFunction, Request, Response } from 'express';

const projectId =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.GCLOUD_PROJECT ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  'web1report';
const firebaseApp = getApps()[0] ?? initializeApp({ projectId });

export type AuthedRequest = Request & {
  user?: { uid: string; email?: string };
};

const adminEmails = (): string[] =>
  (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

const verify = async (req: Request): Promise<DecodedIdToken | null> => {
  const authorization = req.header('authorization');
  if (!authorization?.startsWith('Bearer ')) return null;

  const token = authorization.slice('Bearer '.length).trim();
  if (!token) return null;

  try {
    return await getAuth(firebaseApp).verifyIdToken(token);
  } catch (err) {
    if (err instanceof FirebaseAuthError) return null;
    throw err;
  }
};

export const authenticateOptional = async (
  req: AuthedRequest,
  _res: Response,
  next: NextFunction
) => {
  try {
    const decoded = await verify(req);
    if (decoded) req.user = { uid: decoded.uid, email: decoded.email };
    next();
  } catch (err) {
    next(err);
  }
};

export const requireAuth = async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const decoded = await verify(req);
    if (!decoded) return res.status(401).json({ error: 'Silakan login Google terlebih dahulu.' });
    req.user = { uid: decoded.uid, email: decoded.email };
    next();
  } catch (err) {
    next(err);
  }
};

/** Wajib login DAN email terdaftar di ADMIN_EMAILS. */
export const requireAdmin = async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const decoded = await verify(req);
    if (!decoded) return res.status(401).json({ error: 'Silakan login Google terlebih dahulu.' });
    const admins = adminEmails();
    if (admins.length === 0) {
      return res.status(403).json({ error: 'ADMIN_EMAILS belum dikonfigurasi di server.' });
    }
    if (!decoded.email || !decoded.email_verified || !admins.includes(decoded.email.toLowerCase())) {
      return res.status(403).json({ error: 'Akun ini tidak memiliki akses admin.' });
    }
  

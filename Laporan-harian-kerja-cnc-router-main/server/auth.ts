    const decoded = await verify(req);
    if (!decoded) return res.status(401).json({ error: "Silakan login Google terlebih dahulu." });
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
    if (!decoded) return res.status(401).json({ error: "Silakan login Google terlebih dahulu." });
    const admins = adminEmails();
    if (admins.length === 0) {
      return res.status(403).json({ error: "ADMIN_EMAILS belum dikonfigurasi di server." });
    }
    if (!decoded.email || !decoded.email_verified || !admins.includes(decoded.email.toLowerCase())) {
      return res.status(403).json({ error: "Akun ini tidak memiliki akses admin." });
    }
    req.user = { uid: decoded.uid, email: decoded.email };
    next();
  } catch (err) {
    next(err);
  }
};



import type { User } from 'firebase/auth';

/** Menyimpan profil akun Google ke tabel users di Neon (gagal diam-diam, tidak mengganggu UI). */
export const syncUserToServer = async (user: User): Promise<void> => {
  try {
    const token = await user.getIdToken();
    const res = await fetch('/api/users/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoUrl: user.photoURL,
      }),
    });
    if (!res.ok) console.warn('Sinkron user gagal:', res.status);
  } catch (err) {
    console.warn('Sinkron user gagal:', err);
  }
};

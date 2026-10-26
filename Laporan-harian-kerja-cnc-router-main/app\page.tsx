import { neon } from '@neondatabase/serverless';
import process from 'node:process';

export default function Page() {
  // Fungsi Server Action untuk memproses data form di sisi server
  async function create(formData: FormData) {
    'use server';
    
    // Menghubungkan ke database Neon menggunakan variabel lingkungan (environment variable)
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL belum dikonfigurasi.');
    }
    const sql = neon(databaseUrl);
    
    // Mengambil nilai input dari form berdasarkan atribut name="comment"
    const comment = formData.get('comment');
    
    // Memasukkan data komentar ke dalam tabel 'comments' di Postgres
    await sql`INSERT INTO comments (comment) VALUES (${comment})`;
  }

  return (
    <form action={create}>
      <input type="text" placeholder="write a comment" name="comment" />
      <button type="submit">Submit</button>
    </form>
  );
}

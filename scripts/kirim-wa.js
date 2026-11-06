// Kirim satu pesan WhatsApp lewat antrean aplikasi (tabel wa_queue).
// Pesan dikirim oleh worker WA yang sudah berjalan di server, memakai nomor
// pengirim dari tabel wa_pengirim, sehingga batas kirim per nomor tetap dipatuhi.
//
// Pemakaian (dari folder backend):
//   node scripts/kirim-wa.js --target 082132599037 --pesan "Halo"
//   node scripts/kirim-wa.js --target 082132599037 --pesan "Halo" --tunggu 90
//   node scripts/kirim-wa.js --target 082132599037 --pesan "Halo" --pengirim kelas_7a
//
// --tunggu N      menunggu sampai N detik untuk melihat status akhir (sent/failed).
// --kunci TEKS    penanda awal pesan; bila pesan berpenanda sama sudah pernah
//                 terkirim ke nomor itu, pesan tidak dikirim ulang.
// --jendela-hari N  rentang pengecekan penanda (bawaan 7 hari).
//
// Kode keluar: 0 = terkirim, 1 = gagal/belum terkirim, 2 = sudah pernah terkirim.

const db = require('../config/db');

const bacaArgumen = (argv) => {
  const hasil = {};
  for (let i = 0; i < argv.length; i += 1) {
    const bagian = argv[i];
    if (!bagian.startsWith('--')) continue;
    const nama = bagian.slice(2);
    const nilai = argv[i + 1];
    if (nilai === undefined || nilai.startsWith('--')) {
      hasil[nama] = true;
    } else {
      hasil[nama] = nilai;
      i += 1;
    }
  }
  return hasil;
};

// Fonnte menerima 08xxx maupun 62xxx; simpan dalam bentuk 62 agar konsisten.
const rapikanNomor = (nomor) => {
  const angka = String(nomor ?? '').replace(/\D/g, '');
  if (!angka) return '';
  if (angka.startsWith('62')) return angka;
  if (angka.startsWith('0')) return `62${angka.slice(1)}`;
  if (angka.startsWith('8')) return `62${angka}`;
  return angka;
};

const pilihPengirim = async (kode) => {
  if (kode) {
    const [baris] = await db.query(
      'SELECT kode, nama, token FROM wa_pengirim WHERE kode=? AND aktif=1 LIMIT 1',
      [kode]
    );
    if (baris.length === 0) throw new Error(`Pengirim '${kode}' tidak ada atau tidak aktif`);
    if (!baris[0].token) throw new Error(`Pengirim '${kode}' belum punya token`);
    return baris[0];
  }
  const [baris] = await db.query(
    "SELECT kode, nama, token FROM wa_pengirim WHERE aktif=1 AND token<>'' ORDER BY kode LIMIT 1"
  );
  if (baris.length === 0) throw new Error('Tidak ada nomor pengirim aktif dengan token');
  return baris[0];
};

const tungguStatus = async (id, detik) => {
  const batas = Date.now() + detik * 1000;
  let terakhir = null;
  while (Date.now() < batas) {
    const [baris] = await db.query(
      'SELECT status, attempts, last_error, sent_at FROM wa_queue WHERE id=?',
      [id]
    );
    if (baris.length === 0) return { status: 'hilang' };
    terakhir = baris[0];
    if (['sent', 'failed', 'expired'].includes(terakhir.status)) return terakhir;
    await new Promise((selesai) => setTimeout(selesai, 3000));
  }
  return terakhir || { status: 'pending' };
};

const utama = async () => {
  const arg = bacaArgumen(process.argv.slice(2));
  if (arg.bantuan || arg.help) {
    console.log('Pemakaian: node scripts/kirim-wa.js --target <nomor> --pesan <teks> [--pengirim <kode>] [--tunggu <detik>] [--kunci <teks>] [--jendela-hari <n>]');
    return;
  }

  const target = rapikanNomor(arg.target);
  const pesan = typeof arg.pesan === 'string' ? arg.pesan.trim() : '';
  if (!target) throw new Error('--target wajib diisi, contoh: 082132599037');
  if (!pesan) throw new Error('--pesan wajib diisi');

  const pengirim = await pilihPengirim(typeof arg.pengirim === 'string' ? arg.pengirim : '');
  const jenis = 'pengumuman';

  const kunci = typeof arg.kunci === 'string' ? arg.kunci.trim() : '';
  if (kunci) {
    const hari = Number(arg['jendela-hari']) > 0 ? Number(arg['jendela-hari']) : 7;
    const batas = new Date(Date.now() - hari * 24 * 60 * 60 * 1000);
    const [sudah] = await db.query(
      "SELECT id, sent_at FROM wa_queue WHERE target=? AND jenis=? AND status='sent' AND pesan LIKE ? AND created_at >= ? LIMIT 1",
      [target, jenis, `${kunci}%`, batas]
    );
    if (sudah.length > 0) {
      console.log(`SUDAH_TERKIRIM #${sudah[0].id} pada ${sudah[0].sent_at}`);
      process.exitCode = 2;
      return;
    }
  }

  const [hasil] = await db.query(
    'INSERT INTO wa_queue (target, pesan, jenis, pengirim) VALUES (?, ?, ?, ?)',
    [target, pesan, jenis, pengirim.kode]
  );

  const keluaran = { id: hasil.insertId, target, pengirim: pengirim.kode, jenis };
  console.log(`Masuk antrean #${hasil.insertId} untuk ${target} lewat ${pengirim.kode} (${pengirim.nama})`);

  const detik = Number(arg.tunggu) > 0 ? Number(arg.tunggu) : 0;
  if (detik > 0) {
    const akhir = await tungguStatus(hasil.insertId, detik);
    console.log(JSON.stringify({ ...keluaran, ...akhir }));
    if (akhir.status !== 'sent') process.exitCode = 1;
  }
};

utama()
  .catch((err) => {
    console.error(`GAGAL: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => db.end());

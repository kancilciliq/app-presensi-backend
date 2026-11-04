/* =====================================================================
   rekapBulananService.js - rekap presensi BULANAN per siswa
   Menggabungkan 3 sumber data:
     1. tabel presensi        -> scan datang (waktu_masuk) & scan pulang (waktu_pulang)
     2. tabel presensi_mapel  -> status H/I/S/A per jam pelajaran 1-4
     3. tabel siswa           -> daftar siswa

   ATURAN STATUS HARIAN (satu siswa, satu hari efektif):
     a. Scan datang DAN pulang lengkap:
          - semua jam 1-4 sudah diisi guru & tidak ada yang H  -> otomatis A
            (kalau di jam-jam itu ada I/S, yang dipakai I/S terbanyak)
          - selain itu                                        -> H
     b. Scan datang/pulang tidak lengkap (tidak scan sama sekali,
        atau hanya salah satu):
          - guru mengisi I atau S pada salah satu jam         -> I / S
          - selain itu                                        -> otomatis A

   HARI EFEKTIF = tanggal yang punya minimal satu scan datang (siswa mana
   pun). Hari ini ikut dihitung setelah JAM PULANG DIBUKA (Pengaturan Jam ->
   jam_pulang_mulai); sebelum itu dihitung sampai kemarin. Selama scan pulang
   belum lengkap, siswa yang belum scan pulang tampil A sementara.
   Sabtu/Minggu/libur otomatis tidak ikut karena tidak ada scan.
   ===================================================================== */
const db = require('../config/db');
const { ambilPengaturan } = require('./pengaturanService');
const { jamKeMenit, menitDalamHari } = require('./waktuService');

const JAM = [1, 2, 3, 4];
const BULAN_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// I/S terbanyak dari daftar status jam pelajaran; null jika tidak ada. Seri -> S.
const izinSakitDominan = (daftarStatus) => {
  const i = daftarStatus.filter((s) => s === 'I').length;
  const s = daftarStatus.filter((x) => x === 'S').length;
  if (!i && !s) return null;
  return s >= i ? 'S' : 'I';
};

/* Murni (tanpa database) supaya mudah diuji.
   masuk, pulang : boolean (sudah scan datang / pulang hari itu)
   mapel         : { 1: 'H', 2: 'A', ... } status per jam yang sudah diisi guru */
function tentukanStatusHari({ masuk, pulang, mapel = {} }) {
  const terisi = Object.values(mapel);

  if (masuk && pulang) {
    const semuaJamTerisi = JAM.every((j) => mapel[j]);
    const tidakAdaYangHadir = JAM.every((j) => mapel[j] && mapel[j] !== 'H');
    if (semuaJamTerisi && tidakAdaYangHadir) return izinSakitDominan(terisi) || 'A';
    return 'H';
  }
  return izinSakitDominan(terisi) || 'A';
}

// '2026-11' -> { awal: '2026-11-01', akhirEksklusif: '2026-12-01' }
const batasBulan = (bulan) => {
  const [y, m] = bulan.split('-').map(Number);
  const berikut = new Date(Date.UTC(y, m, 1)); // bulan berikutnya (m sudah 1-based)
  const akhirEksklusif = `${berikut.getUTCFullYear()}-${String(berikut.getUTCMonth() + 1).padStart(2, '0')}-01`;
  return { awal: `${bulan}-01`, akhirEksklusif };
};

async function susunRekapBulanan({ bulan, kelas = null }) {
  const { awal, akhirEksklusif } = batasBulan(bulan);

  const paramSiswa = [];
  let sqlSiswa = 'SELECT nis, nama, kelas FROM siswa';
  if (kelas) { sqlSiswa += ' WHERE kelas = ?'; paramSiswa.push(kelas); }
  sqlSiswa += ' ORDER BY kelas, nama';
  const [siswa] = await db.query(sqlSiswa, paramSiswa);

  // Hari ini ikut dihitung hanya jika jam pulang sudah dibuka (zona waktu sekolah)
  const pengaturan = await ambilPengaturan();
  const hariIniDihitung = menitDalamHari(new Date()) >= jamKeMenit(pengaturan.jam_pulang_mulai);
  const BATAS_ATAS = hariIniDihitung ? 'DATE_ADD(CURDATE(), INTERVAL 1 DAY)' : 'CURDATE()'; // konstanta, bukan input pengguna

  // Hari efektif: tanggal dengan scan datang
  const [hariRows] = await db.query(
    `SELECT DISTINCT DATE_FORMAT(waktu_masuk, '%Y-%m-%d') AS tanggal
     FROM presensi
     WHERE waktu_masuk >= ? AND waktu_masuk < ? AND waktu_masuk < ${BATAS_ATAS}
     ORDER BY tanggal`,
    [awal, akhirEksklusif]
  );
  const hari = hariRows.map((r) => ({ tanggal: r.tanggal, hari: Number(r.tanggal.slice(8, 10)) }));
  // Tanda untuk layar: hari ini sudah masuk hitungan tapi scan pulang masih berjalan
  const [hi] = await db.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hariIni");
  const sementara = hariIniDihitung && hari.some((h) => h.tanggal === hi[0].hariIni);
  if (!hari.length || !siswa.length) {
    return { bulan, hari, sementara, siswa: siswa.map((s) => ({ ...s, harian: [], h: 0, i: 0, s: 0, a: 0, total: 0, persen: null })) };
  }

  const gabung = kelas ? ' AND s.kelas = ?' : '';
  const paramKelas = kelas ? [kelas] : [];

  const [scan] = await db.query(
    `SELECT p.nis, DATE_FORMAT(p.waktu_masuk, '%Y-%m-%d') AS tanggal,
            MAX(p.waktu_pulang IS NOT NULL) AS pulang
     FROM presensi p JOIN siswa s ON s.nis = p.nis${gabung}
     WHERE p.waktu_masuk >= ? AND p.waktu_masuk < ? AND p.waktu_masuk < ${BATAS_ATAS}
     GROUP BY p.nis, DATE_FORMAT(p.waktu_masuk, '%Y-%m-%d')`,
    [...paramKelas, awal, akhirEksklusif]
  );
  const [mapelRows] = await db.query(
    `SELECT pm.nis, DATE_FORMAT(pm.tanggal, '%Y-%m-%d') AS tanggal, pm.jam, pm.status
     FROM presensi_mapel pm JOIN siswa s ON s.nis = pm.nis${gabung}
     WHERE pm.tanggal >= ? AND pm.tanggal < ?`,
    [...paramKelas, awal, akhirEksklusif]
  );

  const petaScan = new Map(scan.map((r) => [`${r.nis}|${r.tanggal}`, !!Number(r.pulang)]));
  const petaMapel = new Map();
  for (const r of mapelRows) {
    const kunci = `${r.nis}|${r.tanggal}`;
    if (!petaMapel.has(kunci)) petaMapel.set(kunci, {});
    petaMapel.get(kunci)[r.jam] = r.status;
  }

  const hasil = siswa.map((s) => {
    const harian = hari.map(({ tanggal }) => {
      const kunci = `${s.nis}|${tanggal}`;
      return tentukanStatusHari({
        masuk: petaScan.has(kunci),
        pulang: petaScan.get(kunci) === true,
        mapel: petaMapel.get(kunci) || {}
      });
    });
    const hitung = (st) => harian.filter((x) => x === st).length;
    const h = hitung('H');
    return {
      nis: s.nis, nama: s.nama, kelas: s.kelas, harian,
      h, i: hitung('I'), s: hitung('S'), a: hitung('A'),
      total: harian.length,
      persen: harian.length ? h / harian.length : null
    };
  });

  return { bulan, hari, sementara, siswa: hasil };
}

module.exports = { susunRekapBulanan, tentukanStatusHari, BULAN_RE };

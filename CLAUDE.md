# SIMPEG — UIN Siber Syekh Nurjati Cirebon

Sistem Informasi Manajemen Pegawai (SIMPEG) untuk UIN Siber Syekh Nurjati
Cirebon. Dikelola oleh tim SDM (personnel/HR division).

## Stack & Arsitektur

- **Frontend**: satu file `index.html` (vanilla JS, tanpa build step),
  di-deploy ke **GitHub Pages**.
- **Backend**: **Supabase** (project ref: `pouaycozskfvucpmappc`, region
  ap-southeast-1) — Postgres + Auth + Storage + Edge Functions.
- **Import/Export Excel**: library **SheetJS (XLSX)**, dimuat via CDN.
- **Auth**: Supabase Auth, role-based (`admin` / `user`) disimpan di tabel
  profile, dicek via `currentProfile.role === "admin"`. Elemen UI khusus
  admin diberi class `admin-only` (di-toggle lewat JS, bukan CSS murni).
- **RLS**: aktif di semua tabel. Pola: `auth.role() = 'authenticated'` untuk
  tabel kerja biasa. Hindari pakai `auth.uid() = id` langsung di kondisi
  policy tabel yang sama (pernah bikin infinite recursion) — pakai subquery
  atau `security_invoker` view kalau perlu logika lebih kompleks.

## Konvensi Kode (WAJIB diikuti)

- **Gaya JS**: `var`, `function` biasa (bukan arrow function), **string
  concatenation** (`"a" + b + "c"`), BUKAN template literal backtick.
  Ini bukan preferensi gaya semata — backtick pernah menyebabkan JS parsing
  error di production, jadi dihindari secara sengaja di seluruh file.
- Supabase client instance global bernama `db` (bukan `supabase`).
- Warna UI pakai CSS variable di `:root` (`--bg`, `--text`, `--accent`,
  dst) — branding UIN SSC: sidebar `#054b38`, primary `#12aa6e`, accent
  `#16d086`.
- **Modal berlatar putih** (`.modal { background: #ffffff }`), BUKAN
  gelap seperti sidebar — kalau bikin komponen baru di dalam modal (dropdown,
  suggestion box), pastikan teksnya kontras di atas putih, jangan asal
  copy warna dari style sidebar.
- File ini besar (>5000 baris) dan padat — **preferensi user: kasih
  perubahan sebagai find-and-replace / edit baris tertentu**, bukan
  tulis ulang seluruh file, supaya gampang di-review.
- Setiap edit signifikan: cek sintaks JS valid (`node --check` pada isi
  `<script>` yang diekstrak) dan tag HTML seimbang sebelum dianggap
  selesai.

## Modul: SIMPEG Inti

Tabel utama: `pegawai` (kolom kunci: `nip` unique, `nama`, `golongan`
— **sudah berformat gabungan** seperti `"IV/e"`, TIDAK ada kolom `pangkat`
terpisah, `jabatan`, `unit`, `tugas_tambahan` — teks bebas untuk jabatan
tambahan/struktural, **sudah termasuk awalan "Plt." kalau relevan**, jangan
tambah prefix lagi secara manual, `nidn`, `nuptk` — opsional, `status_aktif`).

Fitur: CRUD pegawai, dashboard statistik, proyeksi pensiun, purna tugas,
manajemen user, **import/export Excel-CSV**.

**Import massal** (`processFile` → `parseRows` → `confirmImport`):
NIP baru → insert. NIP sudah ada → **update partial** — HANYA kolom yang
terisi di file yang menimpa data lama (lihat `buildUpdatePayload()`).
Field kosong di file TIDAK menghapus data lama. `status_aktif` sengaja
selalu dikecualikan dari update massal.

**Masa kerja** dihitung on-the-fly dari NIP (`hitungMasaKerja()`), BUKAN
kolom tersimpan — posisi karakter 9-12 NIP = tahun masuk, 13-14 = bulan
masuk.

## Modul: Otomasi Dokumen Kenaikan

Sub-sistem untuk generate dokumen administratif kenaikan pangkat/jabatan
otomatis dari template `.docx`, menggantikan proses mail-merge Excel manual.
UI-nya ada di menu sidebar "📄 Otomasi Dokumen" (admin-only).

### Skema database (project Supabase yang sama)

```
pegawai (sudah ada, lihat atas)
referensi_pangkat_golongan   -- kode ("III/a") -> pangkat ("Penata Muda"), 17 baris baku PNS
pejabat_penandatangan        -- jenis (PK: 'rektor'|'kepala_biro_aku'|'plt_kepala_biro_aku') -> nip
v_pejabat_penandatangan      -- VIEW: join pejabat_penandatangan + pegawai + referensi_pangkat_golongan,
                                 pakai security_invoker=true (bukan default definer!)
jenis_dokumen                -- master semua jenis dokumen: kode, nama, storage_path,
                                 dibuat_per_orang (bool), kelompok (text|null), variasi ('batch'|'single'|null)
paket_kenaikan                -- 3 kategori: kenaikan_pangkat, kenaikan_jabatan_non_dosen, kenaikan_jabatan_dosen
paket_dokumen                 -- mapping paket -> daftar jenis_dokumen yang dibutuhkan
pengajuan                     -- satu proses pengajuan; status: draft -> menunggu_nomor -> selesai
pengajuan_pengusul             -- daftar pegawai dalam satu pengajuan (1 baris = single, >1 = batch)
pengajuan_field_tambahan       -- key-value per pengajuan/nip. Key yang dipakai:
                                    'golongan_baru'            -> golongan tujuan, per nip
                                    'nomor_surat_<kode_dok>'   -> nomor individual per dokumen per nip
pengajuan_dokumen              -- riwayat file hasil generate (file_path di bucket dokumen-kenaikan)
```

**Prinsip desain kunci**: `jenis_dokumen.kelompok` + `variasi` menandai
dokumen yang **cuma dibuat SEKALI per pengajuan** (mis. Surat Pengantar),
dengan 2 varian template (batch untuk >1 pengusul, single untuk 1 pengusul)
— dipilih otomatis berdasar jumlah pengusul. Nomornya = `pengajuan.no_surat`.

`dibuat_per_orang = true` menandai dokumen yang **satu file per orang**,
masing-masing dengan nomor surat sendiri (key `nomor_surat_<kode>` di
`pengajuan_field_tambahan`). Desain ini **generik untuk paket manapun** —
nambah paket baru = nambah baris `jenis_dokumen` + `paket_dokumen`, TIDAK
perlu ubah kode Edge Function.

### Template `.docx`

- Bucket Storage: `templates` (private), struktur folder per kategori:
  `kenaikan-pangkat/`, `kenaikan-jabatan-dosen/`, dst — path-nya harus
  PERSIS sama dengan `jenis_dokumen.storage_path` di database.
- Delimiter placeholder: **`{{tag}}`** (kurung kurawal GANDA), bukan
  default docxtemplater `{tag}` tunggal — WAJIB set
  `delimiters: { start: "{{", end: "}}" }`.
- Loop tabel (untuk varian batch): `{{#pengusul}} ... {{/pengusul}}` di
  dalam baris tabel yang mau diulang.
- Tag standar yang sudah dipakai (usahakan konsisten kalau bikin template
  baru): `{{nomor_surat}}` / `{{no_surat}}`, `{{mm}}`, `{{yyyy}}`,
  `{{tanggal_surat}}`, `{{nama}}`, `{{NIP_pengusul}}`, `{{pangkat_pengusul}}`,
  `{{golongan_ruang_pengusul}}`, `{{jabatan}}`, `{{unit_kerja}}`,
  `{{nama_pejabat}}`, `{{NIP_pejabat}}`, `{{pangkat_pejabat}}`,
  `{{golongan_ruang_pejabat}}`, `{{jabatan_pejabat}}`. Untuk varian batch
  tambahan: `{{jumlah_nama}}` + loop `{{#pengusul}}{{no}}/{{nama}}/{{NIP}}/
  {{pangkat}}/{{golongan}}/{{pangkat_baru}}/{{golongan_baru}}{{/pengusul}}`.
- Edge Function pakai `nullGetter: () => ""` — placeholder yang tidak ada
  di data object dirender kosong, TIDAK error. Aman untuk template baru
  yang field-nya sedikit beda, tapi berarti typo nama tag di template
  akan silent-fail (render kosong), bukan error jelas — cek hasil visual.

### Edge Function `generate-dokumen-kenaikan`

Generik, tidak hardcode nama paket. Alur: baca `pengajuan` → baca
`paket_dokumen` untuk tahu dokumen apa saja dibutuhkan → untuk tiap
kelompok batch/single, pilih varian sesuai jumlah pengusul, download
template, render, upload ke bucket `dokumen-kenaikan`, catat di
`pengajuan_dokumen` → untuk tiap dokumen individual, loop per pengusul,
ambil nomornya dari `pengajuan_field_tambahan`, render & upload.

Deploy: `supabase functions deploy generate-dokumen-kenaikan --project-ref
pouaycozskfvucpmappc` (atau lewat MCP Supabase tool kalau tersedia).

### Status per kategori (per 31 Agustus 2026)

- ✅ **(a) Kenaikan Pangkat** — selesai & sudah ditest end-to-end lewat UI.
  Dokumen: Surat Pengantar (batch/single), SPTJM per orang.
  Template di folder `kenaikan-pangkat/`. Field yang dipakai: `pangkat`/
  `golongan`/`pangkat_baru`/`golongan_baru` (promosi berbasis golongan).
- 🚧 **(c) Kenaikan Jabatan Akademik Dosen** & **(b) Kenaikan Jabatan Non
  Dosen** — skema DB + Edge Function + UI SUDAH SIAP, template SUDAH
  dipelajari & diperbaiki (merge runs, hapus tag nyasar), user SEDANG
  proses upload ke bucket. Field yang dipakai: `jabatan`/`jabatan_baru`
  (BUKAN pangkat/golongan — ini promosi jabatan, bukan pangkat). Edge
  Function mengirim KEDUA set field sekaligus (pangkat/golongan DAN
  jabatan/jabatan_baru) ke semua dokumen kelompok batch/single, supaya
  generik lintas paket — placeholder yang tidak dipakai template tertentu
  otomatis diabaikan (nullGetter).

  **Struktur dokumen per paket** (folder Storage: `kenaikan-jabatan/`):
  - **Dokumen BERSAMA** (jenis_dokumen sama persis, dipetakan ke KEDUA
    paket): `sptjm.docx` (kode `sptjm_jabatan`), `bebas_hukdis.docx`,
    `bebas_pidana.docx`, `bebas_tubel.docx` — semua `dibuat_per_orang=true`.
  - **Surat Pengantar BERBEDA per paket** (isi surat beda antara dosen vs
    tendik, JANGAN disatukan lagi):
    - Dosen: `surat_pengantar_kjdosen_batch.docx` /
      `surat_pengantar_kjdosen_single.docx` (kelompok
      `surat_pengantar_kjdosen`)
    - Non Dosen/Tendik: `surat_pengantar_kjtendik_batch.docx` /
      `surat_pengantar_kjtendik_single.docx` (kelompok
      `surat_pengantar_kjtendik`)
  - **3 dokumen individual dosen SENGAJA belum diotomasi** (dibuat manual
    dulu, datanya belum ada di SIMPEG): BA Senat, BA Komite, Surat
    Pernyataan Pimpinan PT. `jenis_dokumen`-nya ADA di database (kode
    `ba_senat`, `ba_komite`, `pernyataan_pimpinan_pt`) tapi TIDAK dipetakan
    ke `paket_dokumen` — tinggal insert ulang mapping-nya kalau nanti mau
    diaktifkan.

  ✅ Isi konten template yang sebelumnya perlu diperbaiki user sudah
  selesai: `sptjm.docx` sudah tidak lagi menyebut "Kenaikan Pangkat", dan
  header tabel `surat_pengantar_kjtendik` sudah "JABATAN" (konsisten
  dengan versi `kjdosen`).

### Form "Buat Pengajuan" (UI) — field per pengusul

Setiap pengusul yang ditambahkan di form Buat Pengajuan sekarang punya
4 field yang tersimpan ke `pengajuan_field_tambahan`: `golongan_baru`
(dropdown, dari `GOLONGAN_LIST`) dan `jabatan_baru` (input teks bebas,
karena nama jabatan tidak baku seperti golongan). Keduanya SELALU
ditampilkan di form terlepas dari paket yang dipilih (disederhanakan,
bukan disembunyikan sesuai paket) — supaya Edge Function generik tanpa
perlu tahu paket mana butuh field mana.

## Proyek terkait (belum digarap di repo ini)

- **Kalkulator Angka Kredit**: web app terpisah untuk cek kelayakan
  kenaikan jabatan akademik dosen berdasarkan Angka Kredit (Kepmendiktisaintek
  39/M/KEP/2026).
- **Ensiklopedia Kepegawaian**: web ensiklopedia aturan & prosedur
  kepegawaian, rencananya terintegrasi dengan SIMPEG dan chatbot ASK-Me.
- **ASK-Me**: chatbot HR self-service, mulai dari Telegram bot dulu.

## Alur Kerja Saat Ini

Mulai 31 Agustus 2026, perubahan **`index.html`** (fitur baru, perbaikan
bug, penyesuaian UI) dikerjakan **langsung di Claude Code** (VS Code),
BUKAN lagi lewat sesi chat.claude.ai dengan copy-paste file. Claude Code
sudah terhubung ke Supabase project yang sama lewat MCP (scoped ke
`pouaycozskfvucpmappc`), jadi bisa baca skema, jalankan migrasi, cek
Storage, dan deploy Edge Function langsung dari situ juga.

Sesi chat.claude.ai (di luar Claude Code) tetap dipakai untuk: mempelajari
template `.docx` baru (butuh render visual + inspeksi XML mendalam),
diskusi desain sebelum eksekusi, atau kalau Claude Code mentok di sesuatu
yang butuh tool yang tidak tersedia di lingkungan lokal user.

## Cara Kerja yang Diharapkan

1. Baca dulu bagian relevan file ini sebelum mulai kerja.
2. Kalau user minta ubah `index.html`, cari lokasi kode lewat teks unik
   (grep/search), edit dengan targeted replace, jangan tulis ulang file.
3. Kalau kerjaan menyentuh database/Storage/Edge Function Supabase,
   pertimbangkan apakah perubahan itu perlu migrasi SQL — tulis sebagai
   migrasi bernama jelas, bukan `execute_sql` langsung untuk perubahan
   struktural permanen.
4. Setelah edit selesai dan user setuju, commit dengan pesan yang jelas.
   User yang akan `git push` sendiri.

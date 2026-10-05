// "Mesin" aplikasi pemilik: state, enkripsi + cache lokal, sinkron cloud, login, dan semua aksi.
// Ini port langsung dari app.js lama. React membaca lewat useStore() (lib/useStore.ts);
// setiap perubahan memanggil commit() = simpan + kirim data partner + beri tahu React.

import { cloudConfigured } from "./config";
import {
  b64url, clearLegacyLocal, decryptBlob, decryptLegacyLocal, decryptReceipt, deriveCredentials, derivePartner,
  encryptJson, encryptWithRandomKey, encryptWithRawKey, hasLegacyLocal, normEmail,
} from "./crypto";
import {
  backfillPayoutAmounts, clamp, defaults, fmtDate, fmtRp, monthLabel, newId, normalize, partnerSnapshot,
  payableOf, shareSnapshot, State, Termin, terminKey, terminOf, terminPeriod, today, waPhone, type Proof,
} from "./model";
import {
  ApiError, appUrl, auth, clearSession, getSession, isNetworkError, remote, restoreSession, setOnSessionChange, setSession,
  type Session,
} from "./supabase";

const STORE_KEY = "cashflow.v1";        // format lama (tidak terenkripsi) — hanya dibaca untuk migrasi
const CACHE_KEY = "cashflow.cloud.v1";  // + ":<email>" — cache terenkripsi data cloud + status sinkron
const SESSION_KEY = "cashflow.session"; // kunci + token sesi; hilang saat tab ditutup
const THEME_KEY = "cashflow.theme";     // tema disimpan terpisah supaya layar login ikut tema
const LAST_EMAIL_KEY = "cashflow.lastEmail";
export const MIN_PW = 8;

export class UserError extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type LockMode = "login" | "signup" | "migrate" | "unsupported" | "noconfig";
export type SyncState = "idle" | "syncing" | "synced" | "offline" | "conflict" | "error";
type Cache = {
  userId?: string; email?: string; blob?: string; version?: number;
  dirty?: boolean; localAt?: string; syncedAt?: string;
};

// ---------- State yang dibaca UI ----------

export const store = {
  ready: false,                     // start() selesai
  unlocked: false,                  // data sudah dibuka (layar utama)
  state: defaults() as State,
  viewMonth: today().slice(0, 7),
  lock: { mode: "login" as LockMode, error: "", info: "", email: "" },
  sync: { state: "idle" as SyncState, detail: "", syncedAt: "" },
  conflict: null as null | { remoteInfo: string; localInfo: string },
  wa: null as null | { key: string; note: string },
  toast: null as null | { msg: string; id: number },
  partnerSynced: false,             // data partner terakhir sudah terkirim
  accountEmail: "",
};

// ---------- Langganan React ----------

let version = 0;
const listeners = new Set<() => void>();
export const subscribe = (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); };
export const getVersion = () => version;
function emit() { version++; for (const fn of listeners) fn(); }

// Konfirmasi: UI memasang dialog sendiri lewat setConfirmHandler; tanpa itu pakai confirm() bawaan.
export type ConfirmOpts = { title?: string; confirmLabel?: string; danger?: boolean };
let confirmHandler: (msg: string, opts: ConfirmOpts) => Promise<boolean> = async (msg) => confirm(msg);
export const setConfirmHandler = (fn: typeof confirmHandler) => { confirmHandler = fn; };
const ask = (msg: string, opts: ConfirmOpts = {}) => confirmHandler(msg, opts);

export function toast(msg: string) {
  store.toast = { msg, id: Date.now() };
  emit();
}

// ---------- Simpan (enkripsi -> cache lokal -> sinkron) ----------

const vault: { key: CryptoKey | null; writing: Promise<unknown> } = { key: null, writing: Promise.resolve() };
let cache: Cache = {};
let lastSavedJson: string | null = null;
let warned = false;
const warnOnce = () => { if (!warned) { warned = true; toast("Gagal menyimpan di perangkat ini — penyimpanan browser penuh atau diblokir"); } };

const cacheKey = (email: string) => `${CACHE_KEY}:${normEmail(email)}`;
function readCache(email: string): Cache {
  try { return JSON.parse(localStorage.getItem(cacheKey(email)) || "null") || {}; } catch { return {}; }
}
function writeCache() {
  if (!cache.email) return;
  try { localStorage.setItem(cacheKey(cache.email), JSON.stringify(cache)); } catch { warnOnce(); }
}

function save() {
  if (!vault.key) return;
  const json = JSON.stringify(store.state);
  if (json === lastSavedJson) return;
  lastSavedJson = json;
  const payload = encryptJson(vault.key, json); // snapshot sekarang
  vault.writing = vault.writing
    .then(() => payload)
    .then((blob) => {
      cache.blob = blob;
      cache.dirty = true;
      cache.localAt = new Date().toISOString();
      writeCache();
      scheduleSync();
    })
    .catch(() => warnOnce());
}

// Setara render() versi lama: simpan perubahan, kirim data partner, perbarui layar.
export function commit() {
  applyTheme(store.state.theme);
  try { localStorage.setItem(THEME_KEY, store.state.theme); } catch { /* abaikan */ }
  save();
  schedulePartnerPublish();
  emit();
}

function applyTheme(theme: string) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", theme === "light" ? "#f5f6f9" : "#0f1115"));
}

// ---------- Sesi di tab ini ----------

async function persistSession() {
  try {
    const jwk = vault.key ? await crypto.subtle.exportKey("jwk", vault.key) : null;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ session: getSession(), jwk }));
  } catch { /* sesi tidak diingat — cukup login lagi */ }
}
function forgetSession() { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* abaikan */ } }
setOnSessionChange(() => { persistSession(); });

// ---------- Sinkron ----------

const sync = { timer: undefined as ReturnType<typeof setTimeout> | undefined, running: false, again: false, conflictOpen: false };
let pendingSignIn: { email: string; authSecret: string } | null = null; // masuk saat offline, login ke server dicoba lagi

function setSync(st: SyncState, detail = "") {
  store.sync = { state: st, detail, syncedAt: cache.syncedAt || "" };
  emit();
}

export function syncText() {
  const { state: st, detail, syncedAt } = store.sync;
  const time = syncedAt ? new Date(syncedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "";
  return st === "syncing" ? "Menyinkron…"
    : st === "synced" ? `Tersinkron ke cloud${time ? " · " + time : ""}`
    : st === "offline" ? "Offline — perubahan disimpan di perangkat ini, dikirim saat online"
    : st === "conflict" ? "Menunggu pilihan data (konflik)"
    : st === "error" ? `Gagal sinkron${detail ? " — " + detail : ""}`
    : "—";
}

function scheduleSync(delay = 800) {
  clearTimeout(sync.timer);
  sync.timer = setTimeout(runSync, delay);
}

// Terapkan data dari cloud ke layar tanpa menandainya sebagai perubahan lokal.
function applyRemote(data: unknown, row: { data: string; version: number }) {
  store.state = normalize(data);
  backfillPayoutAmounts(store.state);
  lastSavedJson = JSON.stringify(store.state);
  cache.blob = row.data;
  cache.version = row.version;
  cache.dirty = false;
  cache.syncedAt = new Date().toISOString();
  writeCache();
  commit();
}

async function runSync(): Promise<void> {
  if (!vault.key) return;
  if (sync.running) { sync.again = true; return; }
  if (!getSession()) {
    setSync("offline");
    if (pendingSignIn) retrySignIn();
    return;
  }
  if (sync.conflictOpen) return;
  sync.running = true;
  setSync("syncing");
  try {
    await vault.writing;
    for (let attempt = 0; attempt < 3; attempt++) {
      const row = await remote.get();
      const base = cache.version || 0;

      if (row && row.version > base) {
        const data = await decryptBlob(vault.key, row.data).catch(() => null);
        if (!data) {
          setSync("error", "password diganti di perangkat lain — keluar lalu masuk lagi dengan password baru");
          return;
        }
        if (cache.dirty) {
          openConflict(data, row);
          return;
        }
        applyRemote(data, row);
        break;
      }

      if (!cache.dirty) { cache.syncedAt = new Date().toISOString(); writeCache(); break; }

      const pushed = cache.blob!;
      const v = await remote.put(pushed, row ? base : 0);
      if (v === null) continue; // keduluan perangkat lain — ambil ulang lalu tangani
      cache.version = v;
      if (cache.blob === pushed) cache.dirty = false; // ada perubahan baru selama upload -> tetap dirty
      cache.syncedAt = new Date().toISOString();
      writeCache();
      if (cache.dirty) sync.again = true;
      break;
    }
    setSync("synced");
    schedulePartnerPublish(); // sesi pasti ada di sini — kirim data partner yang tertunda
  } catch (e) {
    if (isNetworkError(e) || !navigator.onLine) setSync("offline");
    else setSync("error", (e as ApiError).status === 401 ? "sesi berakhir, keluar lalu masuk lagi" : (e as Error).message);
    scheduleSync(15_000);
  } finally {
    sync.running = false;
    if (sync.again) { sync.again = false; scheduleSync(300); }
  }
}

// ---------- Konflik ----------

let pendingConflict: null | { data: unknown; row: { data: string; version: number } } = null;

function describe(data: { entries?: unknown[] }, at?: string) {
  const n = Array.isArray(data.entries) ? data.entries.length : 0;
  const when = at ? new Date(at).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  return `${n} invoice${when ? " · diubah " + when : ""}`;
}

function openConflict(data: unknown, row: { data: string; version: number; updated_at: string }) {
  sync.conflictOpen = true;
  pendingConflict = { data, row };
  store.conflict = {
    remoteInfo: describe(data as { entries?: unknown[] }, row.updated_at),
    localInfo: describe(store.state, cache.localAt),
  };
  setSync("conflict");
}

export function resolveConflict(choice: "remote" | "local" | null) {
  const c = pendingConflict;
  sync.conflictOpen = false;
  pendingConflict = null;
  store.conflict = null;
  if (!c) return emit();
  if (choice === "remote") {
    applyRemote(c.data, c.row);
    toast("Memakai data cloud");
    setSync("synced");
  } else if (choice === "local") {
    cache.version = c.row.version; // push berikutnya menimpa versi cloud ini
    writeCache();
    toast("Memakai data perangkat ini — mengirim ke cloud…");
    scheduleSync(0);
  } else {
    scheduleSync(30_000); // ditutup tanpa memilih — tanya lagi nanti
    emit();
  }
}

// ---------- Login / daftar ----------

function showLock(mode: LockMode, { error = "", info = "" }: { error?: string; info?: string } = {}) {
  store.unlocked = false;
  store.lock = { ...store.lock, mode, error, info };
  emit();
}

export function setLockMode(mode: LockMode) { showLock(mode); }

function enterApp(data: unknown, { dirty = false } = {}) {
  store.state = normalize(data);
  backfillPayoutAmounts(store.state);
  // dirty = data belum ada di cloud (akun baru / migrasi) -> commit() akan menyimpan & mengirimnya
  lastSavedJson = dirty ? null : JSON.stringify(store.state);
  store.viewMonth = today().slice(0, 7);
  store.unlocked = true;
  store.accountEmail = getSession()?.email || cache.email || "";
  commit();
  persistSession();
  setSync(getSession() ? "syncing" : "offline");
  scheduleSync(dirty ? 800 : 100);
}

function loadCacheFor(email: string, userId?: string) {
  cache = readCache(email);
  if (userId && cache.userId && cache.userId !== userId) cache = {}; // email dipakai akun lain
  cache.email = normEmail(email);
  if (userId) cache.userId = userId;
}

function loadLegacy() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

// Setelah berhasil login/daftar: tentukan data mana yang dibuka.
async function afterAuth(password: string | null) {
  const session = getSession()!;
  loadCacheFor(session.email, session.userId);

  let row: Awaited<ReturnType<typeof remote.get>> | undefined;
  try {
    row = await remote.get();      // null = cloud masih kosong
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    row = undefined;               // tidak tahu (koneksi putus)
  }

  const local = cache.blob ? await decryptBlob(vault.key!, cache.blob).catch(() => null) : null;

  if (row) {
    const data = await decryptBlob(vault.key!, row.data).catch(() => null);
    if (!data) throw new UserError("Data di cloud tidak bisa dibuka dengan password ini.");
    // Ada perubahan lokal yang belum terkirim -> buka versi lokal; sinkron akan menangani konfliknya.
    if (local && cache.dirty) return enterApp(local);
    cache.blob = row.data;
    cache.version = row.version;
    cache.dirty = false;
    cache.syncedAt = new Date().toISOString();
    writeCache();
    return enterApp(data);
  }

  if (local) return enterApp(local);

  if (row === null) {
    // Cloud kosong (akun baru): bawa data lama dari browser ini kalau ada.
    if (hasLegacyLocal()) {
      const migrated = password ? await decryptLegacyLocal(password) : null;
      if (migrated) return finishMigration(migrated);
      return showLock("migrate");
    }
    const plain = loadLegacy();
    if (plain) return finishMigration(plain);
    return enterApp(defaults(), { dirty: true });
  }
  enterApp(defaults());
}

async function finishMigration(data: unknown) {
  enterApp(data, { dirty: true });
  await vault.writing; // pastikan sudah masuk cache terenkripsi sebelum format lama dihapus
  clearLegacyLocal();
  try { localStorage.removeItem(STORE_KEY); } catch { /* abaikan */ }
  toast(`Data lama (${store.state.entries.length} invoice) dipindahkan ke akun cloud`);
}

async function doLogin(email: string, pw: string) {
  const { authSecret, key } = await deriveCredentials(email, pw);
  let r;
  try {
    r = await auth.signIn(email, authSecret);
  } catch (e) {
    if (isNetworkError(e)) return offlineUnlock(email, authSecret, key);
    const err = e as ApiError;
    if (err.code === "email_not_confirmed" || /not confirmed/i.test(err.message)) {
      throw new UserError("Email belum dikonfirmasi — klik link di email dari Supabase, lalu masuk lagi.");
    }
    if (err.status === 429) throw new UserError("Terlalu banyak percobaan — tunggu sebentar lalu coba lagi.");
    if (err.status === 400 || err.code === "invalid_credentials") throw new UserError("Email atau password salah");
    throw e;
  }
  vault.key = key;
  setSession(r, email);
  await afterAuth(pw);
}

// Tanpa koneksi: buka dari cache terenkripsi di perangkat ini (password dicek lewat dekripsi).
async function offlineUnlock(email: string, authSecret: string, key: CryptoKey) {
  const c = readCache(email);
  if (!c.blob) throw new UserError("Tidak bisa terhubung ke server. Periksa koneksi internet.");
  const data = await decryptBlob(key, c.blob).catch(() => null);
  if (!data) throw new UserError("Email atau password salah");
  vault.key = key;
  clearSession();
  cache = c;
  pendingSignIn = { email, authSecret };
  enterApp(data);
  toast("Offline — memakai data terakhir di perangkat ini");
}

let retryBusy = false;
async function retrySignIn() {
  if (!pendingSignIn || retryBusy) return;
  retryBusy = true;
  try {
    const r = await auth.signIn(pendingSignIn.email, pendingSignIn.authSecret);
    setSession(r, pendingSignIn.email);
    pendingSignIn = null;
    scheduleSync(0);
  } catch (e) {
    if (!isNetworkError(e)) {
      pendingSignIn = null;
      setSync("error", "login ke server gagal — keluar lalu masuk lagi");
    }
  } finally {
    retryBusy = false;
  }
}

async function doSignup(email: string, pw: string) {
  const { authSecret, key } = await deriveCredentials(email, pw);
  let r;
  try {
    r = await auth.signUp(email, authSecret);
  } catch (e) {
    if (isNetworkError(e)) throw new UserError("Tidak bisa terhubung ke server. Periksa koneksi internet.");
    const err = e as ApiError;
    if (err.code === "user_already_exists" || /already registered|already exists/i.test(err.message)) {
      throw new UserError("Email ini sudah terdaftar — pilih Masuk.");
    }
    if (err.code === "email_address_invalid" || err.code === "validation_failed") throw new UserError("Format email tidak valid");
    if (err.status === 429) throw new UserError("Terlalu banyak percobaan — tunggu sebentar lalu coba lagi.");
    throw e;
  }
  if (!r || !r.access_token) {
    // Proyek Supabase mewajibkan konfirmasi email dulu.
    store.lock.email = email;
    showLock("login", { info: `Akun dibuat. Cek inbox ${email}, klik link konfirmasi, lalu masuk di sini.` });
    return;
  }
  vault.key = key;
  setSession(r, email);
  await afterAuth(pw);
}

// Dipanggil form login. Melempar UserError dengan pesan untuk ditampilkan.
export async function submitLock(emailIn: string, pw: string, pw2: string) {
  const mode = store.lock.mode;
  const email = normEmail(emailIn);
  store.lock = { ...store.lock, error: "", info: "", email };

  if (mode === "migrate") {
    if (!pw) throw new UserError("Masukkan password lama");
  } else {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError("Masukkan email yang valid");
    if (mode === "signup") {
      if (pw.length < MIN_PW) throw new UserError(`Password minimal ${MIN_PW} karakter`);
      if (pw !== pw2) throw new UserError("Password tidak sama");
    } else if (!pw) {
      throw new UserError("Masukkan password");
    }
  }

  try {
    if (mode === "migrate") {
      const data = await decryptLegacyLocal(pw);
      if (!data) throw new UserError("Password lama salah");
      await finishMigration(data);
    } else {
      try { localStorage.setItem(LAST_EMAIL_KEY, email); } catch { /* abaikan */ }
      await (mode === "signup" ? doSignup(email, pw) : doLogin(email, pw));
    }
  } catch (e) {
    if (!store.unlocked && mode !== "migrate") {
      // gagal di tengah jalan -> jangan tinggalkan sesi setengah jadi
      vault.key = null;
      clearSession();
      forgetSession();
    }
    throw e instanceof UserError ? e : new UserError(`Terjadi kesalahan: ${(e as Error).message}`);
  }
}

export function skipMigration() { enterApp(defaults(), { dirty: true }); }

export async function logout() {
  await vault.writing;
  const session = getSession();
  if (cache.dirty && session) {
    setSync("syncing");
    await Promise.race([runSync(), sleep(5000)]);
  }
  if (cache.dirty && !(await ask("Ada perubahan yang belum terkirim ke cloud. Perubahan tetap tersimpan di perangkat ini dan dikirim saat kamu masuk lagi. Keluar sekarang?", { title: "Keluar sekarang?", confirmLabel: "Keluar" }))) return;
  if (session) await Promise.race([auth.logout(session.access_token).catch(() => {}), sleep(1500)]);
  forgetSession();
  // Muat ulang halaman supaya data yang sudah didekripsi tidak tersisa di memori.
  location.reload();
}

// Kembali dari link konfirmasi email: Supabase menaruh hasilnya di #hash. Token di situ tidak dipakai —
// kunci enkripsi tetap butuh password — cukup beri tahu hasilnya lalu bersihkan URL.
function readAuthRedirect() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (!h.has("access_token") && !h.has("error") && !h.has("error_code")) return null;
  history.replaceState(null, "", location.pathname + location.search);
  if (h.get("error_code") === "otp_expired") {
    return { error: "Link konfirmasi sudah kedaluwarsa atau sudah pernah dipakai. Coba masuk — kalau ditolak, daftar ulang." };
  }
  if (h.has("error") || h.has("error_code")) {
    return { error: "Konfirmasi gagal: " + (h.get("error_description") || h.get("error_code") || h.get("error") || "").replace(/\+/g, " ") };
  }
  return { info: "Email sudah dikonfirmasi — silakan masuk." };
}

let started = false;
export async function start() {
  if (started) return;
  started = true;
  let theme: string | null = null;
  try { theme = localStorage.getItem(THEME_KEY); } catch { /* abaikan */ }
  applyTheme(theme === "light" || theme === "dark" ? theme : (loadLegacy() || defaults()).theme);
  try { store.lock.email = localStorage.getItem(LAST_EMAIL_KEY) || ""; } catch { /* abaikan */ }
  const authRedirect = readAuthRedirect();
  store.ready = true;

  // Tarik perubahan dari perangkat lain saat aplikasi kembali dibuka / aktif.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) scheduleSync(200); });
  window.addEventListener("online", () => scheduleSync(200));
  window.addEventListener("offline", () => setSync("offline"));
  setInterval(() => { if (!document.hidden) runSync(); }, 60_000);

  if (!(globalThis.crypto && crypto.subtle)) return showLock("unsupported");
  if (!cloudConfigured()) return showLock("noconfig");

  // Masih di tab yang sama (refresh halaman) — pakai kunci & token sesi, tidak perlu password lagi.
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    if (saved && saved.jwk && saved.session) {
      vault.key = await crypto.subtle.importKey("jwk", saved.jwk, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
      restoreSession(saved.session as Session);
      loadCacheFor(saved.session.email, saved.session.userId);
      if (cache.blob) return enterApp(await decryptBlob(vault.key, cache.blob));
      return await afterAuth(null);
    }
  } catch {
    forgetSession();
    vault.key = null;
    clearSession();
  }

  showLock("login", authRedirect || {});
}

// ---------- Ganti password ----------

export async function changePassword(oldPw: string, newPw: string, newPw2: string) {
  if (!oldPw) throw new UserError("Masukkan password lama");
  if (newPw.length < MIN_PW) throw new UserError(`Password baru minimal ${MIN_PW} karakter`);
  if (newPw !== newPw2) throw new UserError("Password baru tidak sama");
  if (newPw === oldPw) throw new UserError("Password baru harus berbeda");
  const session = getSession();
  if (!session) throw new UserError("Butuh koneksi internet untuk ganti password");

  try {
    const email = session.email;
    const oldC = await deriveCredentials(email, oldPw);
    try {
      setSession(await auth.signIn(email, oldC.authSecret), email);
    } catch (e) {
      throw new UserError(isNetworkError(e) ? "Tidak bisa terhubung ke server" : "Password lama salah");
    }
    // Pastikan cloud sudah berisi data terbaru sebelum kunci diganti.
    await vault.writing;
    await runSync();
    if (cache.dirty) throw new UserError("Sinkron belum selesai — coba lagi sebentar");

    const newC = await deriveCredentials(email, newPw);
    const blob = await encryptJson(newC.key, JSON.stringify(store.state));
    await remote.updatePassword(newC.authSecret);
    // Login sudah pakai password baru -> mulai sekarang data dienkripsi dengan kunci baru.
    vault.key = newC.key;
    cache.blob = blob;
    cache.dirty = true;
    cache.localAt = new Date().toISOString();
    writeCache();
    lastSavedJson = JSON.stringify(store.state);
    persistSession();
    await runSync();
    toast(cache.dirty ? "Password diganti — data dikirim ke cloud saat online" : "Password diganti di semua perangkat");
  } catch (e) {
    throw e instanceof UserError ? e : new UserError(`Gagal ganti password: ${(e as Error).message}`);
  }
}

// ---------- Aksi data ----------

const S = () => store.state;

export function setViewMonth(ym: string) { store.viewMonth = ym; emit(); }

export function toggleTheme() {
  S().theme = S().theme === "light" ? "dark" : "light";
  commit();
}

export function addEntry(date: string, amount: number, note: string, pctIn: string) {
  const sharePct = pctIn !== "" && Number.isFinite(Number(pctIn)) ? clamp(Number(pctIn), 0, 100) : S().settings.sharePct;
  if (!date || !(amount > 0)) return false;
  S().entries.push({ id: newId(), date, amount, note, sharePct });
  store.viewMonth = date.slice(0, 7); // lompat ke bulan entri baru
  commit();
  toast(`Invoice ${fmtRp(amount)} disimpan — Payout ${terminOf(S(), date)}`);
  return true;
}

export async function deleteEntry(id: string) {
  const entry = S().entries.find((e) => e.id === id);
  if (entry && await ask(`Invoice ${fmtRp(entry.amount)} tanggal ${fmtDate(entry.date)} akan dihapus.`, { title: "Hapus invoice?", confirmLabel: "Hapus", danger: true })) {
    S().entries = S().entries.filter((e) => e.id !== id);
    commit();
    toast("Invoice dihapus");
  }
}

export function addSubsidy(termin: Termin, amount: number, purpose: string) {
  if (!(amount > 0) || !purpose) return false;
  S().subsidies.push({ id: newId(), ym: store.viewMonth, termin, amount, purpose });
  commit();
  toast(`Subsidi silang ${fmtRp(amount)} dipotong dari Payout ${termin} — ${monthLabel(store.viewMonth)}`);
  return true;
}

export async function deleteSubsidy(id: string) {
  const x = S().subsidies.find((s) => s.id === id);
  if (x && await ask(`Subsidi silang ${fmtRp(x.amount)} (Payout ${x.termin}) akan dihapus.`, { title: "Hapus subsidi silang?", confirmLabel: "Hapus", danger: true })) {
    S().subsidies = S().subsidies.filter((s) => s.id !== id);
    commit();
    toast("Subsidi silang dihapus");
  }
}

export function saveSettings(nameIn: string, phoneIn: string, pctIn: string, cutoffIn: string) {
  const s = S().settings;
  const name = nameIn.trim() || "Partner";
  // Kosong/tidak valid -> pakai nilai lama. (Dulu `|| 10` membuat 0% berubah jadi 10%.)
  const pct = pctIn.trim() !== "" && Number.isFinite(Number(pctIn)) ? clamp(Number(pctIn), 0, 100) : s.sharePct;
  const cutoff = cutoffIn.trim() !== "" && Number.isFinite(Number(cutoffIn)) ? clamp(Math.round(Number(cutoffIn)), 8, 23) : s.cutoff;
  const phone = phoneIn.replace(/[^\d+]/g, "").slice(0, 20);
  S().settings = { ...s, partnerName: name, partnerPhone: phone, sharePct: pct, cutoff };
  commit();
  toast("Pengaturan disimpan");
}

export function exportBackup() {
  const blob = new Blob([JSON.stringify(S(), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `cashflow-backup-${today()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Safari membatalkan unduhan kalau URL dicabut langsung setelah click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast("Backup diunduh — file ini TIDAK terenkripsi, simpan di tempat aman");
}

export async function importBackup(file: File) {
  let data: State;
  try {
    data = normalize(JSON.parse(await file.text()));
  } catch {
    toast("File tidak valid — pilih file backup JSON dari aplikasi ini");
    return;
  }
  const n = data.entries.length;
  if (!(await ask(`Semua data saat ini diganti dengan isi backup (${n} invoice, ${Object.keys(data.payouts).length} pembayaran).`, { title: "Pulihkan backup?", confirmLabel: "Ganti data", danger: true }))) return;
  store.state = data;
  backfillPayoutAmounts(store.state);
  store.viewMonth = today().slice(0, 7);
  commit();
  toast(`Backup dipulihkan — ${n} invoice`);
}

export async function resetAll() {
  if (!(await ask("Semua invoice, riwayat payout, bukti transfer & pengaturan dihapus di SEMUA perangkat yang memakai akun ini. Tindakan ini tidak bisa dibatalkan.", { title: "Reset semua data?", confirmLabel: "Hapus semua", danger: true }))) return;
  store.state = defaults();
  partnerPublished = null;
  store.viewMonth = today().slice(0, 7);
  commit();
  if (getSession()) {
    // bukti transfer, link & data partner di cloud ikut dihapus
    remote.deleteAllReceipts().catch(() => {});
    remote.deleteAllShares().catch(() => {});
    remote.deletePartnerView().catch(() => {});
  }
  toast("Semua data direset");
}

// ---------- Pembayaran + bukti transfer ----------

// Perkecil screenshot (sisi terpanjang maks 1600px, JPEG) supaya upload cepat dan hemat ruang.
export async function compressImage(file: File) {
  const MAX = 1600;
  const img = await createImageBitmap(file);
  const scale = Math.min(1, MAX / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff"; // PNG transparan -> latar putih
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  img.close?.();
  for (const q of [0.82, 0.7, 0.55]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", q));
    if (blob && blob.size <= 1_500_000) return blob;
  }
  throw new UserError("Gambar terlalu besar — coba screenshot yang lebih kecil");
}

const proofUrls = new Map<string, string>(); // id -> object URL (cache selama sesi)

function markPaid(ym: string, t: number, proof: { id: string; k: string }) {
  const key = terminKey(ym, t);
  const prev = S().payouts[key];
  const amount = payableOf(S(), ym, t);
  const proofs = prev && prev.proofs ? prev.proofs : [];
  // Simpan nominal yang benar-benar dibayar agar riwayat tidak ikut berubah.
  S().payouts[key] = {
    paid: true, paidAt: today(), amount,
    proofs: [...proofs, { ...proof, at: today(), amount: amount - (prev ? prev.amount ?? 0 : 0) }],
    ...(prev?.share ? { share: prev.share } : {}),
  };
  commit();
  toast(`Payout ${t} ditandai sudah dibayar — ${monthLabel(ym)}`);
}

// Upload bukti -> tandai dibayar -> buat link partner -> tawarkan kirim WhatsApp.
export async function payWithProof(ym: string, t: number, blob: Blob) {
  if (!getSession()) throw new UserError("Butuh koneksi internet untuk upload bukti transfer.");
  try {
    const id = newId();
    const { k, data } = await encryptWithRandomKey(await blob.arrayBuffer(), blob.type);
    await remote.putReceipt(id, data);
    proofUrls.set(id, URL.createObjectURL(blob));
    markPaid(ym, t, { id, k });
  } catch (e) {
    throw new UserError(isNetworkError(e)
      ? "Upload gagal — periksa koneksi internet lalu coba lagi."
      : `Upload gagal: ${(e as Error).message}`);
  }
  try {
    await createShare(ym, t);
  } catch {
    toast("Ditandai dibayar — tapi link untuk partner gagal dibuat");
    return;
  }
  openWa(terminKey(ym, t));
}

export async function unmarkPaid(ym: string, t: number) {
  if (!(await ask(`Catatan pembayaran Payout ${t} ${monthLabel(ym)} beserta bukti transfernya akan dihapus dari riwayat.`, { title: "Batalkan tanda bayar?", confirmLabel: "Batalkan pembayaran", danger: true }))) return;
  const key = terminKey(ym, t);
  const prev = S().payouts[key];
  delete S().payouts[key];
  // Hapus gambar & link partner di cloud juga (kalau gagal/offline, tinggal jadi baris yatim yang tidak terbaca).
  if (prev && prev.proofs && prev.proofs.length && getSession()) {
    remote.deleteReceipts(prev.proofs.map((x) => x.id)).catch(() => {});
  }
  if (prev && prev.share && getSession()) remote.deleteShares([prev.share.id]).catch(() => {});
  commit();
  toast("Tanda dibayar dibatalkan");
}

export async function proofUrl(p: Proof) {
  let url = proofUrls.get(p.id);
  if (url) return url;
  if (!getSession()) throw new UserError("Butuh koneksi internet untuk memuat bukti transfer.");
  const data = await remote.getReceipt(p.id);
  if (!data) throw new UserError("Bukti transfer tidak ditemukan di cloud.");
  url = URL.createObjectURL(await decryptReceipt(p.k, data));
  proofUrls.set(p.id, url);
  return url;
}

// ---------- Link detail payout untuk partner (WhatsApp) ----------

export const shareLink = (share: { id: string; k: string }) => `${location.origin}/share#${share.id}.${b64url(share.k)}`;

function waMessage(key: string) {
  const s = S();
  const p = s.payouts[key];
  const ym = key.slice(0, 7), t = Number(key.slice(8));
  return [
    `Halo ${s.settings.partnerName}, Payout ${t} ${monthLabel(ym)} (tgl ${terminPeriod(s, ym, t)}) sudah dibayarkan ✅`,
    ``,
    `Jumlah: ${fmtRp(p.amount ?? 0)}`,
    `Tanggal bayar: ${fmtDate(p.paidAt)}`,
    ``,
    `Detail payout & invoice:`,
    shareLink(p.share!),
  ].join("\n");
}

export const waUrl = (key: string) =>
  `https://wa.me/${waPhone(S().settings.partnerPhone)}?text=${encodeURIComponent(waMessage(key))}`;

export function openWa(key: string, note = "") { store.wa = { key, note }; emit(); }
export function closeWa() { store.wa = null; emit(); }

// Buat link baru untuk payout ini (menggantikan link lama, mis. setelah bayar sisa).
async function createShare(ym: string, t: number) {
  const key = terminKey(ym, t);
  const json = JSON.stringify(shareSnapshot(S(), ym, t));
  const { k, data } = await encryptWithRandomKey(new TextEncoder().encode(json), "application/json");
  const id = newId();
  const receiptIds = (S().payouts[key].proofs || []).map((x) => x.id);
  await remote.putShare(id, data, receiptIds);
  const p = S().payouts[key];
  if (!p) return; // keburu dibatalkan
  const old = p.share;
  p.share = { id, k };
  if (old) remote.deleteShares([old.id]).catch(() => {});
  commit();
}

// ---------- Data untuk login partner ----------

let partnerPublished: string | null = null; // lookup + json terakhir yang sudah terkirim
let partnerTimer: ReturnType<typeof setTimeout> | undefined;

function schedulePartnerPublish() {
  if (!S().settings.partnerAccess) return;
  clearTimeout(partnerTimer);
  partnerTimer = setTimeout(() => publishPartnerView().catch(() => {}), 1500);
}

async function publishPartnerView() {
  const acc = S().settings.partnerAccess;
  if (!acc || !getSession() || !vault.key) return;
  const snap = partnerSnapshot(S());
  const json = JSON.stringify(snap);
  const sig = acc.lookup + json;
  if (sig === partnerPublished) return; // tidak berubah sejak kiriman terakhir
  const data = await encryptWithRawKey(acc.k, json);
  const receiptIds = snap.months.flatMap((m) => m.payouts.flatMap((p) => p.proofs.map((x) => x.id)));
  await remote.putPartnerView({ lookup: acc.lookup, data, receipt_ids: receiptIds, updated_at: new Date().toISOString() });
  partnerPublished = sig;
  store.partnerSynced = true;
  emit();
}

export async function setPartnerPassword(pwIn: string) {
  const pw = pwIn.trim();
  if (pw.length < 10) throw new UserError("Password partner minimal 10 karakter — tekan \"Acak\" untuk membuat yang kuat.");
  if (!getSession()) throw new UserError("Butuh koneksi internet untuk mengaktifkan akses partner.");
  try {
    const { lookup, k } = await derivePartner(pw);
    S().settings.partnerAccess = { password: pw, lookup, k };
    partnerPublished = null;
    store.partnerSynced = false;
    await publishPartnerView();
    commit();
    toast("Akses partner aktif — bagikan password ini ke partner");
  } catch (e) {
    if (e instanceof UserError) throw e;
    const msg = (e as Error).message;
    throw new UserError(isNetworkError(e) ? "Tidak bisa terhubung ke server — coba lagi."
      : /duplicate|unique/i.test(msg) ? "Password ini tidak bisa dipakai — coba password lain."
      : `Gagal: ${msg}`);
  }
}

export async function disablePartner() {
  if (!(await ask("Partner tidak akan bisa masuk lagi sampai kamu membuat password baru.", { title: "Matikan akses partner?", confirmLabel: "Matikan", danger: true }))) return false;
  try {
    if (getSession()) await remote.deletePartnerView();
  } catch (e) {
    throw new UserError(isNetworkError(e) ? "Butuh koneksi internet untuk mematikan akses." : `Gagal: ${(e as Error).message}`);
  }
  S().settings.partnerAccess = null;
  partnerPublished = null;
  store.partnerSynced = false;
  commit();
  toast("Akses partner dimatikan");
  return true;
}

export const appHomeUrl = appUrl;

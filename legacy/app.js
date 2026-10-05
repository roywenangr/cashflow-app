/* ============================================================
   Cashflow — Profit Sharing
   Data dienkripsi di browser (kunci diturunkan dari password), lalu
   disinkronkan ke Supabase dan di-cache terenkripsi di localStorage.
   Supabase hanya pernah melihat ciphertext.
   ============================================================ */

(() => {
  "use strict";

  const STORE_KEY = "cashflow.v1";        // format lama (tidak terenkripsi) — hanya dibaca untuk migrasi
  const ENC_KEY = "cashflow.enc.v1";      // format lama (terenkripsi, lokal saja) — hanya untuk migrasi
  const CACHE_KEY = "cashflow.cloud.v1";  // + ":<email>" — cache terenkripsi data cloud + status sinkron
  const SESSION_KEY = "cashflow.session"; // kunci + token sesi; hilang saat tab ditutup
  const THEME_KEY = "cashflow.theme";     // tema disimpan terpisah supaya layar login ikut tema
  const CFG = window.CASHFLOW_CONFIG || {};

  // ---------- State ----------

  const defaults = () => ({
    settings: { partnerName: "Partner", partnerPhone: "", sharePct: 10, cutoff: 15 },
    entries: [],   // { id, date: "YYYY-MM-DD", amount, note, sharePct }
    payouts: {},   // "YYYY-MM-1" | "YYYY-MM-2" -> { paid: true, paidAt: "YYYY-MM-DD", amount, proofs: [{ id, k, at, amount }], share?: { id, k } }
    subsidies: [], // { id, ym: "YYYY-MM", termin: 1|2, amount, purpose } — dipotong dari share partner
    theme: prefersLight() ? "light" : "dark",
  });

  function prefersLight() {
    try { return matchMedia("(prefers-color-scheme: light)").matches; } catch { return false; }
  }

  const newId = () =>
    globalThis.crypto && crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2);

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  let state = defaults(); // diisi setelah login
  let viewMonth = today().slice(0, 7); // "YYYY-MM"

  function loadLegacy() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? normalize(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  // Validasi data dari localStorage / file import: buang entri rusak, jepit pengaturan ke rentang valid.
  function normalize(data) {
    const base = defaults();
    if (!data || typeof data !== "object") throw new Error("Format data tidak valid");
    const s = data.settings || {};
    const pct = Number(s.sharePct);
    const cutoff = Number(s.cutoff);
    const defaultPct = Number.isFinite(pct) && s.sharePct !== "" && s.sharePct !== null ? clamp(pct, 0, 100) : base.settings.sharePct;
    const validPct = (v) => v !== "" && v !== null && v !== undefined && Number.isFinite(Number(v));

    const entries = (Array.isArray(data.entries) ? data.entries : [])
      .filter((e) => e && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && Number(e.amount) > 0)
      .map((e) => ({
        id: e.id ? String(e.id) : newId(),
        date: e.date,
        amount: Math.round(Number(e.amount)),
        note: typeof e.note === "string" ? e.note.slice(0, 80) : "",
        // Data lama belum punya % per entri — dibekukan ke default saat ini supaya
        // mengganti default nanti tidak mengubah share entri lama.
        sharePct: validPct(e.sharePct) ? clamp(Number(e.sharePct), 0, 100) : defaultPct,
      }));

    const payouts = {};
    if (data.payouts && typeof data.payouts === "object") {
      for (const [key, p] of Object.entries(data.payouts)) {
        if (!/^\d{4}-\d{2}-[12]$/.test(key) || !p || !p.paid) continue;
        payouts[key] = {
          paid: true,
          paidAt: /^\d{4}-\d{2}-\d{2}$/.test(p.paidAt) ? p.paidAt : key.slice(0, 7) + "-01",
          ...(Number.isFinite(Number(p.amount)) && p.amount !== null && p.amount !== "" ? { amount: Math.round(Number(p.amount)) } : {}),
          proofs: (Array.isArray(p.proofs) ? p.proofs : [])
            .filter((x) => x && typeof x.id === "string" && typeof x.k === "string")
            .map((x) => ({
              id: x.id,
              k: x.k,
              at: /^\d{4}-\d{2}-\d{2}$/.test(x.at) ? x.at : null,
              amount: Number.isFinite(Number(x.amount)) ? Math.round(Number(x.amount)) : null,
            })),
          ...(p.share && typeof p.share.id === "string" && typeof p.share.k === "string" ? { share: { id: p.share.id, k: p.share.k } } : {}),
        };
      }
    }

    const subsidies = (Array.isArray(data.subsidies) ? data.subsidies : [])
      .filter((x) => x && /^\d{4}-\d{2}$/.test(x.ym) && (x.termin === 1 || x.termin === 2) && Number(x.amount) > 0)
      .map((x) => ({
        id: x.id ? String(x.id) : newId(),
        ym: x.ym,
        termin: x.termin,
        amount: Math.round(Number(x.amount)),
        purpose: typeof x.purpose === "string" ? x.purpose.slice(0, 80) : "",
      }));

    return {
      settings: {
        partnerName: typeof s.partnerName === "string" && s.partnerName.trim() ? s.partnerName.trim().slice(0, 40) : base.settings.partnerName,
        partnerPhone: typeof s.partnerPhone === "string" ? s.partnerPhone.replace(/[^\d+]/g, "").slice(0, 20) : "",
        // Akses partner: password + turunan (lookup & kunci) — hanya ada di vault terenkripsi.
        partnerAccess: s.partnerAccess && typeof s.partnerAccess.password === "string"
          && /^[0-9a-f]{64}$/.test(s.partnerAccess.lookup) && typeof s.partnerAccess.k === "string"
          ? { password: s.partnerAccess.password, lookup: s.partnerAccess.lookup, k: s.partnerAccess.k } : null,
        sharePct: defaultPct, // default untuk entri baru
        cutoff: Number.isFinite(cutoff) && s.cutoff !== "" && s.cutoff !== null ? clamp(Math.round(cutoff), 8, 23) : base.settings.cutoff,
      },
      entries,
      payouts,
      subsidies,
      theme: data.theme === "light" ? "light" : data.theme === "dark" ? "dark" : base.theme,
    };
  }

  // Data lama tidak menyimpan nominal yang dibayar — isi sekali dari perhitungan saat ini,
  // lalu nominal itu dibekukan agar riwayat tidak berubah saat entri/pengaturan diubah.
  function backfillPayoutAmounts() {
    for (const [key, p] of Object.entries(state.payouts)) {
      if (p.amount === undefined) {
        p.amount = payableOf(key.slice(0, 7), Number(key.slice(8)));
      }
    }
  }

  // Simpan = enkripsi -> cache lokal (langsung) -> sinkron ke cloud (sebentar lagi).
  // render() memanggil save() setiap kali; yang tidak berubah dilewati.
  let lastSavedJson = null;
  function save() {
    if (!vault.key) return;
    const json = JSON.stringify(state);
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

  // ---------- Enkripsi ----------
  // Dari password + email diturunkan 512 bit (PBKDF2-SHA256):
  //   - 256 bit pertama -> "password" untuk login Supabase (password asli tidak pernah dikirim)
  //   - 256 bit kedua   -> kunci AES-GCM untuk data (tidak pernah meninggalkan perangkat)
  // Jadi Supabase tidak bisa membuka data walau menyimpan hash login & ciphertext.

  const KDF_ITER = 600_000;
  const vault = { key: null, writing: Promise.resolve() };

  function toB64(buf) {
    const bytes = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const normEmail = (e) => String(e || "").trim().toLowerCase();

  async function deriveCredentials(email, password) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = new Uint8Array(await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: new TextEncoder().encode("cashflow-v2:" + normEmail(email)), iterations: KDF_ITER, hash: "SHA-256" },
      base, 512));
    const key = await crypto.subtle.importKey("raw", bits.slice(32), { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
    return { authSecret: toHex(bits.slice(0, 32)), key };
  }

  async function encryptJson(key, json) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(json));
    return JSON.stringify({ v: 2, iv: toB64(iv), data: toB64(ct) });
  }

  // Bukti transfer: tiap gambar punya kunci acak sendiri. Kuncinya disimpan di vault (ikut terenkripsi
  // dengan kunci password), jadi ganti password tidak perlu mengenkripsi ulang gambar.
  async function encryptReceipt(bytes, type) {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
    return { k: toB64(raw), data: JSON.stringify({ v: 1, type, iv: toB64(iv), data: toB64(ct) }) };
  }

  // Password partner -> lookup (untuk menemukan baris di server) + kunci AES. Harus sama persis dengan partner.js.
  async function derivePartner(password) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = new Uint8Array(await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: new TextEncoder().encode("cashflow-partner-v1"), iterations: KDF_ITER, hash: "SHA-256" },
      base, 512));
    return { lookup: toHex(bits.slice(0, 32)), k: toB64(bits.slice(32)) };
  }

  async function encryptWithRawKey(k, json) {
    const key = await crypto.subtle.importKey("raw", fromB64(k), { name: "AES-GCM" }, false, ["encrypt"]);
    return encryptJson(key, json);
  }

  async function decryptReceipt(k, dataStr) {
    const blob = JSON.parse(dataStr);
    const key = await crypto.subtle.importKey("raw", fromB64(k), { name: "AES-GCM" }, false, ["decrypt"]);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(blob.iv) }, key, fromB64(blob.data));
    return new Blob([pt], { type: blob.type || "image/jpeg" });
  }

  async function decryptBlob(key, blobStr) {
    const blob = typeof blobStr === "string" ? JSON.parse(blobStr) : blobStr;
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(blob.iv) }, key, fromB64(blob.data));
    return JSON.parse(new TextDecoder().decode(pt));
  }

  // Format lama (v1, lokal saja): kunci dari password + salt acak yang disimpan bersama data.
  async function decryptLegacyLocal(password) {
    let blob;
    try { blob = JSON.parse(localStorage.getItem(ENC_KEY) || "null"); } catch { return null; }
    if (!blob) return null;
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: fromB64(blob.salt), iterations: blob.iter || KDF_ITER, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    try { return await decryptBlob(key, blob); } catch { return null; }
  }

  const hasLegacyLocal = () => { try { return !!localStorage.getItem(ENC_KEY); } catch { return false; } };

  // ---------- Cache lokal (per email) ----------
  // { userId, email, blob, version (versi cloud yang jadi dasar), dirty, localAt, syncedAt }

  let cache = {};
  const cacheKey = (email) => `${CACHE_KEY}:${normEmail(email)}`;
  function readCache(email) {
    try { return JSON.parse(localStorage.getItem(cacheKey(email)) || "null") || {}; } catch { return {}; }
  }
  function writeCache() {
    if (!cache.email) return;
    try { localStorage.setItem(cacheKey(cache.email), JSON.stringify(cache)); } catch { warnOnce(); }
  }

  // ---------- Supabase (REST) ----------

  const cloudConfigured = () => /^https?:\/\//.test(CFG.supabaseUrl || "") && !!CFG.supabaseAnonKey;
  let session = null; // { access_token, refresh_token, expires_at, userId, email }

  class ApiError extends Error {
    constructor(status, body) {
      super(body.msg || body.error_description || body.message || body.error || `HTTP ${status}`);
      this.status = status;
      this.code = body.error_code || body.code || body.error || "";
    }
  }
  const isNetworkError = (e) => !(e instanceof ApiError);

  async function http(method, path, { body, token, headers = {} } = {}) {
    const res = await fetch(CFG.supabaseUrl.replace(/\/+$/, "") + path, {
      method,
      headers: {
        apikey: CFG.supabaseAnonKey,
        Authorization: "Bearer " + (token || CFG.supabaseAnonKey),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { message: text }; }
    if (!res.ok) throw new ApiError(res.status, json || {});
    return json;
  }

  function setSession(r, email) {
    session = {
      access_token: r.access_token,
      refresh_token: r.refresh_token,
      expires_at: Date.now() + (r.expires_in || 3600) * 1000,
      userId: r.user ? r.user.id : session && session.userId,
      email: normEmail(email || (r.user && r.user.email) || (session && session.email)),
    };
    persistSession();
  }

  async function persistSession() {
    try {
      const jwk = vault.key ? await crypto.subtle.exportKey("jwk", vault.key) : null;
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ session, jwk }));
    } catch { /* sesi tidak diingat — cukup login lagi */ }
  }

  function forgetSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* abaikan */ }
  }

  const auth = {
    // redirect_to: link konfirmasi di email kembali ke alamat aplikasi ini
    // (harus terdaftar di Supabase > Authentication > URL Configuration > Redirect URLs; kalau tidak, dipakai Site URL)
    signUp: (email, secret) => http("POST", "/auth/v1/signup?redirect_to=" + encodeURIComponent(appUrl()), { body: { email, password: secret } }),
    signIn: (email, secret) => http("POST", "/auth/v1/token?grant_type=password", { body: { email, password: secret } }),
    refresh: (rt) => http("POST", "/auth/v1/token?grant_type=refresh_token", { body: { refresh_token: rt } }),
    logout: (token) => http("POST", "/auth/v1/logout", { token }),
  };

  const appUrl = () => location.origin + location.pathname.replace(/index\.html$/, "");

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
      return { error: "Konfirmasi gagal: " + (h.get("error_description") || h.get("error_code") || h.get("error")).replace(/\+/g, " ") };
    }
    return { info: "Email sudah dikonfirmasi — silakan masuk." };
  }

  async function freshToken() {
    if (!session) throw new ApiError(401, { msg: "not signed in" });
    if (Date.now() > session.expires_at - 60_000) setSession(await auth.refresh(session.refresh_token));
    return session.access_token;
  }

  // Request dengan token user; kalau 401 coba refresh sekali.
  async function authed(method, path, opts = {}) {
    try {
      return await http(method, path, { ...opts, token: await freshToken() });
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401 || !session) throw e;
      setSession(await auth.refresh(session.refresh_token));
      return http(method, path, { ...opts, token: session.access_token });
    }
  }

  const remote = {
    async get() {
      const rows = await authed("GET", "/rest/v1/vaults?select=data,version,updated_at");
      return rows && rows[0] ? rows[0] : null;
    },
    // Tulis dengan cek versi (optimistic locking). Mengembalikan versi baru, atau null kalau keduluan perangkat lain.
    async put(data, baseVersion) {
      const now = new Date().toISOString();
      if (!baseVersion) {
        try {
          const rows = await authed("POST", "/rest/v1/vaults", {
            body: { data, version: 1, updated_at: now },
            headers: { Prefer: "return=representation" },
          });
          return rows[0].version;
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) return null; // sudah ada baris dari perangkat lain
          throw e;
        }
      }
      const rows = await authed("PATCH",
        `/rest/v1/vaults?user_id=eq.${encodeURIComponent(session.userId)}&version=eq.${baseVersion}`, {
          body: { data, version: baseVersion + 1, updated_at: now },
          headers: { Prefer: "return=representation" },
        });
      return rows && rows[0] ? rows[0].version : null;
    },
    putReceipt: (id, data) => authed("POST", "/rest/v1/receipts", { body: { id, data } }),
    async getReceipt(id) {
      const rows = await authed("GET", `/rest/v1/receipts?id=eq.${encodeURIComponent(id)}&select=data`);
      return rows && rows[0] ? rows[0].data : null;
    },
    deleteReceipts: (ids) => authed("DELETE", `/rest/v1/receipts?id=in.(${ids.map(encodeURIComponent).join(",")})`),
    putShare: (id, data, receiptIds) => authed("POST", "/rest/v1/shares", { body: { id, data, receipt_ids: receiptIds } }),
    deleteShares: (ids) => authed("DELETE", `/rest/v1/shares?id=in.(${ids.map(encodeURIComponent).join(",")})`),
    deleteAllShares: () => authed("DELETE", `/rest/v1/shares?user_id=eq.${encodeURIComponent(session.userId)}`),
    // on_conflict=user_id: satu baris per pemilik; ganti password partner = ganti lookup di baris yang sama
    putPartnerView: (body) => authed("POST", "/rest/v1/partner_views?on_conflict=user_id", {
      body, headers: { Prefer: "resolution=merge-duplicates" },
    }),
    deletePartnerView: () => authed("DELETE", `/rest/v1/partner_views?user_id=eq.${encodeURIComponent(session.userId)}`),
    deleteAllReceipts: () => authed("DELETE", `/rest/v1/receipts?user_id=eq.${encodeURIComponent(session.userId)}`),
    updatePassword: (secret) => authed("PUT", "/auth/v1/user", { body: { password: secret } }),
  };

  // ---------- Sinkron ----------

  const sync = { timer: null, running: false, again: false, state: "idle", conflictOpen: false };

  function setSync(st, detail) {
    sync.state = st;
    const el = document.getElementById("syncStatus");
    if (!el) return;
    el.dataset.state = st;
    const time = cache.syncedAt ? new Date(cache.syncedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "";
    document.getElementById("syncText").textContent =
      st === "syncing" ? "Menyinkron…"
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
  function applyRemote(data, row) {
    state = normalize(data);
    backfillPayoutAmounts();
    els.entryPct.value = state.settings.sharePct;
    lastSavedJson = JSON.stringify(state);
    cache.blob = row.data;
    cache.version = row.version;
    cache.dirty = false;
    cache.syncedAt = new Date().toISOString();
    writeCache();
    render();
  }

  async function runSync() {
    if (!vault.key) return;
    if (sync.running) { sync.again = true; return; }
    if (!session) {
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
            await resolveConflict(data, row);
            return;
          }
          applyRemote(data, row);
          break;
        }

        if (!cache.dirty) { cache.syncedAt = new Date().toISOString(); writeCache(); break; }

        const pushed = cache.blob;
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
      else setSync("error", e.status === 401 ? "sesi berakhir, keluar lalu masuk lagi" : e.message);
      scheduleSync(15_000);
    } finally {
      sync.running = false;
      if (sync.again) { sync.again = false; scheduleSync(300); }
    }
  }

  function describe(data, at) {
    const n = Array.isArray(data.entries) ? data.entries.length : 0;
    const when = at ? new Date(at).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
    return `${n} invoice${when ? " · diubah " + when : ""}`;
  }

  function resolveConflict(remoteData, row) {
    return new Promise((resolve) => {
      const d = document.getElementById("conflictDialog");
      sync.conflictOpen = true;
      setSync("conflict");
      document.getElementById("conflictRemoteInfo").textContent = describe(remoteData, row.updated_at);
      document.getElementById("conflictLocalInfo").textContent = describe(state, cache.localAt);
      d.returnValue = "";
      d.addEventListener("close", () => {
        sync.conflictOpen = false;
        if (d.returnValue === "remote") {
          applyRemote(remoteData, row);
          toast("Memakai data cloud");
          setSync("synced");
        } else if (d.returnValue === "local") {
          cache.version = row.version; // push berikutnya menimpa versi cloud ini
          writeCache();
          toast("Memakai data perangkat ini — mengirim ke cloud…");
          scheduleSync(0);
        } else {
          scheduleSync(30_000); // ditutup tanpa memilih — tanya lagi nanti
        }
        resolve();
      }, { once: true });
      d.showModal();
    });
  }

  // Tarik perubahan dari perangkat lain saat aplikasi kembali dibuka / aktif.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) scheduleSync(200); });
  window.addEventListener("online", () => scheduleSync(200));
  window.addEventListener("offline", () => setSync("offline"));
  setInterval(() => { if (!document.hidden) runSync(); }, 60_000);

  // ---------- Date helpers ----------

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  const pad = (n) => String(n).padStart(2, "0");

  function daysInMonth(ym) {
    const [y, m] = ym.split("-").map(Number);
    return new Date(y, m, 0).getDate();
  }

  function monthLabel(ym) {
    const [y, m] = ym.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
  }

  function shiftMonth(ym, delta) {
    const [y, m] = ym.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  }

  // Termin: 1 = awal bulan s/d tanggal batas, 2 = setelahnya s/d akhir bulan.
  function terminOf(dateStr) {
    const day = Number(dateStr.slice(8, 10));
    return day <= state.settings.cutoff ? 1 : 2;
  }

  function terminKey(ym, t) { return `${ym}-${t}`; }

  function terminPeriod(ym, t) {
    const cutoff = state.settings.cutoff;
    const last = daysInMonth(ym);
    return t === 1 ? `1 – ${cutoff}` : `${cutoff + 1} – ${last}`;
  }

  // ---------- Format ----------

  const fmtRp = (n) =>
    "Rp " + Math.round(n).toLocaleString("id-ID", { maximumFractionDigits: 0 });

  const fmtDate = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
  };

  // ---------- Computation ----------

  function monthEntries(ym) {
    return state.entries
      .filter((e) => e.date.startsWith(ym + "-"))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  const terminEntries = (ym, t) => monthEntries(ym).filter((e) => terminOf(e.date) === t);

  function terminProfit(ym, t) {
    return terminEntries(ym, t).reduce((s, e) => s + e.amount, 0);
  }

  // Tiap entri punya % sendiri; share dibulatkan per termin (Rupiah tanpa sen),
  // total bulan = jumlah dua termin.
  function shareOf(ym, t) {
    return Math.round(terminEntries(ym, t).reduce((s, e) => s + e.amount * (e.sharePct / 100), 0));
  }

  const terminSubsidies = (ym, t) => state.subsidies.filter((x) => x.ym === ym && x.termin === t);
  const subsidyOf = (ym, t) => terminSubsidies(ym, t).reduce((s, x) => s + x.amount, 0);

  // Yang perlu ditransfer ke partner = share − subsidi silang (tidak bisa negatif).
  const payableOf = (ym, t) => Math.max(0, shareOf(ym, t) - subsidyOf(ym, t));

  const fmtPct = (n) => `${n.toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`;

  // "10%" kalau semua entri sama, "campuran" kalau berbeda, default kalau belum ada entri.
  function pctLabel(entries) {
    const pcts = [...new Set(entries.map((e) => e.sharePct))];
    if (pcts.length === 0) return fmtPct(state.settings.sharePct);
    return pcts.length === 1 ? fmtPct(pcts[0]) : "campuran";
  }

  function terminTotals(ym, t) {
    const profit = terminProfit(ym, t);
    const share = shareOf(ym, t);
    const subsidy = subsidyOf(ym, t);
    const payable = Math.max(0, share - subsidy);
    const payout = state.payouts[terminKey(ym, t)];
    const paidAmount = payout ? payout.amount : 0;
    return {
      profit,
      share,
      subsidy,
      payable,                                         // share setelah dipotong subsidi silang
      paid: !!payout,                                  // pernah ada pembayaran
      settled: (!!payout || (share > 0 && payable === 0)) && paidAmount >= payable, // lunas (atau tertutup subsidi)
      paidAt: payout ? payout.paidAt : null,
      paidAmount,
      proofCount: payout && payout.proofs ? payout.proofs.length : 0,
      remaining: Math.max(0, payable - paidAmount),    // kurang bayar (mis. entri ditambah setelah dibayar)
      overpaid: Math.max(0, paidAmount - payable),     // lebih bayar (mis. entri dihapus setelah dibayar)
    };
  }

  // proof: { id, k } bukti transfer yang sudah diupload — wajib saat menandai dibayar.
  function markPaid(ym, t, paid, proof) {
    const key = terminKey(ym, t);
    if (paid) {
      const prev = state.payouts[key];
      const amount = payableOf(ym, t);
      const proofs = prev && prev.proofs ? prev.proofs : [];
      // Simpan nominal yang benar-benar dibayar agar riwayat tidak ikut berubah.
      state.payouts[key] = {
        paid: true, paidAt: today(), amount,
        proofs: [...proofs, { ...proof, at: today(), amount: amount - (prev ? prev.amount : 0) }],
      };
    } else {
      const prev = state.payouts[key];
      delete state.payouts[key];
      // Hapus gambar & link partner di cloud juga (kalau gagal/offline, tinggal jadi baris yatim yang tidak terbaca).
      if (prev && prev.proofs && prev.proofs.length && session) {
        remote.deleteReceipts(prev.proofs.map((x) => x.id)).catch(() => {});
      }
      if (prev && prev.share && session) remote.deleteShares([prev.share.id]).catch(() => {});
    }
    render();
    toast(paid ? `Payout ${t} ditandai sudah dibayar — ${monthLabel(ym)}` : "Tanda dibayar dibatalkan");
  }

  // ---------- DOM ----------

  const $ = (id) => document.getElementById(id);

  const els = {
    partnerLabel: $("partnerLabel"),
    kpiProfit: $("kpiProfit"), kpiProfitMeta: $("kpiProfitMeta"),
    kpiShare: $("kpiShare"), kpiShareMeta: $("kpiShareMeta"),
    kpiNet: $("kpiNet"), kpiNetMeta: $("kpiNetMeta"),
    kpiPaid: $("kpiPaid"), kpiPaidMeta: $("kpiPaidMeta"),
    kpiDue: $("kpiDue"), kpiDueMeta: $("kpiDueMeta"),
    monthTitle: $("monthTitle"),
    terminCards: $("terminCards"),
    entryForm: $("entryForm"), entryDate: $("entryDate"), entryAmount: $("entryAmount"), entryNote: $("entryNote"), entryPct: $("entryPct"),
    entryList: $("entryList"), entryEmpty: $("entryEmpty"), entryCount: $("entryCount"),
    subsidyForm: $("subsidyForm"), subsidyTermin: $("subsidyTermin"), subsidyAmount: $("subsidyAmount"),
    subsidyPurpose: $("subsidyPurpose"), subsidyList: $("subsidyList"), subsidyTotal: $("subsidyTotal"),
    historyList: $("historyList"), historyEmpty: $("historyEmpty"), payoutTotal: $("payoutTotal"),
    toast: $("toast"),
    chartOverlay: $("chartOverlay"),
    chartTotalMargin: $("chartTotalMargin"), chartTotalShare: $("chartTotalShare"),
    chartTotalNet: $("chartTotalNet"), chartTotalDue: $("chartTotalDue"),
    lineChart: $("lineChart"), lineSvg: $("lineSvg"), chartTip: $("chartTip"), chartLegend: $("chartLegend"),
    chartMonthRows: $("chartMonthRows"),
    chartRangeTitle: $("chartRangeTitle"),
  };

  function renderKpi() {
    const isThisMonth = viewMonth === today().slice(0, 7);
    const entries = monthEntries(viewMonth);
    const t1 = terminTotals(viewMonth, 1);
    const t2 = terminTotals(viewMonth, 2);
    const profit = t1.profit + t2.profit;
    const share = t1.share + t2.share;
    const subsidy = t1.subsidy + t2.subsidy;
    const paid = t1.paidAmount + t2.paidAmount;
    const due = t1.remaining + t2.remaining;
    const net = profit - share; // profit bersih = margin kotor − share partner
    const settledCount = (t1.settled && t1.share > 0 ? 1 : 0) + (t2.settled && t2.share > 0 ? 1 : 0);
    const dueCount = (t1.remaining > 0 ? 1 : 0) + (t2.remaining > 0 ? 1 : 0);

    els.kpiProfit.textContent = fmtRp(profit);
    els.kpiShare.textContent = fmtRp(share);
    els.kpiNet.textContent = fmtRp(net);
    els.kpiPaid.textContent = fmtRp(paid);
    els.kpiDue.textContent = fmtRp(due);

    const scope = isThisMonth ? "Bulan ini" : monthLabel(viewMonth);
    els.kpiProfitMeta.textContent = `${entries.length} Invoice · ${scope}`;
    els.kpiShareMeta.textContent = pctLabel(entries) === "campuran"
      ? `Rata-rata ${fmtPct(profit ? Math.round((share / profit) * 1000) / 10 : 0)}`
      : `${pctLabel(entries)} dari margin kotor`;
    if (subsidy > 0) els.kpiShareMeta.textContent += ` · subsidi silang −${fmtRp(subsidy)}`;
    els.kpiNetMeta.textContent = "Margin kotor − share partner";
    els.kpiPaidMeta.textContent = paid > 0 ? `${settledCount} dari 2 payout lunas` : "Belum ada payout lunas";
    els.kpiDueMeta.textContent = due > 0 ? `${dueCount} payout menunggu` : share > 0 ? "Semua lunas" : "Belum ada tagihan";

    clampDateToMonth();
  }

  function terminCard(ym, t, totals) {
    const empty = totals.profit === 0;
    const covered = !empty && !totals.paid && totals.share > 0 && totals.payable === 0; // share habis untuk subsidi
    const partial = totals.paid && totals.remaining > 0;
    const card = document.createElement("article");
    card.className = "termin" +
      (totals.settled && !empty ? " termin--paid" : "") +
      (totals.remaining > 0 ? " termin--due" : "") +
      (empty && !totals.paid ? " termin--empty" : "");

    const badge = totals.settled && !(empty && !totals.paid)
      ? `<span class="badge badge--paid"><span class="badge__dot"></span>Paid</span>`
      : partial
        ? `<span class="badge badge--unpaid"><span class="badge__dot"></span>Kurang</span>`
        : `<span class="badge badge--unpaid"><span class="badge__dot"></span>Unpaid</span>`;

    const paidNote = totals.paid
      ? `<p class="termin__note">Dibayar ${fmtRp(totals.paidAmount)} · ${fmtDate(totals.paidAt)}${
          totals.overpaid > 0 ? ` · lebih bayar ${fmtRp(totals.overpaid)}` : ""}${
          totals.proofCount ? ` · <button type="button" class="link-btn" data-proof="${terminKey(ym, t)}">Lihat bukti${totals.proofCount > 1 ? ` (${totals.proofCount})` : ""}</button>` : ""}${
          state.payouts[terminKey(ym, t)].share ? ` · <a class="link-btn" href="${escapeHtml(waUrl(terminKey(ym, t)))}" target="_blank" rel="noopener">Kirim WA</a>` : ""}</p>`
      : "";

    const footBtn = partial
      ? `<button class="btn btn--primary btn--block" data-mark="${t}">Tandai sisa dibayar</button>
         <button class="btn btn--ghost btn--block" data-unmark="${t}">Batalkan tanda bayar</button>
         ${paidNote}`
      : totals.paid
        ? `<button class="btn btn--ghost btn--block" data-unmark="${t}">Batalkan tanda lunas</button>
           ${paidNote}`
        : covered
          ? `<p class="termin__note">Share tertutup subsidi silang — tidak ada yang perlu ditransfer</p>`
        : empty
          ? `<p class="termin__note">Belum ada invoice di periode ini</p>`
          : `<button class="btn btn--primary btn--block" data-mark="${t}">Tandai sudah dibayar</button>`;

    card.innerHTML = `
      <div class="termin__head">
        <div>
          <p class="termin__name" style="margin:0">Payout ${t}</p>
          <p class="termin__period" style="margin:2px 0 0">${terminPeriod(ym, t)}</p>
        </div>
        ${badge}
      </div>
      <div class="termin__figures">
        <div class="figure">
          <span class="figure__label">Margin Kotor (Tgl ${terminPeriod(ym, t).replace(" – ", " - ")})</span>
          <span class="figure__value">${fmtRp(totals.profit)}</span>
        </div>
        <div class="figure">
          <span class="figure__label">Share partner (${pctLabel(terminEntries(ym, t))})</span>
          <span class="figure__value">${fmtRp(totals.share)}</span>
        </div>
        ${totals.subsidy > 0 ? `
        <div class="figure">
          <span class="figure__label">Subsidi silang</span>
          <span class="figure__value figure__value--neg">−${fmtRp(totals.subsidy)}</span>
        </div>` : ""}
        <div class="figure">
          <span class="figure__label">Profit bersih kamu</span>
          <span class="figure__value">${fmtRp(totals.profit - totals.share)}</span>
        </div>
      </div>
      <div class="termin__share">
        <p class="termin__share-label">
          <span class="tile__dot ${totals.paid ? "tile__dot--good" : "tile__dot--warn"}"></span>
          ${partial ? "Sisa perlu ditransfer" : totals.paid ? "Sudah ditransfer" : covered ? "Tertutup subsidi silang" : "Perlu ditransfer"}
        </p>
        <p class="termin__share-value">${
          partial ? fmtRp(totals.remaining) : totals.paid ? fmtRp(totals.paidAmount) : empty ? "—" : fmtRp(totals.payable)}</p>
      </div>
      <div class="termin__foot">
        ${footBtn}
      </div>
    `;
    return card;
  }

  function renderTermins() {
    els.terminCards.replaceChildren(
      terminCard(viewMonth, 1, terminTotals(viewMonth, 1)),
      terminCard(viewMonth, 2, terminTotals(viewMonth, 2)),
    );
  }

  function renderEntries() {
    const entries = monthEntries(viewMonth);
    els.entryCount.textContent = `${entries.length} Invoice`;
    els.entryEmpty.hidden = entries.length > 0;

    const frag = document.createDocumentFragment();
    for (const e of entries) {
      const li = document.createElement("li");
      li.className = "entry";
      li.innerHTML = `
        <span class="entry__date">${fmtDate(e.date)}</span>
        <div class="entry__body">
          <span class="entry__amount">${fmtRp(e.amount)}</span>
          ${e.note ? `<span class="entry__note"></span>` : ""}
          <span class="entry__share">Share ${fmtPct(e.sharePct)} · ${fmtRp(Math.round(e.amount * (e.sharePct / 100)))}</span>
        </div>
        <div class="entry__side">
          <span class="entry__tag">Payout ${terminOf(e.date)}</span>
          <button class="del-btn" data-del="${e.id}" aria-label="Hapus invoice">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
          </button>
        </div>
      `;
      const noteEl = li.querySelector(".entry__note");
      if (noteEl) noteEl.textContent = e.note; // textContent, bukan innerHTML — aman dari injeksi
      frag.appendChild(li);
    }
    els.entryList.replaceChildren(frag);
  }

  function renderSubsidies() {
    const list = state.subsidies
      .filter((x) => x.ym === viewMonth)
      .sort((a, b) => a.termin - b.termin);
    const total = list.reduce((s, x) => s + x.amount, 0);
    els.subsidyTotal.textContent = list.length ? `${fmtRp(total)} bulan ini` : "—";

    const frag = document.createDocumentFragment();
    for (const x of list) {
      const li = document.createElement("li");
      li.className = "entry";
      li.innerHTML = `
        <div class="entry__body">
          <span class="entry__amount">−${fmtRp(x.amount)}</span>
          <span class="entry__note"></span>
        </div>
        <div class="entry__side">
          <span class="entry__tag">Payout ${x.termin}</span>
          <button class="del-btn" data-del-subsidy="${x.id}" aria-label="Hapus subsidi silang">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
          </button>
        </div>
      `;
      li.querySelector(".entry__note").textContent = x.purpose; // textContent — aman dari injeksi
      frag.appendChild(li);
    }
    els.subsidyList.replaceChildren(frag);
  }

  function renderHistory() {
    const paid = Object.entries(state.payouts)
      .filter(([, p]) => p.paid)
      .map(([key, p]) => ({ ym: key.slice(0, 7), t: Number(key.slice(8)), ...p, share: p.amount }))
      .sort((a, b) => (a.ym < b.ym ? 1 : a.ym > b.ym ? -1 : b.t - a.t));

    const total = paid.reduce((s, p) => s + p.share, 0);
    els.payoutTotal.textContent = paid.length ? `${fmtRp(total)} total` : "—";
    els.historyEmpty.hidden = paid.length > 0;

    const frag = document.createDocumentFragment();
    for (const p of paid) {
      const li = document.createElement("li");
      li.className = "history__item";
      li.innerHTML = `
        <span class="badge badge--paid"><span class="badge__dot"></span>Paid</span>
        <div class="history__body">
          <p class="history__title" style="margin:0">Payout ${p.t} — ${monthLabel(p.ym)}</p>
          <p class="history__date" style="margin:1px 0 0">Untuk ${escapeHtml(state.settings.partnerName)} · dibayar ${fmtDate(p.paidAt)}</p>
          ${p.proofs && p.proofs.length ? `<button type="button" class="link-btn history__proof" data-proof="${p.ym}-${p.t}">Lihat bukti transfer${p.proofs.length > 1 ? ` (${p.proofs.length})` : ""}</button>` : ""}
        </div>
        <span class="history__amount">${fmtRp(p.share)}</span>
      `;
      frag.appendChild(li);
    }
    els.historyList.replaceChildren(frag);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === "light" ? "#f9f9f7" : "#0d0d0d";
  }

  function render() {
    applyTheme(state.theme);
    try { localStorage.setItem(THEME_KEY, state.theme); } catch { /* abaikan */ }

    els.partnerLabel.textContent = "Profit Sharing - Made with <3";
    els.monthTitle.textContent = monthLabel(viewMonth);
    renderKpi();
    renderTermins();
    renderEntries();
    renderSubsidies();
    renderHistory();
    save();
    schedulePartnerPublish();
  }

  // ---------- Chart overlay ----------

  let chartShow = { margin: true, share: true, net: true }; // garis yang ditampilkan
  let chartData = [];          // satu item per bulan di rentang (urutan sama dengan sumbu X)
  let rangeFrom = null;        // "YYYY-MM"; null = default 12 bulan terakhir
  let rangeTo = null;

  const SERIES = [
    { key: "margin", label: "Margin kotor" },
    { key: "share",  label: "Share partner" },
    { key: "net",    label: "Profit bersih" },
  ];

  function computeMonth(ym) {
    const t1 = terminTotals(ym, 1);
    const t2 = terminTotals(ym, 2);
    return {
      ym,
      margin: t1.profit + t2.profit,
      share: t1.share + t2.share,
      net: (t1.profit + t2.profit) - (t1.share + t2.share),
      // termin tanpa share (kosong) dihitung lunas — tidak ada yang perlu dibayar
      paidCount: (t1.remaining === 0 ? 1 : 0) + (t2.remaining === 0 ? 1 : 0),
      due: t1.remaining + t2.remaining,
    };
  }

  const shortMonth = (ym, withYear = true) => {
    const [y, m] = ym.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("id-ID", withYear ? { month: "short", year: "numeric" } : { month: "short" });
  };

  function monthsInRange(from, to) {
    const out = [];
    for (let ym = from; ym <= to; ym = shiftMonth(ym, 1)) out.push(ym);
    return out;
  }

  // Batas pilihan bulan: dari bulan data pertama (minimal 11 bulan lalu) s/d bulan data terakhir / bulan ini.
  function rangeBounds() {
    const cur = today().slice(0, 7);
    let first = null, last = cur;
    for (const e of state.entries) {
      const ym = e.date.slice(0, 7);
      if (!first || ym < first) first = ym;
      if (ym > last) last = ym;
    }
    const min12 = shiftMonth(last, -11);
    return { first: first || min12, earliest: first && first < min12 ? first : min12, latest: last };
  }

  function presetRange(preset) {
    const b = rangeBounds();
    const year = today().slice(0, 4);
    if (preset === "6") return [shiftMonth(b.latest, -5), b.latest];
    if (preset === "12") return [shiftMonth(b.latest, -11), b.latest];
    if (preset === "year") return [`${year}-01`, `${year}-12` < b.latest ? `${year}-12` : b.latest];
    return [b.first < b.latest ? b.first : b.latest, b.latest]; // "all"
  }

  function renderRangeControls() {
    const b = rangeBounds();
    if (!rangeFrom || !rangeTo) [rangeFrom, rangeTo] = presetRange("12");
    // jepit ke batas pilihan (mis. setelah data dihapus)
    if (rangeFrom < b.earliest) rangeFrom = b.earliest;
    if (rangeTo > b.latest) rangeTo = b.latest;
    if (rangeFrom > rangeTo) rangeFrom = rangeTo;

    const opts = monthsInRange(b.earliest, b.latest).reverse(); // terbaru di atas
    for (const [sel, val] of [[$("rangeFrom"), rangeFrom], [$("rangeTo"), rangeTo]]) {
      sel.replaceChildren(...opts.map((ym) => new Option(shortMonth(ym), ym, false, ym === val)));
    }

    for (const btn of document.querySelectorAll("[data-preset]")) {
      const [f, t] = presetRange(btn.dataset.preset);
      btn.classList.toggle("is-active", f === rangeFrom && t === rangeTo);
    }
  }

  function renderChart() {
    renderRangeControls();
    const cur = today().slice(0, 7);
    const yms = monthsInRange(rangeFrom, rangeTo);
    chartData = yms.map(computeMonth);
    const withData = chartData.filter((d) => d.margin > 0);

    els.chartRangeTitle.textContent =
      `Bulanan · ${shortMonth(rangeFrom)} – ${shortMonth(rangeTo)} (${yms.length} bulan)`;

    // ringkasan total untuk rentang terpilih
    let totalMargin = 0, totalShare = 0, totalDue = 0;
    for (const d of chartData) {
      totalMargin += d.margin;
      totalShare += d.share;
      totalDue += d.due;
    }
    els.chartTotalMargin.textContent = fmtRp(totalMargin);
    els.chartTotalShare.textContent = fmtRp(totalShare);
    els.chartTotalNet.textContent = fmtRp(totalMargin - totalShare);
    els.chartTotalDue.textContent = fmtRp(totalDue);

    for (const btn of els.chartLegend.querySelectorAll("[data-series]")) {
      btn.setAttribute("aria-pressed", String(chartShow[btn.dataset.series]));
    }

    if (withData.length === 0) {
      chartData = [];
      drawEmptyChart(state.entries.length ? "Tidak ada data di rentang ini." : "Belum ada data. Tambahkan invoice dulu.");
    } else {
      drawLineChart();
    }
    renderChartTable(withData, cur);
  }

  // ---- Grafik garis (SVG) ----

  const SVG_NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs = {}, text) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text !== undefined) el.textContent = text;
    return el;
  }

  // Angka ringkas untuk sumbu: 1,5 M / 12 jt / 500 rb
  function fmtCompact(n) {
    const abs = Math.abs(n);
    const f = (v) => v.toLocaleString("id-ID", { maximumFractionDigits: v < 10 ? 1 : 0 });
    if (abs >= 1e9) return f(n / 1e9) + " M";
    if (abs >= 1e6) return f(n / 1e6) + " jt";
    if (abs >= 1e3) return f(n / 1e3) + " rb";
    return String(Math.round(n));
  }

  // Skala sumbu Y yang "bulat": kelipatan 1 / 2 / 2,5 / 5 × 10^k, sekitar 4 garis.
  function niceScale(max) {
    if (max <= 0) return { top: 1, step: 0.25 };
    const raw = max / 4;
    const pow = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw);
    return { top: Math.ceil(max / step) * step, step };
  }

  // Kurva halus yang tidak "melampaui" titik data (monotone cubic / Fritsch–Carlson).
  function monotonePath(pts) {
    if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`;
    const n = pts.length;
    const dx = [], m = [], t = new Array(n);
    for (let i = 0; i < n - 1; i++) {
      dx[i] = pts[i + 1][0] - pts[i][0];
      m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i];
    }
    t[0] = m[0];
    t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
      const a = t[i] / m[i], b = t[i + 1] / m[i], h = a * a + b * b;
      if (h > 9) { const k = 3 / Math.sqrt(h); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
    }
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 0; i < n - 1; i++) {
      const h = dx[i] / 3;
      d += ` C${pts[i][0] + h},${pts[i][1] + t[i] * h} ${pts[i + 1][0] - h},${pts[i + 1][1] - t[i + 1] * h} ${pts[i + 1][0]},${pts[i + 1][1]}`;
    }
    return d;
  }

  let chartGeo = null; // { xs, top, bottom } — dipakai layer hover

  function drawEmptyChart(msg) {
    chartGeo = null;
    els.chartTip.hidden = true;
    const svg = els.lineSvg;
    svg.setAttribute("viewBox", "0 0 300 120");
    svg.style.height = "120px";
    svg.replaceChildren(svgEl("text", { x: 150, y: 64, "text-anchor": "middle", class: "lchart__empty" }, msg));
  }

  function drawLineChart() {
    const svg = els.lineSvg;
    const W = Math.max(280, els.lineChart.clientWidth || 600);
    const H = W < 480 ? 220 : 260;
    const series = SERIES.filter((s) => chartShow[s.key]);
    const max = Math.max(1, ...chartData.flatMap((d) => series.map((s) => d[s.key])));
    const { top: yTop, step } = niceScale(max);

    const padL = Math.max(...Array.from({ length: Math.round(yTop / step) + 1 }, (_, i) => fmtCompact(i * step).length)) * 6.6 + 14;
    const padR = 14, padT = 12, padB = 30;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const n = chartData.length;
    const xs = chartData.map((_, i) => padL + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1)));
    const y = (v) => padT + plotH - (v / yTop) * plotH;

    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.style.height = H + "px";
    const frag = document.createDocumentFragment();

    // gradien area margin kotor
    const defs = svgEl("defs");
    const grad = svgEl("linearGradient", { id: "areaGrad", x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.append(
      svgEl("stop", { offset: "0%", "stop-color": "var(--s-margin)", "stop-opacity": "0.18" }),
      svgEl("stop", { offset: "100%", "stop-color": "var(--s-margin)", "stop-opacity": "0" }),
    );
    defs.append(grad);
    frag.append(defs);

    // grid + label sumbu Y
    for (let v = 0; v <= yTop + step / 2; v += step) {
      const yy = Math.round(y(v)) + 0.5;
      frag.append(svgEl("line", { x1: padL, x2: W - padR, y1: yy, y2: yy, class: v === 0 ? "lchart__base" : "lchart__grid" }));
      frag.append(svgEl("text", { x: padL - 8, y: yy + 3.5, "text-anchor": "end", class: "lchart__tick" }, v === 0 ? "0" : fmtCompact(v)));
    }

    // label sumbu X — dijarangkan supaya tidak bertabrakan
    const multiYear = rangeFrom.slice(0, 4) !== rangeTo.slice(0, 4);
    const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / (multiYear ? 52 : 40)))));
    chartData.forEach((d, i) => {
      if ((n - 1 - i) % every !== 0) return; // selalu tampilkan bulan terakhir
      let label = shortMonth(d.ym, false);
      if (multiYear && (i === 0 || d.ym.endsWith("-01") || every > 1)) label += " " + d.ym.slice(2, 4);
      const anchor = n > 1 && i === 0 ? "start" : n > 1 && i === n - 1 ? "end" : "middle";
      frag.append(svgEl("text", { x: xs[i], y: H - 10, "text-anchor": anchor, class: "lchart__tick" }, label));
    });

    // area + garis (margin paling belakang)
    for (const s of [...series].reverse()) {
      const pts = chartData.map((d, i) => [xs[i], y(d[s.key])]);
      const d = monotonePath(pts);
      if (s.key === "margin" && n > 1) {
        frag.append(svgEl("path", { d: `${d} L${xs[n - 1]},${y(0)} L${xs[0]},${y(0)} Z`, fill: "url(#areaGrad)" }));
      }
      frag.append(svgEl("path", { d, class: "lchart__line", stroke: `var(--s-${s.key})` }));
      // titik: semua bulan kalau sedikit, kalau banyak cukup titik terakhir
      pts.forEach(([px, py], i) => {
        if (n > 12 && i !== n - 1) return;
        frag.append(svgEl("circle", { cx: px, cy: py, r: 4, class: "lchart__dot", fill: `var(--s-${s.key})` }));
      });
    }

    // layer hover
    const hover = svgEl("g", { class: "lchart__hover", visibility: "hidden" });
    hover.append(svgEl("line", { y1: padT, y2: padT + plotH, class: "lchart__cross" }));
    for (const s of series) hover.append(svgEl("circle", { r: 5.5, class: "lchart__dot lchart__dot--hl", fill: `var(--s-${s.key})`, "data-k": s.key }));
    frag.append(hover);
    frag.append(svgEl("rect", { x: padL - 10, y: 0, width: plotW + 20, height: H, fill: "transparent", class: "lchart__hit" }));

    svg.replaceChildren(frag);
    chartGeo = { xs, y, W, series, hover };
    els.chartTip.hidden = true;
  }

  function nearestIndex(clientX) {
    const rect = els.lineSvg.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * chartGeo.W;
    let best = 0;
    chartGeo.xs.forEach((px, i) => { if (Math.abs(px - x) < Math.abs(chartGeo.xs[best] - x)) best = i; });
    return best;
  }

  function showChartTip(i) {
    if (!chartGeo || !chartData[i]) return;
    const d = chartData[i];
    const { xs, y, hover, series, W } = chartGeo;
    hover.setAttribute("visibility", "visible");
    const cross = hover.querySelector(".lchart__cross");
    cross.setAttribute("x1", xs[i]);
    cross.setAttribute("x2", xs[i]);
    for (const c of hover.querySelectorAll("circle")) {
      c.setAttribute("cx", xs[i]);
      c.setAttribute("cy", y(d[c.dataset.k]));
    }

    const status = d.margin === 0 ? "Tidak ada invoice"
      : d.paidCount === 2 ? "Lunas" : d.paidCount === 0 ? `Belum dibayar ${fmtRp(d.due)}` : `1/2 lunas · sisa ${fmtRp(d.due)}`;
    const tip = els.chartTip;
    tip.innerHTML = `
      <p class="lchart__tip-title">${monthLabel(d.ym)}</p>
      ${series.map((s) => `
        <p class="lchart__tip-row"><span class="legend__key sdot--${s.key}"></span><span>${s.label}</span><b>${fmtRp(d[s.key])}</b></p>`).join("")}
      <p class="lchart__tip-status">${status}</p>
      <button type="button" class="link-btn lchart__tip-open" data-open-month="${d.ym}">Buka bulan ini →</button>
    `;
    tip.hidden = false;
    // posisi: di sisi kanan titik, pindah ke kiri kalau mepet tepi
    const boxW = els.lineChart.clientWidth;
    const px = (xs[i] / W) * boxW;
    const tw = tip.offsetWidth;
    tip.style.left = (px + 14 + tw > boxW ? Math.max(0, px - 14 - tw) : px + 14) + "px";
  }

  function hideChartTip() {
    if (chartGeo) chartGeo.hover.setAttribute("visibility", "hidden");
    els.chartTip.hidden = true;
  }

  // Tabel per bulan (bulan yang ada datanya, terbaru di atas)
  function renderChartTable(withData, cur) {
    const wrap = els.chartMonthRows;
    if (withData.length === 0) { wrap.replaceChildren(); return; }
    const rows = [...withData].reverse().map((d) => {
      const [y, m] = d.ym.split("-").map(Number);
      const label = new Date(y, m - 1, 1).toLocaleDateString("id-ID", { month: "short", year: "numeric" });
      const status = d.paidCount === 2
        ? `<span class="badge badge--paid"><span class="badge__dot"></span>Lunas</span>`
        : d.paidCount === 0
          ? `<span class="badge badge--unpaid"><span class="badge__dot"></span>Unpaid</span>`
          : `<span class="ctable__part">1/2 lunas</span>`;
      return `<tr class="${d.ym === cur ? "is-current" : ""}" data-open-month="${d.ym}">
        <th scope="row">${label}</th>
        <td>${fmtRp(d.margin)}</td><td>${fmtRp(d.share)}</td><td>${fmtRp(d.net)}</td><td>${status}</td></tr>`;
    }).join("");
    wrap.innerHTML = `<table class="ctable">
      <thead><tr><th scope="col">Bulan</th><th scope="col">Margin kotor</th><th scope="col">Share</th><th scope="col">Profit bersih</th><th scope="col">Status</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  }

  // ---------- Toast ----------

  let toastTimer;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("toast--show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("toast--show"), 2600);
  }

  // ---------- Events ----------

  $("btnPrevMonth").addEventListener("click", () => { viewMonth = shiftMonth(viewMonth, -1); render(); });
  $("btnNextMonth").addEventListener("click", () => { viewMonth = shiftMonth(viewMonth, 1); render(); });
  $("btnToday").addEventListener("click", () => { viewMonth = today().slice(0, 7); render(); });

  $("btnTheme").addEventListener("click", () => {
    state.theme = state.theme === "light" ? "dark" : "light";
    render();
  });

  els.terminCards.addEventListener("click", (ev) => {
    const mark = ev.target.closest("[data-mark]");
    const unmark = ev.target.closest("[data-unmark]");
    if (mark) {
      const t = Number(mark.dataset.mark);
      const totals = terminTotals(viewMonth, t);
      const msg = totals.paid
        ? `Sisa Payout ${t} bulan ${monthLabel(viewMonth)} sebesar ${fmtRp(totals.remaining)} (total menjadi ${fmtRp(totals.payable)}).`
        : `Payout ${t} bulan ${monthLabel(viewMonth)} sebesar ${fmtRp(totals.payable)}.`;
      openProofDialog(viewMonth, t, msg);
    } else if (unmark) {
      const t = Number(unmark.dataset.unmark);
      if (confirm(`Batalkan tanda bayar Payout ${t} bulan ${monthLabel(viewMonth)}? Catatan pembayaran akan dihapus dari riwayat.`)) {
        markPaid(viewMonth, t, false);
      }
    }
  });

  // ---------- Data untuk login partner ----------
  // Hanya angka milik partner: share, subsidi, transfer, status & bukti. Tanpa margin kotor, invoice, profit bersih.

  function partnerSnapshot() {
    const yms = new Set([
      ...state.entries.map((e) => e.date.slice(0, 7)),
      ...state.subsidies.map((x) => x.ym),
      ...Object.keys(state.payouts).map((k) => k.slice(0, 7)),
    ]);
    const months = [];
    let received = 0, outstanding = 0;
    for (const ym of [...yms].sort().reverse()) {
      const payouts = [];
      for (const t of [1, 2]) {
        const tt = terminTotals(ym, t);
        const p = state.payouts[terminKey(ym, t)];
        if (tt.share === 0 && !p && tt.subsidy === 0) continue;
        received += tt.paidAmount;
        outstanding += tt.remaining;
        payouts.push({
          t, period: terminPeriod(ym, t),
          share: tt.share, subsidy: tt.subsidy, payable: tt.payable,
          paid: tt.paid, settled: tt.settled, paidAt: tt.paidAt, paidAmount: tt.paidAmount, remaining: tt.remaining,
          subsidies: terminSubsidies(ym, t).map((x) => ({ amount: x.amount, purpose: x.purpose })),
          proofs: p && p.proofs ? p.proofs.map((x) => ({ id: x.id, k: x.k, at: x.at, amount: x.amount })) : [],
        });
      }
      if (payouts.length) months.push({ ym, label: monthLabel(ym), payouts });
    }
    return { v: 1, partnerName: state.settings.partnerName, received, outstanding, months };
  }

  let partnerPublished = null; // lookup + json terakhir yang sudah terkirim
  let partnerTimer = null;
  function schedulePartnerPublish() {
    if (!state.settings.partnerAccess) return;
    clearTimeout(partnerTimer);
    partnerTimer = setTimeout(() => publishPartnerView().catch(() => {}), 1500);
  }

  async function publishPartnerView() {
    const acc = state.settings.partnerAccess;
    if (!acc || !session || !vault.key) return;
    const snap = partnerSnapshot();
    const json = JSON.stringify(snap);
    const sig = acc.lookup + json;
    if (sig === partnerPublished) return; // tidak berubah sejak kiriman terakhir
    const data = await encryptWithRawKey(acc.k, json);
    const receiptIds = snap.months.flatMap((m) => m.payouts.flatMap((p) => p.proofs.map((x) => x.id)));
    await remote.putPartnerView({ lookup: acc.lookup, data, receipt_ids: receiptIds, updated_at: new Date().toISOString() });
    partnerPublished = sig;
    renderPartnerAccess();
  }

  function renderPartnerAccess() {
    const acc = state.settings.partnerAccess;
    $("partnerAccessStatus").textContent = acc
      ? (partnerPublished && partnerPublished.startsWith(acc.lookup) ? "Aktif — data partner sudah tersinkron" : "Aktif — menunggu sinkron")
      : "Belum aktif";
    $("btnDisablePartner").hidden = !acc;
    $("btnSavePartnerPw").textContent = acc ? "Ganti password partner" : "Aktifkan akses partner";
  }

  function randomPassword(len = 14) {
    const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // tanpa karakter mirip (0/O, 1/l/I)
    const rnd = crypto.getRandomValues(new Uint32Array(len));
    return Array.from(rnd, (n) => chars[n % chars.length]).join("");
  }

  // ---------- Link detail payout untuk partner (WhatsApp) ----------

  const b64url = (b64) => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const shareLink = (share) => `${appUrl()}share.html#${share.id}.${b64url(share.k)}`;

  // 08xx / 8xx / +62xx -> 62xx (format wa.me). Kosong kalau nomor tidak valid.
  function waPhone(raw) {
    let d = String(raw || "").replace(/\D/g, "");
    if (d.startsWith("0")) d = "62" + d.slice(1);
    else if (d.startsWith("8")) d = "62" + d;
    return d.length >= 10 ? d : "";
  }

  function waUrl(key) {
    const p = state.payouts[key];
    const ym = key.slice(0, 7), t = Number(key.slice(8));
    const lines = [
      `Halo ${state.settings.partnerName}, Payout ${t} ${monthLabel(ym)} (tgl ${terminPeriod(ym, t)}) sudah dibayarkan ✅`,
      ``,
      `Jumlah: ${fmtRp(p.amount)}`,
      `Tanggal bayar: ${fmtDate(p.paidAt)}`,
      ``,
      `Detail payout & invoice:`,
      shareLink(p.share),
    ];
    const phone = waPhone(state.settings.partnerPhone);
    return `https://wa.me/${phone}?text=${encodeURIComponent(lines.join("\n"))}`;
  }

  // Ringkasan yang bisa dilihat partner — hanya payout ini, bukan seluruh data.
  function shareSnapshot(ym, t) {
    const totals = terminTotals(ym, t);
    const p = state.payouts[terminKey(ym, t)];
    return {
      v: 1,
      partnerName: state.settings.partnerName,
      ym, t,
      monthLabel: monthLabel(ym),
      period: terminPeriod(ym, t),
      paidAt: p.paidAt,
      paidAmount: p.amount,
      // id + kunci bukti transfer, supaya partner bisa melihat gambarnya (diizinkan lewat receipt_ids)
      payments: (p.proofs || []).map((x) => ({ at: x.at, amount: x.amount, proof: { id: x.id, k: x.k } })),
      profit: totals.profit,
      share: totals.share,
      subsidy: totals.subsidy,
      payable: totals.payable,
      entries: terminEntries(ym, t).map((e) => ({
        date: e.date, amount: e.amount, note: e.note, sharePct: e.sharePct,
        share: Math.round(e.amount * (e.sharePct / 100)),
      })),
      subsidies: terminSubsidies(ym, t).map((x) => ({ amount: x.amount, purpose: x.purpose })),
      createdAt: new Date().toISOString(),
    };
  }

  // Buat link baru untuk payout ini (menggantikan link lama, mis. setelah bayar sisa).
  async function createShare(ym, t) {
    const key = terminKey(ym, t);
    const json = JSON.stringify(shareSnapshot(ym, t));
    const { k, data } = await encryptReceipt(new TextEncoder().encode(json), "application/json");
    const id = newId();
    const receiptIds = (state.payouts[key].proofs || []).map((x) => x.id);
    await remote.putShare(id, data, receiptIds);
    const p = state.payouts[key];
    if (!p) return; // keburu dibatalkan
    const old = p.share;
    p.share = { id, k };
    if (old) remote.deleteShares([old.id]).catch(() => {});
    render();
  }

  const waDlg = $("waDialog");
  function openWaDialog(key) {
    const ym = key.slice(0, 7), t = Number(key.slice(8));
    const phone = waPhone(state.settings.partnerPhone);
    $("waText").textContent = phone
      ? `Kirim kabar ke ${state.settings.partnerName} (+${phone}) bahwa Payout ${t} ${monthLabel(ym)} sudah dibayarkan, lengkap dengan link detail payout & invoice?`
      : `Kirim kabar ke ${state.settings.partnerName} bahwa Payout ${t} ${monthLabel(ym)} sudah dibayarkan? Nomor WhatsApp partner belum diisi di Pengaturan — kamu akan memilih kontak di WhatsApp.`;
    $("waLink").href = waUrl(key);
    waDlg.showModal();
  }
  $("waLink").addEventListener("click", () => setTimeout(() => waDlg.close(), 0));

  // ---------- Bukti transfer ----------

  const proofDlg = $("proofDialog");
  const proofViewDlg = $("proofViewDialog");
  let proofTarget = null;   // { ym, t }
  let proofBlob = null;     // gambar yang sudah dikompres, siap dienkripsi
  const proofUrls = new Map(); // id -> object URL (cache selama sesi)

  // Perkecil screenshot (sisi terpanjang maks 1600px, JPEG) supaya upload cepat dan hemat ruang.
  async function compressImage(file) {
    const MAX = 1600;
    const img = await createImageBitmap(file);
    const scale = Math.min(1, MAX / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; // PNG transparan -> latar putih
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    img.close && img.close();
    for (const q of [0.82, 0.7, 0.55]) {
      const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", q));
      if (blob && blob.size <= 1_500_000) return blob;
    }
    throw new UserError("Gambar terlalu besar — coba screenshot yang lebih kecil");
  }

  function openProofDialog(ym, t, msg) {
    proofTarget = { ym, t };
    proofBlob = null;
    $("proofText").textContent = `${msg} Lampirkan screenshot bukti transfer untuk menandai sudah dibayar.`;
    $("proofFile").value = "";
    $("proofPreview").hidden = true;
    $("proofPreview").removeAttribute("src");
    $("proofError").textContent = cloudConfigured() ? "" : "Bukti transfer butuh sinkron cloud (Supabase) yang aktif.";
    $("btnProofSave").disabled = true;
    proofDlg.showModal();
  }

  $("proofFile").addEventListener("change", async () => {
    const file = $("proofFile").files[0];
    proofBlob = null;
    $("btnProofSave").disabled = true;
    $("proofError").textContent = "";
    const prev = $("proofPreview");
    if (prev.src) URL.revokeObjectURL(prev.src);
    prev.hidden = true;
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      $("proofError").textContent = "File harus berupa gambar (screenshot).";
      return;
    }
    try {
      proofBlob = await compressImage(file);
      prev.src = URL.createObjectURL(proofBlob);
      prev.hidden = false;
      $("btnProofSave").disabled = false;
    } catch (e) {
      $("proofError").textContent = e instanceof UserError ? e.message : "Gambar tidak bisa dibaca — coba file lain.";
    }
  });

  $("btnProofCancel").addEventListener("click", () => proofDlg.close());
  proofDlg.addEventListener("close", () => {
    const prev = $("proofPreview");
    if (prev.src) URL.revokeObjectURL(prev.src);
    prev.removeAttribute("src");
  });

  $("proofForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!proofBlob || !proofTarget) {
      $("proofError").textContent = "Pilih screenshot bukti transfer dulu.";
      return;
    }
    if (!session) {
      $("proofError").textContent = "Butuh koneksi internet untuk upload bukti transfer.";
      return;
    }
    const btn = $("btnProofSave");
    setBusy(btn, true);
    try {
      const id = newId();
      const { k, data } = await encryptReceipt(await proofBlob.arrayBuffer(), proofBlob.type);
      await remote.putReceipt(id, data);
      proofUrls.set(id, URL.createObjectURL(proofBlob));
      const { ym, t } = proofTarget;
      markPaid(ym, t, true, { id, k });
      try {
        await createShare(ym, t);
        setBusy(btn, false);
        proofDlg.close();
        openWaDialog(terminKey(ym, t));
      } catch {
        setBusy(btn, false);
        proofDlg.close();
        toast("Ditandai dibayar — tapi link untuk partner gagal dibuat");
      }
    } catch (e) {
      setBusy(btn, false);
      $("proofError").textContent = isNetworkError(e)
        ? "Upload gagal — periksa koneksi internet lalu coba lagi."
        : `Upload gagal: ${e.message}`;
    }
  });

  async function showProofs(key) {
    const payout = state.payouts[key];
    if (!payout || !payout.proofs || !payout.proofs.length) return;
    const ym = key.slice(0, 7);
    $("proofViewTitle").textContent = `Bukti transfer — Payout ${key.slice(8)} ${monthLabel(ym)}`;
    $("proofViewError").textContent = "";
    const list = $("proofViewList");
    list.replaceChildren();
    proofViewDlg.showModal();

    for (const p of payout.proofs) {
      const fig = document.createElement("figure");
      fig.className = "proof__item proof__item--loading";
      fig.textContent = "Memuat…";
      list.appendChild(fig);
      try {
        let url = proofUrls.get(p.id);
        if (!url) {
          if (!session) throw new UserError("Butuh koneksi internet untuk memuat bukti transfer.");
          const data = await remote.getReceipt(p.id);
          if (!data) throw new UserError("Bukti transfer tidak ditemukan di cloud.");
          url = URL.createObjectURL(await decryptReceipt(p.k, data));
          proofUrls.set(p.id, url);
        }
        const img = document.createElement("img");
        img.src = url;
        img.alt = "Bukti transfer";
        const cap = document.createElement("figcaption");
        cap.textContent = [p.amount !== null ? fmtRp(p.amount) : null, p.at ? fmtDate(p.at) : null].filter(Boolean).join(" · ");
        fig.className = "proof__item";
        fig.replaceChildren(img, cap);
      } catch (e) {
        fig.remove();
        $("proofViewError").textContent = e instanceof UserError ? e.message
          : isNetworkError(e) ? "Gagal memuat bukti — periksa koneksi internet." : `Gagal memuat bukti: ${e.message}`;
      }
    }
  }

  document.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-proof]");
    if (btn) showProofs(btn.dataset.proof);
  });

  els.entryList.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-del]");
    if (!btn) return;
    const id = btn.dataset.del;
    const entry = state.entries.find((e) => e.id === id);
    if (entry && confirm(`Hapus invoice ${fmtRp(entry.amount)} tanggal ${fmtDate(entry.date)}?`)) {
      state.entries = state.entries.filter((e) => e.id !== id);
      render();
      toast("Invoice dihapus");
    }
  });

  els.entryForm.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const date = els.entryDate.value;
    const amount = Math.round(Number(els.entryAmount.value));
    const note = els.entryNote.value.trim();
    const pctIn = els.entryPct.value.trim();
    const sharePct = pctIn !== "" && Number.isFinite(Number(pctIn)) ? clamp(Number(pctIn), 0, 100) : state.settings.sharePct;
    if (!date || !(amount > 0)) return;

    state.entries.push({ id: newId(), date, amount, note, sharePct });
    viewMonth = date.slice(0, 7); // lompat ke bulan entri baru
    els.entryAmount.value = "";
    els.entryNote.value = "";
    els.entryPct.value = state.settings.sharePct; // balik ke default
    render();
    toast(`Invoice ${fmtRp(amount)} disimpan — Payout ${terminOf(date)}`);
  });

  els.subsidyForm.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const termin = Number(els.subsidyTermin.value) === 2 ? 2 : 1;
    const amount = Math.round(Number(els.subsidyAmount.value));
    const purpose = els.subsidyPurpose.value.trim();
    if (!(amount > 0) || !purpose) return;

    state.subsidies.push({ id: newId(), ym: viewMonth, termin, amount, purpose });
    els.subsidyAmount.value = "";
    els.subsidyPurpose.value = "";
    render();
    toast(`Subsidi silang ${fmtRp(amount)} dipotong dari Payout ${termin} — ${monthLabel(viewMonth)}`);
  });

  els.subsidyList.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-del-subsidy]");
    if (!btn) return;
    const id = btn.dataset.delSubsidy;
    const x = state.subsidies.find((s) => s.id === id);
    if (x && confirm(`Hapus subsidi silang ${fmtRp(x.amount)} (Payout ${x.termin})?`)) {
      state.subsidies = state.subsidies.filter((s) => s.id !== id);
      render();
      toast("Subsidi silang dihapus");
    }
  });

  // Default tanggal entri: hari ini saat melihat bulan aktif, tanggal 1 untuk bulan lain.
  // Hanya diisi ulang kalau kosong atau tanggalnya di luar bulan yang sedang dilihat.
  const clampDateToMonth = () => {
    const cur = today().slice(0, 7);
    if (els.entryDate.value && els.entryDate.value.startsWith(viewMonth + "-")) return;
    els.entryDate.value = viewMonth === cur ? today() : `${viewMonth}-01`;
  };

  // ---------- Settings dialog ----------

  const dlg = $("settingsDialog");

  $("btnSettings").addEventListener("click", () => {
    $("setPartnerName").value = state.settings.partnerName;
    $("setPartnerPhone").value = state.settings.partnerPhone;
    $("setPartnerPw").value = state.settings.partnerAccess ? state.settings.partnerAccess.password : "";
    $("partnerAccessError").textContent = "";
    renderPartnerAccess();
    $("setSharePct").value = state.settings.sharePct;
    $("setCutoff").value = state.settings.cutoff;
    dlg.showModal();
  });

  $("btnCancelSettings").addEventListener("click", () => dlg.close());

  $("btnSaveSettings").addEventListener("click", (ev) => {
    ev.preventDefault();
    const name = $("setPartnerName").value.trim() || "Partner";
    // Kosong/tidak valid -> pakai nilai lama. (Dulu `|| 10` membuat 0% berubah jadi 10%.)
    const pctIn = $("setSharePct").value.trim();
    const cutoffIn = $("setCutoff").value.trim();
    const pct = pctIn !== "" && Number.isFinite(Number(pctIn)) ? clamp(Number(pctIn), 0, 100) : state.settings.sharePct;
    const cutoff = cutoffIn !== "" && Number.isFinite(Number(cutoffIn)) ? clamp(Math.round(Number(cutoffIn)), 8, 23) : state.settings.cutoff;
    const phone = $("setPartnerPhone").value.replace(/[^\d+]/g, "").slice(0, 20);
    state.settings = { ...state.settings, partnerName: name, partnerPhone: phone, sharePct: pct, cutoff };
    els.entryPct.value = pct;
    render();
    dlg.close();
    toast("Pengaturan disimpan");
  });

  $("btnGenPartnerPw").addEventListener("click", () => { $("setPartnerPw").value = randomPassword(); });

  $("btnSavePartnerPw").addEventListener("click", async () => {
    const pw = $("setPartnerPw").value.trim();
    const err = $("partnerAccessError");
    err.textContent = "";
    if (pw.length < 10) { err.textContent = "Password partner minimal 10 karakter — tekan \"Acak\" untuk membuat yang kuat."; return; }
    if (!session) { err.textContent = "Butuh koneksi internet untuk mengaktifkan akses partner."; return; }
    const btn = $("btnSavePartnerPw");
    setBusy(btn, true);
    try {
      const { lookup, k } = await derivePartner(pw);
      state.settings.partnerAccess = { password: pw, lookup, k };
      partnerPublished = null;
      await publishPartnerView();
      setBusy(btn, false);
      render();
      renderPartnerAccess();
      toast("Akses partner aktif — bagikan password ini ke partner");
    } catch (e) {
      setBusy(btn, false);
      err.textContent = isNetworkError(e) ? "Tidak bisa terhubung ke server — coba lagi."
        : /duplicate|unique/i.test(e.message) ? "Password ini tidak bisa dipakai — coba password lain."
        : `Gagal: ${e.message}`;
      renderPartnerAccess();
    }
  });

  $("btnDisablePartner").addEventListener("click", async () => {
    if (!confirm("Matikan akses partner? Partner tidak akan bisa masuk lagi sampai kamu membuat password baru.")) return;
    const err = $("partnerAccessError");
    try {
      if (session) await remote.deletePartnerView();
      state.settings.partnerAccess = null;
      partnerPublished = null;
      $("setPartnerPw").value = "";
      render();
      renderPartnerAccess();
      toast("Akses partner dimatikan");
    } catch (e) {
      err.textContent = isNetworkError(e) ? "Butuh koneksi internet untuk mematikan akses." : `Gagal: ${e.message}`;
    }
  });

  // ---------- Chart overlay events ----------

  const openChart = () => {
    els.chartOverlay.hidden = false; // tampilkan dulu supaya lebar grafik bisa diukur
    renderChart();
    document.body.style.overflow = "hidden";
  };

  const closeChart = () => {
    els.chartOverlay.hidden = true;
    document.body.style.overflow = "";
  };

  $("btnChart").addEventListener("click", openChart);
  $("btnCloseChart").addEventListener("click", closeChart);
  els.chartOverlay.addEventListener("click", (ev) => {
    if (ev.target === els.chartOverlay) closeChart(); // klik backdrop untuk tutup
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !els.chartOverlay.hidden) closeChart();
  });

  const openMonth = (ym) => {
    viewMonth = ym;
    render();
    closeChart();
    toast(monthLabel(ym));
  };

  els.lineSvg.addEventListener("pointermove", (ev) => { if (chartGeo) showChartTip(nearestIndex(ev.clientX)); });
  let lastPointer = "mouse"; // Safari lama: event click belum punya pointerType
  els.lineSvg.addEventListener("pointerdown", (ev) => {
    lastPointer = ev.pointerType || "mouse";
    if (chartGeo) showChartTip(nearestIndex(ev.clientX));
  });
  els.lineChart.addEventListener("pointerleave", (ev) => { if (ev.pointerType === "mouse") hideChartTip(); });
  // klik (mouse) di grafik -> lompat ke bulan itu; di layar sentuh, ketukan hanya menampilkan detail
  els.lineSvg.addEventListener("click", (ev) => {
    if (chartGeo && lastPointer === "mouse") openMonth(chartData[nearestIndex(ev.clientX)].ym);
  });
  els.chartOverlay.addEventListener("click", (ev) => {
    const el = ev.target.closest("[data-open-month]");
    if (el) openMonth(el.dataset.openMonth);
  });

  els.chartLegend.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-series]");
    if (!btn) return;
    const k = btn.dataset.series;
    if (chartShow[k] && Object.values(chartShow).filter(Boolean).length === 1) return; // minimal satu garis
    chartShow[k] = !chartShow[k];
    renderChart();
  });

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (!els.chartOverlay.hidden) renderChart(); }, 120);
  });

  $("rangeFrom").addEventListener("change", (ev) => {
    rangeFrom = ev.target.value;
    if (rangeFrom > rangeTo) rangeTo = rangeFrom;
    renderChart();
  });
  $("rangeTo").addEventListener("change", (ev) => {
    rangeTo = ev.target.value;
    if (rangeTo < rangeFrom) rangeFrom = rangeTo;
    renderChart();
  });
  document.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      [rangeFrom, rangeTo] = presetRange(btn.dataset.preset);
      renderChart();
    });
  });

  // ---------- Export / reset ----------
  $("btnExport").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cashflow-backup-${today()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Safari membatalkan unduhan kalau URL dicabut langsung setelah click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast("Backup diunduh — file ini TIDAK terenkripsi, simpan di tempat aman");
  });

  const importInput = $("importFile");
  $("btnImport").addEventListener("click", () => importInput.click());
  importInput.addEventListener("change", async () => {
    const file = importInput.files && importInput.files[0];
    importInput.value = ""; // supaya file yang sama bisa dipilih lagi
    if (!file) return;
    let data;
    try {
      data = normalize(JSON.parse(await file.text()));
    } catch {
      toast("File tidak valid — pilih file backup JSON dari aplikasi ini");
      return;
    }
    const n = data.entries.length;
    if (!confirm(`Ganti SEMUA data saat ini dengan isi backup (${n} invoice, ${Object.keys(data.payouts).length} pembayaran)?`)) return;
    state = data;
    backfillPayoutAmounts();
    viewMonth = today().slice(0, 7);
    render();
    toast(`Backup dipulihkan — ${n} invoice`);
  });

  $("btnReset").addEventListener("click", () => {
    if (confirm("Hapus SEMUA data (invoice, riwayat payout, pengaturan) di SEMUA perangkat yang memakai akun ini? Tindakan ini tidak bisa dibatalkan.")) {
      state = defaults();
      partnerPublished = null;
      viewMonth = today().slice(0, 7);
      render();
      if (session) {
        // bukti transfer & link partner di cloud ikut dihapus
        remote.deleteAllReceipts().catch(() => {});
        remote.deleteAllShares().catch(() => {});
        remote.deletePartnerView().catch(() => {});
      }
      toast("Semua data direset");
    }
  });

  // ---------- Layar login / daftar ----------

  const lock = {
    screen: $("lockScreen"), form: $("lockForm"), sub: $("lockSub"),
    email: $("lockEmail"), emailField: $("lockEmailField"),
    pw: $("lockPw"), pwLabel: $("lockPwLabel"), pw2: $("lockPw2"), pw2Field: $("lockPw2Field"),
    error: $("lockError"), info: $("lockInfo"), submit: $("lockSubmit"), alt: $("lockAlt"),
    switchWrap: $("lockSwitchWrap"), switchText: $("lockSwitchText"), switchBtn: $("lockSwitch"),
    note: $("lockNote"),
    mode: "login", // "login" | "signup" | "migrate" | "unsupported" | "noconfig"
  };
  const MIN_PW = 8;
  const LAST_EMAIL_KEY = "cashflow.lastEmail";
  let pendingSignIn = null; // { email, authSecret } — masuk saat offline, login ke server dicoba lagi saat online

  class UserError extends Error {}
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function showLock(mode, { error = "", info = "" } = {}) {
    lock.mode = mode;
    $("app").hidden = true;
    lock.screen.hidden = false;
    for (const d of document.querySelectorAll("dialog[open]")) d.close();

    const signup = mode === "signup", migrate = mode === "migrate";
    const disabled = mode === "unsupported" || mode === "noconfig";
    lock.sub.textContent = {
      login: "Masuk untuk membuka data. Pakai akun yang sama di laptop & HP.",
      signup: "Buat akun. Data disinkron ke cloud dalam bentuk terenkripsi.",
      migrate: "Ada data lama di browser ini yang dikunci dengan password lain. Masukkan password lama itu untuk memindahkannya ke akun ini.",
      unsupported: "Browser ini tidak mendukung enkripsi. Buka lewat https:// atau localhost dengan browser modern.",
      noconfig: "Sinkron cloud belum dikonfigurasi — isi Supabase URL & anon key di config.js.",
    }[mode];
    lock.emailField.hidden = migrate || disabled;
    lock.pwLabel.textContent = migrate ? "Password lama" : "Password";
    lock.pw.autocomplete = signup ? "new-password" : "current-password";
    lock.pw.disabled = disabled;
    lock.pw2Field.hidden = !signup;
    lock.submit.textContent = signup ? "Daftar & masuk" : migrate ? "Pindahkan data" : "Masuk";
    lock.submit.disabled = disabled;
    lock.alt.hidden = !migrate;
    lock.alt.textContent = "Lewati — mulai dengan data kosong";
    lock.switchWrap.hidden = migrate || disabled;
    lock.switchText.textContent = signup ? "Sudah punya akun?" : "Belum punya akun?";
    lock.switchBtn.textContent = signup ? "Masuk" : "Daftar";
    lock.note.textContent = signup
      ? `Minimal ${MIN_PW} karakter. Password tidak bisa dipulihkan — tanpa password, data tidak bisa dibuka siapa pun, termasuk kamu.`
      : "";
    lock.error.textContent = error;
    lock.info.textContent = info;
    lock.pw.value = "";
    lock.pw2.value = "";
    if (!disabled) setTimeout(() => (lock.emailField.hidden || lock.email.value ? lock.pw : lock.email).focus(), 0);
  }

  function enterApp(data, { dirty = false } = {}) {
    state = normalize(data);
    backfillPayoutAmounts();
    els.entryPct.value = state.settings.sharePct;
    // dirty = data belum ada di cloud (akun baru / migrasi) -> render() akan menyimpan & mengirimnya
    lastSavedJson = dirty ? null : JSON.stringify(state);
    viewMonth = today().slice(0, 7);
    lock.screen.hidden = true;
    $("app").hidden = false;
    lock.pw.value = "";
    lock.pw2.value = "";
    $("accountEmail").textContent = (session && session.email) || cache.email || "—";
    $("pwUser").value = (session && session.email) || cache.email || "";
    render();
    persistSession();
    setSync(session ? "syncing" : "offline");
    scheduleSync(dirty ? 800 : 100);
  }

  function useCacheFor(email, userId) {
    cache = readCache(email);
    if (userId && cache.userId && cache.userId !== userId) cache = {}; // email dipakai akun lain
    cache.email = normEmail(email);
    if (userId) cache.userId = userId;
  }

  // Setelah berhasil login/daftar: tentukan data mana yang dibuka.
  async function afterAuth(password) {
    useCacheFor(session.email, session.userId);

    let row;
    try {
      row = await remote.get();      // null = cloud masih kosong
    } catch (e) {
      if (!isNetworkError(e)) throw e;
      row = undefined;               // tidak tahu (koneksi putus)
    }

    const local = cache.blob ? await decryptBlob(vault.key, cache.blob).catch(() => null) : null;

    if (row) {
      const data = await decryptBlob(vault.key, row.data).catch(() => null);
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

  async function finishMigration(data) {
    enterApp(data, { dirty: true });
    await vault.writing; // pastikan sudah masuk cache terenkripsi sebelum format lama dihapus
    try {
      localStorage.removeItem(ENC_KEY);
      localStorage.removeItem(STORE_KEY);
    } catch { /* abaikan */ }
    toast(`Data lama (${state.entries.length} invoice) dipindahkan ke akun cloud`);
  }

  async function doLogin(email, pw) {
    const { authSecret, key } = await deriveCredentials(email, pw);
    let r;
    try {
      r = await auth.signIn(email, authSecret);
    } catch (e) {
      if (isNetworkError(e)) return offlineUnlock(email, authSecret, key);
      if (e.code === "email_not_confirmed" || /not confirmed/i.test(e.message)) {
        throw new UserError("Email belum dikonfirmasi — klik link di email dari Supabase, lalu masuk lagi.");
      }
      if (e.status === 429) throw new UserError("Terlalu banyak percobaan — tunggu sebentar lalu coba lagi.");
      if (e.status === 400 || e.code === "invalid_credentials") throw new UserError("Email atau password salah");
      throw e;
    }
    vault.key = key;
    setSession(r, email);
    await afterAuth(pw);
  }

  // Tanpa koneksi: buka dari cache terenkripsi di perangkat ini (password dicek lewat dekripsi).
  async function offlineUnlock(email, authSecret, key) {
    const c = readCache(email);
    if (!c.blob) throw new UserError("Tidak bisa terhubung ke server. Periksa koneksi internet.");
    const data = await decryptBlob(key, c.blob).catch(() => null);
    if (!data) throw new UserError("Email atau password salah");
    vault.key = key;
    session = null;
    cache = c;
    pendingSignIn = { email, authSecret };
    enterApp(data);
    toast("Offline — memakai data terakhir di perangkat ini");
  }

  async function retrySignIn() {
    if (!pendingSignIn || retrySignIn.busy) return;
    retrySignIn.busy = true;
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
      retrySignIn.busy = false;
    }
  }

  async function doSignup(email, pw) {
    const { authSecret, key } = await deriveCredentials(email, pw);
    let r;
    try {
      r = await auth.signUp(email, authSecret);
    } catch (e) {
      if (isNetworkError(e)) throw new UserError("Tidak bisa terhubung ke server. Periksa koneksi internet.");
      if (e.code === "user_already_exists" || /already registered|already exists/i.test(e.message)) {
        throw new UserError("Email ini sudah terdaftar — pilih Masuk.");
      }
      if (e.code === "email_address_invalid" || e.code === "validation_failed") throw new UserError("Format email tidak valid");
      if (e.status === 429) throw new UserError("Terlalu banyak percobaan — tunggu sebentar lalu coba lagi.");
      throw e;
    }
    if (!r || !r.access_token) {
      // Proyek Supabase mewajibkan konfirmasi email dulu.
      showLock("login", { info: `Akun dibuat. Cek inbox ${email}, klik link konfirmasi, lalu masuk di sini.` });
      lock.email.value = email;
      return;
    }
    vault.key = key;
    setSession(r, email);
    await afterAuth(pw);
  }

  function setBusy(btn, busy) {
    if (busy) {
      btn.dataset.label = btn.textContent;
      btn.textContent = "Memproses…";
      btn.disabled = true;
    } else {
      if (btn.textContent === "Memproses…") btn.textContent = btn.dataset.label || "";
      btn.disabled = false;
    }
  }

  lock.form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (lock.submit.disabled) return;
    const mode = lock.mode;
    const email = normEmail(lock.email.value);
    const pw = lock.pw.value;
    const fail = (m) => { lock.error.textContent = m; };
    lock.error.textContent = "";
    lock.info.textContent = "";

    if (mode === "migrate") {
      if (!pw) return fail("Masukkan password lama");
    } else {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Masukkan email yang valid");
      if (mode === "signup") {
        if (pw.length < MIN_PW) return fail(`Password minimal ${MIN_PW} karakter`);
        if (pw !== lock.pw2.value) return fail("Password tidak sama");
      } else if (!pw) {
        return fail("Masukkan password");
      }
    }

    setBusy(lock.submit, true);
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
      if (lock.screen.hidden === false && mode !== "migrate") {
        // gagal di tengah jalan -> jangan tinggalkan sesi setengah jadi
        vault.key = null;
        session = null;
        forgetSession();
      }
      fail(e instanceof UserError ? e.message : `Terjadi kesalahan: ${e.message}`);
      if (lock.mode === "login" || lock.mode === "migrate") lock.pw.select();
    } finally {
      setBusy(lock.submit, false);
    }
  });

  lock.switchBtn.addEventListener("click", () => {
    showLock(lock.mode === "signup" ? "login" : "signup");
  });

  lock.alt.addEventListener("click", () => {
    if (!confirm("Mulai dengan data kosong? Data lama tetap tersimpan (terkunci) di browser ini.")) return;
    enterApp(defaults(), { dirty: true });
  });

  // Tombol "Lihat" — tampilkan/sembunyikan password di form yang sama
  document.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-pw-toggle]");
    if (!btn) return;
    const inputs = btn.closest("form").querySelectorAll('input[type="password"], input[data-pw-shown]');
    const show = btn.textContent === "Lihat";
    for (const i of inputs) {
      i.type = show ? "text" : "password";
      if (show) i.dataset.pwShown = ""; else delete i.dataset.pwShown;
    }
    btn.textContent = show ? "Sembunyikan" : "Lihat";
    btn.setAttribute("aria-label", show ? "Sembunyikan password" : "Tampilkan password");
  });

  $("btnLock").addEventListener("click", async () => {
    await vault.writing;
    if (cache.dirty && session) {
      setSync("syncing");
      await Promise.race([runSync(), sleep(5000)]);
    }
    if (cache.dirty && !confirm("Ada perubahan yang belum terkirim ke cloud. Perubahan tetap tersimpan di perangkat ini dan dikirim saat kamu masuk lagi.\n\nKeluar sekarang?")) return;
    if (session) await Promise.race([auth.logout(session.access_token).catch(() => {}), sleep(1500)]);
    forgetSession();
    // Muat ulang halaman supaya data yang sudah didekripsi tidak tersisa di memori/DOM.
    location.reload();
  });

  // ---------- Ganti password ----------

  const pwDlg = $("pwDialog");

  $("btnChangePw").addEventListener("click", () => {
    dlg.close();
    for (const id of ["pwOld", "pwNew", "pwNew2"]) $(id).value = "";
    $("pwError").textContent = "";
    pwDlg.showModal();
  });

  $("btnPwCancel").addEventListener("click", () => pwDlg.close());

  $("pwForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const oldPw = $("pwOld").value, newPw = $("pwNew").value;
    const fail = (m) => { $("pwError").textContent = m; };
    $("pwError").textContent = "";
    if (!oldPw) return fail("Masukkan password lama");
    if (newPw.length < MIN_PW) return fail(`Password baru minimal ${MIN_PW} karakter`);
    if (newPw !== $("pwNew2").value) return fail("Password baru tidak sama");
    if (newPw === oldPw) return fail("Password baru harus berbeda");
    if (!session) return fail("Butuh koneksi internet untuk ganti password");

    const btn = $("btnPwSave");
    setBusy(btn, true);
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
      const blob = await encryptJson(newC.key, JSON.stringify(state));
      await remote.updatePassword(newC.authSecret);
      // Login sudah pakai password baru -> mulai sekarang data dienkripsi dengan kunci baru.
      vault.key = newC.key;
      cache.blob = blob;
      cache.dirty = true;
      cache.localAt = new Date().toISOString();
      writeCache();
      lastSavedJson = JSON.stringify(state);
      persistSession();
      await runSync();
      setBusy(btn, false);
      pwDlg.close();
      toast(cache.dirty ? "Password diganti — data dikirim ke cloud saat online" : "Password diganti di semua perangkat");
    } catch (e) {
      setBusy(btn, false);
      fail(e instanceof UserError ? e.message : `Gagal ganti password: ${e.message}`);
    }
  });

  // ---------- Init ----------

  async function start() {
    let theme = null;
    try { theme = localStorage.getItem(THEME_KEY); } catch { /* abaikan */ }
    applyTheme(theme === "light" || theme === "dark" ? theme : (loadLegacy() || defaults()).theme);
    setSync("idle");
    const authRedirect = readAuthRedirect();

    if (!(globalThis.crypto && crypto.subtle)) return showLock("unsupported");
    if (!cloudConfigured()) return showLock("noconfig");

    // Masih di tab yang sama (refresh halaman) — pakai kunci & token sesi, tidak perlu password lagi.
    try {
      const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
      if (saved && saved.jwk && saved.session) {
        vault.key = await crypto.subtle.importKey("jwk", saved.jwk, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
        session = saved.session;
        useCacheFor(session.email, session.userId);
        if (cache.blob) return enterApp(await decryptBlob(vault.key, cache.blob));
        return await afterAuth(null);
      }
    } catch {
      forgetSession();
      vault.key = null;
      session = null;
    }

    try { lock.email.value = localStorage.getItem(LAST_EMAIL_KEY) || ""; } catch { /* abaikan */ }
    showLock("login", authRedirect || {});
  }

  start();
})();

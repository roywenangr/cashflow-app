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
    settings: { partnerName: "Partner", sharePct: 10, cutoff: 15 },
    entries: [],   // { id, date: "YYYY-MM-DD", amount, note }
    payouts: {},   // "YYYY-MM-1" | "YYYY-MM-2" -> { paid: true, paidAt: "YYYY-MM-DD", amount }
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

    const entries = (Array.isArray(data.entries) ? data.entries : [])
      .filter((e) => e && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && Number(e.amount) > 0)
      .map((e) => ({
        id: e.id ? String(e.id) : newId(),
        date: e.date,
        amount: Math.round(Number(e.amount)),
        note: typeof e.note === "string" ? e.note.slice(0, 80) : "",
      }));

    const payouts = {};
    if (data.payouts && typeof data.payouts === "object") {
      for (const [key, p] of Object.entries(data.payouts)) {
        if (!/^\d{4}-\d{2}-[12]$/.test(key) || !p || !p.paid) continue;
        payouts[key] = {
          paid: true,
          paidAt: /^\d{4}-\d{2}-\d{2}$/.test(p.paidAt) ? p.paidAt : key.slice(0, 7) + "-01",
          ...(Number.isFinite(Number(p.amount)) && p.amount !== null && p.amount !== "" ? { amount: Math.round(Number(p.amount)) } : {}),
        };
      }
    }

    return {
      settings: {
        partnerName: typeof s.partnerName === "string" && s.partnerName.trim() ? s.partnerName.trim().slice(0, 40) : base.settings.partnerName,
        sharePct: Number.isFinite(pct) && s.sharePct !== "" && s.sharePct !== null ? clamp(pct, 0, 100) : base.settings.sharePct,
        cutoff: Number.isFinite(cutoff) && s.cutoff !== "" && s.cutoff !== null ? clamp(Math.round(cutoff), 8, 23) : base.settings.cutoff,
      },
      entries,
      payouts,
      theme: data.theme === "light" ? "light" : data.theme === "dark" ? "dark" : base.theme,
    };
  }

  // Data lama tidak menyimpan nominal yang dibayar — isi sekali dari perhitungan saat ini,
  // lalu nominal itu dibekukan agar riwayat tidak berubah saat entri/pengaturan diubah.
  function backfillPayoutAmounts() {
    for (const [key, p] of Object.entries(state.payouts)) {
      if (p.amount === undefined) {
        p.amount = shareOf(key.slice(0, 7), Number(key.slice(8)));
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
    signUp: (email, secret) => http("POST", "/auth/v1/signup", { body: { email, password: secret } }),
    signIn: (email, secret) => http("POST", "/auth/v1/token?grant_type=password", { body: { email, password: secret } }),
    refresh: (rt) => http("POST", "/auth/v1/token?grant_type=refresh_token", { body: { refresh_token: rt } }),
    logout: (token) => http("POST", "/auth/v1/logout", { token }),
  };

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
    return `${n} entri${when ? " · diubah " + when : ""}`;
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

  function terminProfit(ym, t) {
    return monthEntries(ym)
      .filter((e) => terminOf(e.date) === t)
      .reduce((s, e) => s + e.amount, 0);
  }

  // Share dibulatkan per termin (Rupiah tanpa sen); total bulan = jumlah dua termin.
  function shareOf(ym, t) {
    return Math.round(terminProfit(ym, t) * (state.settings.sharePct / 100));
  }

  function terminTotals(ym, t) {
    const profit = terminProfit(ym, t);
    const share = Math.round(profit * (state.settings.sharePct / 100));
    const payout = state.payouts[terminKey(ym, t)];
    const paidAmount = payout ? payout.amount : 0;
    return {
      profit,
      share,
      paid: !!payout,                                  // pernah ada pembayaran
      settled: !!payout && paidAmount >= share,        // lunas sesuai share saat ini
      paidAt: payout ? payout.paidAt : null,
      paidAmount,
      remaining: Math.max(0, share - paidAmount),      // kurang bayar (mis. entri ditambah setelah dibayar)
      overpaid: Math.max(0, paidAmount - share),       // lebih bayar (mis. entri dihapus setelah dibayar)
    };
  }

  function markPaid(ym, t, paid) {
    const key = terminKey(ym, t);
    if (paid) {
      // Simpan nominal yang benar-benar dibayar agar riwayat tidak ikut berubah.
      state.payouts[key] = { paid: true, paidAt: today(), amount: shareOf(ym, t) };
    } else {
      delete state.payouts[key];
    }
    render();
    toast(paid ? `Termin ${t} ditandai sudah dibayar — ${monthLabel(ym)}` : "Tanda dibayar dibatalkan");
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
    entryForm: $("entryForm"), entryDate: $("entryDate"), entryAmount: $("entryAmount"), entryNote: $("entryNote"),
    entryList: $("entryList"), entryEmpty: $("entryEmpty"), entryCount: $("entryCount"),
    historyList: $("historyList"), historyEmpty: $("historyEmpty"), payoutTotal: $("payoutTotal"),
    toast: $("toast"),
    chartOverlay: $("chartOverlay"),
    chartTotalMargin: $("chartTotalMargin"), chartTotalShare: $("chartTotalShare"),
    chartTotalNet: $("chartTotalNet"), chartTotalDue: $("chartTotalDue"),
    barChart: $("barChart"), chartMonthRows: $("chartMonthRows"), chartUnit: $("chartUnit"),
    chartRangeTitle: $("chartRangeTitle"),
  };

  function renderKpi() {
    const isThisMonth = viewMonth === today().slice(0, 7);
    const entries = monthEntries(viewMonth);
    const t1 = terminTotals(viewMonth, 1);
    const t2 = terminTotals(viewMonth, 2);
    const profit = t1.profit + t2.profit;
    const share = t1.share + t2.share;
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
    els.kpiProfitMeta.textContent = `${entries.length} entri · ${scope}`;
    els.kpiShareMeta.textContent = `${state.settings.sharePct}% dari margin kotor`;
    els.kpiNetMeta.textContent = "Margin kotor − share partner";
    els.kpiPaidMeta.textContent = paid > 0 ? `${settledCount} dari 2 termin lunas` : "Belum ada termin lunas";
    els.kpiDueMeta.textContent = due > 0 ? `${dueCount} termin menunggu` : share > 0 ? "Semua lunas" : "Belum ada tagihan";

    clampDateToMonth();
  }

  function terminCard(ym, t, totals) {
    const empty = totals.profit === 0;
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
          totals.overpaid > 0 ? ` · lebih bayar ${fmtRp(totals.overpaid)}` : ""}</p>`
      : "";

    const footBtn = partial
      ? `<button class="btn btn--primary btn--block" data-mark="${t}">Tandai sisa dibayar</button>
         <button class="btn btn--ghost btn--block" data-unmark="${t}">Batalkan tanda bayar</button>
         ${paidNote}`
      : totals.paid
        ? `<button class="btn btn--ghost btn--block" data-unmark="${t}">Batalkan tanda lunas</button>
           ${paidNote}`
        : empty
          ? `<p class="termin__note">Belum ada margin di periode ini</p>`
          : `<button class="btn btn--primary btn--block" data-mark="${t}">Tandai sudah dibayar</button>`;

    card.innerHTML = `
      <div class="termin__head">
        <div>
          <p class="termin__name" style="margin:0">Termin ${t}</p>
          <p class="termin__period" style="margin:2px 0 0">${terminPeriod(ym, t)}</p>
        </div>
        ${badge}
      </div>
      <div class="termin__figures">
        <div class="figure">
          <span class="figure__label">Margin kotor periode</span>
          <span class="figure__value">${fmtRp(totals.profit)}</span>
        </div>
        <div class="figure">
          <span class="figure__label">Share partner (${state.settings.sharePct}%)</span>
          <span class="figure__value">${fmtRp(totals.share)}</span>
        </div>
        <div class="figure">
          <span class="figure__label">Profit bersih kamu</span>
          <span class="figure__value">${fmtRp(totals.profit - totals.share)}</span>
        </div>
      </div>
      <div class="termin__share">
        <p class="termin__share-label">
          <span class="tile__dot ${totals.paid ? "tile__dot--good" : "tile__dot--warn"}"></span>
          ${partial ? "Sisa perlu ditransfer" : totals.paid ? "Sudah ditransfer" : "Perlu ditransfer"}
        </p>
        <p class="termin__share-value">${
          partial ? fmtRp(totals.remaining) : totals.paid ? fmtRp(totals.paidAmount) : empty ? "—" : fmtRp(totals.share)}</p>
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
    els.entryCount.textContent = `${entries.length} entri`;
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
        </div>
        <div class="entry__side">
          <span class="entry__tag">Termin ${terminOf(e.date)}</span>
          <button class="del-btn" data-del="${e.id}" aria-label="Hapus entri">
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
          <p class="history__title" style="margin:0">Termin ${p.t} — ${monthLabel(p.ym)}</p>
          <p class="history__date" style="margin:1px 0 0">Untuk ${escapeHtml(state.settings.partnerName)} · dibayar ${fmtDate(p.paidAt)}</p>
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

    els.partnerLabel.textContent = `Profit sharing · ${state.settings.partnerName} (${state.settings.sharePct}%)`;
    els.monthTitle.textContent = monthLabel(viewMonth);
    renderKpi();
    renderTermins();
    renderEntries();
    renderHistory();
    save();
  }

  // ---------- Chart overlay ----------

  let chartMetric = "margin"; // "margin" | "share" | "net"
  let chartData = [];          // satu item per kolom batang (urutan sama dengan DOM)
  let rangeFrom = null;        // "YYYY-MM"; null = default 12 bulan terakhir
  let rangeTo = null;

  const METRIC_INFO = {
    margin: { label: "Margin kotor", css: "var(--accent)" },
    share:  { label: "Share partner", css: "var(--warn)" },
    net:    { label: "Profit bersih", css: "var(--good)" },
  };

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

    // bar chart: semua bulan di rentang (bulan kosong tetap punya kolom supaya sumbu waktu jujur)
    const info = METRIC_INFO[chartMetric];
    els.chartUnit.textContent = info.label;
    const multiYear = rangeFrom.slice(0, 4) !== rangeTo.slice(0, 4);
    const frag = document.createDocumentFragment();
    if (withData.length === 0) {
      chartData = [];
      const empty = document.createElement("p");
      empty.className = "chart-empty";
      empty.textContent = state.entries.length ? "Tidak ada data di rentang ini." : "Belum ada data. Tambahkan margin dulu.";
      frag.appendChild(empty);
      els.barChart.style.height = "auto";
    } else {
      els.barChart.style.height = "";
      const max = Math.max(...chartData.map((d) => d[chartMetric]), 1);
      chartData.forEach((d, i) => {
        const v = d[chartMetric];
        const pct = Math.max((v / max) * 100, v > 0 ? 3 : 0);
        // tahun ditulis di kolom pertama dan setiap Januari kalau rentang lintas tahun
        const showYear = multiYear && (i === 0 || d.ym.endsWith("-01"));
        const col = document.createElement("div");
        col.className = "chart__col" + (d.ym === cur ? " is-current" : "");
        col.innerHTML = `
          <div class="chart__barwrap"><div class="chart__bar" style="--h:${pct}%; --bar-color:${info.css}"></div></div>
          <span class="chart__label">${shortMonth(d.ym, false)}</span>
          ${multiYear ? `<span class="chart__year">${showYear ? d.ym.slice(0, 4) : "&nbsp;"}</span>` : ""}
        `;
        col.title = `${monthLabel(d.ym)} · ${info.label}: ${fmtRp(v)}`;
        frag.appendChild(col);
      });
    }
    els.barChart.classList.toggle("chart--scroll", chartData.length > 12);
    els.barChart.replaceChildren(frag);
    els.barChart.scrollLeft = els.barChart.scrollWidth; // bulan terbaru terlihat duluan

    // month rows (detail per bulan) — hanya bulan yang ada datanya
    const rows = document.createDocumentFragment();
    if (withData.length === 0) {
      const empty = document.createElement("p");
      empty.className = "chart-empty";
      empty.textContent = "—";
      rows.appendChild(empty);
    } else {
      const max = Math.max(...withData.map((d) => d[chartMetric]), 1);
      for (const d of withData) {
        const v = d[chartMetric];
        const [y, m] = d.ym.split("-").map(Number);
        const label = new Date(y, m - 1, 1).toLocaleDateString("id-ID", { month: "short", year: "2-digit" });
        const row = document.createElement("div");
        row.className = "chart__row" + (d.ym === cur ? " is-current" : "");
        const w = (v / max) * 100;
        row.innerHTML = `
          <span class="chart__row-month">${label}</span>
          <div class="chart__row-bar" style="--w:${w}%; --bar-color:${info.css}"></div>
          <span class="chart__row-val">${fmtRp(v)}</span>
          <span class="chart__row-paid">${d.paidCount === 2
            ? `<span class="badge badge--paid"><span class="badge__dot"></span>Lunas</span>`
            : d.paidCount === 0
              ? `<span class="badge badge--unpaid"><span class="badge__dot"></span>Unpaid</span>`
              : "1/2 lunas"}</span>
        `;
        rows.appendChild(row);
      }
    }
    els.chartMonthRows.replaceChildren(rows);
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
        ? `Tandai sisa Termin ${t} bulan ${monthLabel(viewMonth)} sebesar ${fmtRp(totals.remaining)} sebagai SUDAH DIBAYAR? (total menjadi ${fmtRp(totals.share)})`
        : `Tandai Termin ${t} bulan ${monthLabel(viewMonth)} sebagai SUDAH DIBAYAR sebesar ${fmtRp(totals.share)}?`;
      if (confirm(msg)) markPaid(viewMonth, t, true);
    } else if (unmark) {
      const t = Number(unmark.dataset.unmark);
      if (confirm(`Batalkan tanda bayar Termin ${t} bulan ${monthLabel(viewMonth)}? Catatan pembayaran akan dihapus dari riwayat.`)) {
        markPaid(viewMonth, t, false);
      }
    }
  });

  els.entryList.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-del]");
    if (!btn) return;
    const id = btn.dataset.del;
    const entry = state.entries.find((e) => e.id === id);
    if (entry && confirm(`Hapus entri ${fmtRp(entry.amount)} tanggal ${fmtDate(entry.date)}?`)) {
      state.entries = state.entries.filter((e) => e.id !== id);
      render();
      toast("Entri dihapus");
    }
  });

  els.entryForm.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const date = els.entryDate.value;
    const amount = Math.round(Number(els.entryAmount.value));
    const note = els.entryNote.value.trim();
    if (!date || !(amount > 0)) return;

    state.entries.push({ id: newId(), date, amount, note });
    viewMonth = date.slice(0, 7); // lompat ke bulan entri baru
    els.entryAmount.value = "";
    els.entryNote.value = "";
    render();
    toast(`Margin kotor ${fmtRp(amount)} disimpan — Termin ${terminOf(date)}`);
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
    state.settings = { partnerName: name, sharePct: pct, cutoff };
    render();
    dlg.close();
    toast("Pengaturan disimpan");
  });

  // ---------- Chart overlay events ----------

  const openChart = () => {
    renderChart();
    els.chartOverlay.hidden = false;
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

  els.barChart.addEventListener("click", (ev) => {
    const col = ev.target.closest(".chart__col");
    if (!col) return;
    // klik bulan -> lompat ke bulan itu di halaman utama
    const idx = Array.from(els.barChart.children).indexOf(col);
    const d = chartData[idx];
    if (d) {
      viewMonth = d.ym;
      render();
      closeChart();
      toast(`${monthLabel(d.ym)} — ${fmtRp(d[chartMetric])}`);
    }
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

  document.querySelectorAll(".seg__btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".seg__btn").forEach((b) => {
        b.classList.remove("is-active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("is-active");
      btn.setAttribute("aria-selected", "true");
      chartMetric = btn.dataset.metric;
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
    if (!confirm(`Ganti SEMUA data saat ini dengan isi backup (${n} entri, ${Object.keys(data.payouts).length} pembayaran)?`)) return;
    state = data;
    backfillPayoutAmounts();
    viewMonth = today().slice(0, 7);
    render();
    toast(`Backup dipulihkan — ${n} entri`);
  });

  $("btnReset").addEventListener("click", () => {
    if (confirm("Hapus SEMUA data (entri, riwayat termin, pengaturan) di SEMUA perangkat yang memakai akun ini? Tindakan ini tidak bisa dibatalkan.")) {
      state = defaults();
      viewMonth = today().slice(0, 7);
      render();
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
    toast(`Data lama (${state.entries.length} entri) dipindahkan ke akun cloud`);
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
    showLock("login");
  }

  start();
})();

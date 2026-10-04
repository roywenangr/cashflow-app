/* ============================================================
   Cashflow — Profit Sharing
   Semua data tersimpan di localStorage (browser lokal), terenkripsi
   dengan kunci yang diturunkan dari password pengguna.
   ============================================================ */

(() => {
  "use strict";

  const STORE_KEY = "cashflow.v1";        // format lama (tidak terenkripsi) — hanya dibaca untuk migrasi
  const ENC_KEY = "cashflow.enc.v1";      // data terenkripsi
  const SESSION_KEY = "cashflow.session"; // kunci sesi; hilang saat tab ditutup
  const THEME_KEY = "cashflow.theme";     // tema disimpan terpisah supaya layar login ikut tema

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

  function save() {
    if (!vault.key) return;
    // Enkripsi dimulai sekarang (snapshot state saat ini); penulisan diantrekan supaya urutannya terjaga.
    const payload = encryptState(vault, state);
    vault.writing = vault.writing
      .then(() => payload)
      .then((blob) => localStorage.setItem(ENC_KEY, blob))
      .catch(() => {
        // localStorage bisa diblokir (mode privat / file:// di sebagian browser).
        // Aplikasi tetap jalan untuk sesi ini; data hilang saat tab ditutup.
        warnOnce();
      });
  }

  // ---------- Enkripsi ----------
  // AES-GCM 256-bit; kunci dari password via PBKDF2-SHA256. Salt & IV acak disimpan bersama ciphertext.
  // Kode aplikasi boleh publik — tanpa password, isi localStorage tidak bisa dibaca.

  const KDF_ITER = 600_000;
  const vault = { key: null, salt: null, iter: KDF_ITER, writing: Promise.resolve() };

  function toB64(buf) {
    const bytes = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function deriveKey(password, salt, iter) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  }

  async function encryptState({ key, salt, iter }, data) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(data)));
    return JSON.stringify({ v: 1, kdf: "PBKDF2-SHA256", iter, salt: toB64(salt), iv: toB64(iv), data: toB64(ct) });
  }

  async function decryptBlob(key, blob) {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(blob.iv) }, key, fromB64(blob.data));
    return JSON.parse(new TextDecoder().decode(pt));
  }

  function readBlob() {
    try {
      const raw = localStorage.getItem(ENC_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  // Coba password ke data tersimpan; null kalau salah.
  async function tryPassword(password, blob) {
    const salt = fromB64(blob.salt);
    const iter = blob.iter || KDF_ITER;
    const key = await deriveKey(password, salt, iter);
    try {
      return { key, salt, iter, data: await decryptBlob(key, blob) };
    } catch {
      return null;
    }
  }

  async function rememberSession(key) {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(await crypto.subtle.exportKey("jwk", key))); } catch { /* sesi tidak diingat */ }
  }

  function forgetSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* abaikan */ }
  }

  let warned = false;
  function warnOnce() {
    if (warned) return;
    warned = true;
    setTimeout(() => toast("Penyimpanan browser tidak aktif — data hanya bertahan di sesi ini"), 400);
  }

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
    if (confirm("Hapus SEMUA data (entri, riwayat termin, pengaturan)? Tindakan ini tidak bisa dibatalkan.")) {
      state = defaults();
      viewMonth = today().slice(0, 7);
      render();
      toast("Semua data direset");
    }
  });

  // ---------- Layar login / buat password ----------

  const lock = {
    screen: $("lockScreen"), form: $("lockForm"), sub: $("lockSub"),
    pw: $("lockPw"), pw2: $("lockPw2"), pw2Field: $("lockPw2Field"),
    error: $("lockError"), submit: $("lockSubmit"), note: $("lockNote"), forgot: $("btnForgot"),
    mode: "login", // "setup" | "login" | "unsupported"
  };
  const MIN_PW = 6;

  function showLock(mode, msg = "") {
    lock.mode = mode;
    vault.key = null;
    state = defaults();
    $("app").hidden = true;
    lock.screen.hidden = false;
    closeChart();
    for (const d of document.querySelectorAll("dialog[open]")) d.close();

    const setup = mode === "setup";
    let hasLegacy = false;
    try { hasLegacy = !!localStorage.getItem(STORE_KEY); } catch { /* abaikan */ }

    lock.sub.textContent =
      mode === "unsupported" ? "Browser ini tidak mendukung enkripsi. Buka lewat https:// atau localhost dengan browser modern."
      : setup ? "Buat password untuk mengunci data cashflow di browser ini."
      : "Masukkan password untuk membuka data.";
    lock.pw.autocomplete = setup ? "new-password" : "current-password";
    lock.pw2Field.hidden = !setup;
    lock.submit.textContent = setup ? "Buat password & masuk" : "Masuk";
    lock.submit.disabled = mode === "unsupported";
    lock.note.textContent = setup
      ? (hasLegacy ? "Data yang sudah ada di browser ini akan dikunci dengan password ini. " : "") +
        "Password tidak bisa dipulihkan — kalau lupa, data harus dihapus."
      : "";
    lock.forgot.hidden = mode !== "login";
    lock.error.textContent = msg;
    lock.pw.value = "";
    lock.pw2.value = "";
    if (mode !== "unsupported") setTimeout(() => lock.pw.focus(), 0);
  }

  async function unlock({ key, salt, iter, data }) {
    vault.key = key;
    vault.salt = salt;
    vault.iter = iter;
    await rememberSession(key);
    state = normalize(data);
    backfillPayoutAmounts();
    viewMonth = today().slice(0, 7);
    lock.screen.hidden = true;
    $("app").hidden = false;
    lock.pw.value = "";
    lock.pw2.value = "";
    render();
  }

  function setBusy(btn, busy, label) {
    btn.disabled = busy;
    if (busy) { btn.dataset.label = btn.textContent; btn.textContent = "Memproses…"; }
    else btn.textContent = label || btn.dataset.label || btn.textContent;
  }

  lock.form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (lock.mode === "unsupported") return;
    const pw = lock.pw.value;
    const fail = (m) => { lock.error.textContent = m; };
    lock.error.textContent = "";

    if (lock.mode === "setup") {
      if (pw.length < MIN_PW) return fail(`Password minimal ${MIN_PW} karakter`);
      if (pw !== lock.pw2.value) return fail("Password tidak sama");
    } else if (!pw) {
      return fail("Masukkan password");
    }

    setBusy(lock.submit, true);
    try {
      if (lock.mode === "setup") {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const key = await deriveKey(pw, salt, KDF_ITER);
        const data = loadLegacy() || defaults();
        // Tulis versi terenkripsi dulu, baru hapus data lama yang tidak terenkripsi.
        localStorage.setItem(ENC_KEY, await encryptState({ key, salt, iter: KDF_ITER }, data));
        try { localStorage.removeItem(STORE_KEY); } catch { /* abaikan */ }
        setBusy(lock.submit, false);
        await unlock({ key, salt, iter: KDF_ITER, data });
        toast("Password dibuat — data sekarang terkunci");
      } else {
        const blob = readBlob();
        if (!blob) { setBusy(lock.submit, false); return showLock("setup"); }
        const res = await tryPassword(pw, blob);
        setBusy(lock.submit, false);
        if (!res) {
          lock.pw.select();
          return fail("Password salah");
        }
        await unlock(res);
      }
    } catch {
      setBusy(lock.submit, false);
      fail("Gagal menyimpan — penyimpanan browser mungkin diblokir (mode privat?)");
    }
  });

  lock.forgot.addEventListener("click", () => {
    if (!confirm("Tanpa password, data tidak bisa dibuka.\n\nHapus SEMUA data di browser ini dan buat password baru? Tindakan ini tidak bisa dibatalkan.")) return;
    try {
      localStorage.removeItem(ENC_KEY);
      localStorage.removeItem(STORE_KEY);
    } catch { /* abaikan */ }
    forgetSession();
    showLock("setup");
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
    await vault.writing; // pastikan simpanan terakhir sudah tertulis
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

    const btn = $("btnPwSave");
    setBusy(btn, true);
    try {
      await vault.writing;
      const blob = readBlob();
      if (!blob || !(await tryPassword(oldPw, blob))) {
        setBusy(btn, false);
        return fail("Password lama salah");
      }
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await deriveKey(newPw, salt, KDF_ITER);
      // Tulis langsung (bukan lewat antrean) supaya kegagalan terlihat di sini.
      localStorage.setItem(ENC_KEY, await encryptState({ key, salt, iter: KDF_ITER }, state));
      Object.assign(vault, { key, salt, iter: KDF_ITER });
      await rememberSession(key);
      setBusy(btn, false);
      pwDlg.close();
      toast("Password diganti");
    } catch {
      setBusy(btn, false);
      fail("Gagal menyimpan password baru");
    }
  });

  // ---------- Init ----------

  async function start() {
    let theme = null;
    try { theme = localStorage.getItem(THEME_KEY); } catch { /* abaikan */ }
    applyTheme(theme === "light" || theme === "dark" ? theme : (loadLegacy() || defaults()).theme);

    if (!(globalThis.crypto && crypto.subtle)) return showLock("unsupported");

    const blob = readBlob();
    if (!blob) return showLock("setup");

    // Masih dalam sesi yang sama (refresh halaman) — pakai kunci sesi, tidak perlu password lagi.
    try {
      const jwk = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
      if (jwk) {
        const key = await crypto.subtle.importKey("jwk", jwk, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
        const data = await decryptBlob(key, blob);
        return unlock({ key, salt: fromB64(blob.salt), iter: blob.iter || KDF_ITER, data });
      }
    } catch {
      forgetSession();
    }
    showLock("login");
  }

  start();
})();

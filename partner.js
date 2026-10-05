/* ============================================================
   Dashboard partner — login hanya dengan password partner.
   Password -> PBKDF2 -> lookup (menemukan baris di server) + kunci AES.
   Data partner dibuat & dienkripsi oleh aplikasi pemilik; isinya hanya
   share, subsidi, status bayar & bukti transfer (tanpa margin/invoice).
   ============================================================ */

(() => {
  "use strict";

  const CFG = window.CASHFLOW_CONFIG || {};
  const KDF_ITER = 600_000;                // harus sama dengan app.js
  const SALT = "cashflow-partner-v1";      // harus sama dengan app.js
  const SESSION_KEY = "cashflow.partner";  // { lookup, k } — hilang saat tab ditutup
  const $ = (id) => document.getElementById(id);

  try {
    const saved = localStorage.getItem("cashflow.theme");
    document.documentElement.dataset.theme = saved === "light" || saved === "dark" ? saved
      : matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch { document.documentElement.dataset.theme = "dark"; }

  const toB64 = (bytes) => {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

  const fmtRp = (n) => "Rp " + Math.round(n).toLocaleString("id-ID", { maximumFractionDigits: 0 });
  const fmtDate = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
  };
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  async function derive(password) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = new Uint8Array(await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: new TextEncoder().encode(SALT), iterations: KDF_ITER, hash: "SHA-256" }, base, 512));
    return { lookup: toHex(bits.slice(0, 32)), k: toB64(bits.slice(32)) };
  }

  async function decrypt(k, blobStr) {
    const blob = JSON.parse(blobStr);
    const key = await crypto.subtle.importKey("raw", fromB64(k), { name: "AES-GCM" }, false, ["decrypt"]);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(blob.iv) }, key, fromB64(blob.data));
    return { bytes: pt, type: blob.type };
  }

  async function rpc(fn, args) {
    const res = await fetch(CFG.supabaseUrl.replace(/\/+$/, "") + "/rest/v1/rpc/" + fn, {
      method: "POST",
      headers: {
        apikey: CFG.supabaseAnonKey,
        Authorization: "Bearer " + CFG.supabaseAnonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  class WrongPassword extends Error {}
  let creds = null; // { lookup, k }

  async function fetchView(c) {
    const rows = await rpc("get_partner_view", { lookup_hex: c.lookup });
    if (!rows || !rows[0]) throw new WrongPassword();
    const { bytes } = await decrypt(c.k, rows[0].data);
    return { data: JSON.parse(new TextDecoder().decode(bytes)), updatedAt: rows[0].updated_at };
  }

  // ---------- Login ----------

  $("partnerPwToggle").addEventListener("click", () => {
    const pw = $("partnerPw");
    const show = pw.type === "password";
    pw.type = show ? "text" : "password";
    $("partnerPwToggle").textContent = show ? "Tutup" : "Lihat";
  });

  $("partnerForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const pw = $("partnerPw").value.trim();
    const err = $("partnerError");
    err.textContent = "";
    if (!pw) { err.textContent = "Masukkan password partner."; return; }
    if (!/^https?:\/\//.test(CFG.supabaseUrl || "") || !CFG.supabaseAnonKey) { err.textContent = "Aplikasi belum dikonfigurasi."; return; }
    const btn = $("partnerSubmit");
    btn.disabled = true;
    btn.textContent = "Memproses…";
    try {
      const c = await derive(pw);
      const view = await fetchView(c);
      creds = c;
      try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(c)); } catch { /* cukup login lagi nanti */ }
      $("partnerPw").value = "";
      showDashboard(view);
    } catch (e) {
      err.textContent = e instanceof WrongPassword ? "Password salah atau akses partner sudah dimatikan."
        : "Tidak bisa terhubung ke server — periksa koneksi internet.";
    } finally {
      btn.disabled = false;
      btn.textContent = "Masuk";
    }
  });

  function logout() {
    creds = null;
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* abaikan */ }
    $("partnerApp").hidden = true;
    $("partnerLock").hidden = false;
    $("pMonths").replaceChildren();
  }
  $("btnPartnerLogout").addEventListener("click", logout);

  $("btnPartnerRefresh").addEventListener("click", async () => {
    if (!creds) return;
    try {
      showDashboard(await fetchView(creds));
    } catch (e) {
      if (e instanceof WrongPassword) logout();
      else $("pUpdated").textContent = "Gagal memuat ulang — periksa koneksi internet.";
    }
  });

  // ---------- Dashboard ----------

  function showDashboard({ data: d, updatedAt }) {
    $("partnerLock").hidden = true;
    $("partnerApp").hidden = false;
    $("partnerSub").textContent = `Partner · ${d.partnerName}`;

    const payouts = d.months.flatMap((m) => m.payouts);
    const settled = payouts.filter((p) => p.settled && p.paid).length;
    const waiting = payouts.filter((p) => p.remaining > 0).length;
    $("pReceived").textContent = fmtRp(d.received);
    $("pReceivedMeta").textContent = settled ? `${settled} payout lunas` : "Belum ada payout lunas";
    $("pOutstanding").textContent = fmtRp(d.outstanding);
    $("pOutstandingMeta").textContent = waiting ? `${waiting} payout menunggu` : "Semua lunas";

    $("pEmpty").hidden = d.months.length > 0;
    const frag = document.createDocumentFragment();
    for (const m of d.months) {
      const h = document.createElement("h2");
      h.className = "pmonth__title";
      h.textContent = m.label;
      const grid = document.createElement("section");
      grid.className = "termins";
      for (const p of m.payouts) grid.append(payoutCard(p));
      frag.append(h, grid);
    }
    $("pMonths").replaceChildren(frag);

    $("pUpdated").textContent = updatedAt
      ? `Data diperbarui ${new Date(updatedAt).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`
      : "";
  }

  function payoutCard(p) {
    const partial = p.paid && p.remaining > 0;
    const covered = !p.paid && p.share > 0 && p.payable === 0;
    const card = document.createElement("article");
    card.className = "termin" + (p.settled ? " termin--paid" : "") + (p.remaining > 0 ? " termin--due" : "");

    const badge = p.settled
      ? `<span class="badge badge--paid"><span class="badge__dot"></span>Paid</span>`
      : partial
        ? `<span class="badge badge--unpaid"><span class="badge__dot"></span>Kurang</span>`
        : `<span class="badge badge--unpaid"><span class="badge__dot"></span>Unpaid</span>`;

    const subsidyRows = p.subsidies.map((x) => `
        <div class="figure figure--sub">
          <span class="figure__label">· ${escapeHtml(x.purpose)}</span>
          <span class="figure__value">−${fmtRp(x.amount)}</span>
        </div>`).join("");

    const label = partial ? "Sisa perlu ditransfer" : p.paid ? "Sudah ditransfer" : covered ? "Tertutup subsidi silang" : "Akan ditransfer";
    const value = partial ? fmtRp(p.remaining) : p.paid ? fmtRp(p.paidAmount) : fmtRp(p.payable);

    card.innerHTML = `
      <div class="termin__head">
        <div>
          <p class="termin__name" style="margin:0">Payout ${p.t}</p>
          <p class="termin__period" style="margin:2px 0 0">Tgl ${escapeHtml(p.period.replace(" – ", " - "))}</p>
        </div>
        ${badge}
      </div>
      <div class="termin__figures">
        <div class="figure">
          <span class="figure__label">Share partner</span>
          <span class="figure__value">${fmtRp(p.share)}</span>
        </div>
        ${p.subsidy > 0 ? `
        <div class="figure">
          <span class="figure__label">Subsidi silang</span>
          <span class="figure__value figure__value--neg">−${fmtRp(p.subsidy)}</span>
        </div>${subsidyRows}` : ""}
      </div>
      <div class="termin__share">
        <p class="termin__share-label">
          <span class="tile__dot ${p.paid ? "tile__dot--good" : "tile__dot--warn"}"></span>${label}
        </p>
        <p class="termin__share-value">${value}</p>
      </div>
      <div class="termin__foot">
        ${p.paid ? `<p class="termin__note">Dibayar ${fmtRp(p.paidAmount)} · ${fmtDate(p.paidAt)}${
          p.proofs.length ? ` · <button type="button" class="link-btn" data-proofs>Lihat bukti${p.proofs.length > 1 ? ` (${p.proofs.length})` : ""}</button>` : ""}</p>` : ""}
        <div class="proof__list pproofs" hidden></div>
      </div>
    `;
    const btn = card.querySelector("[data-proofs]");
    if (btn) btn.addEventListener("click", () => toggleProofs(card.querySelector(".pproofs"), p.proofs, btn));
    return card;
  }

  async function toggleProofs(box, proofs, btn) {
    if (!box.hidden) { box.hidden = true; btn.textContent = btn.textContent.replace("Tutup", "Lihat"); return; }
    box.hidden = false;
    btn.textContent = btn.textContent.replace("Lihat", "Tutup");
    if (box.dataset.loaded) return;
    box.dataset.loaded = "1";
    for (const x of proofs) {
      const fig = document.createElement("figure");
      fig.className = "proof__item proof__item--loading";
      fig.textContent = "Memuat bukti…";
      box.append(fig);
      try {
        const data = await rpc("get_partner_receipt", { lookup_hex: creds.lookup, receipt_id: x.id });
        if (!data) throw new Error("missing");
        const { bytes, type } = await decrypt(x.k, data);
        const url = URL.createObjectURL(new Blob([bytes], { type: type || "image/jpeg" }));
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener";
        const img = document.createElement("img");
        img.src = url;
        img.alt = "Bukti transfer";
        a.append(img);
        const cap = document.createElement("figcaption");
        cap.textContent = [x.amount !== null ? fmtRp(x.amount) : null, x.at ? fmtDate(x.at) : null].filter(Boolean).join(" · ");
        fig.className = "proof__item";
        fig.replaceChildren(a, cap);
      } catch {
        fig.className = "proof__item proof__item--loading";
        fig.textContent = "Bukti tidak bisa dimuat.";
      }
    }
  }

  // ---------- Init: pakai sesi tab ini kalau ada ----------

  (async () => {
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); } catch { /* abaikan */ }
    if (!saved || !saved.lookup || !saved.k) return;
    try {
      creds = saved;
      showDashboard(await fetchView(saved));
    } catch (e) {
      if (e instanceof WrongPassword) logout();
      else $("partnerError").textContent = "Tidak bisa terhubung ke server — periksa koneksi internet.";
    }
  })();
})();

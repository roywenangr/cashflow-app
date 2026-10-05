/* ============================================================
   Halaman detail payout untuk partner (dibuka dari link WhatsApp).
   Link: share.html#<id>.<kunci> — kunci ada di #hash, jadi tidak pernah
   terkirim ke server. Data diambil lewat get_share(id) lalu didekripsi di sini.
   ============================================================ */

(() => {
  "use strict";

  const CFG = window.CASHFLOW_CONFIG || {};
  const $ = (id) => document.getElementById(id);

  try {
    document.documentElement.dataset.theme =
      matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch { /* default gelap */ }

  const fromB64url = (s) => {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(b64 + "===".slice((b64.length + 3) % 4)), (c) => c.charCodeAt(0));
  };
  const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  const fmtRp = (n) => "Rp " + Math.round(n).toLocaleString("id-ID", { maximumFractionDigits: 0 });
  const fmtPct = (n) => `${n.toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`;
  const fmtDate = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
  };

  function fail(msg) {
    $("shareStatus").textContent = msg;
    $("shareSub").textContent = "Tidak bisa dibuka";
  }

  const rpc = async (fn, args) => {
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
  };

  let shareId = null;

  async function load() {
    const m = location.hash.slice(1).match(/^([0-9a-f-]{36})\.([A-Za-z0-9_-]+)$/i);
    if (!m) return fail("Link tidak lengkap — pastikan seluruh link dari WhatsApp tersalin.");
    if (!/^https?:\/\//.test(CFG.supabaseUrl || "") || !CFG.supabaseAnonKey) return fail("Aplikasi belum dikonfigurasi.");
    if (!(globalThis.crypto && crypto.subtle)) return fail("Browser ini tidak mendukung dekripsi. Coba buka di Chrome/Safari terbaru.");

    shareId = m[1];
    let data;
    try {
      data = await rpc("get_share", { share_id: shareId });
    } catch {
      return fail("Gagal memuat — periksa koneksi internet lalu muat ulang halaman.");
    }
    if (!data) return fail("Link ini sudah tidak berlaku (pembayaran dibatalkan atau diperbarui).");

    let d;
    try {
      const blob = JSON.parse(data);
      const key = await crypto.subtle.importKey("raw", fromB64url(m[2]), { name: "AES-GCM" }, false, ["decrypt"]);
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(blob.iv) }, key, fromB64(blob.data));
      d = JSON.parse(new TextDecoder().decode(pt));
    } catch {
      return fail("Link rusak atau tidak lengkap — pastikan seluruh link dari WhatsApp tersalin.");
    }
    render(d);
  }

  function figure(label, value, cls = "") {
    const div = document.createElement("div");
    div.className = "figure";
    const l = document.createElement("span");
    l.className = "figure__label";
    l.textContent = label;
    const v = document.createElement("span");
    v.className = "figure__value" + (cls ? " " + cls : "");
    v.textContent = value;
    div.append(l, v);
    return div;
  }

  function row(amountText, note, tag, extra) {
    const li = document.createElement("li");
    li.className = "entry";
    const body = document.createElement("div");
    body.className = "entry__body";
    const amt = document.createElement("span");
    amt.className = "entry__amount";
    amt.textContent = amountText;
    body.append(amt);
    if (note) {
      const n = document.createElement("span");
      n.className = "entry__note";
      n.textContent = note;
      body.append(n);
    }
    if (extra) {
      const s = document.createElement("span");
      s.className = "entry__share";
      s.textContent = extra;
      body.append(s);
    }
    if (tag) {
      const date = document.createElement("span");
      date.className = "entry__date";
      date.textContent = tag;
      li.append(date);
    }
    li.append(body);
    return li;
  }

  function render(d) {
    document.title = `Payout ${d.t} ${d.monthLabel}`;
    $("shareTitle").textContent = `Payout ${d.t} — ${d.monthLabel}`;
    $("shareSub").textContent = `Untuk ${d.partnerName} · periode tgl ${d.period}`;

    const figs = [
      figure(`Margin Kotor (Tgl ${d.period.replace(" – ", " - ")})`, fmtRp(d.profit)),
      figure("Share partner", fmtRp(d.share)),
    ];
    if (d.subsidy > 0) {
      figs.push(figure("Subsidi silang", "−" + fmtRp(d.subsidy), "figure__value--neg"));
      figs.push(figure("Share setelah subsidi", fmtRp(d.payable)));
    }
    $("shareFigures").replaceChildren(...figs);

    $("sharePaid").textContent = fmtRp(d.paidAmount);
    const payments = (d.payments || []).filter((p) => p.at && p.amount !== null);
    $("sharePaidNote").textContent = payments.length > 1
      ? "Dibayar bertahap: " + payments.map((p) => `${fmtRp(p.amount)} (${fmtDate(p.at)})`).join(" + ")
      : `Dibayar ${fmtDate(d.paidAt)}`;

    $("shareEntryCount").textContent = `${d.entries.length} Invoice`;
    $("shareEntriesEmpty").hidden = d.entries.length > 0;
    $("shareEntries").replaceChildren(...d.entries.map((e) =>
      row(fmtRp(e.amount), e.note, fmtDate(e.date), `Share ${fmtPct(e.sharePct)} · ${fmtRp(e.share)}`)));

    $("shareSubsidyCard").hidden = !(d.subsidies && d.subsidies.length);
    $("shareSubsidies").replaceChildren(...(d.subsidies || []).map((x) => row("−" + fmtRp(x.amount), x.purpose)));

    $("shareStatus").hidden = true;
    $("shareBody").hidden = false;
    renderProofs((d.payments || []).filter((p) => p.proof));
  }

  // Bukti transfer: ambil gambar terenkripsi lewat get_share_receipt, dekripsi dengan kunci dari data link.
  async function renderProofs(items) {
    if (!items.length) return;
    $("shareProofCard").hidden = false;
    const list = $("shareProofs");
    for (const p of items) {
      const fig = document.createElement("figure");
      fig.className = "proof__item proof__item--loading";
      fig.textContent = "Memuat bukti…";
      list.append(fig);
      try {
        const data = await rpc("get_share_receipt", { share_id: shareId, receipt_id: p.proof.id });
        if (!data) throw new Error("missing");
        const blob = JSON.parse(data);
        const key = await crypto.subtle.importKey("raw", fromB64(p.proof.k), { name: "AES-GCM" }, false, ["decrypt"]);
        const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(blob.iv) }, key, fromB64(blob.data));
        const url = URL.createObjectURL(new Blob([pt], { type: blob.type || "image/jpeg" }));
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener";
        const img = document.createElement("img");
        img.src = url;
        img.alt = "Bukti transfer";
        a.append(img);
        const cap = document.createElement("figcaption");
        cap.textContent = [p.amount !== null ? fmtRp(p.amount) : null, p.at ? fmtDate(p.at) : null].filter(Boolean).join(" · ");
        fig.className = "proof__item";
        fig.replaceChildren(a, cap);
      } catch {
        fig.remove();
        $("shareProofError").textContent = "Sebagian bukti transfer tidak bisa dimuat.";
      }
    }
    if (!list.children.length) $("shareProofCard").hidden = $("shareProofError").textContent === "";
  }

  load();
})();

"use client";

// Halaman detail payout untuk partner (dibuka dari link WhatsApp).
// Link: /share#<id>.<kunci> — kunci ada di #hash, jadi tidak pernah terkirim ke server.
// Data diambil lewat get_share(id) lalu didekripsi di sini.

import { useEffect, useState } from "react";
import { cloudConfigured } from "@/lib/config";
import { decryptWithRawKey, fromB64url } from "@/lib/crypto";
import { dashPeriod, fmtDate, fmtPct, fmtRp, type ShareView as Share } from "@/lib/model";
import { rpc } from "@/lib/supabase";
import { ProofImage } from "./PartnerApp";

export default function ShareView() {
  const [d, setD] = useState<Share | null>(null);
  const [shareId, setShareId] = useState("");
  const [status, setStatus] = useState("Memuat detail payout…");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    try {
      document.documentElement.dataset.theme = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    } catch { /* default gelap */ }
    const fail = (msg: string) => { setStatus(msg); setFailed(true); };
    (async () => {
      const m = location.hash.slice(1).match(/^([0-9a-f-]{36})\.([A-Za-z0-9_-]+)$/i);
      if (!m) return fail("Link tidak lengkap — pastikan seluruh link dari WhatsApp tersalin.");
      if (!cloudConfigured()) return fail("Aplikasi belum dikonfigurasi.");
      if (!(globalThis.crypto && crypto.subtle)) return fail("Browser ini tidak mendukung dekripsi. Coba buka di Chrome/Safari terbaru.");
      let data: string | null;
      try {
        data = await rpc("get_share", { share_id: m[1] });
      } catch {
        return fail("Gagal memuat — periksa koneksi internet lalu muat ulang halaman.");
      }
      if (!data) return fail("Link ini sudah tidak berlaku (pembayaran dibatalkan atau diperbarui).");
      try {
        const { bytes } = await decryptWithRawKey(fromB64url(m[2]), data);
        const snap: Share = JSON.parse(new TextDecoder().decode(bytes));
        setShareId(m[1]);
        setD(snap);
        document.title = `Payout ${snap.t} ${snap.monthLabel}`;
      } catch {
        return fail("Link rusak atau tidak lengkap — pastikan seluruh link dari WhatsApp tersalin.");
      }
    })();
  }, []);

  const payments = (d?.payments || []).filter((p) => p.at && p.amount !== null);
  const proofs = (d?.payments || []).filter((p) => p.proof);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__logo" aria-hidden="true">Rp</span>
          <div>
            <h1>{d ? `Payout ${d.t} — ${d.monthLabel}` : "Detail payout"}</h1>
            <p className="topbar__sub">{d ? `Untuk ${d.partnerName} · periode tgl ${d.period}` : failed ? "Tidak bisa dibuka" : "Memuat…"}</p>
          </div>
        </div>
      </header>

      <main>
        {!d && <p className="empty">{status}</p>}
        {d && (
          <>
            <section className="card">
              <div className="card__head">
                <h3 className="card__title">Ringkasan</h3>
                <span className="badge badge--paid"><span className="badge__dot"></span>Paid</span>
              </div>
              <div className="termin__figures share__figures">
                <Figure label={`Margin Kotor (Tgl ${dashPeriod(d.period)})`} value={fmtRp(d.profit)} />
                <Figure label="Share partner" value={fmtRp(d.share)} />
                {d.subsidy > 0 && <>
                  <Figure label="Subsidi silang" value={"−" + fmtRp(d.subsidy)} cls="figure__value--neg" />
                  <Figure label="Share setelah subsidi" value={fmtRp(d.payable)} />
                </>}
              </div>
              <div className="termin__share">
                <p className="termin__share-label"><span className="tile__dot tile__dot--good"></span>Sudah ditransfer</p>
                <p className="termin__share-value">{fmtRp(d.paidAmount)}</p>
              </div>
              <p className="termin__note">
                {payments.length > 1
                  ? "Dibayar bertahap: " + payments.map((p) => `${fmtRp(p.amount!)} (${fmtDate(p.at!)})`).join(" + ")
                  : `Dibayar ${fmtDate(d.paidAt)}`}
              </p>
            </section>

            {proofs.length > 0 && (
              <section className="card">
                <div className="card__head"><h3 className="card__title">Bukti transfer</h3></div>
                <div className="proof__list share__proofs">
                  {proofs.map((p) => (
                    <ProofImage key={p.proof.id} proof={{ id: p.proof.id, k: p.proof.k, at: p.at, amount: p.amount }}
                      load={() => rpc("get_share_receipt", { share_id: shareId, receipt_id: p.proof.id })} />
                  ))}
                </div>
              </section>
            )}

            <section className="card">
              <div className="card__head">
                <h3 className="card__title">Invoice</h3>
                <span className="chip">{d.entries.length} Invoice</span>
              </div>
              <ul className="entries">
                {d.entries.map((e, i) => (
                  <li key={i} className="entry">
                    <span className="entry__date">{fmtDate(e.date)}</span>
                    <div className="entry__body">
                      <span className="entry__amount">{fmtRp(e.amount)}</span>
                      {e.note && <span className="entry__note">{e.note}</span>}
                      <span className="entry__share">Share {fmtPct(e.sharePct)} · {fmtRp(e.share)}</span>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="empty" hidden={d.entries.length > 0}>Tidak ada invoice.</p>
            </section>

            {d.subsidies.length > 0 && (
              <section className="card">
                <div className="card__head"><h3 className="card__title">Subsidi Silang</h3></div>
                <ul className="entries subsidies" id="shareSubsidies">
                  {d.subsidies.map((x, i) => (
                    <li key={i} className="entry">
                      <div className="entry__body">
                        <span className="entry__amount">−{fmtRp(x.amount)}</span>
                        {x.purpose && <span className="entry__note">{x.purpose}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Figure({ label, value, cls = "" }: { label: string; value: string; cls?: string }) {
  return (
    <div className="figure">
      <span className="figure__label">{label}</span>
      <span className={"figure__value" + (cls ? " " + cls : "")}>{value}</span>
    </div>
  );
}

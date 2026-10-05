"use client";

// Halaman detail payout untuk partner (dibuka dari link WhatsApp), bergaya struk.
// Link: /share#<id>.<kunci> — kunci ada di #hash, jadi tidak pernah terkirim ke server.
// Data diambil lewat get_share(id) lalu didekripsi di sini.

import { useEffect, useState } from "react";
import { CircleCheck, Link2Off, Loader2, ShieldCheck } from "lucide-react";
import { cloudConfigured } from "@/lib/config";
import { decryptWithRawKey, fromB64url } from "@/lib/crypto";
import { dashPeriod, fmtDate, fmtPct, fmtRp, type ShareView as Share } from "@/lib/model";
import { rpc } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Brand } from "./common";
import { ProofImage } from "./PartnerApp";

export default function ShareView() {
  const [d, setD] = useState<Share | null>(null);
  const [shareId, setShareId] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    try {
      document.documentElement.classList.toggle("dark", !matchMedia("(prefers-color-scheme: light)").matches);
    } catch { /* biarkan */ }
    (async () => {
      const m = location.hash.slice(1).match(/^([0-9a-f-]{36})\.([A-Za-z0-9_-]+)$/i);
      if (!m) return setStatus("Link tidak lengkap — pastikan seluruh link dari WhatsApp tersalin.");
      if (!cloudConfigured()) return setStatus("Aplikasi belum dikonfigurasi.");
      if (!(globalThis.crypto && crypto.subtle)) return setStatus("Browser ini tidak mendukung dekripsi. Coba buka di Chrome/Safari terbaru.");
      let data: string | null;
      try {
        data = await rpc("get_share", { share_id: m[1] });
      } catch {
        return setStatus("Gagal memuat — periksa koneksi internet lalu muat ulang halaman.");
      }
      if (!data) return setStatus("Link ini sudah tidak berlaku (pembayaran dibatalkan atau diperbarui).");
      try {
        const { bytes } = await decryptWithRawKey(fromB64url(m[2]), data);
        const snap: Share = JSON.parse(new TextDecoder().decode(bytes));
        setShareId(m[1]);
        setD(snap);
        document.title = `Payout ${snap.t} ${snap.monthLabel}`;
      } catch {
        return setStatus("Link rusak atau tidak lengkap — pastikan seluruh link dari WhatsApp tersalin.");
      }
    })();
  }, []);

  return (
    <div className="mx-auto min-h-dvh max-w-xl px-4 py-6 sm:py-10">
      <Brand sub="Detail payout" />

      {!d && (
        <div className="mt-16 flex flex-col items-center gap-3 text-center">
          {status ? (
            <>
              <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground"><Link2Off className="size-5" /></span>
              <p className="font-medium">Tidak bisa dibuka</p>
              <p className="max-w-xs text-sm text-muted-foreground">{status}</p>
            </>
          ) : (
            <>
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Memuat detail payout…</p>
            </>
          )}
        </div>
      )}

      {d && <Receipt d={d} shareId={shareId} />}
    </div>
  );
}

function Receipt({ d, shareId }: { d: Share; shareId: string }) {
  const payments = d.payments.filter((p) => p.at && p.amount !== null);
  const proofs = d.payments.filter((p) => p.proof);
  return (
    <div className="mt-6 space-y-4">
      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-col items-center gap-2 px-6 pt-7 pb-6 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-success/12 text-success-ink"><CircleCheck className="size-6" /></span>
          <p className="text-sm text-muted-foreground">Payout {d.t} · {d.monthLabel} · untuk {d.partnerName}</p>
          <p className="tnum text-4xl font-semibold tracking-tight">{fmtRp(d.paidAmount)}</p>
          <p className="text-sm text-muted-foreground">
            {payments.length > 1
              ? "Dibayar bertahap: " + payments.map((p) => `${fmtRp(p.amount!)} (${fmtDate(p.at!)})`).join(" + ")
              : `Ditransfer ${fmtDate(d.paidAt)}`}
          </p>
        </div>
        <dl className="space-y-2.5 border-t border-dashed px-6 py-5 text-sm">
          <Line label={`Margin kotor (Tgl ${dashPeriod(d.period)})`} value={fmtRp(d.profit)} />
          <Line label="Share partner" value={fmtRp(d.share)} />
          {d.subsidy > 0 && <>
            <Line label="Subsidi silang" value={"−" + fmtRp(d.subsidy)} valueClass="text-warning-ink" />
            <Line label="Share setelah subsidi" value={fmtRp(d.payable)} strong />
          </>}
        </dl>
      </div>

      {proofs.length > 0 && (
        <Card title="Bukti transfer">
          <div className="space-y-3 px-5 pb-5">
            {proofs.map((p) => (
              <ProofImage key={p.proof.id} proof={{ id: p.proof.id, k: p.proof.k, at: p.at, amount: p.amount }}
                load={() => rpc("get_share_receipt", { share_id: shareId, receipt_id: p.proof.id })} />
            ))}
          </div>
        </Card>
      )}

      <Card title={<>Invoice <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{d.entries.length}</span></>}>
        {d.entries.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted-foreground">Tidak ada invoice.</p>
        ) : (
          <ul className="divide-y border-t">
            {d.entries.map((e, i) => (
              <li key={i} className="flex items-center gap-3 px-5 py-3">
                <span className="w-16 shrink-0 text-xs text-muted-foreground">{fmtDate(e.date)}</span>
                <div className="min-w-0 flex-1">
                  <p className="tnum text-sm font-semibold">{fmtRp(e.amount)}</p>
                  <p className="truncate text-xs text-muted-foreground">{e.note || "Tanpa catatan"} · Share {fmtPct(e.sharePct)} = {fmtRp(e.share)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {d.subsidies.length > 0 && (
        <Card title="Subsidi silang">
          <ul className="divide-y border-t">
            {d.subsidies.map((x, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <span className="truncate text-muted-foreground">{x.purpose}</span>
                <span className="tnum font-semibold">−{fmtRp(x.amount)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <p className="flex items-center justify-center gap-1.5 pt-2 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5" /> Terenkripsi end-to-end — hanya pemegang link ini yang bisa membukanya.
      </p>
    </div>
  );
}

function Card({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border bg-card shadow-xs">
      <h2 className="flex items-center px-5 pt-4 pb-3 text-[15px] font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function Line({ label, value, strong, valueClass }: { label: string; value: string; strong?: boolean; valueClass?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("tnum font-medium", strong && "font-semibold", valueClass)}>{value}</dd>
    </div>
  );
}

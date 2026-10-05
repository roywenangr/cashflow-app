"use client";

// Portal partner — login hanya dengan password partner.
// Password -> PBKDF2 -> lookup (menemukan baris di server) + kunci AES.
// Data partner dibuat & dienkripsi oleh aplikasi pemilik; isinya hanya
// share, subsidi, status bayar & bukti transfer (tanpa margin/invoice).

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, CircleCheck, Clock, FileText, Loader2, LogOut, PiggyBank, RefreshCw, Wallet,
} from "lucide-react";
import { cloudConfigured } from "@/lib/config";
import { decryptWithRawKey, derivePartner } from "@/lib/crypto";
import { dashPeriod, fmtDate, fmtRp, monthLabel, type PartnerPayout, type PartnerView, type Proof } from "@/lib/model";
import { rpc } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Brand, EmptyState, FieldLabel, FormError, Logo, PasswordInput, StatusBadge, useMounted } from "./common";
import { AnimatePresence, ease, Money, motion, MotionProvider, Rise, Stagger } from "./motion";

const SESSION_KEY = "cashflow.partner"; // { lookup, k } — hilang saat tab ditutup
type Creds = { lookup: string; k: string };
class WrongPassword extends Error {}

async function fetchView(c: Creds): Promise<{ data: PartnerView; updatedAt: string }> {
  const rows = await rpc("get_partner_view", { lookup_hex: c.lookup });
  if (!rows || !rows[0]) throw new WrongPassword();
  const { bytes } = await decryptWithRawKey(c.k, rows[0].data);
  return { data: JSON.parse(new TextDecoder().decode(bytes)), updatedAt: rows[0].updated_at };
}

// Halaman partner mengikuti tema perangkat.
function useSystemTheme() {
  useEffect(() => {
    try {
      const saved = localStorage.getItem("cashflow.theme");
      const dark = saved ? saved === "dark" : !matchMedia("(prefers-color-scheme: light)").matches;
      document.documentElement.classList.toggle("dark", dark);
    } catch { /* biarkan */ }
  }, []);
}

export default function PartnerApp() {
  const mounted = useMounted();
  useSystemTheme();
  const [creds, setCreds] = useState<Creds | null>(null);
  const [view, setView] = useState<{ data: PartnerView; updatedAt: string } | null>(null);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [note, setNote] = useState("");

  function logout() {
    setCreds(null);
    setView(null);
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* abaikan */ }
  }

  // Masih di tab yang sama -> pakai sesi tab ini.
  useEffect(() => {
    let saved: Creds | null = null;
    try { saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); } catch { /* abaikan */ }
    if (!saved?.lookup || !saved?.k) return;
    fetchView(saved)
      .then((v) => { setCreds(saved); setView(v); })
      .catch((e) => {
        if (e instanceof WrongPassword) logout();
        else setErr("Tidak bisa terhubung ke server — periksa koneksi internet.");
      });
  }, []);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const p = pw.trim();
    if (!p) { setErr("Masukkan password partner."); return; }
    if (!cloudConfigured()) { setErr("Aplikasi belum dikonfigurasi."); return; }
    setBusy(true);
    try {
      const c = await derivePartner(p);
      const v = await fetchView(c);
      try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(c)); } catch { /* cukup login lagi nanti */ }
      setPw("");
      setCreds(c);
      setView(v);
    } catch (e2) {
      setErr(e2 instanceof WrongPassword ? "Password salah atau akses partner sudah dimatikan."
        : "Tidak bisa terhubung ke server — periksa koneksi internet.");
    } finally {
      setBusy(false);
    }
  }

  if (!mounted) return null;
  return <MotionProvider>{renderBody()}</MotionProvider>;

  function renderBody() {
  if (!creds || !view) {
    return (
      <div className="flex min-h-dvh flex-col px-4 py-6 sm:px-8">
        <Brand sub="Portal partner" />
        <div className="flex flex-1 items-center justify-center py-10">
          <motion.form onSubmit={login} noValidate className="w-full max-w-sm space-y-5"
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease }}>
            <div className="flex flex-col items-center gap-3 text-center">
              <Logo className="size-12 rounded-2xl text-base" />
              <div className="space-y-1">
                <h1 className="text-2xl font-semibold tracking-tight">Portal partner</h1>
                <p className="text-sm text-muted-foreground">Lihat share, status pembayaran, dan bukti transfer kamu.</p>
              </div>
            </div>
            <div className="space-y-1.5">
              <FieldLabel htmlFor="ppw">Password partner</FieldLabel>
              <PasswordInput id="ppw" autoComplete="current-password" autoCapitalize="off" spellCheck={false} autoFocus
                value={pw} onChange={(e) => setPw(e.target.value)} />
            </div>
            <FormError>{err}</FormError>
            <Button type="submit" size="lg" className="h-10 w-full" disabled={busy}>
              {busy ? <><Loader2 className="animate-spin" /> Memproses…</> : <>Masuk <ArrowRight /></>}
            </Button>
            <Button asChild variant="ghost" size="lg" className="h-10 w-full">
              <Link href="/"><ArrowLeft /> Masuk sebagai pemilik</Link>
            </Button>
          </motion.form>
        </div>
      </div>
    );
  }

  const d = view.data;
  const payouts = d.months.flatMap((m) => m.payouts);
  const settled = payouts.filter((p) => p.settled && p.paid).length;
  const waiting = payouts.filter((p) => p.remaining > 0).length;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur-lg">
        <div className="mx-auto flex h-16 max-w-4xl items-center gap-3 px-4 sm:px-6">
          <Brand sub={`Partner · ${d.partnerName}`} />
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon-lg" aria-label="Muat ulang data" title="Muat ulang data" disabled={refreshing} onClick={async () => {
              setRefreshing(true);
              try { setView(await fetchView(creds)); setNote(""); } catch (e) {
                if (e instanceof WrongPassword) logout(); else setNote("Gagal memuat ulang — periksa koneksi internet.");
              } finally { setRefreshing(false); }
            }}><RefreshCw className={cn(refreshing && "animate-spin")} /></Button>
            <Button variant="ghost" size="icon-lg" aria-label="Keluar" title="Keluar" onClick={logout}><LogOut /></Button>
          </div>
        </div>
      </header>

      <Stagger className="mx-auto max-w-4xl space-y-6 px-4 pt-5 pb-12 sm:px-6">
        <Rise className="grid gap-4 sm:grid-cols-[1.4fr_1fr]">
          <div className="bg-hero relative overflow-hidden rounded-2xl p-6 text-white shadow-sm">
            <div className="pointer-events-none absolute -top-20 -right-16 size-64 rounded-full bg-white/10 blur-3xl" />
            <p className="relative flex items-center gap-2 text-sm text-white/75"><Wallet className="size-4" /> Total sudah diterima</p>
            <Money value={d.received} className="tnum relative mt-2 block text-4xl font-semibold tracking-tight" />
            <p className="relative mt-1 text-sm text-white/70">{settled ? `${settled} payout lunas` : "Belum ada payout lunas"}</p>
          </div>
          <div className="flex flex-col justify-between rounded-2xl border bg-card p-6 shadow-xs">
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Clock className="size-4" /> Belum dibayar</p>
            <Money value={d.outstanding} className={cn("tnum mt-2 block text-3xl font-semibold tracking-tight", d.outstanding > 0 && "text-warning-ink")} />
            <p className="mt-1 text-sm text-muted-foreground">{waiting ? `${waiting} payout menunggu` : "Semua lunas"}</p>
          </div>
        </Rise>

        {d.savings && d.savings.txs.length > 0 && <Rise><PartnerSavings sv={d.savings} /></Rise>}

        {d.months.length === 0 && (
          <div className="rounded-2xl border bg-card"><EmptyState icon={<Wallet />} title="Belum ada data payout" /></div>
        )}

        {d.months.map((m) => (
          <Rise key={m.ym} className="space-y-3">
            <h2 className="px-1 text-sm font-semibold text-muted-foreground capitalize">{m.label}</h2>
            <div className="grid items-start gap-4 md:grid-cols-2">
              {m.payouts.map((p) => <PartnerPayoutCard key={p.t} p={p} lookup={creds.lookup} />)}
            </div>
          </Rise>
        ))}

        <p className="text-center text-xs text-muted-foreground">
          {note || (view.updatedAt
            ? `Data diperbarui ${new Date(view.updatedAt).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`
            : "")}
        </p>
      </Stagger>
    </div>
  );
  }
}

// Money Savings versi partner: hanya lihat saldo & riwayat.
function PartnerSavings({ sv }: { sv: NonNullable<PartnerView["savings"]> }) {
  const [all, setAll] = useState(false);
  const shown = all ? sv.txs : sv.txs.slice(0, 5);
  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-xs">
      <div className="flex flex-wrap items-center gap-4 bg-[linear-gradient(135deg,oklch(0.52_0.12_175),oklch(0.42_0.1_200))] px-5 py-4 text-white">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm text-white/80"><PiggyBank className="size-4" /> Money Savings</p>
          <Money value={sv.balance} className="tnum mt-1 block text-2xl font-semibold tracking-tight" />
        </div>
        <div className="flex gap-5 text-sm">
          <div><p className="flex items-center gap-1 text-xs text-white/75"><ArrowDownLeft className="size-3.5" /> Masuk</p><p className="tnum font-semibold">{fmtRp(sv.totalIn)}</p></div>
          <div><p className="flex items-center gap-1 text-xs text-white/75"><ArrowUpRight className="size-3.5" /> Dipakai</p><p className="tnum font-semibold">{fmtRp(sv.totalOut)}</p></div>
        </div>
      </div>
      <p className="px-5 pt-3 text-xs text-muted-foreground">Dana terkumpul dari subsidi silang (dipotong dari share kamu) beserta penggunaannya.</p>
      <ul className="mt-2 border-t">
        <AnimatePresence initial={false}>
          {shown.map((t, i) => (
            <motion.li key={`${t.kind}-${i}-${t.amount}`} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3, ease }} className="overflow-hidden border-b last:border-b-0">
              <div className="flex items-center gap-3 px-5 py-3">
                <span className={cn("grid size-8 shrink-0 place-items-center rounded-full",
                  t.kind === "in" ? "bg-success/12 text-success-ink" : "bg-s-share/12 text-s-share")}>
                  {t.kind === "in" ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.purpose || (t.kind === "in" ? "Subsidi silang" : "Penggunaan")}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {t.kind === "in" ? <>Subsidi silang · Payout {t.termin} <span className="capitalize">{monthLabel(t.ym)}</span></> : <>Dipakai · {fmtDate(t.date!)}</>}
                  </p>
                </div>
                <span className={cn("tnum shrink-0 text-sm font-semibold", t.kind === "in" && "text-success-ink")}>
                  {t.kind === "in" ? "+" : "−"}{fmtRp(t.amount)}
                </span>
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {sv.txs.length > 5 && (
        <div className="border-t p-2">
          <Button variant="ghost" size="lg" className="w-full" onClick={() => setAll(!all)}>
            {all ? "Tampilkan lebih sedikit" : `Lihat semua (${sv.txs.length})`}
          </Button>
        </div>
      )}
    </section>
  );
}

function PartnerPayoutCard({ p, lookup }: { p: PartnerPayout; lookup: string }) {
  const [showProofs, setShowProofs] = useState(false);
  const partial = p.paid && p.remaining > 0;
  const covered = !p.paid && p.share > 0 && p.payable === 0;
  const label = partial ? "Sisa akan ditransfer" : p.paid ? "Sudah ditransfer" : covered ? "Tertutup subsidi silang" : "Akan ditransfer";
  const value = partial ? p.remaining : p.paid ? p.paidAmount : p.payable;

  return (
    <motion.article whileHover={{ y: -3 }} transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className={cn("flex flex-col rounded-2xl border bg-card shadow-xs transition-shadow hover:shadow-md", p.remaining > 0 && "ring-1 ring-warning/30")}>
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div>
          <h3 className="text-[15px] font-semibold tracking-tight">Payout {p.t}</h3>
          <p className="text-xs text-muted-foreground">Tanggal {dashPeriod(p.period)}</p>
        </div>
        {p.settled ? <StatusBadge tone="paid">Lunas</StatusBadge>
          : partial ? <StatusBadge tone="partial">Kurang bayar</StatusBadge>
          : <StatusBadge tone="due">Belum dibayar</StatusBadge>}
      </div>
      <div className="px-5 pt-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <Money value={value} className="tnum mt-0.5 block text-3xl font-semibold tracking-tight" />
      </div>
      <dl className="mx-5 mt-4 space-y-2 border-t pt-4 text-sm">
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Share partner</dt><dd className="tnum font-medium">{fmtRp(p.share)}</dd></div>
        {p.subsidy > 0 && (
          <>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Subsidi silang</dt><dd className="tnum font-medium text-warning-ink">−{fmtRp(p.subsidy)}</dd></div>
            {p.subsidies.map((x, i) => (
              <div key={i} className="flex justify-between gap-3 pl-3 text-xs text-muted-foreground">
                <dt className="truncate">· {x.purpose}</dt><dd className="tnum">−{fmtRp(x.amount)}</dd>
              </div>
            ))}
          </>
        )}
      </dl>
      <div className="mt-auto space-y-3 p-5">
        {p.paid && (
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <CircleCheck className="size-3.5 text-success" /> Dibayar {fmtRp(p.paidAmount)} · {fmtDate(p.paidAt!)}
          </p>
        )}
        {p.proofs.length > 0 && (
          <Button variant="outline" size="lg" className="w-full" onClick={() => setShowProofs(!showProofs)}>
            <FileText /> {showProofs ? "Tutup bukti transfer" : `Lihat bukti transfer${p.proofs.length > 1 ? ` (${p.proofs.length})` : ""}`}
          </Button>
        )}
        <AnimatePresence initial={false}>
          {showProofs && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.35, ease }} className="space-y-3 overflow-hidden">
              {p.proofs.map((x) => (
                <ProofImage key={x.id} proof={x} load={() => rpc("get_partner_receipt", { lookup_hex: lookup, receipt_id: x.id })} />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.article>
  );
}

// Ambil gambar terenkripsi lewat fungsi publik, dekripsi dengan kunci yang ada di data.
export function ProofImage({ proof, load }: { proof: Proof; load: () => Promise<string | null> }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let made = "";
    (async () => {
      try {
        const data = await load();
        if (!data) throw new Error("missing");
        const { bytes, type } = await decryptWithRawKey(proof.k, data);
        made = URL.createObjectURL(new Blob([bytes], { type: type || "image/jpeg" }));
        if (!cancelled) setUrl(made);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; if (made) URL.revokeObjectURL(made); };
  }, [proof.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <figure className="space-y-1.5">
      {failed ? (
        <div className="grid h-32 place-items-center rounded-lg bg-muted text-xs text-muted-foreground">Bukti tidak bisa dimuat.</div>
      ) : !url ? (
        <div className="grid h-48 place-items-center rounded-lg bg-muted text-muted-foreground"><Loader2 className="animate-spin" /></div>
      ) : (
        <motion.a href={url} target="_blank" rel="noopener" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4, ease }} className="block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="Bukti transfer" className="max-h-[70vh] w-full rounded-lg border bg-muted object-contain" />
        </motion.a>
      )}
      <figcaption className="tnum text-xs text-muted-foreground">
        {[proof.amount !== null ? fmtRp(proof.amount) : null, proof.at ? fmtDate(proof.at) : null].filter(Boolean).join(" · ")}
      </figcaption>
    </figure>
  );
}

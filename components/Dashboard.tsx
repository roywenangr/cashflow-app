"use client";

import { useRef, useState } from "react";
import {
  CalendarDays, ChartLine, ChevronLeft, ChevronRight, CircleCheck, Download, FileText, HandCoins, History, KeyRound,
  LayoutDashboard, LogOut, MessageCircle, MoreHorizontal, Plus, Receipt, Settings, Trash2, Undo2, Upload, Wallet,
} from "lucide-react";
import {
  deleteEntry, deleteSubsidy, exportBackup, importBackup, logout, resetAll, setViewMonth, syncText, unmarkPaid, waUrl,
} from "@/lib/store";
import {
  dashPeriod, entryShare, fmtDate, fmtPct, fmtRp, monthEntries, monthLabel, pctLabel, shiftMonth, State, Termin,
  terminEntries, terminKey, terminOf, terminPeriod, terminTotals, today,
} from "@/lib/model";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Brand, EmptyState, Section, StatusBadge, ThemeButton, useStore } from "./common";
import Analytics from "./Analytics";
import SettingsSheet from "./SettingsSheet";
import { AddInvoiceDialog, AddSubsidyDialog, PasswordDialog, ProofDialog, ProofViewDialog, WaDialog } from "./dialogs";

export default function Dashboard() {
  const s = useStore();
  const [tab, setTab] = useState("overview");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [subsidyOpen, setSubsidyOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<null | { ym: string; t: number; msg: string }>(null);
  const [proofKey, setProofKey] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <TooltipProvider delayDuration={200}>
      <Tabs value={tab} onValueChange={setTab} className="min-h-dvh gap-0">
        <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur-lg">
          <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
            <Brand sub="Profit Sharing - Made with <3" />
            <TabsList className="mx-auto hidden md:flex">
              <TabsTrigger value="overview"><LayoutDashboard /> Ringkasan</TabsTrigger>
              <TabsTrigger value="analytics"><ChartLine /> Analitik</TabsTrigger>
            </TabsList>
            <div className="ml-auto flex items-center gap-1 md:ml-0">
              <SyncDot />
              <ThemeButton />
              <Button variant="ghost" size="icon-lg" aria-label="Pengaturan" title="Pengaturan" onClick={() => setSettingsOpen(true)}><Settings /></Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-lg" aria-label="Akun">
                    <span className="grid size-7 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary uppercase">{(s.accountEmail || "?")[0]}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{s.accountEmail || "—"}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setPwOpen(true)}><KeyRound /> Ganti password</DropdownMenuItem>
                  <DropdownMenuItem onSelect={exportBackup}><Download /> Export backup (JSON)</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => fileRef.current?.click()}><Upload /> Import backup</DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onSelect={() => resetAll()}><Trash2 /> Reset semua data</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => logout()}><LogOut /> Keluar</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <div className="px-4 pb-3 md:hidden">
            <TabsList className="w-full">
              <TabsTrigger value="overview"><LayoutDashboard /> Ringkasan</TabsTrigger>
              <TabsTrigger value="analytics"><ChartLine /> Analitik</TabsTrigger>
            </TabsList>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl px-4 pt-5 pb-10 sm:px-6">
          <TabsContent value="overview">
            <Overview s={s.state} ym={s.viewMonth}
              onAddInvoice={() => setInvoiceOpen(true)} onAddSubsidy={() => setSubsidyOpen(true)}
              onPay={(t, msg) => setPayTarget({ ym: s.viewMonth, t, msg })} onProofs={setProofKey} />
          </TabsContent>
          <TabsContent value="analytics">
            <Analytics onOpenMonth={(ym) => { setViewMonth(ym); setTab("overview"); }} />
          </TabsContent>
        </main>

        <footer className="mx-auto max-w-6xl px-4 pb-8 text-center text-xs text-muted-foreground sm:px-6">
          Data dienkripsi di perangkat ini sebelum dikirim ke cloud.
        </footer>
      </Tabs>

      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = ""; // supaya file yang sama bisa dipilih lagi
        if (f) importBackup(f);
      }} />
      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} onChangePw={() => { setSettingsOpen(false); setPwOpen(true); }} />
      <PasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
      <AddInvoiceDialog open={invoiceOpen} onOpenChange={setInvoiceOpen} />
      <AddSubsidyDialog open={subsidyOpen} onOpenChange={setSubsidyOpen} />
      <ProofDialog target={payTarget} onClose={() => setPayTarget(null)} />
      <ProofViewDialog payoutKey={proofKey} onClose={() => setProofKey(null)} />
      <WaDialog />
    </TooltipProvider>
  );
}

function SyncDot() {
  const s = useStore();
  const st = s.sync.state;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} aria-label={syncText()} className="grid size-9 place-items-center rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <span className={cn("size-2.5 rounded-full",
            st === "synced" && "bg-success",
            st === "syncing" && "animate-pulse bg-primary",
            (st === "offline" || st === "conflict") && "bg-warning",
            st === "error" && "bg-destructive",
            st === "idle" && "bg-muted-foreground/40")} />
        </span>
      </TooltipTrigger>
      <TooltipContent>{syncText()}</TooltipContent>
    </Tooltip>
  );
}

// ---------- Ringkasan ----------

function Overview({ s, ym, onAddInvoice, onAddSubsidy, onPay, onProofs }: {
  s: State; ym: string; onAddInvoice: () => void; onAddSubsidy: () => void;
  onPay: (t: Termin, msg: string) => void; onProofs: (key: string) => void;
}) {
  const isThisMonth = ym === today().slice(0, 7);
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex items-center justify-between gap-1 rounded-xl border bg-card p-1 shadow-xs sm:justify-start">
          <Button variant="ghost" size="icon-lg" aria-label="Bulan sebelumnya" onClick={() => setViewMonth(shiftMonth(ym, -1))}><ChevronLeft /></Button>
          <h1 className="min-w-36 text-center text-[15px] font-semibold tracking-tight capitalize">{monthLabel(ym)}</h1>
          <Button variant="ghost" size="icon-lg" aria-label="Bulan berikutnya" onClick={() => setViewMonth(shiftMonth(ym, 1))}><ChevronRight /></Button>
        </div>
        {!isThisMonth && (
          <Button variant="outline" size="lg" onClick={() => setViewMonth(today().slice(0, 7))}><CalendarDays /> Bulan ini</Button>
        )}
        <div className="grid grid-cols-2 gap-2 sm:ml-auto sm:flex">
          <Button variant="outline" size="lg" className="h-10 sm:h-9" onClick={onAddSubsidy}><HandCoins /> Subsidi silang</Button>
          <Button size="lg" className="h-10 sm:h-9" onClick={onAddInvoice}><Plus /> Tambah invoice</Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Hero s={s} ym={ym} />
        <PaymentStatus s={s} ym={ym} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {([1, 2] as const).map((t) => (
          <PayoutCard key={t} s={s} ym={ym} t={t} onPay={(msg) => onPay(t, msg)} onProofs={() => onProofs(terminKey(ym, t))} />
        ))}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Invoices s={s} ym={ym} onAdd={onAddInvoice} className="lg:col-span-2" />
        <div className="space-y-4">
          <Subsidies s={s} ym={ym} onAdd={onAddSubsidy} />
          <PayoutHistory s={s} onProofs={onProofs} />
        </div>
      </div>
    </div>
  );
}

function Hero({ s, ym }: { s: State; ym: string }) {
  const entries = monthEntries(s, ym);
  const t1 = terminTotals(s, ym, 1), t2 = terminTotals(s, ym, 2);
  const profit = t1.profit + t2.profit;
  const share = t1.share + t2.share;
  const subsidy = t1.subsidy + t2.subsidy;
  const label = pctLabel(s, entries);
  const pct = label === "campuran" ? `rata-rata ${fmtPct(profit ? Math.round((share / profit) * 1000) / 10 : 0)}` : label;

  return (
    <div className="bg-hero relative overflow-hidden rounded-2xl p-6 text-white shadow-sm lg:col-span-2">
      <div className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-white/10 blur-3xl" />
      <div className="relative">
        <p className="flex items-center gap-2 text-sm text-white/75"><Wallet className="size-4" /> Profit bersih kamu · <span className="capitalize">{monthLabel(ym)}</span></p>
        <p className="tnum mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">{fmtRp(profit - share)}</p>
        <p className="mt-1 text-sm text-white/70">Margin kotor − share partner · {entries.length} invoice</p>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <HeroStat label="Margin kotor" value={fmtRp(profit)} />
          <HeroStat label={`Share partner (${pct})`} value={fmtRp(share)} />
          <HeroStat label="Subsidi silang" value={subsidy ? "−" + fmtRp(subsidy) : "—"} className="col-span-2 sm:col-span-1" />
        </div>
      </div>
    </div>
  );
}

function HeroStat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn("rounded-xl bg-white/10 px-3.5 py-3 ring-1 ring-white/10 backdrop-blur", className)}>
      <p className="truncate text-xs text-white/70">{label}</p>
      <p className="tnum mt-0.5 truncate text-[15px] font-semibold">{value}</p>
    </div>
  );
}

function PaymentStatus({ s, ym }: { s: State; ym: string }) {
  const t1 = terminTotals(s, ym, 1), t2 = terminTotals(s, ym, 2);
  const payable = t1.payable + t2.payable;
  const paid = t1.paidAmount + t2.paidAmount;
  const due = t1.remaining + t2.remaining;
  const pct = payable ? Math.min(100, Math.round((Math.min(paid, payable) / payable) * 100)) : 0;
  const row = (t: number, tt: typeof t1) => {
    const empty = tt.share === 0 && !tt.paid;
    return (
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">Payout {t}</span>
        {empty ? <StatusBadge tone="neutral">Kosong</StatusBadge>
          : tt.settled ? <StatusBadge tone="paid">Lunas</StatusBadge>
          : tt.paid ? <StatusBadge tone="partial">Kurang {fmtRp(tt.remaining)}</StatusBadge>
          : <StatusBadge tone="due">{fmtRp(tt.remaining)}</StatusBadge>}
      </div>
    );
  };
  return (
    <div className="flex flex-col rounded-2xl border bg-card p-5 shadow-xs">
      <p className="text-sm font-medium text-muted-foreground">Pembayaran ke {s.settings.partnerName}</p>
      <p className="tnum mt-2 text-2xl font-semibold tracking-tight">{fmtRp(paid)}<span className="text-base font-normal text-muted-foreground"> / {fmtRp(payable)}</span></p>
      <Progress value={pct} className="mt-3 h-2" />
      <p className="mt-2 text-xs text-muted-foreground">
        {payable === 0 ? "Belum ada tagihan bulan ini" : due > 0 ? <>Belum dibayar <b className="tnum font-semibold text-warning-ink">{fmtRp(due)}</b></> : "Semua payout bulan ini lunas"}
      </p>
      <div className="mt-auto space-y-2.5 border-t pt-4">
        {row(1, t1)}
        {row(2, t2)}
      </div>
    </div>
  );
}

function PayoutCard({ s, ym, t, onPay, onProofs }: {
  s: State; ym: string; t: Termin; onPay: (msg: string) => void; onProofs: () => void;
}) {
  const tt = terminTotals(s, ym, t);
  const key = terminKey(ym, t);
  const payout = s.payouts[key];
  const period = terminPeriod(s, ym, t);
  const empty = tt.profit === 0;
  const covered = !empty && !tt.paid && tt.share > 0 && tt.payable === 0; // share habis untuk subsidi
  const partial = tt.paid && tt.remaining > 0;
  const progress = tt.payable ? Math.min(100, Math.round((Math.min(tt.paidAmount, tt.payable) / tt.payable) * 100)) : tt.settled ? 100 : 0;

  const pay = () => onPay(tt.paid
    ? `Sisa Payout ${t} bulan ${monthLabel(ym)} sebesar ${fmtRp(tt.remaining)} (total menjadi ${fmtRp(tt.payable)}).`
    : `Payout ${t} bulan ${monthLabel(ym)} sebesar ${fmtRp(tt.payable)}.`);

  const label = partial ? "Sisa perlu ditransfer" : tt.paid ? "Sudah ditransfer" : covered ? "Tertutup subsidi silang" : empty ? "Belum ada invoice" : "Perlu ditransfer";
  const amount = partial ? tt.remaining : tt.paid ? tt.paidAmount : tt.payable;

  return (
    <article className={cn("flex flex-col rounded-2xl border bg-card shadow-xs", tt.remaining > 0 && "ring-1 ring-warning/30")}>
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div>
          <h3 className="text-[15px] font-semibold tracking-tight">Payout {t}</h3>
          <p className="text-xs text-muted-foreground">Tanggal {period}</p>
        </div>
        {empty && !tt.paid ? <StatusBadge tone="neutral">Kosong</StatusBadge>
          : tt.settled ? <StatusBadge tone="paid">Lunas</StatusBadge>
          : partial ? <StatusBadge tone="partial">Kurang bayar</StatusBadge>
          : <StatusBadge tone="due">Belum dibayar</StatusBadge>}
      </div>

      <div className="px-5 pt-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn("tnum mt-0.5 text-3xl font-semibold tracking-tight", empty && !tt.paid && "text-muted-foreground/60")}>
          {empty && !tt.paid ? "—" : fmtRp(amount)}
        </p>
        {tt.payable > 0 && <Progress value={progress} className="mt-3 h-1.5" />}
      </div>

      <dl className="mx-5 mt-4 space-y-2 border-t pt-4 text-sm">
        <Row label={`Margin kotor (Tgl ${dashPeriod(period)})`} value={fmtRp(tt.profit)} />
        <Row label={`Share partner (${pctLabel(s, terminEntries(s, ym, t))})`} value={fmtRp(tt.share)} />
        {tt.subsidy > 0 && <Row label="Subsidi silang" value={"−" + fmtRp(tt.subsidy)} valueClass="text-warning-ink" />}
        <Row label="Profit bersih kamu" value={fmtRp(tt.profit - tt.share)} strong />
      </dl>

      <div className="mt-auto space-y-3 p-5">
        {tt.paid && (
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <CircleCheck className="size-3.5 text-success" />
            Dibayar {fmtRp(tt.paidAmount)} · {fmtDate(tt.paidAt!)}
            {tt.overpaid > 0 && <span className="text-warning-ink">· lebih bayar {fmtRp(tt.overpaid)}</span>}
          </p>
        )}
        {covered && <p className="text-xs text-muted-foreground">Share tertutup subsidi silang — tidak ada yang perlu ditransfer.</p>}
        <div className="flex flex-wrap gap-2">
          {!tt.paid && !empty && !covered && <Button size="lg" className="flex-1" onClick={pay}><Receipt /> Tandai sudah dibayar</Button>}
          {partial && <Button size="lg" className="flex-1" onClick={pay}><Receipt /> Tandai sisa dibayar</Button>}
          {tt.paid && tt.proofCount > 0 && (
            <Button variant="outline" size="lg" className="flex-1" onClick={onProofs}><FileText /> Bukti{tt.proofCount > 1 ? ` (${tt.proofCount})` : ""}</Button>
          )}
          {payout?.share && (
            <Button asChild variant="outline" size="lg" className="flex-1">
              <a href={waUrl(key)} target="_blank" rel="noopener"><MessageCircle /> Kirim WA</a>
            </Button>
          )}
          {tt.paid && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon-lg" aria-label="Opsi lain"><MoreHorizontal /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem variant="destructive" onSelect={() => unmarkPaid(ym, t)}><Undo2 /> Batalkan tanda bayar</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </article>
  );
}

function Row({ label, value, strong, valueClass }: { label: string; value: string; strong?: boolean; valueClass?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("tnum font-medium", strong && "font-semibold", valueClass)}>{value}</dd>
    </div>
  );
}

function Invoices({ s, ym, onAdd, className }: { s: State; ym: string; onAdd: () => void; className?: string }) {
  const entries = monthEntries(s, ym);
  const total = entries.reduce((sum, e) => sum + e.amount, 0);
  return (
    <Section className={className}
      title={<span className="flex items-center gap-2">Invoice bulan ini <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{entries.length} Invoice</span></span>}
      action={<Button variant="ghost" size="sm" onClick={onAdd}><Plus /> Tambah</Button>}>
      {entries.length === 0 ? (
        <EmptyState icon={<Receipt />} title="Belum ada invoice tercatat bulan ini">Tambahkan invoice untuk menghitung share partner otomatis.</EmptyState>
      ) : (
        <>
          <ul className="divide-y border-t">
            {entries.map((e) => {
              const [y, m, d] = e.date.split("-").map(Number);
              return (
                <li key={e.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="grid w-11 shrink-0 place-items-center rounded-lg bg-muted py-1.5 leading-none">
                    <span className="tnum text-base font-semibold">{d}</span>
                    <span className="mt-0.5 text-[10px] text-muted-foreground uppercase">{new Date(y, m - 1, d).toLocaleDateString("id-ID", { month: "short" })}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="tnum text-[15px] font-semibold">{fmtRp(e.amount)}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {e.note || "Tanpa catatan"} · Share {fmtPct(e.sharePct)} = {fmtRp(entryShare(e))}
                    </p>
                  </div>
                  <span className="hidden shrink-0 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground sm:inline">Payout {terminOf(s, e.date)}</span>
                  <Button variant="ghost" size="icon" aria-label="Hapus invoice" className="text-muted-foreground hover:text-destructive"
                    onClick={() => deleteEntry(e.id)}><Trash2 /></Button>
                </li>
              );
            })}
          </ul>
          <div className="flex justify-between border-t px-5 py-3 text-sm">
            <span className="text-muted-foreground">Total margin kotor</span>
            <span className="tnum font-semibold">{fmtRp(total)}</span>
          </div>
        </>
      )}
    </Section>
  );
}

function Subsidies({ s, ym, onAdd }: { s: State; ym: string; onAdd: () => void }) {
  const list = s.subsidies.filter((x) => x.ym === ym).sort((a, b) => a.termin - b.termin);
  const total = list.reduce((sum, x) => sum + x.amount, 0);
  return (
    <Section title="Subsidi silang" action={<Button variant="ghost" size="sm" onClick={onAdd}><Plus /> Tambah</Button>}>
      {list.length === 0 ? (
        <EmptyState icon={<HandCoins />} title="Tidak ada subsidi silang">Potongan dari share partner untuk keperluan bersama.</EmptyState>
      ) : (
        <>
          <ul className="divide-y border-t">
            {list.map((x) => (
              <li key={x.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="tnum text-sm font-semibold">−{fmtRp(x.amount)}</p>
                  <p className="truncate text-xs text-muted-foreground">{x.purpose} · Payout {x.termin}</p>
                </div>
                <Button variant="ghost" size="icon" aria-label="Hapus subsidi silang" className="text-muted-foreground hover:text-destructive"
                  onClick={() => deleteSubsidy(x.id)}><Trash2 /></Button>
              </li>
            ))}
          </ul>
          <div className="flex justify-between border-t px-5 py-3 text-sm">
            <span className="text-muted-foreground">Total bulan ini</span>
            <span className="tnum font-semibold">−{fmtRp(total)}</span>
          </div>
        </>
      )}
    </Section>
  );
}

function PayoutHistory({ s, onProofs }: { s: State; onProofs: (key: string) => void }) {
  const paid = Object.entries(s.payouts)
    .map(([key, p]) => ({ key, ym: key.slice(0, 7), t: Number(key.slice(8)), ...p, amount: p.amount ?? 0 }))
    .sort((a, b) => (a.ym < b.ym ? 1 : a.ym > b.ym ? -1 : b.t - a.t));
  const total = paid.reduce((sum, p) => sum + p.amount, 0);
  return (
    <Section title="Riwayat payout" action={paid.length ? <span className="tnum text-xs font-medium text-muted-foreground">{fmtRp(total)} total</span> : undefined}>
      {paid.length === 0 ? (
        <EmptyState icon={<History />} title="Belum ada riwayat pembayaran" />
      ) : (
        <ul className="max-h-96 divide-y overflow-y-auto border-t">
          {paid.map((p) => (
            <li key={p.key} className="flex items-center gap-3 px-5 py-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-success/12 text-success-ink"><CircleCheck className="size-4" /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">Payout {p.t} — <span className="capitalize">{monthLabel(p.ym)}</span></p>
                <p className="truncate text-xs text-muted-foreground">
                  Untuk {s.settings.partnerName} · {fmtDate(p.paidAt)}
                  {p.proofs.length > 0 && <> · <button className="font-medium text-primary hover:underline" onClick={() => onProofs(p.key)}>bukti{p.proofs.length > 1 ? ` (${p.proofs.length})` : ""}</button></>}
                </p>
              </div>
              <span className="tnum shrink-0 text-sm font-semibold">{fmtRp(p.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

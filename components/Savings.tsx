"use client";

// Money Savings: dana subsidi silang terkumpul di sini, penggunaannya dicatat sebagai dana keluar.

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, Minus, PiggyBank, Trash2 } from "lucide-react";
import { deleteSavingsUse, setViewMonth } from "@/lib/store";
import {
  fmtCompact, fmtDate, fmtRp, monthLabel, monthsInRange, savingsBalance, savingsLedger, savingsMonth, savingsRange,
  shiftMonth, shortMonth, State, today, type SavingsMonth, type SavingsTx,
} from "@/lib/model";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, Section, useStore } from "./common";
import { AnimatePresence, ease, listItem, Money, motion, Rise, Stagger } from "./motion";

export default function Savings({ onUse }: { onUse: () => void }) {
  const s = useStore();
  const [mode, setMode] = useState<"month" | "all">("month");
  const st = s.state;
  const balance = savingsBalance(st);
  const totalIn = st.subsidies.reduce((sum, x) => sum + x.amount, 0);
  const totalOut = st.savingsUses.reduce((sum, x) => sum + x.amount, 0);

  return (
    <Stagger className="space-y-5">
      <Rise>
        <div className="relative overflow-hidden rounded-2xl bg-[linear-gradient(135deg,oklch(0.52_0.12_175),oklch(0.42_0.1_200))] p-6 text-white shadow-sm">
          <motion.div aria-hidden className="pointer-events-none absolute -top-24 -right-10 size-72 rounded-full bg-white/10 blur-3xl"
            animate={{ x: [0, -20, 0], y: [0, 16, 0] }} transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }} />
          <div className="relative flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 text-sm text-white/80"><PiggyBank className="size-4" /> Saldo Money Savings</p>
              <Money value={balance} className={cn("tnum mt-2 block text-4xl font-semibold tracking-tight sm:text-5xl", balance < 0 && "text-red-200")} />
              <p className="mt-1 text-sm text-white/75">Terkumpul dari subsidi silang · dipotong dari share partner</p>
            </div>
            <Button size="lg" onClick={onUse} disabled={balance <= 0}
              className="h-10 bg-white text-[oklch(0.35_0.08_190)] hover:bg-white/90"><Minus /> Catat penggunaan</Button>
          </div>
          <div className="relative mt-6 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-white/12 px-3.5 py-3 ring-1 ring-white/15">
              <p className="flex items-center gap-1.5 text-xs text-white/75"><ArrowDownLeft className="size-3.5" /> Total masuk</p>
              <Money value={totalIn} className="tnum mt-0.5 block text-[15px] font-semibold" />
            </div>
            <div className="rounded-xl bg-white/12 px-3.5 py-3 ring-1 ring-white/15">
              <p className="flex items-center gap-1.5 text-xs text-white/75"><ArrowUpRight className="size-3.5" /> Total dipakai</p>
              <Money value={totalOut} className="tnum mt-0.5 block text-[15px] font-semibold" />
            </div>
          </div>
        </div>
      </Rise>

      <Rise>
        <ToggleGroup type="single" variant="outline" value={mode} onValueChange={(v) => v && setMode(v as "month" | "all")}>
          <ToggleGroupItem value="month" className="h-9 px-4">Bulanan</ToggleGroupItem>
          <ToggleGroupItem value="all" className="h-9 px-4">Semua</ToggleGroupItem>
        </ToggleGroup>
      </Rise>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={mode} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25, ease }}>
          {mode === "month" ? <MonthView s={st} ym={s.viewMonth} /> : <AllView s={st} />}
        </motion.div>
      </AnimatePresence>
    </Stagger>
  );
}

// ---------- Per bulan ----------

function MonthView({ s, ym }: { s: State; ym: string }) {
  const m = savingsMonth(s, ym);
  const txs = savingsLedger(s).filter((t) => t.ym === ym);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 self-start rounded-xl border bg-card p-1 shadow-xs sm:w-fit">
        <Button variant="ghost" size="icon-lg" aria-label="Bulan sebelumnya" onClick={() => setViewMonth(shiftMonth(ym, -1))}><ChevronLeft /></Button>
        <h2 className="flex-1 text-center text-[15px] font-semibold tracking-tight capitalize sm:min-w-36">{monthLabel(ym)}</h2>
        <Button variant="ghost" size="icon-lg" aria-label="Bulan berikutnya" onClick={() => setViewMonth(shiftMonth(ym, 1))}><ChevronRight /></Button>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Saldo awal bulan" value={m.start} />
        <Stat label="Masuk" value={m.in} tone="in" />
        <Stat label="Dipakai" value={m.out} tone="out" />
        <Stat label="Saldo akhir bulan" value={m.end} strong />
      </div>
      <Ledger txs={txs} empty={`Tidak ada transaksi di ${monthLabel(ym)}`} />
    </div>
  );
}

// ---------- Semua (seperti Analitik) ----------

function AllView({ s }: { s: State }) {
  const bounds = savingsRange(s);
  const cur = today().slice(0, 7);
  // Grafik dimulai dari bulan transaksi pertama — bulan sebelumnya tidak punya arti untuk saldo.
  const first = bounds ? bounds[0] : cur;
  const last = bounds && bounds[1] > cur ? bounds[1] : cur;
  const earliest = first;
  const clampFirst = (ym: string) => (ym < first ? first : ym);
  const presets: Record<string, [string, string]> = {
    "6": [clampFirst(shiftMonth(last, -5)), last],
    "12": [clampFirst(shiftMonth(last, -11)), last],
    all: [first, last],
  };
  const [range, setRange] = useState<[string, string] | null>(null);
  let [from, to] = range ?? presets.all;
  if (from < earliest) from = earliest;
  if (to > last) to = last;
  if (from > to) from = to;
  const opts = monthsInRange(earliest, last).reverse();
  const months = monthsInRange(from, to).map((ym) => savingsMonth(s, ym));
  const active = Object.entries(presets).find(([, [f, t]]) => f === from && t === to)?.[0] ?? "";
  const withTx = months.filter((m) => m.in || m.out);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2">
          <MonthSelect value={from} options={opts} label="Dari" onChange={(f) => setRange([f, f > to ? f : to])} />
          <span className="text-muted-foreground">–</span>
          <MonthSelect value={to} options={opts} label="Sampai" onChange={(t) => setRange([t < from ? t : from, t])} />
        </div>
        <ToggleGroup type="single" variant="outline" value={active} onValueChange={(p) => p && setRange(presets[p])}>
          <ToggleGroupItem value="6" className="h-9 px-3">6 bln</ToggleGroupItem>
          <ToggleGroupItem value="12" className="h-9 px-3">12 bln</ToggleGroupItem>
          <ToggleGroupItem value="all" className="h-9 px-3">Semua</ToggleGroupItem>
        </ToggleGroup>
      </div>

      <Section title={<>Arus dana <span className="font-normal text-muted-foreground">· {shortMonth(from)} – {shortMonth(to)}</span></>}
        action={
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-s-net" /> Masuk</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-s-share" /> Dipakai</span>
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded bg-s-margin" /> Saldo</span>
          </div>
        }>
        <div className="px-3 pb-4 sm:px-5">
          {withTx.length ? <FlowChart months={months} /> : (
            <EmptyState icon={<PiggyBank />} title="Belum ada transaksi di rentang ini">Dana masuk otomatis dari subsidi silang.</EmptyState>
          )}
        </div>
      </Section>

      {withTx.length > 0 && (
        <Section title="Per bulan">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Bulan</TableHead>
                <TableHead className="text-right">Masuk</TableHead>
                <TableHead className="text-right">Dipakai</TableHead>
                <TableHead className="pr-5 text-right">Saldo akhir</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...withTx].reverse().map((m) => (
                <TableRow key={m.ym}>
                  <TableCell className="pl-5">{shortMonth(m.ym)}</TableCell>
                  <TableCell className="tnum text-right text-success-ink">{m.in ? "+" + fmtRp(m.in) : "—"}</TableCell>
                  <TableCell className="tnum text-right">{m.out ? "−" + fmtRp(m.out) : "—"}</TableCell>
                  <TableCell className="tnum pr-5 text-right font-semibold">{fmtRp(m.end)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}

      <Ledger txs={savingsLedger(s)} empty="Belum ada transaksi Money Savings" title="Semua transaksi" />
    </div>
  );
}

function MonthSelect({ value, options, onChange, label }: { value: string; options: string[]; onChange: (v: string) => void; label: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-32" aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>{options.map((ym) => <SelectItem key={ym} value={ym}>{shortMonth(ym)}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function Stat({ label, value, tone, strong }: { label: string; value: number; tone?: "in" | "out"; strong?: boolean }) {
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-xs">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {tone === "in" && <ArrowDownLeft className="size-3.5 text-success" />}
        {tone === "out" && <ArrowUpRight className="size-3.5 text-s-share" />}
        {label}
      </p>
      <Money value={value} prefix={tone === "in" && value ? "+" : tone === "out" && value ? "−" : ""}
        className={cn("tnum mt-1.5 block truncate text-lg tracking-tight", strong ? "font-semibold" : "font-medium", tone === "in" && value > 0 && "text-success-ink")} />
    </div>
  );
}

function Ledger({ txs, empty, title = "Transaksi" }: { txs: SavingsTx[]; empty: string; title?: string }) {
  return (
    <Section title={<span className="flex items-center gap-2">{title} <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{txs.length}</span></span>}>
      {txs.length === 0 ? <EmptyState icon={<PiggyBank />} title={empty} /> : (
        <ul className="max-h-[32rem] overflow-y-auto border-t">
          <AnimatePresence initial={false}>
            {txs.map((t) => (
              <motion.li key={t.kind + t.id} {...listItem} className="overflow-hidden border-b last:border-b-0">
                <div className="flex items-center gap-3 px-5 py-3">
                  <span className={cn("grid size-9 shrink-0 place-items-center rounded-full",
                    t.kind === "in" ? "bg-success/12 text-success-ink" : "bg-s-share/12 text-s-share")}>
                    {t.kind === "in" ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.purpose || (t.kind === "in" ? "Subsidi silang" : "Penggunaan")}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {t.kind === "in" ? <>Subsidi silang · Payout {t.termin} <span className="capitalize">{monthLabel(t.ym)}</span></> : <>Dipakai · {fmtDate(t.date)}</>}
                    </p>
                  </div>
                  <span className={cn("tnum shrink-0 text-sm font-semibold", t.kind === "in" && "text-success-ink")}>
                    {t.kind === "in" ? "+" : "−"}{fmtRp(t.amount)}
                  </span>
                  {t.kind === "out" ? (
                    <Button variant="ghost" size="icon" aria-label="Hapus penggunaan" className="text-muted-foreground hover:text-destructive"
                      onClick={() => deleteSavingsUse(t.id)}><Trash2 /></Button>
                  ) : <span className="w-8 shrink-0" />}
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </Section>
  );
}

// ---------- Grafik arus dana: kolom masuk/dipakai + garis saldo (satu sumbu Rupiah) ----------

function niceScale(max: number) {
  if (max <= 0) return { top: 1, step: 0.25 };
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((x) => x >= raw)!;
  return { top: Math.ceil(max / step) * step, step };
}

function FlowChart({ months }: { months: SavingsMonth[] }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => setW(Math.max(280, el.clientWidth || 600));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const g = useMemo(() => {
    const H = W < 480 ? 220 : 260;
    const min = Math.min(0, ...months.map((m) => m.end));
    const max = Math.max(1, ...months.flatMap((m) => [m.in, m.out, m.end]));
    const { top, step } = niceScale((max - min) * 1.12); // sedikit ruang di atas batang tertinggi
    const bottom = min < 0 ? -Math.ceil(-min / step) * step : 0;
    const ticks: number[] = [];
    for (let v = bottom; v <= top + step / 2; v += step) ticks.push(v);
    const padL = Math.max(...ticks.map((v) => fmtCompact(v).length)) * 6.6 + 14, padR = 10, padT = 12, padB = 28;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const n = months.length;
    const band = plotW / n;
    const cx = (i: number) => padL + band * (i + 0.5);
    const y = (v: number) => padT + plotH - ((v - bottom) / (top - bottom)) * plotH;
    const barW = Math.min(22, Math.max(4, band / 2 - 4));
    return { H, ticks, padL, padR, padT, plotW, plotH, n, band, cx, y, barW };
  }, [months, W]);

  const { H, ticks, padL, padR, n, band, cx, y, barW } = g;
  const every = Math.max(1, Math.ceil(n / Math.floor(g.plotW / 44)));
  const linePts = months.map((m, i) => `${cx(i)},${y(m.end)}`).join(" ");
  const areaPath = n > 1 ? `M${cx(0)},${y(0)} L${months.map((m, i) => `${cx(i)},${y(m.end)}`).join(" L")} L${cx(n - 1)},${y(0)} Z` : "";
  const bar = (x: number, v: number, color: string, key: string, delay: number) => {
    const h = Math.max(0, y(0) - y(v));
    return (
      <motion.rect key={key} x={x} width={barW} rx={Math.min(4, barW / 2)} fill={color}
        initial={{ height: 0, y: y(0) }} animate={{ height: h, y: y(0) - h }} transition={{ duration: 0.6, ease, delay }} />
    );
  };
  const d = hover !== null ? months[hover] : null;

  return (
    <div ref={boxRef} className="relative select-none" onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ height: H }} className="block w-full overflow-visible" role="img"
        aria-label="Grafik dana masuk, dipakai, dan saldo Money Savings per bulan"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - r.left) / r.width) * W;
          setHover(Math.max(0, Math.min(n - 1, Math.floor((x - padL) / band))));
        }}>
        {ticks.map((v) => {
          const yy = Math.round(y(v)) + 0.5;
          return (
            <g key={v}>
              <line x1={padL} x2={W - padR} y1={yy} y2={yy} stroke={v === 0 ? "var(--chart-axis)" : "var(--chart-grid)"} />
              <text x={padL - 8} y={yy + 3.5} textAnchor="end" className="tnum fill-muted-foreground text-[11px]">{v === 0 ? "0" : fmtCompact(v)}</text>
            </g>
          );
        })}
        {hover !== null && <rect x={padL + band * hover} y={g.padT} width={band} height={g.plotH} className="fill-muted/60" rx={6} />}
        <defs>
          <linearGradient id="saveGrad" x1={0} y1={0} x2={0} y2={1}>
            <stop offset="0%" stopColor="var(--s-margin)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--s-margin)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {/* saldo: area lembut + garis di belakang batang */}
        {areaPath && <motion.path key={areaPath} d={areaPath} fill="url(#saveGrad)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.2 }} />}
        {n > 1 && (
          <motion.polyline key={linePts} points={linePts} fill="none" stroke="var(--s-margin)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease }} />
        )}
        {months.map((m, i) => (
          <g key={m.ym}>
            {m.in > 0 && bar(cx(i) - barW - 1, m.in, "var(--s-net)", "in", i * 0.03)}
            {m.out > 0 && bar(cx(i) + 1, m.out, "var(--s-share)", "out", i * 0.03 + 0.05)}
            {(n - 1 - i) % every === 0 && (
              <text x={cx(i)} y={H - 9} textAnchor="middle" className="fill-muted-foreground text-[11px]">{shortMonth(m.ym, false)}</text>
            )}
          </g>
        ))}
        {months.map((m, i) => (
          <circle key={m.ym} cx={cx(i)} cy={y(m.end)} r={hover === i ? 5.5 : n > 12 && i !== n - 1 ? 0 : 4} fill="var(--s-margin)" stroke="var(--card)" strokeWidth={2} />
        ))}
      </svg>
      {d && hover !== null && (
        <div className="pointer-events-none absolute top-1 z-10 min-w-48 rounded-xl border bg-popover p-3 text-[13px] shadow-lg"
          style={{ left: Math.min(Math.max(0, cx(hover) + 12), W - 200) }}>
          <p className="mb-1.5 font-semibold capitalize">{monthLabel(d.ym)}</p>
          <p className="flex justify-between gap-3 text-muted-foreground"><span>Masuk</span><b className="tnum font-semibold text-foreground">{fmtRp(d.in)}</b></p>
          <p className="flex justify-between gap-3 text-muted-foreground"><span>Dipakai</span><b className="tnum font-semibold text-foreground">{fmtRp(d.out)}</b></p>
          <p className="mt-1.5 flex justify-between gap-3 border-t pt-1.5 text-muted-foreground"><span>Saldo akhir</span><b className="tnum font-semibold text-foreground">{fmtRp(d.end)}</b></p>
        </div>
      )}
    </div>
  );
}

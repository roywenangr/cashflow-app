"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import {
  computeMonth, fmtCompact, fmtRp, monthLabel, monthsInRange, shiftMonth, shortMonth, State, today, type MonthSummary,
} from "@/lib/model";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, Section, StatusBadge, useStore } from "./common";
import { ease, Money, motion, Rise, Stagger } from "./motion";
import { ChartLine } from "lucide-react";

type SeriesKey = "margin" | "share" | "net";
const SERIES: { key: SeriesKey; label: string }[] = [
  { key: "margin", label: "Margin kotor" },
  { key: "share", label: "Share partner" },
  { key: "net", label: "Profit bersih" },
];

// Batas pilihan bulan: dari bulan data pertama (minimal 11 bulan lalu) s/d bulan data terakhir / bulan ini.
function rangeBounds(s: State) {
  const cur = today().slice(0, 7);
  let first: string | null = null, last = cur;
  for (const e of s.entries) {
    const ym = e.date.slice(0, 7);
    if (!first || ym < first) first = ym;
    if (ym > last) last = ym;
  }
  const min12 = shiftMonth(last, -11);
  return { first: first || min12, earliest: first && first < min12 ? first : min12, latest: last };
}

function presetRange(s: State, preset: string): [string, string] {
  const b = rangeBounds(s);
  const year = today().slice(0, 4);
  if (preset === "6") return [shiftMonth(b.latest, -5), b.latest];
  if (preset === "12") return [shiftMonth(b.latest, -11), b.latest];
  if (preset === "year") return [`${year}-01`, `${year}-12` < b.latest ? `${year}-12` : b.latest];
  return [b.first < b.latest ? b.first : b.latest, b.latest]; // "all"
}

// Skala sumbu Y yang "bulat": kelipatan 1 / 2 / 2,5 / 5 × 10^k, sekitar 4 garis.
function niceScale(max: number) {
  if (max <= 0) return { top: 1, step: 0.25 };
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((x) => x >= raw)!;
  return { top: Math.ceil(max / step) * step, step };
}

// Kurva halus yang tidak "melampaui" titik data (monotone cubic / Fritsch–Carlson).
function monotonePath(pts: [number, number][]) {
  if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`;
  const n = pts.length;
  const dx: number[] = [], m: number[] = [], t: number[] = new Array(n);
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

export default function Analytics({ onOpenMonth }: { onOpenMonth: (ym: string) => void }) {
  const s = useStore();
  const [range, setRange] = useState<[string, string] | null>(null);
  const [show, setShow] = useState<SeriesKey[]>(["margin", "share", "net"]);

  const b = rangeBounds(s.state);
  let [from, to] = range ?? presetRange(s.state, "12");
  // jepit ke batas pilihan (mis. setelah data dihapus)
  if (from < b.earliest) from = b.earliest;
  if (to > b.latest) to = b.latest;
  if (from > to) from = to;
  const opts = monthsInRange(b.earliest, b.latest).reverse(); // terbaru di atas
  const yms = monthsInRange(from, to);
  const data = yms.map((ym) => computeMonth(s.state, ym));
  const withData = data.filter((d) => d.margin > 0);
  const totals = data.reduce((a, d) => ({ margin: a.margin + d.margin, share: a.share + d.share, due: a.due + d.due }), { margin: 0, share: 0, due: 0 });
  const activePreset = ["6", "12", "year", "all"].find((p) => { const [pf, pt] = presetRange(s.state, p); return pf === from && pt === to; }) ?? "";

  return (
    <Stagger className="space-y-5">
      <Rise className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Rentang</p>
          <div className="flex items-center gap-2">
            <MonthSelect value={from} options={opts} onChange={(f) => setRange([f, f > to ? f : to])} label="Dari" />
            <span className="text-muted-foreground">–</span>
            <MonthSelect value={to} options={opts} onChange={(t) => setRange([t < from ? t : from, t])} label="Sampai" />
          </div>
        </div>
        <ToggleGroup type="single" variant="outline" value={activePreset} onValueChange={(p) => p && setRange(presetRange(s.state, p))}>
          <ToggleGroupItem value="6" className="h-9 px-3">6 bln</ToggleGroupItem>
          <ToggleGroupItem value="12" className="h-9 px-3">12 bln</ToggleGroupItem>
          <ToggleGroupItem value="year" className="h-9 px-3">Tahun ini</ToggleGroupItem>
          <ToggleGroupItem value="all" className="h-9 px-3">Semua</ToggleGroupItem>
        </ToggleGroup>
      </Rise>

      <Rise className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat dot="bg-s-margin" label="Total margin kotor" value={totals.margin} />
        <Stat dot="bg-s-share" label="Total share partner" value={totals.share} />
        <Stat dot="bg-s-net" label="Total profit bersih" value={totals.margin - totals.share} />
        <Stat dot="bg-warning" label="Belum dibayar" value={totals.due} />
      </Rise>

      <Rise>
      <Section title={<>Bulanan <span className="font-normal text-muted-foreground">· {shortMonth(from)} – {shortMonth(to)} ({yms.length} bulan)</span></>}
        action={
          <ToggleGroup type="multiple" variant="outline" size="sm" value={show}
            onValueChange={(v: string[]) => v.length && setShow(v as SeriesKey[])} aria-label="Tampilkan garis">
            {SERIES.map((x) => (
              <ToggleGroupItem key={x.key} value={x.key} className="gap-1.5 px-2.5 text-xs data-[state=off]:opacity-50">
                <span className={cn("size-2.5 rounded-[3px]", `bg-s-${x.key}`)} /> <span className="hidden sm:inline">{x.label}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        }>
        <div className="px-3 pb-4 sm:px-5">
          {withData.length ? (
            <LineChart data={data} from={from} to={to} show={show} onOpen={onOpenMonth} />
          ) : (
            <EmptyState icon={<ChartLine />} title={s.state.entries.length ? "Tidak ada data di rentang ini" : "Belum ada data"}>
              {s.state.entries.length ? "Pilih rentang lain." : "Tambahkan invoice dulu."}
            </EmptyState>
          )}
          <p className="mt-2 text-center text-xs text-muted-foreground sm:hidden">Ketuk grafik untuk detail bulan</p>
        </div>
      </Section>
      </Rise>

      {withData.length > 0 && (
        <Rise>
        <Section title="Per bulan">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Bulan</TableHead>
                <TableHead className="text-right">Margin kotor</TableHead>
                <TableHead className="text-right">Share</TableHead>
                <TableHead className="text-right">Profit bersih</TableHead>
                <TableHead className="pr-5 text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...withData].reverse().map((d) => (
                <TableRow key={d.ym} className="cursor-pointer" onClick={() => onOpenMonth(d.ym)}>
                  <TableCell className={cn("pl-5", d.ym === today().slice(0, 7) && "font-semibold")}>{shortMonth(d.ym)}</TableCell>
                  <TableCell className="tnum text-right">{fmtRp(d.margin)}</TableCell>
                  <TableCell className="tnum text-right">{fmtRp(d.share)}</TableCell>
                  <TableCell className="tnum text-right font-medium">{fmtRp(d.net)}</TableCell>
                  <TableCell className="pr-5 text-right">
                    {d.paidCount === 2 ? <StatusBadge tone="paid">Lunas</StatusBadge>
                      : d.paidCount === 0 ? <StatusBadge tone="due">Belum</StatusBadge>
                      : <StatusBadge tone="partial">1/2 lunas</StatusBadge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
        </Rise>
      )}
    </Stagger>
  );
}

function MonthSelect({ value, options, onChange, label }: { value: string; options: string[]; onChange: (v: string) => void; label: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-32" aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>
        {options.map((ym) => <SelectItem key={ym} value={ym}>{shortMonth(ym)}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function Stat({ dot, label, value }: { dot: string; label: string; value: number }) {
  return (
    <motion.div whileHover={{ y: -2 }} className="rounded-2xl border bg-card p-4 shadow-xs transition-shadow hover:shadow-md">
      <p className="flex items-center gap-2 text-xs text-muted-foreground"><span className={cn("size-2 rounded-full", dot)} />{label}</p>
      <Money value={value} className="tnum mt-1.5 block truncate text-lg font-semibold tracking-tight" />
    </motion.div>
  );
}

function LineChart({ data, from, to, show, onOpen }: {
  data: MonthSummary[]; from: string; to: string; show: SeriesKey[]; onOpen: (ym: string) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  const [tipLeft, setTipLeft] = useState(0);
  const lastPointer = useRef("mouse");

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => setW(Math.max(280, el.clientWidth || 600));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geo = useMemo(() => {
    const H = W < 480 ? 240 : 300;
    const series = SERIES.filter((x) => show.includes(x.key));
    const max = Math.max(1, ...data.flatMap((d) => series.map((x) => d[x.key])));
    const { top: yTop, step } = niceScale(max);
    const ticks: number[] = [];
    for (let v = 0; v <= yTop + step / 2; v += step) ticks.push(v);
    const padL = Math.max(...ticks.map((v) => fmtCompact(v).length)) * 6.6 + 14;
    const padR = 12, padT = 14, padB = 30;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const n = data.length;
    const xs = data.map((_, i) => padL + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1)));
    const y = (v: number) => padT + plotH - (v / yTop) * plotH;
    return { H, series, ticks, padL, padR, padT, plotW, plotH, n, xs, y };
  }, [data, W, show]);

  // Tooltip di kanan titik, pindah ke kiri kalau mepet tepi.
  useLayoutEffect(() => {
    if (hover === null || !tipRef.current) return;
    const px = geo.xs[hover];
    const tw = tipRef.current.offsetWidth;
    setTipLeft(px + 14 + tw > W ? Math.max(0, px - 14 - tw) : px + 14);
  }, [hover, geo, W]);

  const { H, series, ticks, padL, padR, padT, plotW, plotH, n, xs, y } = geo;
  const nearest = (clientX: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    xs.forEach((px, i) => { if (Math.abs(px - x) < Math.abs(xs[best] - x)) best = i; });
    return best;
  };
  const multiYear = from.slice(0, 4) !== to.slice(0, 4);
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / (multiYear ? 52 : 40)))));
  const d = hover !== null ? data[hover] : null;

  return (
    <div ref={boxRef} className="relative touch-pan-y select-none" onPointerLeave={(e) => { if (e.pointerType === "mouse") setHover(null); }}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ height: H }} className="block w-full overflow-visible" role="img"
        aria-label="Grafik garis margin kotor, share partner, dan profit bersih per bulan"
        onPointerMove={(e) => setHover(nearest(e.clientX))}
        onPointerDown={(e) => { lastPointer.current = e.pointerType || "mouse"; setHover(nearest(e.clientX)); }}
        onClick={(e) => { if (lastPointer.current === "mouse") onOpen(data[nearest(e.clientX)].ym); }}>
        <defs>
          <linearGradient id="areaGrad" x1={0} y1={0} x2={0} y2={1}>
            <stop offset="0%" stopColor="var(--s-margin)" stopOpacity={0.2} />
            <stop offset="100%" stopColor="var(--s-margin)" stopOpacity={0} />
          </linearGradient>
        </defs>
        {ticks.map((v) => {
          const yy = Math.round(y(v)) + 0.5;
          return (
            <g key={v}>
              <line x1={padL} x2={W - padR} y1={yy} y2={yy} stroke={v === 0 ? "var(--chart-axis)" : "var(--chart-grid)"} />
              <text x={padL - 8} y={yy + 3.5} textAnchor="end" className="tnum fill-muted-foreground text-[11px]">{v === 0 ? "0" : fmtCompact(v)}</text>
            </g>
          );
        })}
        {data.map((m, i) => {
          if ((n - 1 - i) % every !== 0) return null; // bulan terakhir selalu tampil
          let label = shortMonth(m.ym, false);
          if (multiYear && (i === 0 || m.ym.endsWith("-01") || every > 1)) label += " " + m.ym.slice(2, 4);
          const anchor = n > 1 && i === 0 ? "start" : n > 1 && i === n - 1 ? "end" : "middle";
          return <text key={m.ym} x={xs[i]} y={H - 10} textAnchor={anchor} className="fill-muted-foreground text-[11px]">{label}</text>;
        })}
        {[...series].reverse().map((x) => {
          const pts = data.map((m, i) => [xs[i], y(m[x.key])] as [number, number]);
          const path = monotonePath(pts);
          return (
            <g key={x.key}>
              {x.key === "margin" && n > 1 && (
                <motion.path key={path} d={`${path} L${xs[n - 1]},${y(0)} L${xs[0]},${y(0)} Z`} fill="url(#areaGrad)"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.3 }} />
              )}
              <motion.path key={path} d={path} fill="none" stroke={`var(--s-${x.key})`} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
                initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, ease }} />
              {pts.map(([px, py], i) => (n > 12 && i !== n - 1) ? null : (
                <motion.circle key={`${i}-${px}-${py}`} cx={px} cy={py} r={4} fill={`var(--s-${x.key})`} stroke="var(--card)" strokeWidth={2}
                  initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.3 + i * 0.03, type: "spring", stiffness: 500, damping: 25 }} />
              ))}
            </g>
          );
        })}
        {d && hover !== null && (
          <g>
            <line x1={xs[hover]} x2={xs[hover]} y1={padT} y2={padT + plotH} stroke="var(--muted-foreground)" strokeOpacity={0.5} />
            {series.map((x) => (
              <circle key={x.key} cx={xs[hover]} cy={y(d[x.key])} r={5.5} fill={`var(--s-${x.key})`} stroke="var(--card)" strokeWidth={2.5} />
            ))}
          </g>
        )}
        <rect x={padL - 10} y={0} width={plotW + 20} height={H} fill="transparent" className="cursor-crosshair" />
      </svg>
      {d && (
        <motion.div ref={tipRef} style={{ left: tipLeft }} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.15 }}
          className="absolute top-1 z-10 min-w-52 rounded-xl border bg-popover p-3 text-[13px] shadow-lg">
          <p className="mb-2 font-semibold capitalize">{monthLabel(d.ym)}</p>
          {series.map((x) => (
            <p key={x.key} className="flex items-center gap-2 py-0.5 text-muted-foreground">
              <span className={cn("size-2.5 rounded-[3px]", `bg-s-${x.key}`)} />{x.label}
              <b className="tnum ml-auto pl-3 font-semibold text-foreground">{fmtRp(d[x.key])}</b>
            </p>
          ))}
          <p className="mt-2 border-t pt-2 text-xs text-muted-foreground">
            {d.margin === 0 ? "Tidak ada invoice"
              : d.paidCount === 2 ? "Lunas" : d.paidCount === 0 ? `Belum dibayar ${fmtRp(d.due)}` : `1/2 lunas · sisa ${fmtRp(d.due)}`}
          </p>
          <button type="button" onClick={() => onOpen(d.ym)} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            Buka bulan ini <ArrowUpRight className="size-3.5" />
          </button>
        </motion.div>
      )}
    </div>
  );
}

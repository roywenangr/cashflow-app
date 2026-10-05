"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { setViewMonth, toast } from "@/lib/store";
import {
  computeMonth, fmtCompact, fmtRp, monthLabel, monthsInRange, shiftMonth, shortMonth, State, today, type MonthSummary,
} from "@/lib/model";
import { Icon, useStore } from "./ui";

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

export default function ChartOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useStore();
  const [range, setRange] = useState<[string, string] | null>(null);
  const [show, setShow] = useState<Record<SeriesKey, boolean>>({ margin: true, share: true, net: true });

  // Tutup dengan Escape; kunci scroll halaman selama terbuka.
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = ""; document.removeEventListener("keydown", onKey); };
  }, [open, onClose]);

  if (!open) return null;

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

  const openMonth = (ym: string) => {
    setViewMonth(ym);
    onClose();
    toast(monthLabel(ym));
  };

  return (
    <section className="chart-overlay" aria-label="Grafik cashflow" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="chart-sheet">
        <header className="chart-sheet__head">
          <h3 className="chart-sheet__title">Grafik cashflow</h3>
          <div className="chart-sheet__actions">
            <button className="icon-btn" aria-label="Tutup grafik" onClick={onClose}><Icon.close /></button>
          </div>
        </header>

        <div className="range" role="group" aria-label="Rentang bulan">
          <div className="range__fields">
            <label className="range__field">
              <span>Dari</span>
              <select value={from} onChange={(e) => { const f = e.target.value; setRange([f, f > to ? f : to]); }}>
                {opts.map((ym) => <option key={ym} value={ym}>{shortMonth(ym)}</option>)}
              </select>
            </label>
            <span className="range__sep" aria-hidden="true">–</span>
            <label className="range__field">
              <span>Sampai</span>
              <select value={to} onChange={(e) => { const t = e.target.value; setRange([t < from ? t : from, t]); }}>
                {opts.map((ym) => <option key={ym} value={ym}>{shortMonth(ym)}</option>)}
              </select>
            </label>
          </div>
          <div className="range__presets">
            {[["6", "6 bln"], ["12", "12 bln"], ["year", "Tahun ini"], ["all", "Semua"]].map(([p, label]) => {
              const [pf, pt] = presetRange(s.state, p);
              return (
                <button key={p} type="button" className={"chip-btn" + (pf === from && pt === to ? " is-active" : "")}
                  onClick={() => setRange(presetRange(s.state, p))}>{label}</button>
              );
            })}
          </div>
        </div>

        <div className="chart-summary">
          <div className="chart-summary__item">
            <p className="chart-summary__label"><span className="tile__dot sdot--margin"></span>Total margin kotor</p>
            <p className="chart-summary__value">{fmtRp(totals.margin)}</p>
          </div>
          <div className="chart-summary__item">
            <p className="chart-summary__label"><span className="tile__dot sdot--share"></span>Total share partner</p>
            <p className="chart-summary__value">{fmtRp(totals.share)}</p>
          </div>
          <div className="chart-summary__item">
            <p className="chart-summary__label"><span className="tile__dot sdot--net"></span>Total profit bersih</p>
            <p className="chart-summary__value">{fmtRp(totals.margin - totals.share)}</p>
          </div>
          <div className="chart-summary__item">
            <p className="chart-summary__label"><span className="tile__dot tile__dot--warn"></span>Belum dibayar</p>
            <p className="chart-summary__value">{fmtRp(totals.due)}</p>
          </div>
        </div>

        <div className="chart-block">
          <div className="chart-block__head">
            <p className="chart-block__title">Bulanan · {shortMonth(from)} – {shortMonth(to)} ({yms.length} bulan)</p>
            <div className="legend" role="group" aria-label="Tampilkan garis">
              {SERIES.map((x) => (
                <button key={x.key} type="button" className="legend__item" aria-pressed={show[x.key]} onClick={() => {
                  if (show[x.key] && Object.values(show).filter(Boolean).length === 1) return; // minimal satu garis
                  setShow({ ...show, [x.key]: !show[x.key] });
                }}><span className={"legend__key sdot--" + x.key}></span>{x.label}</button>
              ))}
            </div>
          </div>
          <LineChart data={withData.length ? data : []} from={from} to={to} show={show} onOpen={openMonth}
            emptyMsg={s.state.entries.length ? "Tidak ada data di rentang ini." : "Belum ada data. Tambahkan invoice dulu."} />
          <p className="chart-block__note chart-block__hint">Arahkan / ketuk grafik untuk detail bulan.</p>
          <MonthTable rows={withData} onOpen={openMonth} />
        </div>
      </div>
    </section>
  );
}

function LineChart({ data, from, to, show, onOpen, emptyMsg }: {
  data: MonthSummary[]; from: string; to: string; show: Record<SeriesKey, boolean>;
  onOpen: (ym: string) => void; emptyMsg: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  const [tipLeft, setTipLeft] = useState(0);
  const lastPointer = useRef("mouse"); // Safari lama: event click belum punya pointerType

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
    if (!data.length) return null;
    const H = W < 480 ? 220 : 260;
    const series = SERIES.filter((x) => show[x.key]);
    const max = Math.max(1, ...data.flatMap((d) => series.map((x) => d[x.key])));
    const { top: yTop, step } = niceScale(max);
    const ticks: number[] = [];
    for (let v = 0; v <= yTop + step / 2; v += step) ticks.push(v);
    const padL = Math.max(...ticks.map((v) => fmtCompact(v).length)) * 6.6 + 14;
    const padR = 14, padT = 12, padB = 30;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const n = data.length;
    const xs = data.map((_, i) => padL + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1)));
    const y = (v: number) => padT + plotH - (v / yTop) * plotH;
    return { H, series, ticks, padL, padR, padT, plotW, plotH, n, xs, y };
  }, [data, W, show]);

  // Posisi tooltip: di kanan titik, pindah ke kiri kalau mepet tepi.
  useLayoutEffect(() => {
    if (hover === null || !geo || !tipRef.current) return;
    const px = geo.xs[hover];
    const tw = tipRef.current.offsetWidth;
    setTipLeft(px + 14 + tw > W ? Math.max(0, px - 14 - tw) : px + 14);
  }, [hover, geo, W]);

  if (!geo) {
    return (
      <div className="lchart" ref={boxRef}>
        <svg className="lchart__svg" viewBox="0 0 300 120" style={{ height: 120 }}>
          <text x={150} y={64} textAnchor="middle" className="lchart__empty">{emptyMsg}</text>
        </svg>
      </div>
    );
  }

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
    <div className="lchart" ref={boxRef} onPointerLeave={(e) => { if (e.pointerType === "mouse") setHover(null); }}>
      <svg ref={svgRef} className="lchart__svg" viewBox={`0 0 ${W} ${H}`} style={{ height: H }} role="img"
        aria-label="Grafik garis margin kotor, share partner, dan profit bersih per bulan"
        onPointerMove={(e) => setHover(nearest(e.clientX))}
        onPointerDown={(e) => { lastPointer.current = e.pointerType || "mouse"; setHover(nearest(e.clientX)); }}
        onClick={(e) => { if (lastPointer.current === "mouse") onOpen(data[nearest(e.clientX)].ym); }}>
        <defs>
          <linearGradient id="areaGrad" x1={0} y1={0} x2={0} y2={1}>
            <stop offset="0%" stopColor="var(--s-margin)" stopOpacity={0.18} />
            <stop offset="100%" stopColor="var(--s-margin)" stopOpacity={0} />
          </linearGradient>
        </defs>
        {/* grid + label sumbu Y */}
        {ticks.map((v) => {
          const yy = Math.round(y(v)) + 0.5;
          return (
            <g key={v}>
              <line x1={padL} x2={W - padR} y1={yy} y2={yy} className={v === 0 ? "lchart__base" : "lchart__grid"} />
              <text x={padL - 8} y={yy + 3.5} textAnchor="end" className="lchart__tick">{v === 0 ? "0" : fmtCompact(v)}</text>
            </g>
          );
        })}
        {/* label sumbu X — dijarangkan supaya tidak bertabrakan; bulan terakhir selalu tampil */}
        {data.map((m, i) => {
          if ((n - 1 - i) % every !== 0) return null;
          let label = shortMonth(m.ym, false);
          if (multiYear && (i === 0 || m.ym.endsWith("-01") || every > 1)) label += " " + m.ym.slice(2, 4);
          const anchor = n > 1 && i === 0 ? "start" : n > 1 && i === n - 1 ? "end" : "middle";
          return <text key={m.ym} x={xs[i]} y={H - 10} textAnchor={anchor} className="lchart__tick">{label}</text>;
        })}
        {/* area + garis (margin paling belakang) */}
        {[...series].reverse().map((x) => {
          const pts = data.map((m, i) => [xs[i], y(m[x.key])] as [number, number]);
          const path = monotonePath(pts);
          return (
            <g key={x.key}>
              {x.key === "margin" && n > 1 && (
                <path d={`${path} L${xs[n - 1]},${y(0)} L${xs[0]},${y(0)} Z`} fill="url(#areaGrad)" />
              )}
              <path d={path} className="lchart__line" stroke={`var(--s-${x.key})`} />
              {pts.map(([px, py], i) => (n > 12 && i !== n - 1) ? null : (
                <circle key={i} cx={px} cy={py} r={4} className="lchart__dot" fill={`var(--s-${x.key})`} />
              ))}
            </g>
          );
        })}
        {/* layer hover */}
        {d && hover !== null && (
          <g className="lchart__hover">
            <line x1={xs[hover]} x2={xs[hover]} y1={padT} y2={padT + plotH} className="lchart__cross" />
            {series.map((x) => (
              <circle key={x.key} cx={xs[hover]} cy={y(d[x.key])} r={5.5} className="lchart__dot lchart__dot--hl" fill={`var(--s-${x.key})`} />
            ))}
          </g>
        )}
        <rect x={padL - 10} y={0} width={plotW + 20} height={H} fill="transparent" className="lchart__hit" />
      </svg>
      {d && (
        <div className="lchart__tip" ref={tipRef} style={{ left: tipLeft }}>
          <p className="lchart__tip-title">{monthLabel(d.ym)}</p>
          {series.map((x) => (
            <p key={x.key} className="lchart__tip-row">
              <span className={"legend__key sdot--" + x.key}></span><span>{x.label}</span><b>{fmtRp(d[x.key])}</b>
            </p>
          ))}
          <p className="lchart__tip-status">
            {d.margin === 0 ? "Tidak ada invoice"
              : d.paidCount === 2 ? "Lunas" : d.paidCount === 0 ? `Belum dibayar ${fmtRp(d.due)}` : `1/2 lunas · sisa ${fmtRp(d.due)}`}
          </p>
          <button type="button" className="link-btn lchart__tip-open" onClick={() => onOpen(d.ym)}>Buka bulan ini →</button>
        </div>
      )}
    </div>
  );
}

// Tabel per bulan (bulan yang ada datanya, terbaru di atas)
function MonthTable({ rows, onOpen }: { rows: MonthSummary[]; onOpen: (ym: string) => void }) {
  if (!rows.length) return <div className="ctable-wrap" />;
  const cur = today().slice(0, 7);
  return (
    <div className="ctable-wrap">
      <table className="ctable">
        <thead>
          <tr><th scope="col">Bulan</th><th scope="col">Margin kotor</th><th scope="col">Share</th><th scope="col">Profit bersih</th><th scope="col">Status</th></tr>
        </thead>
        <tbody>
          {[...rows].reverse().map((d) => (
            <tr key={d.ym} className={d.ym === cur ? "is-current" : ""} onClick={() => onOpen(d.ym)}>
              <th scope="row">{shortMonth(d.ym)}</th>
              <td>{fmtRp(d.margin)}</td><td>{fmtRp(d.share)}</td><td>{fmtRp(d.net)}</td>
              <td>{d.paidCount === 2
                ? <span className="badge badge--paid"><span className="badge__dot"></span>Lunas</span>
                : d.paidCount === 0
                  ? <span className="badge badge--unpaid"><span className="badge__dot"></span>Unpaid</span>
                  : <span className="ctable__part">1/2 lunas</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

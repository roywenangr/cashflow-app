// Model data + perhitungan. Semua fungsi murni: menerima state, tidak mengubahnya.

export type Theme = "light" | "dark";
export type Termin = 1 | 2;

export type Entry = { id: string; date: string; amount: number; note: string; sharePct: number };
export type Proof = { id: string; k: string; at: string | null; amount: number | null };
export type Payout = {
  paid: true;
  paidAt: string;
  amount?: number;
  proofs: Proof[];
  share?: { id: string; k: string };
};
export type Subsidy = { id: string; ym: string; termin: Termin; amount: number; purpose: string };
export type PartnerAccess = { password: string; lookup: string; k: string };
export type Settings = {
  partnerName: string;
  partnerPhone: string;
  partnerAccess?: PartnerAccess | null;
  sharePct: number;
  cutoff: number;
};
export type State = {
  settings: Settings;
  entries: Entry[];
  payouts: Record<string, Payout>; // "YYYY-MM-1" | "YYYY-MM-2"
  subsidies: Subsidy[];
  theme: Theme;
};

export function prefersLight() {
  try { return matchMedia("(prefers-color-scheme: light)").matches; } catch { return false; }
}

export const defaults = (): State => ({
  settings: { partnerName: "Partner", partnerPhone: "", sharePct: 10, cutoff: 15 },
  entries: [],
  payouts: {},
  subsidies: [],
  theme: prefersLight() ? "light" : "dark",
});

export const newId = () =>
  globalThis.crypto && crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/* eslint-disable @typescript-eslint/no-explicit-any */
// Validasi data dari cloud / localStorage / file import: buang entri rusak, jepit pengaturan ke rentang valid.
export function normalize(data: any): State {
  const base = defaults();
  if (!data || typeof data !== "object") throw new Error("Format data tidak valid");
  const s = data.settings || {};
  const pct = Number(s.sharePct);
  const cutoff = Number(s.cutoff);
  const defaultPct = Number.isFinite(pct) && s.sharePct !== "" && s.sharePct !== null ? clamp(pct, 0, 100) : base.settings.sharePct;
  const validPct = (v: any) => v !== "" && v !== null && v !== undefined && Number.isFinite(Number(v));

  const entries: Entry[] = (Array.isArray(data.entries) ? data.entries : [])
    .filter((e: any) => e && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && Number(e.amount) > 0)
    .map((e: any) => ({
      id: e.id ? String(e.id) : newId(),
      date: e.date,
      amount: Math.round(Number(e.amount)),
      note: typeof e.note === "string" ? e.note.slice(0, 80) : "",
      // Data lama belum punya % per entri — dibekukan ke default saat ini supaya
      // mengganti default nanti tidak mengubah share entri lama.
      sharePct: validPct(e.sharePct) ? clamp(Number(e.sharePct), 0, 100) : defaultPct,
    }));

  const payouts: Record<string, Payout> = {};
  if (data.payouts && typeof data.payouts === "object") {
    for (const [key, p] of Object.entries<any>(data.payouts)) {
      if (!/^\d{4}-\d{2}-[12]$/.test(key) || !p || !p.paid) continue;
      payouts[key] = {
        paid: true,
        paidAt: /^\d{4}-\d{2}-\d{2}$/.test(p.paidAt) ? p.paidAt : key.slice(0, 7) + "-01",
        ...(Number.isFinite(Number(p.amount)) && p.amount !== null && p.amount !== "" ? { amount: Math.round(Number(p.amount)) } : {}),
        proofs: (Array.isArray(p.proofs) ? p.proofs : [])
          .filter((x: any) => x && typeof x.id === "string" && typeof x.k === "string")
          .map((x: any) => ({
            id: x.id,
            k: x.k,
            at: /^\d{4}-\d{2}-\d{2}$/.test(x.at) ? x.at : null,
            amount: Number.isFinite(Number(x.amount)) ? Math.round(Number(x.amount)) : null,
          })),
        ...(p.share && typeof p.share.id === "string" && typeof p.share.k === "string" ? { share: { id: p.share.id, k: p.share.k } } : {}),
      };
    }
  }

  const subsidies: Subsidy[] = (Array.isArray(data.subsidies) ? data.subsidies : [])
    .filter((x: any) => x && /^\d{4}-\d{2}$/.test(x.ym) && (x.termin === 1 || x.termin === 2) && Number(x.amount) > 0)
    .map((x: any) => ({
      id: x.id ? String(x.id) : newId(),
      ym: x.ym,
      termin: x.termin,
      amount: Math.round(Number(x.amount)),
      purpose: typeof x.purpose === "string" ? x.purpose.slice(0, 80) : "",
    }));

  const pa = s.partnerAccess;
  return {
    settings: {
      partnerName: typeof s.partnerName === "string" && s.partnerName.trim() ? s.partnerName.trim().slice(0, 40) : base.settings.partnerName,
      partnerPhone: typeof s.partnerPhone === "string" ? s.partnerPhone.replace(/[^\d+]/g, "").slice(0, 20) : "",
      // Akses partner: password + turunan (lookup & kunci) — hanya ada di vault terenkripsi.
      partnerAccess: pa && typeof pa.password === "string" && /^[0-9a-f]{64}$/.test(pa.lookup) && typeof pa.k === "string"
        ? { password: pa.password, lookup: pa.lookup, k: pa.k } : null,
      sharePct: defaultPct, // default untuk entri baru
      cutoff: Number.isFinite(cutoff) && s.cutoff !== "" && s.cutoff !== null ? clamp(Math.round(cutoff), 8, 23) : base.settings.cutoff,
    },
    entries,
    payouts,
    subsidies,
    theme: data.theme === "light" ? "light" : data.theme === "dark" ? "dark" : base.theme,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------- Tanggal ----------

const pad = (n: number) => String(n).padStart(2, "0");

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function daysInMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

export function monthLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
}

export function shiftMonth(ym: string, delta: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export const shortMonth = (ym: string, withYear = true) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("id-ID", withYear ? { month: "short", year: "numeric" } : { month: "short" });
};

export function monthsInRange(from: string, to: string) {
  const out: string[] = [];
  for (let ym = from; ym <= to; ym = shiftMonth(ym, 1)) out.push(ym);
  return out;
}

// ---------- Format ----------

export const fmtRp = (n: number) =>
  "Rp " + Math.round(n).toLocaleString("id-ID", { maximumFractionDigits: 0 });

export const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
};

export const fmtPct = (n: number) => `${n.toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`;

// Angka ringkas untuk sumbu grafik: 1,5 M / 12 jt / 500 rb
export function fmtCompact(n: number) {
  const abs = Math.abs(n);
  const f = (v: number) => v.toLocaleString("id-ID", { maximumFractionDigits: v < 10 ? 1 : 0 });
  if (abs >= 1e9) return f(n / 1e9) + " M";
  if (abs >= 1e6) return f(n / 1e6) + " jt";
  if (abs >= 1e3) return f(n / 1e3) + " rb";
  return String(Math.round(n));
}

// "1 – 15" -> "1 - 15" (untuk label "Tgl 1 - 15")
export const dashPeriod = (p: string) => p.replace(" – ", " - ");

// ---------- Payout (termin) ----------
// Payout 1 = awal bulan s/d tanggal batas, Payout 2 = setelahnya s/d akhir bulan.

export const terminOf = (s: State, dateStr: string): Termin =>
  Number(dateStr.slice(8, 10)) <= s.settings.cutoff ? 1 : 2;

export const terminKey = (ym: string, t: number) => `${ym}-${t}`;

export function terminPeriod(s: State, ym: string, t: number) {
  const cutoff = s.settings.cutoff;
  return t === 1 ? `1 – ${cutoff}` : `${cutoff + 1} – ${daysInMonth(ym)}`;
}

export const monthEntries = (s: State, ym: string) =>
  s.entries
    .filter((e) => e.date.startsWith(ym + "-"))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

export const terminEntries = (s: State, ym: string, t: number) =>
  monthEntries(s, ym).filter((e) => terminOf(s, e.date) === t);

export const terminProfit = (s: State, ym: string, t: number) =>
  terminEntries(s, ym, t).reduce((sum, e) => sum + e.amount, 0);

// Tiap entri punya % sendiri; share dibulatkan per payout (Rupiah tanpa sen).
export const shareOf = (s: State, ym: string, t: number) =>
  Math.round(terminEntries(s, ym, t).reduce((sum, e) => sum + e.amount * (e.sharePct / 100), 0));

export const entryShare = (e: Entry) => Math.round(e.amount * (e.sharePct / 100));

export const terminSubsidies = (s: State, ym: string, t: number) =>
  s.subsidies.filter((x) => x.ym === ym && x.termin === t);

export const subsidyOf = (s: State, ym: string, t: number) =>
  terminSubsidies(s, ym, t).reduce((sum, x) => sum + x.amount, 0);

// Yang perlu ditransfer ke partner = share − subsidi silang (tidak bisa negatif).
export const payableOf = (s: State, ym: string, t: number) => Math.max(0, shareOf(s, ym, t) - subsidyOf(s, ym, t));

// "10%" kalau semua entri sama, "campuran" kalau berbeda, default kalau belum ada entri.
export function pctLabel(s: State, entries: Entry[]) {
  const pcts = [...new Set(entries.map((e) => e.sharePct))];
  if (pcts.length === 0) return fmtPct(s.settings.sharePct);
  return pcts.length === 1 ? fmtPct(pcts[0]) : "campuran";
}

export type TerminTotals = ReturnType<typeof terminTotals>;

export function terminTotals(s: State, ym: string, t: number) {
  const profit = terminProfit(s, ym, t);
  const share = shareOf(s, ym, t);
  const subsidy = subsidyOf(s, ym, t);
  const payable = Math.max(0, share - subsidy);
  const payout = s.payouts[terminKey(ym, t)];
  const paidAmount = payout ? payout.amount ?? 0 : 0;
  return {
    profit,
    share,
    subsidy,
    payable,                                         // share setelah dipotong subsidi silang
    paid: !!payout,                                  // pernah ada pembayaran
    settled: (!!payout || (share > 0 && payable === 0)) && paidAmount >= payable, // lunas (atau tertutup subsidi)
    paidAt: payout ? payout.paidAt : null,
    paidAmount,
    proofCount: payout && payout.proofs ? payout.proofs.length : 0,
    remaining: Math.max(0, payable - paidAmount),    // kurang bayar (mis. entri ditambah setelah dibayar)
    overpaid: Math.max(0, paidAmount - payable),     // lebih bayar (mis. entri dihapus setelah dibayar)
  };
}

// Data lama tidak menyimpan nominal yang dibayar — isi sekali dari perhitungan saat ini,
// lalu nominal itu dibekukan agar riwayat tidak berubah saat entri/pengaturan diubah.
export function backfillPayoutAmounts(s: State) {
  for (const [key, p] of Object.entries(s.payouts)) {
    if (p.amount === undefined) p.amount = payableOf(s, key.slice(0, 7), Number(key.slice(8)));
  }
}

export type MonthSummary = ReturnType<typeof computeMonth>;

export function computeMonth(s: State, ym: string) {
  const t1 = terminTotals(s, ym, 1);
  const t2 = terminTotals(s, ym, 2);
  return {
    ym,
    margin: t1.profit + t2.profit,
    share: t1.share + t2.share,
    net: (t1.profit + t2.profit) - (t1.share + t2.share),
    // payout tanpa share (kosong) dihitung lunas — tidak ada yang perlu dibayar
    paidCount: (t1.remaining === 0 ? 1 : 0) + (t2.remaining === 0 ? 1 : 0),
    due: t1.remaining + t2.remaining,
  };
}

// ---------- Ringkasan untuk partner ----------

// Login partner: hanya angka milik partner (share, subsidi, transfer, status & bukti).
// Tanpa margin kotor, invoice, profit bersih. Format harus sama dengan yang dibaca halaman partner.
export function partnerSnapshot(s: State) {
  const yms = new Set([
    ...s.entries.map((e) => e.date.slice(0, 7)),
    ...s.subsidies.map((x) => x.ym),
    ...Object.keys(s.payouts).map((k) => k.slice(0, 7)),
  ]);
  const months: PartnerMonth[] = [];
  let received = 0, outstanding = 0;
  for (const ym of [...yms].sort().reverse()) {
    const payouts: PartnerPayout[] = [];
    for (const t of [1, 2] as const) {
      const tt = terminTotals(s, ym, t);
      const p = s.payouts[terminKey(ym, t)];
      if (tt.share === 0 && !p && tt.subsidy === 0) continue;
      received += tt.paidAmount;
      outstanding += tt.remaining;
      payouts.push({
        t, period: terminPeriod(s, ym, t),
        share: tt.share, subsidy: tt.subsidy, payable: tt.payable,
        paid: tt.paid, settled: tt.settled, paidAt: tt.paidAt, paidAmount: tt.paidAmount, remaining: tt.remaining,
        subsidies: terminSubsidies(s, ym, t).map((x) => ({ amount: x.amount, purpose: x.purpose })),
        proofs: p && p.proofs ? p.proofs.map((x) => ({ id: x.id, k: x.k, at: x.at, amount: x.amount })) : [],
      });
    }
    if (payouts.length) months.push({ ym, label: monthLabel(ym), payouts });
  }
  return { v: 1, partnerName: s.settings.partnerName, received, outstanding, months };
}

export type PartnerPayout = {
  t: number; period: string;
  share: number; subsidy: number; payable: number;
  paid: boolean; settled: boolean; paidAt: string | null; paidAmount: number; remaining: number;
  subsidies: { amount: number; purpose: string }[];
  proofs: Proof[];
};
export type PartnerMonth = { ym: string; label: string; payouts: PartnerPayout[] };
export type PartnerView = ReturnType<typeof partnerSnapshot>;

// Link detail satu payout (dikirim via WhatsApp).
export function shareSnapshot(s: State, ym: string, t: number) {
  const totals = terminTotals(s, ym, t);
  const p = s.payouts[terminKey(ym, t)];
  return {
    v: 1,
    partnerName: s.settings.partnerName,
    ym, t,
    monthLabel: monthLabel(ym),
    period: terminPeriod(s, ym, t),
    paidAt: p.paidAt,
    paidAmount: p.amount ?? 0,
    // id + kunci bukti transfer, supaya partner bisa melihat gambarnya (diizinkan lewat receipt_ids)
    payments: (p.proofs || []).map((x) => ({ at: x.at, amount: x.amount, proof: { id: x.id, k: x.k } })),
    profit: totals.profit,
    share: totals.share,
    subsidy: totals.subsidy,
    payable: totals.payable,
    entries: terminEntries(s, ym, t).map((e) => ({
      date: e.date, amount: e.amount, note: e.note, sharePct: e.sharePct, share: entryShare(e),
    })),
    subsidies: terminSubsidies(s, ym, t).map((x) => ({ amount: x.amount, purpose: x.purpose })),
    createdAt: new Date().toISOString(),
  };
}
export type ShareView = ReturnType<typeof shareSnapshot>;

// 08xx / 8xx / +62xx -> 62xx (format wa.me). Kosong kalau nomor tidak valid.
export function waPhone(raw: string) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("0")) d = "62" + d.slice(1);
  else if (d.startsWith("8")) d = "62" + d;
  return d.length >= 10 ? d : "";
}

export function randomPassword(len = 14) {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // tanpa karakter mirip (0/O, 1/l/I)
  const rnd = crypto.getRandomValues(new Uint32Array(len));
  return Array.from(rnd, (n) => chars[n % chars.length]).join("");
}

"use client";

import { useRef, useState } from "react";
import {
  addEntry, addSubsidy, deleteEntry, deleteSubsidy, exportBackup, importBackup, logout, resetAll, setViewMonth,
  syncText, toggleTheme, unmarkPaid, waUrl,
} from "@/lib/store";
import {
  dashPeriod, entryShare, fmtDate, fmtPct, fmtRp, monthEntries, monthLabel, pctLabel, shiftMonth, State, Termin,
  terminEntries, terminKey, terminOf, terminPeriod, terminTotals, today, type TerminTotals,
} from "@/lib/model";
import { Icon, useStore } from "./ui";
import ChartOverlay from "./ChartOverlay";
import { PasswordDialog, ProofDialog, ProofViewDialog, SettingsDialog, WaDialog } from "./dialogs";

export default function Dashboard() {
  const s = useStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<null | { ym: string; t: number; msg: string }>(null);
  const [proofKey, setProofKey] = useState<string | null>(null);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__logo" aria-hidden="true">Rp</span>
          <div>
            <h1>Cashflowshit App</h1>
            <p className="topbar__sub">Profit Sharing - Made with &lt;3</p>
          </div>
        </div>
        <div className="topbar__actions">
          <button className="icon-btn" aria-label="Grafik cashflow" title="Grafik cashflow" onClick={() => setChartOpen(true)}><Icon.chart /></button>
          <button className="icon-btn" aria-label="Pengaturan" title="Pengaturan" onClick={() => setSettingsOpen(true)}><Icon.settings /></button>
          <button className="icon-btn" aria-label="Keluar" title="Keluar" onClick={() => logout()}><Icon.lock /></button>
          <button className="icon-btn" aria-label="Ganti tema" title="Ganti tema" onClick={toggleTheme}><Icon.moon /><Icon.sun /></button>
        </div>
      </header>

      <main>
        <Kpi s={s.state} ym={s.viewMonth} />

        <nav className="month-nav" aria-label="Pilih bulan">
          <button className="icon-btn" aria-label="Bulan sebelumnya" onClick={() => setViewMonth(shiftMonth(s.viewMonth, -1))}><Icon.prev /></button>
          <h2 className="month-nav__title">{monthLabel(s.viewMonth)}</h2>
          <button className="icon-btn" aria-label="Bulan berikutnya" onClick={() => setViewMonth(shiftMonth(s.viewMonth, 1))}><Icon.next /></button>
          <button className="btn btn--ghost btn--today" onClick={() => setViewMonth(today().slice(0, 7))}>Hari ini</button>
        </nav>

        <section className="termins" aria-label="Payout bulan ini">
          {([1, 2] as const).map((t) => (
            <PayoutCard key={t} s={s.state} ym={s.viewMonth} t={t}
              onPay={(msg) => setPayTarget({ ym: s.viewMonth, t, msg })}
              onProofs={() => setProofKey(terminKey(s.viewMonth, t))} />
          ))}
        </section>

        <EntryForm s={s.state} ym={s.viewMonth} />
        <EntryList s={s.state} ym={s.viewMonth} />
        <SubsidyCard s={s.state} ym={s.viewMonth} />
        <History s={s.state} onProofs={setProofKey} />
      </main>

      <Footer />

      <ChartOverlay open={chartOpen} onClose={() => setChartOpen(false)} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)}
        onChangePw={() => { setSettingsOpen(false); setPwOpen(true); }} />
      <PasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
      <ProofDialog target={payTarget} onClose={() => setPayTarget(null)} />
      <ProofViewDialog payoutKey={proofKey} onClose={() => setProofKey(null)} />
      <WaDialog />
    </div>
  );
}

function Kpi({ s, ym }: { s: State; ym: string }) {
  const isThisMonth = ym === today().slice(0, 7);
  const entries = monthEntries(s, ym);
  const t1 = terminTotals(s, ym, 1);
  const t2 = terminTotals(s, ym, 2);
  const profit = t1.profit + t2.profit;
  const share = t1.share + t2.share;
  const subsidy = t1.subsidy + t2.subsidy;
  const paid = t1.paidAmount + t2.paidAmount;
  const due = t1.remaining + t2.remaining;
  const net = profit - share; // profit bersih = margin kotor − share partner
  const settledCount = (t1.settled && t1.share > 0 ? 1 : 0) + (t2.settled && t2.share > 0 ? 1 : 0);
  const dueCount = (t1.remaining > 0 ? 1 : 0) + (t2.remaining > 0 ? 1 : 0);
  const scope = isThisMonth ? "Bulan ini" : monthLabel(ym);
  const label = pctLabel(s, entries);
  let shareMeta = label === "campuran"
    ? `Rata-rata ${fmtPct(profit ? Math.round((share / profit) * 1000) / 10 : 0)}`
    : `${label} dari margin kotor`;
  if (subsidy > 0) shareMeta += ` · subsidi silang −${fmtRp(subsidy)}`;

  return (
    <section className="tiles" aria-label="Ringkasan bulan ini">
      <div className="tile">
        <p className="tile__label"><span className="tile__dot"></span>Margin kotor bulan ini</p>
        <p className="tile__value">{fmtRp(profit)}</p>
        <p className="tile__meta">{entries.length} Invoice · {scope}</p>
      </div>
      <div className="tile">
        <p className="tile__label"><span className="tile__dot tile__dot--accent"></span>Share partner bulan ini</p>
        <p className="tile__value tile__value--accent">{fmtRp(share)}</p>
        <p className="tile__meta">{shareMeta}</p>
      </div>
      <div className="tile">
        <p className="tile__label"><span className="tile__dot tile__dot--good"></span>Profit bersih bulan ini</p>
        <p className="tile__value tile__value--good">{fmtRp(net)}</p>
        <p className="tile__meta">Margin kotor − share partner</p>
      </div>
      <div className="tile">
        <p className="tile__label"><span className="tile__dot tile__dot--good"></span>Sudah dibayar (bulan ini)</p>
        <p className="tile__value tile__value--good">{fmtRp(paid)}</p>
        <p className="tile__meta">{paid > 0 ? `${settledCount} dari 2 payout lunas` : "Belum ada payout lunas"}</p>
      </div>
      <div className="tile tile--wide">
        <p className="tile__label"><span className="tile__dot tile__dot--warn"></span>Belum dibayar (bulan ini)</p>
        <p className="tile__value tile__value--due">{fmtRp(due)}</p>
        <p className="tile__meta">{due > 0 ? `${dueCount} payout menunggu` : share > 0 ? "Semua lunas" : "Belum ada tagihan"}</p>
      </div>
    </section>
  );
}

function PayoutCard({ s, ym, t, onPay, onProofs }: {
  s: State; ym: string; t: Termin; onPay: (msg: string) => void; onProofs: () => void;
}) {
  const totals: TerminTotals = terminTotals(s, ym, t);
  const key = terminKey(ym, t);
  const payout = s.payouts[key];
  const empty = totals.profit === 0;
  const covered = !empty && !totals.paid && totals.share > 0 && totals.payable === 0; // share habis untuk subsidi
  const partial = totals.paid && totals.remaining > 0;
  const cls = "termin" +
    (totals.settled && !empty ? " termin--paid" : "") +
    (totals.remaining > 0 ? " termin--due" : "") +
    (empty && !totals.paid ? " termin--empty" : "");

  const pay = () => onPay(totals.paid
    ? `Sisa Payout ${t} bulan ${monthLabel(ym)} sebesar ${fmtRp(totals.remaining)} (total menjadi ${fmtRp(totals.payable)}).`
    : `Payout ${t} bulan ${monthLabel(ym)} sebesar ${fmtRp(totals.payable)}.`);

  const paidNote = totals.paid && (
    <p className="termin__note">
      Dibayar {fmtRp(totals.paidAmount)} · {fmtDate(totals.paidAt!)}
      {totals.overpaid > 0 && ` · lebih bayar ${fmtRp(totals.overpaid)}`}
      {totals.proofCount > 0 && <> · <button type="button" className="link-btn" onClick={onProofs}>
        Lihat bukti{totals.proofCount > 1 ? ` (${totals.proofCount})` : ""}</button></>}
      {payout?.share && <> · <a className="link-btn" href={waUrl(key)} target="_blank" rel="noopener">Kirim WA</a></>}
    </p>
  );

  return (
    <article className={cls}>
      <div className="termin__head">
        <div>
          <p className="termin__name" style={{ margin: 0 }}>Payout {t}</p>
          <p className="termin__period" style={{ margin: "2px 0 0" }}>{terminPeriod(s, ym, t)}</p>
        </div>
        {totals.settled && !(empty && !totals.paid)
          ? <span className="badge badge--paid"><span className="badge__dot"></span>Paid</span>
          : partial
            ? <span className="badge badge--unpaid"><span className="badge__dot"></span>Kurang</span>
            : <span className="badge badge--unpaid"><span className="badge__dot"></span>Unpaid</span>}
      </div>
      <div className="termin__figures">
        <div className="figure">
          <span className="figure__label">Margin Kotor (Tgl {dashPeriod(terminPeriod(s, ym, t))})</span>
          <span className="figure__value">{fmtRp(totals.profit)}</span>
        </div>
        <div className="figure">
          <span className="figure__label">Share partner ({pctLabel(s, terminEntries(s, ym, t))})</span>
          <span className="figure__value">{fmtRp(totals.share)}</span>
        </div>
        {totals.subsidy > 0 && (
          <div className="figure">
            <span className="figure__label">Subsidi silang</span>
            <span className="figure__value figure__value--neg">−{fmtRp(totals.subsidy)}</span>
          </div>
        )}
        <div className="figure">
          <span className="figure__label">Profit bersih kamu</span>
          <span className="figure__value">{fmtRp(totals.profit - totals.share)}</span>
        </div>
      </div>
      <div className="termin__share">
        <p className="termin__share-label">
          <span className={"tile__dot " + (totals.paid ? "tile__dot--good" : "tile__dot--warn")}></span>
          {partial ? "Sisa perlu ditransfer" : totals.paid ? "Sudah ditransfer" : covered ? "Tertutup subsidi silang" : "Perlu ditransfer"}
        </p>
        <p className="termin__share-value">
          {partial ? fmtRp(totals.remaining) : totals.paid ? fmtRp(totals.paidAmount) : empty ? "—" : fmtRp(totals.payable)}
        </p>
      </div>
      <div className="termin__foot">
        {partial ? (
          <>
            <button className="btn btn--primary btn--block" onClick={pay}>Tandai sisa dibayar</button>
            <button className="btn btn--ghost btn--block" onClick={() => unmarkPaid(ym, t)}>Batalkan tanda bayar</button>
            {paidNote}
          </>
        ) : totals.paid ? (
          <>
            <button className="btn btn--ghost btn--block" onClick={() => unmarkPaid(ym, t)}>Batalkan tanda lunas</button>
            {paidNote}
          </>
        ) : covered ? (
          <p className="termin__note">Share tertutup subsidi silang — tidak ada yang perlu ditransfer</p>
        ) : empty ? (
          <p className="termin__note">Belum ada invoice di periode ini</p>
        ) : (
          <button className="btn btn--primary btn--block" onClick={pay}>Tandai sudah dibayar</button>
        )}
      </div>
    </article>
  );
}

function EntryForm({ s, ym }: { s: State; ym: string }) {
  const [dateIn, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [pctIn, setPct] = useState<string | null>(null); // null = ikut default di Pengaturan

  // Default tanggal: hari ini saat melihat bulan aktif, tanggal 1 untuk bulan lain.
  // Tanggal pilihan dipertahankan selama masih di bulan yang sedang dilihat.
  const date = dateIn && dateIn.startsWith(ym + "-") ? dateIn : ym === today().slice(0, 7) ? today() : `${ym}-01`;
  const pct = pctIn ?? String(s.settings.sharePct);

  return (
    <section className="card form-card" aria-label="Tambah Invoice">
      <h3 className="card__title">Tambah Invoice</h3>
      <form className="form" onSubmit={(e) => {
        e.preventDefault();
        if (addEntry(date, Math.round(Number(amount)), note.trim(), pct.trim())) {
          setAmount(""); setNote(""); setPct(null); // balik ke default
        }
      }}>
        <div className="form__row">
          <label className="field">
            <span>Tanggal</span>
            <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field field--grow">
            <span>Jumlah (Rp)</span>
            <input type="number" inputMode="numeric" min="0" step="any" placeholder="0" required value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
        </div>
        <div className="form__row">
          <label className="field field--grow">
            <span>Catatan <em>(opsional)</em></span>
            <input type="text" maxLength={80} placeholder="mis. Proyek A, client X…" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <label className="field field--pct">
            <span>Share (%)</span>
            <input type="number" inputMode="decimal" min="0" max="100" step="0.5" value={pct} onChange={(e) => setPct(e.target.value)} />
          </label>
          <button type="submit" className="btn btn--primary">Simpan</button>
        </div>
      </form>
    </section>
  );
}

function EntryList({ s, ym }: { s: State; ym: string }) {
  const entries = monthEntries(s, ym);
  return (
    <section className="card" aria-label="Daftar invoice bulan ini">
      <div className="card__head">
        <h3 className="card__title">Invoice Bulan Ini</h3>
        <span className="chip">{entries.length} Invoice</span>
      </div>
      <ul className="entries">
        {entries.map((e) => (
          <li key={e.id} className="entry">
            <span className="entry__date">{fmtDate(e.date)}</span>
            <div className="entry__body">
              <span className="entry__amount">{fmtRp(e.amount)}</span>
              {e.note && <span className="entry__note">{e.note}</span>}
              <span className="entry__share">Share {fmtPct(e.sharePct)} · {fmtRp(entryShare(e))}</span>
            </div>
            <div className="entry__side">
              <span className="entry__tag">Payout {terminOf(s, e.date)}</span>
              <button className="del-btn" aria-label="Hapus invoice" onClick={() => deleteEntry(e.id)}><Icon.trash /></button>
            </div>
          </li>
        ))}
      </ul>
      <p className="empty" hidden={entries.length > 0}>Belum ada invoice tercatat bulan ini.</p>
    </section>
  );
}

function SubsidyCard({ s, ym }: { s: State; ym: string }) {
  const [termin, setTermin] = useState<Termin>(1);
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const list = s.subsidies.filter((x) => x.ym === ym).sort((a, b) => a.termin - b.termin);
  const total = list.reduce((sum, x) => sum + x.amount, 0);

  return (
    <section className="card form-card" aria-label="Subsidi silang">
      <div className="card__head">
        <h3 className="card__title">Subsidi Silang</h3>
        <span className="chip">{list.length ? `${fmtRp(total)} bulan ini` : "—"}</span>
      </div>
      <form className="form" noValidate onSubmit={(e) => {
        e.preventDefault();
        if (addSubsidy(termin, Math.round(Number(amount)), purpose.trim())) { setAmount(""); setPurpose(""); }
      }}>
        <div className="form__row">
          <label className="field field--pct">
            <span>Payout</span>
            <select value={termin} onChange={(e) => setTermin(Number(e.target.value) === 2 ? 2 : 1)}>
              <option value="1">Payout 1</option>
              <option value="2">Payout 2</option>
            </select>
          </label>
          <label className="field field--grow">
            <span>Jumlah (Rp)</span>
            <input type="number" inputMode="numeric" min="0" step="any" placeholder="0" required value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
        </div>
        <div className="form__row">
          <label className="field field--grow">
            <span>Keperluan</span>
            <input type="text" maxLength={80} placeholder="mis. Bantu biaya proyek B…" required value={purpose} onChange={(e) => setPurpose(e.target.value)} />
          </label>
          <button type="submit" className="btn btn--primary">Simpan</button>
        </div>
        <small className="form__hint">Dipotong dari share partner pada payout yang dipilih (bulan yang sedang dilihat).</small>
      </form>
      <ul className="entries subsidies">
        {list.map((x) => (
          <li key={x.id} className="entry">
            <div className="entry__body">
              <span className="entry__amount">−{fmtRp(x.amount)}</span>
              <span className="entry__note">{x.purpose}</span>
            </div>
            <div className="entry__side">
              <span className="entry__tag">Payout {x.termin}</span>
              <button className="del-btn" aria-label="Hapus subsidi silang" onClick={() => deleteSubsidy(x.id)}><Icon.trash /></button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function History({ s, onProofs }: { s: State; onProofs: (key: string) => void }) {
  const paid = Object.entries(s.payouts)
    .filter(([, p]) => p.paid)
    .map(([key, p]) => ({ key, ym: key.slice(0, 7), t: Number(key.slice(8)), ...p, share: p.amount ?? 0 }))
    .sort((a, b) => (a.ym < b.ym ? 1 : a.ym > b.ym ? -1 : b.t - a.t));
  const total = paid.reduce((sum, p) => sum + p.share, 0);

  return (
    <section className="card" aria-label="Riwayat pembayaran">
      <div className="card__head">
        <h3 className="card__title">Riwayat payout</h3>
        <span className="chip">{paid.length ? `${fmtRp(total)} total` : "—"}</span>
      </div>
      <ul className="history">
        {paid.map((p) => (
          <li key={p.key} className="history__item">
            <span className="badge badge--paid"><span className="badge__dot"></span>Paid</span>
            <div className="history__body">
              <p className="history__title" style={{ margin: 0 }}>Payout {p.t} — {monthLabel(p.ym)}</p>
              <p className="history__date" style={{ margin: "1px 0 0" }}>Untuk {s.settings.partnerName} · dibayar {fmtDate(p.paidAt)}</p>
              {p.proofs.length > 0 && (
                <button type="button" className="link-btn history__proof" onClick={() => onProofs(p.key)}>
                  Lihat bukti transfer{p.proofs.length > 1 ? ` (${p.proofs.length})` : ""}
                </button>
              )}
            </div>
            <span className="history__amount">{fmtRp(p.share)}</span>
          </li>
        ))}
      </ul>
      <p className="empty" hidden={paid.length > 0}>Belum ada riwayat pembayaran.</p>
    </section>
  );
}

function Footer() {
  const s = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <footer className="footer">
      <p>
        <span className="sync" data-state={s.sync.state}><span className="sync__dot"></span><span>{syncText()}</span></span>
      </p>
      <p>
        Data terenkripsi sebelum dikirim ke cloud.{" "}
        <button className="link-btn" onClick={exportBackup}>Export JSON</button> ·{" "}
        <button className="link-btn" onClick={() => fileRef.current?.click()}>Import JSON</button> ·{" "}
        <button className="link-btn link-btn--danger" onClick={resetAll}>Reset data</button>
      </p>
      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = ""; // supaya file yang sama bisa dipilih lagi
        if (f) importBackup(f);
      }} />
    </footer>
  );
}

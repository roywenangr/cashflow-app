"use client";

// Dashboard partner — login hanya dengan password partner.
// Password -> PBKDF2 -> lookup (menemukan baris di server) + kunci AES.
// Data partner dibuat & dienkripsi oleh aplikasi pemilik; isinya hanya
// share, subsidi, status bayar & bukti transfer (tanpa margin/invoice).

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { cloudConfigured } from "@/lib/config";
import { decryptWithRawKey, derivePartner } from "@/lib/crypto";
import { dashPeriod, fmtDate, fmtRp, type PartnerPayout, type PartnerView, type Proof } from "@/lib/model";
import { rpc } from "@/lib/supabase";
import { Icon, PwToggle } from "./ui";

const SESSION_KEY = "cashflow.partner"; // { lookup, k } — hilang saat tab ditutup
type Creds = { lookup: string; k: string };
class WrongPassword extends Error {}

async function fetchView(c: Creds): Promise<{ data: PartnerView; updatedAt: string }> {
  const rows = await rpc("get_partner_view", { lookup_hex: c.lookup });
  if (!rows || !rows[0]) throw new WrongPassword();
  const { bytes } = await decryptWithRawKey(c.k, rows[0].data);
  return { data: JSON.parse(new TextDecoder().decode(bytes)), updatedAt: rows[0].updated_at };
}

export default function PartnerApp() {
  // true hanya di browser (data & sesi ada di sessionStorage) — di server tidak merender apa pun.
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const [creds, setCreds] = useState<Creds | null>(null);
  const [view, setView] = useState<{ data: PartnerView; updatedAt: string } | null>(null);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

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

  function logout() {
    setCreds(null);
    setView(null);
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* abaikan */ }
  }

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

  if (!creds || !view) {
    return (
      <section className="lock">
        <form className="lock__card" onSubmit={login} noValidate>
          <span className="topbar__logo lock__logo" aria-hidden="true">Rp</span>
          <h1 className="lock__title">Cashflowshit App</h1>
          <p className="lock__sub">Masuk sebagai partner.</p>
          <label className="field">
            <span>Password partner</span>
            <span className="pw">
              <input type="password" autoComplete="current-password" autoCapitalize="off" spellCheck={false}
                value={pw} onChange={(e) => setPw(e.target.value)} />
              <PwToggle />
            </span>
          </label>
          <p className="form-error" role="alert">{err}</p>
          <button type="submit" className="btn btn--primary btn--block" disabled={busy}>{busy ? "Memproses…" : "Masuk"}</button>
          <Link className="link-btn lock__owner" href="/">← Masuk sebagai pemilik</Link>
        </form>
      </section>
    );
  }

  const d = view.data;
  const payouts = d.months.flatMap((m) => m.payouts);
  const settled = payouts.filter((p) => p.settled && p.paid).length;
  const waiting = payouts.filter((p) => p.remaining > 0).length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__logo" aria-hidden="true">Rp</span>
          <div>
            <h1>Cashflowshit App</h1>
            <p className="topbar__sub">Partner · {d.partnerName}</p>
          </div>
        </div>
        <div className="topbar__actions">
          <button className="icon-btn" aria-label="Muat ulang data" title="Muat ulang data" onClick={async () => {
            try { setView(await fetchView(creds)); setNote(""); } catch (e) {
              if (e instanceof WrongPassword) logout(); else setNote("Gagal memuat ulang — periksa koneksi internet.");
            }
          }}><Icon.refresh /></button>
          <button className="icon-btn" aria-label="Keluar" title="Keluar" onClick={logout}><Icon.lock /></button>
        </div>
      </header>

      <main>
        <section className="tiles tiles--partner" aria-label="Ringkasan">
          <div className="tile">
            <p className="tile__label"><span className="tile__dot tile__dot--good"></span>Total sudah diterima</p>
            <p className="tile__value tile__value--good">{fmtRp(d.received)}</p>
            <p className="tile__meta">{settled ? `${settled} payout lunas` : "Belum ada payout lunas"}</p>
          </div>
          <div className="tile">
            <p className="tile__label"><span className="tile__dot tile__dot--warn"></span>Belum dibayar</p>
            <p className="tile__value tile__value--due">{fmtRp(d.outstanding)}</p>
            <p className="tile__meta">{waiting ? `${waiting} payout menunggu` : "Semua lunas"}</p>
          </div>
        </section>

        {d.months.map((m) => (
          <div key={m.ym}>
            <h2 className="pmonth__title">{m.label}</h2>
            <section className="termins">
              {m.payouts.map((p) => <PartnerPayoutCard key={p.t} p={p} lookup={creds.lookup} />)}
            </section>
          </div>
        ))}
        <p className="empty" hidden={d.months.length > 0}>Belum ada data payout.</p>
      </main>

      <footer className="footer">
        <p>{note || (view.updatedAt
          ? `Data diperbarui ${new Date(view.updatedAt).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`
          : "")}</p>
      </footer>
    </div>
  );
}

function PartnerPayoutCard({ p, lookup }: { p: PartnerPayout; lookup: string }) {
  const [showProofs, setShowProofs] = useState(false);
  const partial = p.paid && p.remaining > 0;
  const covered = !p.paid && p.share > 0 && p.payable === 0;
  const label = partial ? "Sisa perlu ditransfer" : p.paid ? "Sudah ditransfer" : covered ? "Tertutup subsidi silang" : "Akan ditransfer";
  const value = partial ? fmtRp(p.remaining) : p.paid ? fmtRp(p.paidAmount) : fmtRp(p.payable);

  return (
    <article className={"termin" + (p.settled ? " termin--paid" : "") + (p.remaining > 0 ? " termin--due" : "")}>
      <div className="termin__head">
        <div>
          <p className="termin__name" style={{ margin: 0 }}>Payout {p.t}</p>
          <p className="termin__period" style={{ margin: "2px 0 0" }}>Tgl {dashPeriod(p.period)}</p>
        </div>
        {p.settled
          ? <span className="badge badge--paid"><span className="badge__dot"></span>Paid</span>
          : partial
            ? <span className="badge badge--unpaid"><span className="badge__dot"></span>Kurang</span>
            : <span className="badge badge--unpaid"><span className="badge__dot"></span>Unpaid</span>}
      </div>
      <div className="termin__figures">
        <div className="figure">
          <span className="figure__label">Share partner</span>
          <span className="figure__value">{fmtRp(p.share)}</span>
        </div>
        {p.subsidy > 0 && (
          <>
            <div className="figure">
              <span className="figure__label">Subsidi silang</span>
              <span className="figure__value figure__value--neg">−{fmtRp(p.subsidy)}</span>
            </div>
            {p.subsidies.map((x, i) => (
              <div key={i} className="figure figure--sub">
                <span className="figure__label">· {x.purpose}</span>
                <span className="figure__value">−{fmtRp(x.amount)}</span>
              </div>
            ))}
          </>
        )}
      </div>
      <div className="termin__share">
        <p className="termin__share-label">
          <span className={"tile__dot " + (p.paid ? "tile__dot--good" : "tile__dot--warn")}></span>{label}
        </p>
        <p className="termin__share-value">{value}</p>
      </div>
      <div className="termin__foot">
        {p.paid && (
          <p className="termin__note">
            Dibayar {fmtRp(p.paidAmount)} · {fmtDate(p.paidAt!)}
            {p.proofs.length > 0 && <> · <button type="button" className="link-btn" onClick={() => setShowProofs(!showProofs)}>
              {showProofs ? "Tutup" : "Lihat"} bukti{p.proofs.length > 1 ? ` (${p.proofs.length})` : ""}</button></>}
          </p>
        )}
        {showProofs && (
          <div className="proof__list pproofs">
            {p.proofs.map((x) => (
              <ProofImage key={x.id} proof={x} load={() => rpc("get_partner_receipt", { lookup_hex: lookup, receipt_id: x.id })} />
            ))}
          </div>
        )}
      </div>
    </article>
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

  if (failed) return <figure className="proof__item proof__item--loading">Bukti tidak bisa dimuat.</figure>;
  if (!url) return <figure className="proof__item proof__item--loading">Memuat bukti…</figure>;
  return (
    <figure className="proof__item">
      <a href={url} target="_blank" rel="noopener">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="Bukti transfer" />
      </a>
      <figcaption>{[proof.amount !== null ? fmtRp(proof.amount) : null, proof.at ? fmtDate(proof.at) : null].filter(Boolean).join(" · ")}</figcaption>
    </figure>
  );
}

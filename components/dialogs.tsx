"use client";

import { useEffect, useState } from "react";
import {
  changePassword, closeWa, compressImage, disablePartner, payWithProof, proofUrl, resolveConflict, saveSettings,
  setPartnerPassword, UserError, waUrl,
} from "@/lib/store";
import { cloudConfigured } from "@/lib/config";
import { fmtDate, fmtRp, monthLabel, randomPassword, waPhone, type Proof } from "@/lib/model";
import { isNetworkError } from "@/lib/supabase";
import { Modal, useStore } from "./ui";

const errText = (e: unknown) => (e instanceof UserError ? e.message : `Gagal: ${(e as Error).message}`);

// ---------- Pengaturan + panel akses partner ----------

// Isi form dipasang ulang setiap dialog dibuka (Modal hanya merender isi saat terbuka), jadi selalu segar.
export function SettingsDialog({ open, onClose, onChangePw }: { open: boolean; onClose: () => void; onChangePw: () => void }) {
  return <Modal open={open} onClose={onClose}><SettingsForm onClose={onClose} onChangePw={onChangePw} /></Modal>;
}

function SettingsForm({ onClose, onChangePw }: { onClose: () => void; onChangePw: () => void }) {
  const s = useStore();
  const st = s.state.settings;
  const [name, setName] = useState(st.partnerName);
  const [phone, setPhone] = useState(st.partnerPhone);
  const [pct, setPct] = useState(String(st.sharePct));
  const [cutoff, setCutoff] = useState(String(st.cutoff));
  const [partnerPw, setPartnerPw] = useState(st.partnerAccess ? st.partnerAccess.password : "");
  const [partnerErr, setPartnerErr] = useState("");
  const [partnerBusy, setPartnerBusy] = useState(false);

  const acc = st.partnerAccess;
  return (
      <form className="dialog__form" onSubmit={(e) => { e.preventDefault(); saveSettings(name, phone, pct, cutoff); onClose(); }}>
        <h3>Pengaturan</h3>
        <label className="field">
          <span>Nama partner</span>
          <input type="text" maxLength={40} placeholder="Partner" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Nomor WhatsApp partner</span>
          <input type="tel" inputMode="tel" maxLength={20} placeholder="08xxxxxxxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <small>Dipakai untuk kirim kabar payout yang sudah dibayar. Kosongkan untuk memilih kontak di WhatsApp.</small>
        </label>
        <label className="field">
          <span>Share partner default (%)</span>
          <input type="number" min="0" max="100" step="0.5" value={pct} onChange={(e) => setPct(e.target.value)} />
          <small>Diisi otomatis di form invoice baru — bisa diubah per invoice. Invoice yang sudah ada tidak berubah.</small>
        </label>
        <label className="field">
          <span>Pembagi payout — tanggal batas</span>
          <input type="number" min="8" max="23" step="1" value={cutoff} onChange={(e) => setCutoff(e.target.value)} />
          <small>Payout 1: tanggal 1 s/d batas · Payout 2: setelahnya s/d akhir bulan. Default 15.</small>
        </label>
        <div className="field">
          <span>Akses partner</span>
          <p className="account">{acc ? (s.partnerSynced ? "Aktif — data partner sudah tersinkron" : "Aktif — menunggu sinkron") : "Belum aktif"}</p>
          <span className="pw">
            <input type="text" maxLength={64} autoComplete="off" spellCheck={false} placeholder="Password untuk partner"
              value={partnerPw} onChange={(e) => setPartnerPw(e.target.value)} />
            <button type="button" className="pw__toggle" onClick={() => setPartnerPw(randomPassword())}>Acak</button>
          </span>
          <small>Partner masuk lewat &quot;Masuk sebagai partner&quot; dengan password ini dan hanya melihat share, subsidi, status bayar &amp; bukti transfer — tanpa margin kotor atau invoice. Minimal 10 karakter.</small>
          <div className="form__row">
            <button type="button" className="btn btn--ghost" disabled={partnerBusy} onClick={async () => {
              setPartnerErr(""); setPartnerBusy(true);
              try { await setPartnerPassword(partnerPw); } catch (e) { setPartnerErr(errText(e)); } finally { setPartnerBusy(false); }
            }}>{partnerBusy ? "Memproses…" : acc ? "Ganti password partner" : "Aktifkan akses partner"}</button>
            {acc && (
              <button type="button" className="btn btn--ghost link-btn--danger" onClick={async () => {
                setPartnerErr("");
                try { if (await disablePartner()) setPartnerPw(""); } catch (e) { setPartnerErr(errText(e)); }
              }}>Matikan akses</button>
            )}
          </div>
          <p className="form-error" role="alert">{partnerErr}</p>
        </div>
        <div className="field">
          <span>Akun</span>
          <p className="account">{s.accountEmail || "—"}</p>
          <button type="button" className="btn btn--ghost" onClick={onChangePw}>Ganti password</button>
        </div>
        <div className="dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Batal</button>
          <button type="submit" className="btn btn--primary">Simpan</button>
        </div>
      </form>
  );
}

// ---------- Ganti password akun ----------

export function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <Modal open={open} onClose={onClose}><PasswordForm onClose={onClose} /></Modal>;
}

function PasswordForm({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [oldPw, setOld] = useState("");
  const [newPw, setNew] = useState("");
  const [newPw2, setNew2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  return (
      <form className="dialog__form" noValidate onSubmit={async (e) => {
        e.preventDefault();
        setErr(""); setBusy(true);
        try { await changePassword(oldPw, newPw, newPw2); onClose(); } catch (e2) { setErr(errText(e2)); } finally { setBusy(false); }
      }}>
        <h3>Ganti password</h3>
        <input type="email" autoComplete="username" className="sr-only" tabIndex={-1} aria-hidden="true" readOnly value={s.accountEmail} />
        <label className="field">
          <span>Password lama</span>
          <input type="password" autoComplete="current-password" value={oldPw} onChange={(e) => setOld(e.target.value)} />
        </label>
        <label className="field">
          <span>Password baru</span>
          <input type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNew(e.target.value)} />
          <small>Minimal 8 karakter. Berlaku di semua perangkat.</small>
        </label>
        <label className="field">
          <span>Ulangi password baru</span>
          <input type="password" autoComplete="new-password" value={newPw2} onChange={(e) => setNew2(e.target.value)} />
        </label>
        <p className="form-error" role="alert">{err}</p>
        <div className="dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Batal</button>
          <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? "Memproses…" : "Simpan"}</button>
        </div>
      </form>
  );
}

// ---------- Lampirkan bukti transfer (tandai dibayar) ----------

type PayTarget = { ym: string; t: number; msg: string };

export function ProofDialog({ target, onClose }: { target: null | PayTarget; onClose: () => void }) {
  return (
    <Modal open={!!target} onClose={onClose}>
      {target && <ProofForm key={`${target.ym}-${target.t}-${target.msg}`} target={target} onClose={onClose} />}
    </Modal>
  );
}

function ProofForm({ target, onClose }: { target: PayTarget; onClose: () => void }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [preview, setPreview] = useState("");
  const [err, setErr] = useState(cloudConfigured() ? "" : "Bukti transfer butuh sinkron cloud (Supabase) yang aktif.");
  const [busy, setBusy] = useState(false);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  return (
      <form className="dialog__form" noValidate onSubmit={async (e) => {
        e.preventDefault();
        if (!blob) { setErr("Pilih screenshot bukti transfer dulu."); return; }
        setBusy(true); setErr("");
        try {
          await payWithProof(target.ym, target.t, blob);
          onClose();
        } catch (e2) {
          setErr(errText(e2));
        } finally {
          setBusy(false);
        }
      }}>
        <h3>Lampirkan bukti transfer</h3>
        <p className="dialog__text">{target.msg} Lampirkan screenshot bukti transfer untuk menandai sudah dibayar.</p>
        <label className="field">
          <span>Screenshot bukti transfer</span>
          <input type="file" accept="image/*" onChange={async (e) => {
            const file = e.target.files?.[0];
            setBlob(null); setPreview(""); setErr("");
            if (!file) return;
            if (!file.type.startsWith("image/")) { setErr("File harus berupa gambar (screenshot)."); return; }
            try {
              const b = await compressImage(file);
              setBlob(b);
              setPreview(URL.createObjectURL(b));
            } catch (e2) {
              setErr(e2 instanceof UserError ? e2.message : "Gambar tidak bisa dibaca — coba file lain.");
            }
          }} />
        </label>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {preview && <img className="proof__preview" src={preview} alt="Pratinjau bukti transfer" />}
        <p className="form-error" role="alert">{err}</p>
        <div className="dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Batal</button>
          <button type="submit" className="btn btn--primary" disabled={!blob || busy}>{busy ? "Memproses…" : "Tandai dibayar"}</button>
        </div>
      </form>
  );
}

// ---------- Lihat bukti transfer ----------

export function ProofViewDialog({ payoutKey, onClose }: { payoutKey: string | null; onClose: () => void }) {
  const s = useStore();
  const payout = payoutKey ? s.state.payouts[payoutKey] : null;
  return (
    <Modal open={!!payout} onClose={onClose} className="dialog dialog--wide">
      {payoutKey && payout && <ProofViewer key={payoutKey} payoutKey={payoutKey} proofs={payout.proofs} onClose={onClose} />}
    </Modal>
  );
}

function ProofViewer({ payoutKey, proofs, onClose }: { payoutKey: string; proofs: Proof[]; onClose: () => void }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const x of proofs) {
        try {
          const url = await proofUrl(x);
          if (!cancelled) setUrls((u) => ({ ...u, [x.id]: url }));
        } catch (e) {
          if (!cancelled) setErr(e instanceof UserError ? e.message
            : isNetworkError(e) ? "Gagal memuat bukti — periksa koneksi internet." : `Gagal memuat bukti: ${(e as Error).message}`);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [proofs]);

  return (
    <form className="dialog__form" onSubmit={(e) => { e.preventDefault(); onClose(); }}>
      <h3>Bukti transfer — Payout {payoutKey.slice(8)} {monthLabel(payoutKey.slice(0, 7))}</h3>
      <div className="proof__list">
        {proofs.map((x) => urls[x.id] ? (
          <figure key={x.id} className="proof__item">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={urls[x.id]} alt="Bukti transfer" />
            <figcaption>{[x.amount !== null ? fmtRp(x.amount) : null, x.at ? fmtDate(x.at) : null].filter(Boolean).join(" · ")}</figcaption>
          </figure>
        ) : (
          <figure key={x.id} className="proof__item proof__item--loading">Memuat…</figure>
        ))}
      </div>
      <p className="form-error" role="alert">{err}</p>
      <div className="dialog__actions">
        <button type="submit" className="btn btn--ghost">Tutup</button>
      </div>
    </form>
  );
}

// ---------- Kabari partner via WhatsApp ----------

export function WaDialog() {
  const s = useStore();
  const wa = s.wa;
  const key = wa?.key ?? "";
  const ym = key.slice(0, 7), t = Number(key.slice(8));
  const phone = waPhone(s.state.settings.partnerPhone);
  const name = s.state.settings.partnerName;
  const ready = !!wa && !!s.state.payouts[key]?.share;

  return (
    <Modal open={ready} onClose={closeWa}>
      <form className="dialog__form" onSubmit={(e) => { e.preventDefault(); closeWa(); }}>
        <h3>Payout ditandai dibayar</h3>
        <p className="dialog__text">
          {wa?.note ? wa.note + " " : ""}
          {phone
            ? `Kirim kabar ke ${name} (+${phone}) bahwa Payout ${t} ${ready ? monthLabel(ym) : ""} sudah dibayarkan, lengkap dengan link detail payout & invoice?`
            : `Kirim kabar ke ${name} bahwa Payout ${t} ${ready ? monthLabel(ym) : ""} sudah dibayarkan? Nomor WhatsApp partner belum diisi di Pengaturan — kamu akan memilih kontak di WhatsApp.`}
        </p>
        <div className="dialog__actions">
          <button type="submit" className="btn btn--ghost">Nanti saja</button>
          {ready && (
            <a className="btn btn--primary" href={waUrl(key)} target="_blank" rel="noopener" onClick={() => setTimeout(closeWa, 0)}>
              Kirim via WhatsApp
            </a>
          )}
        </div>
      </form>
    </Modal>
  );
}

// ---------- Konflik sinkron ----------

export function ConflictDialog() {
  const s = useStore();
  const c = s.conflict;
  return (
    <Modal open={!!c} onClose={() => resolveConflict(null)}>
      <form className="dialog__form" onSubmit={(e) => e.preventDefault()}>
        <h3>Data berbeda dengan cloud</h3>
        <p className="dialog__text">Data di cloud sudah diubah dari perangkat lain, sementara perangkat ini juga punya perubahan yang belum tersinkron. Pilih data yang mau dipakai:</p>
        <button type="button" className="btn btn--primary btn--block btn--stack" onClick={() => resolveConflict("remote")}>
          Pakai data cloud<small>{c?.remoteInfo}</small>
        </button>
        <button type="button" className="btn btn--ghost btn--block btn--stack" onClick={() => resolveConflict("local")}>
          Pakai data perangkat ini<small>{c?.localInfo}</small>
        </button>
        <p className="lock__note">Data yang tidak dipilih akan ditimpa dan tidak bisa dikembalikan.</p>
      </form>
    </Modal>
  );
}


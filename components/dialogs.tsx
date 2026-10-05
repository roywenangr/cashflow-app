"use client";

import { useEffect, useState } from "react";
import { CloudDownload, HardDrive, ImageUp, Loader2, MessageCircle } from "lucide-react";
import {
  addEntry, addSubsidy, changePassword, closeWa, compressImage, payWithProof, proofUrl, resolveConflict, UserError, waUrl,
} from "@/lib/store";
import { cloudConfigured } from "@/lib/config";
import { fmtDate, fmtRp, monthLabel, terminOf, today, waPhone, type Proof, type Termin } from "@/lib/model";
import { isNetworkError } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { FieldLabel, FormError, PasswordInput, useStore } from "./common";

const errText = (e: unknown) => (e instanceof UserError ? e.message : `Gagal: ${(e as Error).message}`);

// Input Rupiah: angka biasa + pratinjau format di bawahnya.
function MoneyInput({ id, value, onChange, autoFocus }: { id: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const n = Math.round(Number(value));
  return (
    <div className="space-y-1">
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-sm text-muted-foreground">Rp</span>
        <Input id={id} type="number" inputMode="numeric" min="0" step="any" placeholder="0" autoFocus={autoFocus}
          className="tnum h-10 pl-9 text-base" value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
      <p className="tnum h-4 text-xs text-muted-foreground">{n > 0 ? fmtRp(n) : ""}</p>
    </div>
  );
}

// ---------- Tambah invoice ----------

export function AddInvoiceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <InvoiceForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function InvoiceForm({ onDone }: { onDone: () => void }) {
  const s = useStore();
  const ym = s.viewMonth;
  // Default tanggal: hari ini saat melihat bulan aktif, tanggal 1 untuk bulan lain.
  const [date, setDate] = useState(ym === today().slice(0, 7) ? today() : `${ym}-01`);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [pct, setPct] = useState(String(s.state.settings.sharePct));
  const [err, setErr] = useState("");

  return (
    <form className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      if (!(Math.round(Number(amount)) > 0)) { setErr("Masukkan jumlah invoice."); return; }
      if (addEntry(date, Math.round(Number(amount)), note.trim(), pct.trim())) onDone();
    }}>
      <DialogHeader>
        <DialogTitle>Tambah invoice</DialogTitle>
        <DialogDescription>Share partner dihitung otomatis dari margin kotor invoice ini.</DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <FieldLabel htmlFor="inv-amount">Jumlah (margin kotor)</FieldLabel>
        <MoneyInput id="inv-amount" value={amount} onChange={setAmount} autoFocus />
      </div>
      <div className="grid grid-cols-[1fr_7rem] gap-3">
        <div className="space-y-1.5">
          <FieldLabel htmlFor="inv-date">Tanggal</FieldLabel>
          <Input id="inv-date" type="date" required className="h-10" value={date} onChange={(e) => setDate(e.target.value)} />
          {date && <p className="text-xs text-muted-foreground">Masuk Payout {terminOf(s.state, date)}</p>}
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor="inv-pct">Share (%)</FieldLabel>
          <Input id="inv-pct" type="number" inputMode="decimal" min="0" max="100" step="0.5" className="tnum h-10" value={pct} onChange={(e) => setPct(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <FieldLabel htmlFor="inv-note" hint="(opsional)">Catatan</FieldLabel>
        <Input id="inv-note" maxLength={80} placeholder="mis. Proyek A, client X…" className="h-10" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <FormError>{err}</FormError>
      <DialogFooter>
        <Button type="button" variant="outline" size="lg" onClick={onDone}>Batal</Button>
        <Button type="submit" size="lg">Simpan invoice</Button>
      </DialogFooter>
    </form>
  );
}

// ---------- Tambah subsidi silang ----------

export function AddSubsidyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <SubsidyForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function SubsidyForm({ onDone }: { onDone: () => void }) {
  const s = useStore();
  const [termin, setTermin] = useState<Termin>(1);
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [err, setErr] = useState("");
  return (
    <form className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      if (!(Math.round(Number(amount)) > 0)) { setErr("Masukkan jumlah subsidi."); return; }
      if (!purpose.trim()) { setErr("Isi keperluannya."); return; }
      if (addSubsidy(termin, Math.round(Number(amount)), purpose.trim())) onDone();
    }}>
      <DialogHeader>
        <DialogTitle>Subsidi silang</DialogTitle>
        <DialogDescription>Dipotong dari share partner pada payout yang dipilih — <span className="capitalize">{monthLabel(s.viewMonth)}</span>.</DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <FieldLabel>Payout</FieldLabel>
        <ToggleGroup type="single" variant="outline" className="w-full" value={String(termin)}
          onValueChange={(v) => v && setTermin(v === "2" ? 2 : 1)}>
          <ToggleGroupItem value="1" className="h-10 flex-1">Payout 1</ToggleGroupItem>
          <ToggleGroupItem value="2" className="h-10 flex-1">Payout 2</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="space-y-1.5">
        <FieldLabel htmlFor="sub-amount">Jumlah</FieldLabel>
        <MoneyInput id="sub-amount" value={amount} onChange={setAmount} />
      </div>
      <div className="space-y-1.5">
        <FieldLabel htmlFor="sub-purpose">Keperluan</FieldLabel>
        <Input id="sub-purpose" maxLength={80} placeholder="mis. Bantu biaya proyek B…" className="h-10" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
      </div>
      <FormError>{err}</FormError>
      <DialogFooter>
        <Button type="button" variant="outline" size="lg" onClick={onDone}>Batal</Button>
        <Button type="submit" size="lg">Simpan</Button>
      </DialogFooter>
    </form>
  );
}

// ---------- Ganti password akun ----------

export function PasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <PasswordForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function PasswordForm({ onDone }: { onDone: () => void }) {
  const s = useStore();
  const [oldPw, setOld] = useState("");
  const [newPw, setNew] = useState("");
  const [newPw2, setNew2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form className="space-y-4" noValidate onSubmit={async (e) => {
      e.preventDefault();
      setErr(""); setBusy(true);
      try { await changePassword(oldPw, newPw, newPw2); onDone(); } catch (e2) { setErr(errText(e2)); } finally { setBusy(false); }
    }}>
      <DialogHeader>
        <DialogTitle>Ganti password</DialogTitle>
        <DialogDescription>Berlaku di semua perangkat. Data dienkripsi ulang dengan kunci baru.</DialogDescription>
      </DialogHeader>
      <input type="email" autoComplete="username" className="sr-only" tabIndex={-1} aria-hidden="true" readOnly value={s.accountEmail} />
      <div className="space-y-1.5">
        <FieldLabel htmlFor="pw-old">Password lama</FieldLabel>
        <PasswordInput id="pw-old" autoComplete="current-password" value={oldPw} onChange={(e) => setOld(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <FieldLabel htmlFor="pw-new" hint="(min. 8 karakter)">Password baru</FieldLabel>
        <PasswordInput id="pw-new" autoComplete="new-password" value={newPw} onChange={(e) => setNew(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <FieldLabel htmlFor="pw-new2">Ulangi password baru</FieldLabel>
        <PasswordInput id="pw-new2" autoComplete="new-password" value={newPw2} onChange={(e) => setNew2(e.target.value)} />
      </div>
      <FormError>{err}</FormError>
      <DialogFooter>
        <Button type="button" variant="outline" size="lg" onClick={onDone}>Batal</Button>
        <Button type="submit" size="lg" disabled={busy}>{busy && <Loader2 className="animate-spin" />} Simpan</Button>
      </DialogFooter>
    </form>
  );
}

// ---------- Lampirkan bukti transfer (tandai dibayar) ----------

type PayTarget = { ym: string; t: number; msg: string };

export function ProofDialog({ target, onClose }: { target: null | PayTarget; onClose: () => void }) {
  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {target && <ProofForm target={target} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function ProofForm({ target, onClose }: { target: PayTarget; onClose: () => void }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [preview, setPreview] = useState("");
  const [err, setErr] = useState(cloudConfigured() ? "" : "Bukti transfer butuh sinkron cloud (Supabase) yang aktif.");
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function pick(file?: File) {
    setBlob(null); setPreview(""); setErr("");
    if (!file) return;
    if (!file.type.startsWith("image/")) { setErr("File harus berupa gambar (screenshot)."); return; }
    try {
      const b = await compressImage(file);
      setBlob(b);
      setPreview(URL.createObjectURL(b));
    } catch (e) {
      setErr(e instanceof UserError ? e.message : "Gambar tidak bisa dibaca — coba file lain.");
    }
  }

  return (
    <form className="space-y-4" noValidate onSubmit={async (e) => {
      e.preventDefault();
      if (!blob) { setErr("Pilih screenshot bukti transfer dulu."); return; }
      setBusy(true); setErr("");
      try { await payWithProof(target.ym, target.t, blob); onClose(); } catch (e2) { setErr(errText(e2)); } finally { setBusy(false); }
    }}>
      <DialogHeader>
        <DialogTitle>Lampirkan bukti transfer</DialogTitle>
        <DialogDescription>{target.msg} Lampirkan screenshot bukti transfer untuk menandai sudah dibayar.</DialogDescription>
      </DialogHeader>
      <label
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); }}
        className={cn("flex cursor-pointer flex-col items-center gap-2 overflow-hidden rounded-xl border-2 border-dashed p-4 text-center transition-colors",
          drag ? "border-primary bg-primary/5" : "hover:bg-muted/50")}>
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Pratinjau bukti transfer" className="max-h-72 rounded-lg object-contain" />
        ) : (
          <>
            <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground"><ImageUp className="size-5" /></span>
            <span className="text-sm font-medium">Pilih atau tarik screenshot ke sini</span>
            <span className="text-xs text-muted-foreground">JPG / PNG — otomatis dikompres & dienkripsi</span>
          </>
        )}
        <input type="file" accept="image/*" className="sr-only" aria-label="Screenshot bukti transfer" onChange={(e) => pick(e.target.files?.[0])} />
      </label>
      {preview && <p className="text-center text-xs text-muted-foreground">Ketuk gambar untuk mengganti</p>}
      <FormError>{err}</FormError>
      <DialogFooter>
        <Button type="button" variant="outline" size="lg" onClick={onClose}>Batal</Button>
        <Button type="submit" size="lg" disabled={!blob || busy}>{busy && <Loader2 className="animate-spin" />} Tandai dibayar</Button>
      </DialogFooter>
    </form>
  );
}

// ---------- Lihat bukti transfer ----------

export function ProofViewDialog({ payoutKey, onClose }: { payoutKey: string | null; onClose: () => void }) {
  const s = useStore();
  const payout = payoutKey ? s.state.payouts[payoutKey] : null;
  return (
    <Dialog open={!!payout} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        {payoutKey && payout && <ProofViewer payoutKey={payoutKey} proofs={payout.proofs} />}
      </DialogContent>
    </Dialog>
  );
}

function ProofViewer({ payoutKey, proofs }: { payoutKey: string; proofs: Proof[] }) {
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
    <>
      <DialogHeader>
        <DialogTitle>Bukti transfer</DialogTitle>
        <DialogDescription>Payout {payoutKey.slice(8)} — <span className="capitalize">{monthLabel(payoutKey.slice(0, 7))}</span></DialogDescription>
      </DialogHeader>
      <div className="max-h-[65vh] space-y-4 overflow-y-auto">
        {proofs.map((x) => (
          <figure key={x.id} className="space-y-1.5">
            {urls[x.id] ? (
              <a href={urls[x.id]} target="_blank" rel="noopener">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={urls[x.id]} alt="Bukti transfer" className="w-full rounded-lg border object-contain" />
              </a>
            ) : (
              <div className="grid h-48 place-items-center rounded-lg bg-muted text-sm text-muted-foreground"><Loader2 className="animate-spin" /></div>
            )}
            <figcaption className="tnum text-xs text-muted-foreground">
              {[x.amount !== null ? fmtRp(x.amount) : null, x.at ? fmtDate(x.at) : null].filter(Boolean).join(" · ")}
            </figcaption>
          </figure>
        ))}
      </div>
      <FormError>{err}</FormError>
    </>
  );
}

// ---------- Kabari partner via WhatsApp ----------

export function WaDialog() {
  const s = useStore();
  const wa = s.wa;
  const key = wa?.key ?? "";
  const ready = !!wa && !!s.state.payouts[key]?.share;
  const ym = key.slice(0, 7), t = Number(key.slice(8));
  const phone = waPhone(s.state.settings.partnerPhone);
  const name = s.state.settings.partnerName;

  return (
    <Dialog open={ready} onOpenChange={(o) => { if (!o) closeWa(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <span className="mb-1 grid size-11 place-items-center rounded-full bg-success/12 text-success-ink"><MessageCircle className="size-5" /></span>
          <DialogTitle>Payout ditandai dibayar</DialogTitle>
          <DialogDescription>
            {wa?.note ? wa.note + " " : ""}
            {phone
              ? `Kirim kabar ke ${name} (+${phone}) bahwa Payout ${t} ${ready ? monthLabel(ym) : ""} sudah dibayarkan, lengkap dengan link detail payout & invoice?`
              : `Kirim kabar ke ${name} bahwa Payout ${t} ${ready ? monthLabel(ym) : ""} sudah dibayarkan? Nomor WhatsApp partner belum diisi di Pengaturan — kamu akan memilih kontak di WhatsApp.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="lg" onClick={closeWa}>Nanti saja</Button>
          {ready && (
            <Button asChild size="lg">
              <a href={waUrl(key)} target="_blank" rel="noopener" onClick={() => setTimeout(closeWa, 0)}><MessageCircle /> Kirim via WhatsApp</a>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Konflik sinkron ----------

export function ConflictDialog() {
  const s = useStore();
  const c = s.conflict;
  return (
    <Dialog open={!!c} onOpenChange={(o) => { if (!o) resolveConflict(null); }}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Data berbeda dengan cloud</DialogTitle>
          <DialogDescription>
            Data di cloud sudah diubah dari perangkat lain, sementara perangkat ini juga punya perubahan yang belum tersinkron. Pilih data yang mau dipakai — yang tidak dipilih akan ditimpa.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <button onClick={() => resolveConflict("remote")} className="flex items-center gap-3 rounded-xl border p-3 text-left hover:bg-muted">
            <CloudDownload className="size-5 text-primary" />
            <span><span className="block text-sm font-medium">Pakai data cloud</span><span className="text-xs text-muted-foreground">{c?.remoteInfo}</span></span>
          </button>
          <button onClick={() => resolveConflict("local")} className="flex items-center gap-3 rounded-xl border p-3 text-left hover:bg-muted">
            <HardDrive className="size-5 text-primary" />
            <span><span className="block text-sm font-medium">Pakai data perangkat ini</span><span className="text-xs text-muted-foreground">{c?.localInfo}</span></span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

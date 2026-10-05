"use client";

import { useState } from "react";
import { Dices, KeyRound, Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { disablePartner, saveSettings, setPartnerPassword, UserError } from "@/lib/store";
import { randomPassword } from "@/lib/model";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FieldLabel, FormError, StatusBadge, useStore } from "./common";

export default function SettingsSheet({ open, onOpenChange, onChangePw }: {
  open: boolean; onOpenChange: (o: boolean) => void; onChangePw: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-md">
        {/* Isi dipasang ulang setiap sheet dibuka, jadi form selalu berisi nilai terbaru. */}
        <SettingsForm onDone={() => onOpenChange(false)} onChangePw={onChangePw} />
      </SheetContent>
    </Sheet>
  );
}

function Group({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 border-b px-5 py-5 last:border-b-0">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {desc && <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>}
      </div>
      {children}
    </section>
  );
}

function SettingsForm({ onDone, onChangePw }: { onDone: () => void; onChangePw: () => void }) {
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
    <form className="flex h-full flex-col" onSubmit={(e) => { e.preventDefault(); saveSettings(name, phone, pct, cutoff); onDone(); }}>
      <SheetHeader className="border-b">
        <SheetTitle>Pengaturan</SheetTitle>
        <SheetDescription>Partner, perhitungan, akses partner & akun.</SheetDescription>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto">
        <Group title="Partner">
          <div className="space-y-1.5">
            <FieldLabel htmlFor="set-name">Nama partner</FieldLabel>
            <Input id="set-name" maxLength={40} placeholder="Partner" className="h-10" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <FieldLabel htmlFor="set-phone">Nomor WhatsApp</FieldLabel>
            <Input id="set-phone" type="tel" inputMode="tel" maxLength={20} placeholder="08xxxxxxxxxx" className="h-10" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <p className="text-xs text-muted-foreground">Untuk kabar payout yang sudah dibayar. Kosongkan untuk memilih kontak di WhatsApp.</p>
          </div>
        </Group>

        <Group title="Perhitungan">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <FieldLabel htmlFor="set-pct">Share default (%)</FieldLabel>
              <Input id="set-pct" type="number" min="0" max="100" step="0.5" className="tnum h-10" value={pct} onChange={(e) => setPct(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <FieldLabel htmlFor="set-cutoff">Tanggal batas</FieldLabel>
              <Input id="set-cutoff" type="number" min="8" max="23" step="1" className="tnum h-10" value={cutoff} onChange={(e) => setCutoff(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Share default diisi otomatis di invoice baru (invoice lama tidak berubah). Payout 1: tanggal 1 s/d batas · Payout 2: setelahnya s/d akhir bulan.
          </p>
        </Group>

        <Group title="Akses partner" desc="Partner masuk lewat “Masuk sebagai partner” dan hanya melihat share, subsidi, status bayar & bukti transfer — tanpa margin kotor atau invoice.">
          <div className="flex items-center gap-2">
            {acc ? <StatusBadge tone="paid">{s.partnerSynced ? "Aktif · tersinkron" : "Aktif · menunggu sinkron"}</StatusBadge>
              : <StatusBadge tone="neutral">Belum aktif</StatusBadge>}
          </div>
          <div className="space-y-1.5">
            <FieldLabel htmlFor="set-ppw" hint="(min. 10 karakter)">Password partner</FieldLabel>
            <div className="flex gap-2">
              <Input id="set-ppw" maxLength={64} autoComplete="off" spellCheck={false} placeholder="Password untuk partner"
                className="h-10 font-mono" value={partnerPw} onChange={(e) => setPartnerPw(e.target.value)} />
              <Button type="button" variant="outline" size="icon-lg" className="size-10" aria-label="Buat password acak" title="Buat password acak"
                onClick={() => setPartnerPw(randomPassword())}><Dices /></Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="lg" disabled={partnerBusy} onClick={async () => {
              setPartnerErr(""); setPartnerBusy(true);
              try { await setPartnerPassword(partnerPw); } catch (e) { setPartnerErr(e instanceof UserError ? e.message : String(e)); } finally { setPartnerBusy(false); }
            }}>
              {partnerBusy ? <Loader2 className="animate-spin" /> : <ShieldCheck />} {acc ? "Ganti password partner" : "Aktifkan akses partner"}
            </Button>
            {acc && (
              <Button type="button" variant="destructive" size="lg" onClick={async () => {
                setPartnerErr("");
                try { if (await disablePartner()) setPartnerPw(""); } catch (e) { setPartnerErr(e instanceof UserError ? e.message : String(e)); }
              }}><ShieldOff /> Matikan</Button>
            )}
          </div>
          <FormError>{partnerErr}</FormError>
        </Group>

        <Group title="Akun">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-sm">{s.accountEmail || "—"}</p>
            <Button type="button" variant="outline" size="lg" onClick={onChangePw}><KeyRound /> Ganti password</Button>
          </div>
        </Group>
      </div>

      <SheetFooter className="flex-row justify-end border-t">
        <Button type="button" variant="outline" size="lg" onClick={onDone}>Batal</Button>
        <Button type="submit" size="lg">Simpan</Button>
      </SheetFooter>
    </form>
  );
}

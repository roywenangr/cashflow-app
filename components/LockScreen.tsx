"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Loader2, LockKeyhole, RefreshCcw, ShieldCheck, Users } from "lucide-react";
import { MIN_PW, setLockMode, skipMigration, submitLock, UserError } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Brand, FieldLabel, FormError, Logo, PasswordInput, ThemeButton, useStore } from "./common";

const COPY = {
  login: { title: "Selamat datang kembali", sub: "Masuk untuk membuka data. Pakai akun yang sama di laptop & HP." },
  signup: { title: "Buat akun", sub: "Data disinkron ke cloud dalam bentuk terenkripsi." },
  migrate: { title: "Pindahkan data lama", sub: "Ada data lama di browser ini yang dikunci dengan password lain. Masukkan password lama itu untuk memindahkannya ke akun ini." },
  unsupported: { title: "Browser tidak didukung", sub: "Browser ini tidak mendukung enkripsi. Buka lewat https:// dengan browser modern." },
  noconfig: { title: "Belum dikonfigurasi", sub: "Sinkron cloud belum dikonfigurasi — isi Supabase URL & anon key di lib/config.ts." },
};

export default function LockScreen() {
  const s = useStore();
  const { mode } = s.lock;
  const signup = mode === "signup", migrate = mode === "migrate";
  const disabled = mode === "unsupported" || mode === "noconfig";

  const [email, setEmail] = useState(s.lock.email);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState(s.lock.error);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);

  // OwnerApp memasang ulang komponen ini (key) setiap mode/pesan berubah, jadi state di atas selalu segar.
  useEffect(() => {
    if (!disabled) (migrate || emailRef.current?.value ? pwRef.current : emailRef.current)?.focus();
  }, [disabled, migrate]);

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (busy || disabled) return;
    setError("");
    setBusy(true);
    try {
      await submitLock(email, pw, pw2);
    } catch (e) {
      setError(e instanceof UserError ? e.message : String(e));
      if (mode === "login" || mode === "migrate") pwRef.current?.select();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <BrandPanel />
      <div className="flex flex-col px-4 py-6 sm:px-8">
        <div className="flex items-center justify-between lg:justify-end">
          <div className="lg:hidden"><Brand sub="Profit Sharing - Made with <3" /></div>
          <ThemeButton />
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <form onSubmit={onSubmit} noValidate className="w-full max-w-sm space-y-5">
            <div className="space-y-1.5">
              <h1 className="text-2xl font-semibold tracking-tight">{COPY[mode].title}</h1>
              <p className="text-sm text-muted-foreground">{COPY[mode].sub}</p>
            </div>

            {s.lock.info && (
              <p role="status" className="rounded-lg bg-success/10 px-3 py-2 text-[13px] font-medium text-success-ink">{s.lock.info}</p>
            )}

            {!(migrate || disabled) && (
              <div className="space-y-1.5">
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input id="email" ref={emailRef} type="email" autoComplete="username" inputMode="email" autoCapitalize="off"
                  spellCheck={false} placeholder="nama@email.com" className="h-10" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            )}
            <div className="space-y-1.5">
              <FieldLabel htmlFor="pw">{migrate ? "Password lama" : "Password"}</FieldLabel>
              <PasswordInput id="pw" ref={pwRef} autoComplete={signup ? "new-password" : "current-password"} disabled={disabled}
                value={pw} onChange={(e) => setPw(e.target.value)} />
            </div>
            {signup && (
              <div className="space-y-1.5">
                <FieldLabel htmlFor="pw2">Ulangi password</FieldLabel>
                <PasswordInput id="pw2" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
                <p className="text-xs text-muted-foreground">
                  Minimal {MIN_PW} karakter. Password tidak bisa dipulihkan — tanpa password, data tidak bisa dibuka siapa pun, termasuk kamu.
                </p>
              </div>
            )}

            <FormError>{error}</FormError>

            <Button type="submit" size="lg" className="h-10 w-full" disabled={disabled || busy}>
              {busy ? <><Loader2 className="animate-spin" /> Memproses…</>
                : <>{signup ? "Daftar & masuk" : migrate ? "Pindahkan data" : "Masuk"} <ArrowRight /></>}
            </Button>

            {migrate && (
              <Button type="button" variant="ghost" size="lg" className="h-10 w-full" onClick={skipMigration}>
                Lewati — mulai dengan data kosong
              </Button>
            )}

            {!(migrate || disabled) && (
              <p className="text-center text-sm text-muted-foreground">
                {signup ? "Sudah punya akun?" : "Belum punya akun?"}{" "}
                <button type="button" className="font-medium text-primary hover:underline" onClick={() => setLockMode(signup ? "login" : "signup")}>
                  {signup ? "Masuk" : "Daftar"}
                </button>
              </p>
            )}

            <div className="relative py-1 text-center text-xs text-muted-foreground before:absolute before:inset-x-0 before:top-1/2 before:h-px before:bg-border">
              <span className="relative bg-background px-3">atau</span>
            </div>

            <Button asChild variant="outline" size="lg" className="h-10 w-full">
              <Link href="/partner"><Users /> Masuk sebagai partner</Link>
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

function BrandPanel() {
  return (
    <aside className="bg-hero relative hidden overflow-hidden p-10 text-white lg:flex lg:flex-col lg:justify-between">
      <div className="pointer-events-none absolute -top-32 -right-24 size-[28rem] rounded-full bg-white/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -left-20 size-[26rem] rounded-full bg-black/20 blur-3xl" />
      <div className="relative flex items-center gap-3">
        <Logo className="bg-white/15 bg-none" />
        <div className="leading-tight">
          <p className="font-semibold tracking-tight">Cashflowshit App</p>
          <p className="text-xs text-white/70">Profit Sharing - Made with &lt;3</p>
        </div>
      </div>
      <div className="relative max-w-md space-y-6">
        <h2 className="text-4xl leading-tight font-semibold tracking-tight">Bagi hasil yang rapi, transparan, dan aman.</h2>
        <ul className="space-y-4 text-sm text-white/85">
          <li className="flex gap-3"><ShieldCheck className="mt-0.5 size-5 shrink-0" /> Data dienkripsi di perangkatmu sebelum dikirim — server hanya menyimpan sandi acak.</li>
          <li className="flex gap-3"><RefreshCcw className="mt-0.5 size-5 shrink-0" /> Sinkron otomatis di laptop & HP, tetap jalan saat offline.</li>
          <li className="flex gap-3"><LockKeyhole className="mt-0.5 size-5 shrink-0" /> Partner punya portal sendiri — hanya melihat bagiannya.</li>
        </ul>
      </div>
      <p className="relative text-xs text-white/60">AES-256-GCM · PBKDF2 600.000 iterasi</p>
    </aside>
  );
}

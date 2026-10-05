"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MIN_PW, setLockMode, skipMigration, submitLock, UserError } from "@/lib/store";
import { PwToggle, useStore } from "./ui";

const SUBTITLE = {
  login: "Masuk untuk membuka data. Pakai akun yang sama di laptop & HP.",
  signup: "Buat akun. Data disinkron ke cloud dalam bentuk terenkripsi.",
  migrate: "Ada data lama di browser ini yang dikunci dengan password lain. Masukkan password lama itu untuk memindahkannya ke akun ini.",
  unsupported: "Browser ini tidak mendukung enkripsi. Buka lewat https:// atau localhost dengan browser modern.",
  noconfig: "Sinkron cloud belum dikonfigurasi — isi Supabase URL & anon key di lib/config.ts.",
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
    <section className="lock">
      <form className="lock__card" onSubmit={onSubmit} noValidate>
        <span className="topbar__logo lock__logo" aria-hidden="true">Rp</span>
        <h1 className="lock__title">Cashflowshit App</h1>
        <p className="lock__sub">{SUBTITLE[mode]}</p>
        {!(migrate || disabled) && (
          <label className="field">
            <span>Email</span>
            <input ref={emailRef} type="email" autoComplete="username" inputMode="email" autoCapitalize="off" spellCheck={false}
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
        )}
        <label className="field">
          <span>{migrate ? "Password lama" : "Password"}</span>
          <span className="pw">
            <input ref={pwRef} type="password" autoComplete={signup ? "new-password" : "current-password"} disabled={disabled}
              value={pw} onChange={(e) => setPw(e.target.value)} />
            <PwToggle />
          </span>
        </label>
        {signup && (
          <label className="field">
            <span>Ulangi password</span>
            <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </label>
        )}
        <p className="form-error" role="alert">{error}</p>
        <p className="form-info" role="status">{s.lock.info}</p>
        <button type="submit" className="btn btn--primary btn--block" disabled={disabled || busy}>
          {busy ? "Memproses…" : signup ? "Daftar & masuk" : migrate ? "Pindahkan data" : "Masuk"}
        </button>
        {migrate && (
          <button type="button" className="btn btn--ghost btn--block" onClick={() => {
            if (confirm("Mulai dengan data kosong? Data lama tetap tersimpan (terkunci) di browser ini.")) skipMigration();
          }}>Lewati — mulai dengan data kosong</button>
        )}
        {!(migrate || disabled) && (
          <p className="lock__switch">
            <span>{signup ? "Sudah punya akun?" : "Belum punya akun?"}</span>{" "}
            <button type="button" className="link-btn" onClick={() => setLockMode(signup ? "login" : "signup")}>
              {signup ? "Masuk" : "Daftar"}
            </button>
          </p>
        )}
        <p className="lock__note">
          {signup ? `Minimal ${MIN_PW} karakter. Password tidak bisa dipulihkan — tanpa password, data tidak bisa dibuka siapa pun, termasuk kamu.` : ""}
        </p>
        <Link className="btn btn--ghost btn--block lock__partner" href="/partner">Masuk sebagai partner</Link>
      </form>
    </section>
  );
}

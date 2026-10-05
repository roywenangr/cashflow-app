"use client";

// Potongan kecil yang dipakai di banyak layar.

import { useEffect, useState, useSyncExternalStore } from "react";
import { toast as sonner } from "sonner";
import { Eye, EyeOff, Moon, Sun } from "lucide-react";
import { getVersion, setConfirmHandler, store, subscribe, toggleTheme, type ConfirmOpts } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toaster } from "@/components/ui/sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Render ulang setiap kali store berubah.
export function useStore() {
  useSyncExternalStore(subscribe, getVersion, () => 0);
  return store;
}

// true hanya di browser — halaman ini tidak punya isi yang dirender di server.
export const useMounted = () => useSyncExternalStore(() => () => {}, () => true, () => false);

// Pesan dari store -> toast sonner. Juga memasang dialog konfirmasi untuk aksi berbahaya.
export function AppToaster() {
  const t = useStore().toast;
  useEffect(() => { if (t) sonner(t.msg, { id: t.id }); }, [t]);
  return (
    <>
      <Toaster position="bottom-center" />
      <ConfirmHost />
    </>
  );
}

function ConfirmHost() {
  const [req, setReq] = useState<null | { msg: string; opts: ConfirmOpts; resolve: (ok: boolean) => void }>(null);
  useEffect(() => {
    setConfirmHandler((msg, opts) => new Promise<boolean>((resolve) => setReq({ msg, opts, resolve })));
  }, []);
  const close = (ok: boolean) => { req?.resolve(ok); setReq(null); };
  return (
    <AlertDialog open={!!req} onOpenChange={(o) => { if (!o) close(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{req?.opts.title ?? "Yakin?"}</AlertDialogTitle>
          <AlertDialogDescription>{req?.msg}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => close(false)}>Batal</AlertDialogCancel>
          <AlertDialogAction variant={req?.opts.danger ? "destructive" : "default"} onClick={() => close(true)}>
            {req?.opts.confirmLabel ?? "Lanjutkan"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Logo: lencana gradasi dengan simbol Rp.
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("bg-hero grid size-9 shrink-0 place-items-center rounded-xl text-[13px] font-semibold tracking-tight text-white shadow-sm ring-1 ring-white/10", className)}>
      Rp
    </span>
  );
}

export function Brand({ sub }: { sub: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Logo />
      <div className="min-w-0 leading-tight">
        <p className="truncate text-[15px] font-semibold tracking-tight">Cashflowshit App</p>
        <p className="truncate text-xs text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

export function ThemeButton() {
  const s = useStore();
  return (
    <Button variant="ghost" size="icon-lg" aria-label="Ganti tema" title="Ganti tema" onClick={toggleTheme}>
      {s.state.theme === "dark" ? <Sun /> : <Moon />}
    </Button>
  );
}

// Input password dengan tombol lihat/sembunyikan.
export function PasswordInput(props: React.ComponentProps<typeof Input>) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={show ? "text" : "password"} className={cn("h-10 pr-10", props.className)} />
      <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Sembunyikan password" : "Tampilkan password"}
        className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground hover:text-foreground">
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

type Tone = "paid" | "due" | "partial" | "neutral";

// Status selalu dengan teks + titik, bukan warna saja.
export function StatusBadge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={cn(
      "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium",
      tone === "paid" && "bg-success/12 text-success-ink",
      tone === "due" && "bg-warning/15 text-warning-ink",
      tone === "partial" && "bg-warning/15 text-warning-ink",
      tone === "neutral" && "bg-muted text-muted-foreground",
    )}>
      <span className={cn("size-1.5 rounded-full",
        tone === "paid" ? "bg-success" : tone === "neutral" ? "bg-muted-foreground/60" : "bg-warning")} />
      {children}
    </span>
  );
}

export function FieldLabel({ children, hint, htmlFor }: { children: React.ReactNode; hint?: string; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="text-[13px] font-medium text-foreground/80">
      {children}{hint && <span className="font-normal text-muted-foreground"> {hint}</span>}
    </label>
  );
}

export function FormError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <p role="alert" className="text-[13px] font-medium text-destructive">{children}</p>;
}

// Bagian dengan judul + aksi di kanan.
export function Section({ title, action, children, className }: {
  title: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={cn("rounded-2xl border bg-card shadow-xs", className)}>
      <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 pt-4 pb-8 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5">{icon}</span>
      <p className="text-sm font-medium">{title}</p>
      {children && <p className="max-w-xs text-[13px] text-muted-foreground">{children}</p>}
    </div>
  );
}

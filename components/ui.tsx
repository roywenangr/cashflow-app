"use client";

// Komponen kecil yang dipakai di banyak tempat: hook store, modal <dialog>, toast, ikon.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getVersion, store, subscribe } from "@/lib/store";

// Render ulang setiap kali store berubah.
export function useStore() {
  useSyncExternalStore(subscribe, getVersion, () => 0);
  return store;
}

// <dialog> bawaan browser, dibuka/ditutup mengikuti prop `open`.
export function Modal({ open, onClose, className = "dialog", children }: {
  open: boolean; onClose: () => void; className?: string; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={className} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      {open ? children : null}
    </dialog>
  );
}

export function Toast() {
  const t = useStore().toast;
  return t ? <ToastMsg key={t.id} msg={t.msg} /> : <div className="toast" role="status" aria-live="polite" />;
}

// Satu pesan: muncul (animasi), lalu hilang sendiri setelah 2,6 detik.
function ToastMsg({ msg }: { msg: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShow(true));
    const timer = setTimeout(() => setShow(false), 2600);
    return () => { cancelAnimationFrame(raf); clearTimeout(timer); };
  }, []);
  return <div className={"toast" + (show ? " toast--show" : "")} role="status" aria-live="polite">{msg}</div>;
}

// Tombol "Lihat" — tampilkan/sembunyikan semua input password di form yang sama.
export function PwToggle() {
  const [shown, setShown] = useState(false);
  return (
    <button
      type="button"
      className="pw__toggle"
      aria-label={shown ? "Sembunyikan password" : "Tampilkan password"}
      onClick={(e) => {
        const form = (e.currentTarget as HTMLElement).closest("form");
        const show = !shown;
        form?.querySelectorAll<HTMLInputElement>('input[type="password"], input[data-pw-shown]').forEach((i) => {
          i.type = show ? "text" : "password";
          if (show) i.dataset.pwShown = ""; else delete i.dataset.pwShown;
        });
        setShown(show);
      }}
    >
      {shown ? "Sembunyikan" : "Lihat"}
    </button>
  );
}

// Tombol yang menampilkan "Memproses…" selama aksi async berjalan.
export function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };
  return [busy, run] as const;
}

const svg = { viewBox: "0 0 24 24", width: 20, height: 20, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const Icon = {
  chart: () => <svg {...svg}><path d="M18 20V10M12 20V4M6 20v-6" /></svg>,
  settings: () => (
    <svg {...svg}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  lock: () => <svg {...svg}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>,
  moon: () => <svg {...svg} className="ico-moon"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>,
  sun: () => (
    <svg {...svg} className="ico-sun">
      <circle cx="12" cy="12" r="5" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  ),
  refresh: () => <svg {...svg}><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>,
  prev: () => <svg {...svg} strokeWidth={2}><path d="M15 18l-6-6 6-6" /></svg>,
  next: () => <svg {...svg} strokeWidth={2}><path d="M9 18l6-6-6-6" /></svg>,
  close: () => <svg {...svg} width={18} height={18} strokeWidth={2}><path d="M18 6L6 18M6 6l12 12" /></svg>,
  trash: () => (
    <svg {...svg} width={16} height={16} strokeWidth={2}>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    </svg>
  ),
};

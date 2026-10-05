"use client";

// Animasi yang dipakai di banyak tempat. Semua menghormati pengaturan "kurangi gerakan" di perangkat
// (MotionConfig reducedMotion="user" + useReducedMotion untuk animasi angka).

import { useEffect, useRef } from "react";
import { animate, motion, MotionConfig, useInView, useReducedMotion, type Variants } from "motion/react";
import { fmtRp } from "@/lib/model";

export const ease = [0.22, 1, 0.36, 1] as const; // ease-out yang lembut

export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user" transition={{ duration: 0.45, ease }}>{children}</MotionConfig>;
}

// Kontainer yang memunculkan anak-anaknya bertahap.
const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.02 } },
};
export const rise: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease } },
};

export function Stagger({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className={className}>
      {children}
    </motion.div>
  );
}

// Satu blok yang naik + memudar masuk (dipakai di dalam <Stagger>).
export function Rise({ children, className }: { children: React.ReactNode; className?: string }) {
  return <motion.div variants={rise} className={className}>{children}</motion.div>;
}

// Transisi isi tab.
export function TabPanel({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease }}>
      {children}
    </motion.div>
  );
}

// Angka Rupiah yang "menghitung" ke nilai baru. Teks diperbarui langsung di DOM (tanpa render ulang React).
export function Money({ value, prefix = "", className }: { value: number; prefix?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const from = useRef(0);
  const reduce = useReducedMotion();
  const inView = useInView(ref, { once: true });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fmt = (v: number) => prefix + fmtRp(v);
    if (reduce || !inView) {
      el.textContent = fmt(value);
      if (!inView) return; // tunggu sampai terlihat, baru dianimasikan
      from.current = value;
      return;
    }
    const controls = animate(from.current, value, {
      duration: Math.min(1.1, 0.5 + Math.abs(value - from.current) / 4e7),
      ease,
      onUpdate: (v) => { el.textContent = fmt(v); },
    });
    from.current = value;
    return () => controls.stop();
  }, [value, prefix, reduce, inView]);

  return <span ref={ref} className={className}>{prefix + fmtRp(value)}</span>;
}

// Item daftar yang masuk/keluar dengan halus (bungkus dengan <AnimatePresence initial={false}>).
export const listItem = {
  layout: true,
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: "auto" },
  exit: { opacity: 0, height: 0 },
  transition: { duration: 0.3, ease },
} as const;

export { AnimatePresence, motion } from "motion/react";

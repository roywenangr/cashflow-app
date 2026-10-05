"use client";

import { useEffect } from "react";
import { start } from "@/lib/store";
import LockScreen from "./LockScreen";
import Dashboard from "./Dashboard";
import { ConflictDialog } from "./dialogs";
import { Toast, useStore } from "./ui";

export default function OwnerApp() {
  const s = useStore();
  useEffect(() => { start(); }, []);
  if (!s.ready) return null; // semua data ada di browser — tidak ada yang dirender di server
  return (
    <>
      {s.unlocked ? <Dashboard /> : <LockScreen key={`${s.lock.mode}|${s.lock.error}|${s.lock.info}`} />}
      <ConflictDialog />
      <Toast />
    </>
  );
}

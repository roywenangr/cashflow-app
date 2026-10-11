// Sambungan ke bot Telegram pencatat keuangan (app terpisah). Bot yang memegang dompet & saldo;
// app ini hanya membaca daftarnya dan mengabari saat payout dibayar / dibatalkan.

import type { BotJob, BotSync } from "./model";

export const DEFAULT_BOT_URL = "https://mycashflow-smoky.vercel.app";

export type BotWallet = { id: number; name: string; balance: number };
export type BotWallets = {
  me: string;
  wallets: BotWallet[];
  partner: { name: string; wallets: { id: number; name: string }[] } | null;
};

// Ditolak bot (token salah, dompet sudah dihapus, ...) — mengulang tidak akan membantu.
export class BotRejected extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function call(cfg: BotSync, path: string, init: RequestInit = {}) {
  const res = await fetch(cfg.url + path, {
    ...init,
    headers: { Authorization: `Bearer ${cfg.token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });
  const body = await res.json().catch(() => null);
  if (res.ok && body) return body;
  if (res.status >= 400 && res.status < 500) throw new BotRejected(body?.error || `Ditolak bot (${res.status})`, res.status);
  throw new Error(`Bot sedang bermasalah (${res.status})`);
}

export const fetchBotWallets = (cfg: BotSync): Promise<BotWallets> => call(cfg, "/api/sync/wallets");

export function sendBotJob(cfg: BotSync, job: BotJob): Promise<{ status: string }> {
  const { op, ...body } = job;
  return call(cfg, "/api/sync/payouts", { method: op === "pay" ? "POST" : "DELETE", body: JSON.stringify(body) });
}

// Akses Supabase lewat REST (tanpa SDK) — sama seperti versi lama.

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import { normEmail } from "./crypto";

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, body: Record<string, string>) {
    super(body.msg || body.error_description || body.message || body.error || `HTTP ${status}`);
    this.status = status;
    this.code = body.error_code || body.code || body.error || "";
  }
}
export const isNetworkError = (e: unknown) => !(e instanceof ApiError);

type HttpOpts = { body?: unknown; token?: string; headers?: Record<string, string> };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function http(method: string, path: string, { body, token, headers = {} }: HttpOpts = {}): Promise<any> {
  const res = await fetch(SUPABASE_URL.replace(/\/+$/, "") + path, {
    method,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: "Bearer " + (token || SUPABASE_ANON_KEY),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { message: text }; }
  if (!res.ok) throw new ApiError(res.status, json || {});
  return json;
}

// Fungsi publik (tanpa login) untuk halaman partner & link share.
export const rpc = (fn: string, args: Record<string, unknown>) => http("POST", "/rest/v1/rpc/" + fn, { body: args });

// ---------- Sesi ----------

export type Session = { access_token: string; refresh_token: string; expires_at: number; userId: string; email: string };
type AuthResponse = { access_token: string; refresh_token: string; expires_in?: number; user?: { id: string; email?: string } };

let session: Session | null = null;
let onSessionChange: (() => void) | null = null;

export const getSession = () => session;
export const setOnSessionChange = (fn: () => void) => { onSessionChange = fn; };
export function clearSession() { session = null; }
export function restoreSession(s: Session) { session = s; }

export function setSession(r: AuthResponse, email?: string) {
  session = {
    access_token: r.access_token,
    refresh_token: r.refresh_token,
    expires_at: Date.now() + (r.expires_in || 3600) * 1000,
    userId: r.user ? r.user.id : (session?.userId ?? ""),
    email: normEmail(email || r.user?.email || session?.email),
  };
  onSessionChange?.();
}

export const appUrl = () => location.origin + "/";

export const auth = {
  // redirect_to: link konfirmasi di email kembali ke alamat aplikasi ini
  // (harus terdaftar di Supabase > Authentication > URL Configuration > Redirect URLs; kalau tidak, dipakai Site URL)
  signUp: (email: string, secret: string) =>
    http("POST", "/auth/v1/signup?redirect_to=" + encodeURIComponent(appUrl()), { body: { email, password: secret } }),
  signIn: (email: string, secret: string) =>
    http("POST", "/auth/v1/token?grant_type=password", { body: { email, password: secret } }),
  refresh: (rt: string) => http("POST", "/auth/v1/token?grant_type=refresh_token", { body: { refresh_token: rt } }),
  logout: (token: string) => http("POST", "/auth/v1/logout", { token }),
};

async function freshToken() {
  if (!session) throw new ApiError(401, { msg: "not signed in" });
  if (Date.now() > session.expires_at - 60_000) setSession(await auth.refresh(session.refresh_token));
  return session!.access_token;
}

// Request dengan token user; kalau 401 coba refresh sekali.
async function authed(method: string, path: string, opts: HttpOpts = {}) {
  try {
    return await http(method, path, { ...opts, token: await freshToken() });
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401 || !session) throw e;
    setSession(await auth.refresh(session.refresh_token));
    return http(method, path, { ...opts, token: session!.access_token });
  }
}

const uid = () => encodeURIComponent(session!.userId);
const idList = (ids: string[]) => ids.map(encodeURIComponent).join(",");

export const remote = {
  async get(): Promise<{ data: string; version: number; updated_at: string } | null> {
    const rows = await authed("GET", "/rest/v1/vaults?select=data,version,updated_at");
    return rows && rows[0] ? rows[0] : null;
  },
  // Tulis dengan cek versi (optimistic locking). Mengembalikan versi baru, atau null kalau keduluan perangkat lain.
  async put(data: string, baseVersion: number): Promise<number | null> {
    const now = new Date().toISOString();
    if (!baseVersion) {
      try {
        const rows = await authed("POST", "/rest/v1/vaults", {
          body: { data, version: 1, updated_at: now },
          headers: { Prefer: "return=representation" },
        });
        return rows[0].version;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) return null; // sudah ada baris dari perangkat lain
        throw e;
      }
    }
    const rows = await authed("PATCH", `/rest/v1/vaults?user_id=eq.${uid()}&version=eq.${baseVersion}`, {
      body: { data, version: baseVersion + 1, updated_at: now },
      headers: { Prefer: "return=representation" },
    });
    return rows && rows[0] ? rows[0].version : null;
  },
  putReceipt: (id: string, data: string) => authed("POST", "/rest/v1/receipts", { body: { id, data } }),
  async getReceipt(id: string): Promise<string | null> {
    const rows = await authed("GET", `/rest/v1/receipts?id=eq.${encodeURIComponent(id)}&select=data`);
    return rows && rows[0] ? rows[0].data : null;
  },
  deleteReceipts: (ids: string[]) => authed("DELETE", `/rest/v1/receipts?id=in.(${idList(ids)})`),
  deleteAllReceipts: () => authed("DELETE", `/rest/v1/receipts?user_id=eq.${uid()}`),
  putShare: (id: string, data: string, receiptIds: string[]) =>
    authed("POST", "/rest/v1/shares", { body: { id, data, receipt_ids: receiptIds } }),
  deleteShares: (ids: string[]) => authed("DELETE", `/rest/v1/shares?id=in.(${idList(ids)})`),
  deleteAllShares: () => authed("DELETE", `/rest/v1/shares?user_id=eq.${uid()}`),
  // on_conflict=user_id: satu baris per pemilik; ganti password partner = ganti lookup di baris yang sama
  putPartnerView: (body: { lookup: string; data: string; receipt_ids: string[]; updated_at: string }) =>
    authed("POST", "/rest/v1/partner_views?on_conflict=user_id", { body, headers: { Prefer: "resolution=merge-duplicates" } }),
  deletePartnerView: () => authed("DELETE", `/rest/v1/partner_views?user_id=eq.${uid()}`),
  updatePassword: (secret: string) => authed("PUT", "/auth/v1/user", { body: { password: secret } }),
};

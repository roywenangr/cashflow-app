// Enkripsi — format HARUS tetap sama dengan versi lama supaya data & link lama tetap terbaca.
//
// Dari password + email diturunkan 512 bit (PBKDF2-SHA256):
//   - 256 bit pertama -> "password" untuk login Supabase (password asli tidak pernah dikirim)
//   - 256 bit kedua   -> kunci AES-GCM untuk data (tidak pernah meninggalkan perangkat)
// Jadi Supabase tidak bisa membuka data walau menyimpan hash login & ciphertext.

export const KDF_ITER = 600_000;
const ENC_KEY = "cashflow.enc.v1"; // format lama (terenkripsi, lokal saja) — hanya untuk migrasi

export function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  return btoa(s);
}
export const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
export const b64url = (b64: string) => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export function fromB64url(s: string) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return fromB64(b64 + "===".slice((b64.length + 3) % 4));
}
export const normEmail = (e: unknown) => String(e || "").trim().toLowerCase();

const enc = (s: string) => new TextEncoder().encode(s);

async function pbkdf2Bits(password: string, salt: string) {
  const base = await crypto.subtle.importKey("raw", enc(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc(salt), iterations: KDF_ITER, hash: "SHA-256" }, base, 512));
}

export async function deriveCredentials(email: string, password: string) {
  const bits = await pbkdf2Bits(password, "cashflow-v2:" + normEmail(email));
  const key = await crypto.subtle.importKey("raw", bits.slice(32), { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
  return { authSecret: toHex(bits.slice(0, 32)), key };
}

// Password partner -> lookup (untuk menemukan baris di server) + kunci AES.
export async function derivePartner(password: string) {
  const bits = await pbkdf2Bits(password, "cashflow-partner-v1");
  return { lookup: toHex(bits.slice(0, 32)), k: toB64(bits.slice(32)) };
}

export async function encryptJson(key: CryptoKey, json: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc(json));
  return JSON.stringify({ v: 2, iv: toB64(iv), data: toB64(ct) });
}

export async function encryptWithRawKey(k: string, json: string) {
  const key = await crypto.subtle.importKey("raw", fromB64(k), { name: "AES-GCM" }, false, ["encrypt"]);
  return encryptJson(key, json);
}

type Blob64 = { iv: string; data: string; type?: string; salt?: string; iter?: number };

export async function decryptBlob<T = unknown>(key: CryptoKey, blobStr: string | Blob64): Promise<T> {
  const blob: Blob64 = typeof blobStr === "string" ? JSON.parse(blobStr) : blobStr;
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(blob.iv) }, key, fromB64(blob.data));
  return JSON.parse(new TextDecoder().decode(pt));
}

// Kunci acak per item (bukti transfer, link share): kuncinya disimpan di dalam data terenkripsi lain.
export async function encryptWithRandomKey(bytes: ArrayBuffer | Uint8Array, type: string) {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes as BufferSource);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  return { k: toB64(raw), data: JSON.stringify({ v: 1, type, iv: toB64(iv), data: toB64(ct) }) };
}

// Dekripsi item berkunci acak. k boleh base64 biasa atau base64url (dari #hash link).
export async function decryptWithRawKey(k: Uint8Array | string, dataStr: string) {
  const blob: Blob64 = JSON.parse(dataStr);
  const raw = typeof k === "string" ? fromB64(k) : k;
  const key = await crypto.subtle.importKey("raw", raw as BufferSource, { name: "AES-GCM" }, false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(blob.iv) }, key, fromB64(blob.data));
  return { bytes: pt, type: blob.type };
}

export async function decryptReceipt(k: string, dataStr: string) {
  const { bytes, type } = await decryptWithRawKey(k, dataStr);
  return new Blob([bytes], { type: type || "image/jpeg" });
}

// Format lama (v1, lokal saja): kunci dari password + salt acak yang disimpan bersama data.
export async function decryptLegacyLocal(password: string) {
  let blob: Blob64 | null;
  try { blob = JSON.parse(localStorage.getItem(ENC_KEY) || "null"); } catch { return null; }
  if (!blob || !blob.salt) return null;
  const base = await crypto.subtle.importKey("raw", enc(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: fromB64(blob.salt), iterations: blob.iter || KDF_ITER, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  try { return await decryptBlob(key, blob); } catch { return null; }
}

export const hasLegacyLocal = () => { try { return !!localStorage.getItem(ENC_KEY); } catch { return false; } };
export const clearLegacyLocal = () => { try { localStorage.removeItem(ENC_KEY); } catch { /* abaikan */ } };

// Konfigurasi Supabase. Kedua nilai ini memang aman untuk publik (anon key dibatasi
// Row Level Security di database) — JANGAN taruh service_role key di sini.
// Bisa ditimpa lewat environment variable (mis. di Vercel).
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://minatyuenzobnejpultf.supabase.co";
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1pbmF0eXVlbnpvYm5lanB1bHRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTExMzQyMDQsImV4cCI6MjEwNjcxMDIwNH0.HfRsnqAMWEiGC1ahEzrrP6vyEkiWYWNY9TjjXCZEPjs";

export const cloudConfigured = () => /^https?:\/\//.test(SUPABASE_URL) && !!SUPABASE_ANON_KEY;

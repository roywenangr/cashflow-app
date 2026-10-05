import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cashflowshit App",
  description: "Profit sharing — Made with <3",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0d0d0d",
};

// Pasang tema sebelum halaman tampil supaya tidak berkedip gelap/terang.
const themeScript = `try{var t=localStorage.getItem("cashflow.theme");document.documentElement.dataset.theme=t==="light"||t==="dark"?t:(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark")}catch(e){document.documentElement.dataset.theme="dark"}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import ShareView from "@/components/ShareView";

export const metadata: Metadata = { title: "Detail Payout", robots: { index: false } };

export default function SharePage() {
  return <ShareView />;
}

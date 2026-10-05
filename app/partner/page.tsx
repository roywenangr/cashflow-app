import type { Metadata } from "next";
import PartnerApp from "@/components/PartnerApp";

export const metadata: Metadata = { title: "Cashflowshit Partner", robots: { index: false } };

export default function PartnerPage() {
  return <PartnerApp />;
}

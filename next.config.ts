import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Alamat lama (versi HTML biasa) tetap jalan. #hash link ikut terbawa oleh browser saat redirect.
  async redirects() {
    return [
      { source: "/index.html", destination: "/", permanent: true },
      { source: "/partner.html", destination: "/partner", permanent: true },
      { source: "/share.html", destination: "/share", permanent: true },
    ];
  },
};

export default nextConfig;

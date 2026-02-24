/** @type {import('next').NextConfig} */
const supabaseHost = (() => {
  try {
    const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!raw) return null;
    return new URL(raw).hostname;
  } catch {
    return null;
  }
})();

const nextConfig = {
  // Keep this simple + stable. Add allowedDevOrigins only if you truly need it.
  reactStrictMode: true,
  productionBrowserSourceMaps: true,
  images: {
    remotePatterns: supabaseHost
      ? [
          {
            protocol: "https",
            hostname: supabaseHost,
            pathname: "/storage/v1/object/public/**"
          }
        ]
      : []
  }
};

module.exports = nextConfig;

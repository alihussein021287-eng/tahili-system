/** @type {import('next').NextConfig} */

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
];

const noStoreHeaders = [
  { key: "Cache-Control", value: "no-store, no-cache, max-age=0, must-revalidate" },
  { key: "Pragma", value: "no-cache" },
];

const noStoreRoutes = [
  "/",
  "/login",
  "/display",
  "/portal/:path*",
  "/api/:path*",
  "/account/:path*",
  "/analytics/:path*",
  "/appointments/:path*",
  "/approvals/:path*",
  "/attendance/:path*",
  "/audit/:path*",
  "/backup/:path*",
  "/beds/:path*",
  "/care-board/:path*",
  "/devices/:path*",
  "/finance/:path*",
  "/inventory/:path*",
  "/login-log/:path*",
  "/maintenance/:path*",
  "/meds/:path*",
  "/patients/:path*",
  "/permissions/:path*",
  "/pharmacy/:path*",
  "/queue/:path*",
  "/readiness/:path*",
  "/reports/:path*",
  "/search/:path*",
  "/settings/:path*",
  "/shifts/:path*",
  "/station-kpis/:path*",
  "/tasks/:path*",
  "/users/:path*",
  "/workload/:path*",
  "/workspaces/:path*",
];

const nextConfig = {
  reactStrictMode: true,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      ...noStoreRoutes.map((source) => ({
        source,
        headers: noStoreHeaders,
      })),
    ];
  },
};

export default nextConfig;

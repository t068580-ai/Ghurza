/** @type {import('next').NextConfig} */
const securityHeaders = [
  // Nobody may frame the app (clickjacking).
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Content-Security-Policy',
    // Script rules are left to Next.js defaults (it needs inline bootstrap scripts);
    // these directives lock down framing, plugins, base tags and form targets.
    value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
  },
  // HSTS only in production (served over https); on http://localhost it would be ignored
  // and could pin a dev hostname to https by mistake.
  ...(process.env.NODE_ENV === 'production'
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
    : []),
]

const nextConfig = {
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // Reference photos are capped at 2 MB in validation; leave a little headroom.
      bodySizeLimit: '3mb',
    },
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // Uploaded files: nothing inside may run, even if opened directly. This rule
      // must come LAST: when two rules set the same header, the later one wins, and
      // config headers also override headers set by the route handler itself.
      {
        source: '/api/files/:path*',
        headers: [{ key: 'Content-Security-Policy', value: "default-src 'none'; sandbox" }],
      },
    ]
  },
}

export default nextConfig

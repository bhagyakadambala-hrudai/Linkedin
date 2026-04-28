
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Only treat files ending in .page.tsx, .page.ts, etc as routes. 
  // This prevents the existing 'pages/' directory (which contains SPA components) from being treated as Next.js routes.
  pageExtensions: ['page.tsx', 'page.ts', 'page.jsx', 'page.js'],
};

module.exports = nextConfig;

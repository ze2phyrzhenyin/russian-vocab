import type { NextConfig } from 'next';
const config: NextConfig = {
  output: 'standalone',
  outputFileTracingExcludes: {'/*':['./data/**','./.env*','./.local/**','./artifacts/**','./tests/**','./docs/**']},
  poweredByHeader: false,
  serverExternalPackages: ['@prisma/client', '@prisma/adapter-pg', 'pg'],
  async headers() {
    return [{source: '/api/:path*', headers: [
      {key:'Cache-Control',value:'private, no-store'},
      {key:'X-Content-Type-Options',value:'nosniff'},
    ]}, {source:'/:path*',headers:[
      {key:'Referrer-Policy',value:'same-origin'},
      {key:'X-Frame-Options',value:'DENY'},
    ]}];
  },
};
export default config;

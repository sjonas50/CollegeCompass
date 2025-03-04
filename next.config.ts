/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['images.unsplash.com'],
  },
  experimental: {
    serverComponentsExternalPackages: ['mongoose', 'jsonwebtoken'],
  },
  serverRuntimeConfig: {
    PROJECT_ROOT: __dirname
  }
};

export default nextConfig;

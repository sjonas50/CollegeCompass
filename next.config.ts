/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['images.unsplash.com'],
  },
  experimental: {
    serverExternalPackages: ['mongoose', 'jsonwebtoken']
  },
  serverRuntimeConfig: {
    PROJECT_ROOT: __dirname
  }
};

export default nextConfig;

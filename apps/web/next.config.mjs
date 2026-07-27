/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@zvedeno/shared", "@zvedeno/reporting"]
};

export default nextConfig;

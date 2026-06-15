/** @type {import('next').NextConfig} */
const nextConfig = {
  // @resvg/resvg-js es un addon nativo (Rust, binario .node). Hay que sacarlo del bundle
  // de webpack para que Next lo cargue por require() en runtime, y asegurar que el binario
  // de Linux quede incluido en la función serverless de Vercel.
  // (Next 14.2: ambas claves van bajo experimental; en Next 15 pasan a top-level
  //  serverExternalPackages / outputFileTracingIncludes.)
  experimental: {
    serverComponentsExternalPackages: ["@resvg/resvg-js"],
    outputFileTracingIncludes: {
      "/api/extract": ["./node_modules/@resvg/resvg-js-linux-x64-gnu/**/*"],
    },
  },
};

export default nextConfig;

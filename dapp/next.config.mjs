/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // The pure-SDK (../sdk) uses NodeNext-style `.js` import specifiers that point at `.ts` sources.
    // Teach webpack to resolve `.js` -> `.ts`/`.tsx` so we can import the SDK source directly.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      ...config.resolve.extensionAlias,
    };
    return config;
  },
};

export default nextConfig;

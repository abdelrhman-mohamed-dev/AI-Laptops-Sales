/** @type {import('next').NextConfig} */
const nextConfig = {};

module.exports = {
  async rewrites() {
    return {
      fallback: [
        {
          source: "api/rag",
          destination: `https://ai-laptops.netlify.app/api/rag`,
        },
      ],
    };
  },
};
export default nextConfig;

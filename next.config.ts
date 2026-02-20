/** @type {import('next').NextConfig} */
const nextConfig = {
  rewrites: async () => {
    return [
      {
        source: '/api/analyze',
        destination: '/api/index.py',
      },
    ];
  },
};

module.exports = nextConfig;

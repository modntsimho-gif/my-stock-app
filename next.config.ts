/** @type {import('next').NextConfig} */
const nextConfig = {
  rewrites: async () => {
    return [
      {
        source: '/api/:path*', // 모든 /api/로 시작하는 요청을
        destination: '/api/index.py', // 파이썬 파일로 보냅니다.
      },
    ];
  },
};

module.exports = nextConfig;

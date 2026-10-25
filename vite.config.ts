import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// GitHub Pages 部署在 /<repository>/ 子路径下：CI 中通过 BASE_PATH 指定。
// 本地默认使用相对路径 './'，构建产物放在任意子目录都能加载静态资源。
export default defineConfig({
  base: process.env.BASE_PATH ?? './',
  plugins: [react()],
  // 单页工具，React Flow + Dagre 打包后约 500 kB（gzip 约 160 kB），无需拆分
  build: { chunkSizeWarningLimit: 700 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});

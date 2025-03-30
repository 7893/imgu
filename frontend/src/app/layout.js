// /home/admin/imgu/frontend/src/app/layout.js (Updated with Noto Sans SC)
import { Inter } from "next/font/google";
// 导入 Noto Sans SC
import { Noto_Sans_SC } from "next/font/google";
import "./globals.css";

// 配置 Noto Sans SC，选择合适的字重
const noto_sans_sc = Noto_Sans_SC({
  subsets: ["latin"], // 通常需要包含 latin 子集
  weight: ['400', '700'] // 选择需要的字重，400=Regular, 700=Bold
});

// Inter 字体可以保留作为备用，或者完全移除
// const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "Unsplash 图片库", // 改为中文标题
  description: "由 Vercel, Cloudflare R2, AWS Lambda/DynamoDB/StepFunctions 驱动",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN"> {/* 设置语言为中文 */}
      {/* 应用 Noto Sans SC 字体 */}
      <body className={noto_sans_sc.className}>{children}</body>
    </html>
  );
}

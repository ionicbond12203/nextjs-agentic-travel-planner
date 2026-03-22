import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "旅游 AI 规划师 | Travel Planner",
  description: "智能旅游规划助手 - 基于 AI 的个性化行程推荐",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

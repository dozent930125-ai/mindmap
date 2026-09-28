import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "자동 가계부",
  description: "문자로 자동 입력되는 개인 가계부",
  appleWebApp: { capable: true, title: "가계부" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <nav className="top">
          <Link href="/" className="brand">자동 가계부</Link>
          <Link href="/" className="tab">대시보드</Link>
          <Link href="/rules" className="tab">분류 규칙</Link>
          <Link href="/import" className="tab">가져오기</Link>
          <Link href="/setup" className="tab">연동 설정</Link>
        </nav>
        {children}
      </body>
    </html>
  );
}

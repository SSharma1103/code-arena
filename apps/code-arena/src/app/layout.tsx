import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Code Arena",
  description: "One prompt. Four possibilities. Explore SVG, Three.js, HTML and live agent reasoning.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

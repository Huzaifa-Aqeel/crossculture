import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CrossCulture — Discover better partnerships",
  description: "Find culturally credible collaboration opportunities and turn promising matches into practical ideas.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

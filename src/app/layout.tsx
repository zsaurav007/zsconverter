import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ZS Converter",
  description: "A fast, private, browser-based toolkit. Developed by Zulkarnain Saurav (+8801615201545)",
};

// Locks the viewport on mobile devices to prevent accidental zooming 
// when dragging sliders, cropping images, or moving PDF pages.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#f8fafc", // matches bg-slate-50 for a seamless mobile status bar
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* overscroll-none prevents the rubber-band "pull-to-refresh" bounce on mobile browsers */}
      <body className="min-h-full flex flex-col overscroll-none bg-slate-50 text-slate-900 selection:bg-[#6384A3] selection:text-white">
        {children}
      </body>
    </html>
  );
}
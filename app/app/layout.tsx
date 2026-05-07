import type { Metadata } from "next";
import "./globals.css";
import { WalletProvider } from "./components/WalletProvider";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { Toaster } from "./components/Toaster";

export const metadata: Metadata = {
  title: "Sealed — Private NFT auctions on Solana",
  description:
    "Vickrey-style sealed-bid NFT auctions powered by Arcium MPC. Bidders' amounts stay encrypted until the winner is decided.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          <div className="flex min-h-screen flex-col">
            <Header />
            <main className="flex-1">{children}</main>
            <Footer />
          </div>
          <Toaster />
        </WalletProvider>
      </body>
    </html>
  );
}

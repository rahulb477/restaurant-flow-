import type { ReactNode } from "react";
import { Nav, Footer } from "@/components/marketing";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <Nav />
      <main>{children}</main>
      <Footer />
    </div>
  );
}

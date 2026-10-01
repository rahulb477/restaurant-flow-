import type { ReactNode } from "react";
import Link from "next/link";
import { Logo } from "@/components/marketing";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative grid min-h-screen place-items-center px-4 py-10">
      <div className="grid-bg absolute inset-0" aria-hidden />
      <div className="relative w-full max-w-md">
        <Link href="/" className="mb-8 flex justify-center" aria-label="Home"><Logo /></Link>
        {children}
      </div>
    </div>
  );
}

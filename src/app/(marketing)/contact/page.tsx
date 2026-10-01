import type { Metadata } from "next";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { Eyebrow, Section } from "@/components/marketing";
import { publicEnv } from "@/config/env";

export const metadata: Metadata = { title: "Contact", description: "Talk to the team." };

export default function Contact() {
  const wa = publicEnv.supportWhatsapp.replace(/[^\d]/g, "");
  return (
    <Section className="max-w-2xl py-20">
      <Eyebrow>Contact</Eyebrow>
      <h1 className="font-display text-4xl font-semibold tracking-tight md:text-5xl">We’re here to help</h1>
      <div className="mt-10 rounded-2xl border border-line bg-surface p-6">
        {wa ? (
          <>
            <p className="text-muted">Chat with our support team on WhatsApp for onboarding help, billing questions or feature requests.</p>
            <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex h-11 items-center gap-2 rounded-xl bg-[#25d366] px-5 font-semibold text-black"><MessageCircle className="size-4" />Chat on WhatsApp</a>
          </>
        ) : (
          <p className="text-muted">A public support channel has not been configured by the platform operator yet. If you already have an account, sign in and use the in-app support link in Settings.</p>
        )}
        <Link href="/login" className="mt-5 block text-sm text-accent hover:underline">Sign in to your workspace →</Link>
      </div>
    </Section>
  );
}

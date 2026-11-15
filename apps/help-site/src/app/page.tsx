import { Features } from "@/components/landing/Features";
import { Hero } from "@/components/landing/Hero";
import { Integrations } from "@/components/landing/Integrations";
import { ClosingCta, Developers, Privacy } from "@/components/landing/Privacy";
import { ScrollReveal } from "@/components/landing/ScrollReveal";
import { Walkthroughs } from "@/components/landing/Walkthroughs";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: { absolute: "Toby: the AI assistant for your Mac" },
	description:
		"Toby connects to your email, calendar, tasks, and team tools so you can ask for help in plain English, get meetings written up, and automate routine work.",
	alternates: { canonical: "/" },
};

export default function Home() {
	return (
		<main>
			<ScrollReveal />
			<Hero />
			<Integrations />
			<Features />
			<Walkthroughs />
			<Privacy />
			<Developers />
			<ClosingCta />
		</main>
	);
}

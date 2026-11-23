import { Container, TextLink } from "./primitives";

const apps = [
	{ name: "Email", icon: "/img/integrations/email.png" },
	{ name: "Apple Calendar", icon: "/img/integrations/apple-calendar.png" },
	{ name: "Apple Reminders", icon: "/img/integrations/apple-reminders.png" },
	{ name: "Slack", icon: "/img/integrations/slack.png" },
	{ name: "macOS", icon: "/img/integrations/macos.png" },
] as const;

function LogoRow({
	items,
}: {
	readonly items: readonly { name: string; icon: string }[];
}) {
	return (
		<ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-5">
			{items.map((item) => (
				<li
					key={item.name}
					className="flex items-center gap-2.5 text-sm text-faint grayscale transition duration-200 hover:text-fg hover:grayscale-0"
				>
					<img
						src={item.icon}
						alt=""
						width={22}
						height={22}
						loading="lazy"
						className="size-[22px] object-contain opacity-70"
					/>
					{item.name}
				</li>
			))}
		</ul>
	);
}

export function Integrations() {
	return (
		<section
			id="integrations"
			className="scroll-mt-navbar border-y border-line-subtle py-16"
		>
			<Container>
				<div data-reveal className="text-center">
					<p className="mb-8 text-sm text-muted">
						Built in: the apps you already use
					</p>
					<LogoRow items={apps} />
					<p className="mt-12 text-sm text-muted">
						AI through your OpenRouter account
					</p>
					<div className="mt-10">
						<TextLink href="/docs/integrations/overview">
							See all sources
						</TextLink>
					</div>
				</div>
			</Container>
		</section>
	);
}

import tobyLogo from "@/assets/toby-logo.png";
import { ChatInboundStatusBadge } from "@/components/ChatInboundStatusBadge";
import { DaemonStatusBadge } from "@/components/DaemonStatusBadge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

const tabs = [
	{ id: "configure", label: "Configuration", path: "/configure" },
	{ id: "sessions", label: "Sessions", path: "/sessions" },
	{ id: "memories", label: "Memories", path: "/memories" },
] as const;

export function AppShell() {
	const location = useLocation();
	const navigate = useNavigate();
	const activeTab =
		tabs.find((t) => location.pathname.startsWith(t.path))?.id ?? "configure";

	return (
		<div className="flex flex-col h-svh bg-background text-foreground">
			<header className="flex items-center gap-6 px-6 h-14 border-b shrink-0">
				<div className="flex items-center gap-2.5 shrink-0">
					<img
						src={tobyLogo}
						alt=""
						className="size-7 shrink-0"
						width={28}
						height={28}
						aria-hidden
					/>
					<span className="font-semibold text-sm tracking-[0.14em]">TOBY</span>
				</div>
				<Tabs
					value={activeTab}
					onValueChange={(v) => {
						const tab = tabs.find((t) => t.id === v);
						if (tab) navigate(tab.path);
					}}
				>
					<TabsList>
						{tabs.map((tab) => (
							<TabsTrigger key={tab.id} value={tab.id}>
								{tab.label}
							</TabsTrigger>
						))}
					</TabsList>
				</Tabs>
				<div className="ml-auto flex items-center gap-3 shrink-0">
					<ChatInboundStatusBadge />
					<DaemonStatusBadge />
				</div>
			</header>
			<main className="flex-1 min-h-0 overflow-hidden">
				<Outlet />
			</main>
		</div>
	);
}

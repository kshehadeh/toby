import { Badge } from "@/components/ui/badge";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/api/client";
import { cn } from "@/lib/utils";
import type { ChatInboundStatus } from "@/types";
import { useQuery } from "@tanstack/react-query";
import { MessageSquareOff } from "lucide-react";

function statusDotClass(status: ChatInboundStatus["status"]): string {
	switch (status) {
		case "connected":
			return "bg-emerald-500";
		case "connecting":
			return "bg-amber-500 animate-pulse";
		case "error":
			return "bg-destructive";
		case "idle":
			return "bg-muted-foreground/70";
		default:
			return "bg-muted-foreground/40";
	}
}

function statusLabel(status: ChatInboundStatus["status"]): string {
	switch (status) {
		case "connected":
			return "Connected";
		case "connecting":
			return "Connecting";
		case "error":
			return "Error";
		case "idle":
			return "Idle";
		default:
			return "Off";
	}
}

function buildSummary(chat: ChatInboundStatus): string {
	if (!chat.enabled || chat.status === "disabled") {
		return "Chat inbound off";
	}
	const provider = chat.integrationLabel ?? chat.integration ?? "Chat";
	if (chat.status === "connected") {
		return `${provider} · connected`;
	}
	return `${provider} · ${statusLabel(chat.status).toLowerCase()}`;
}

function buildTooltip(chat: ChatInboundStatus): string {
	if (chat.disabledReason) {
		return chat.disabledReason;
	}
	const provider = chat.integrationLabel ?? chat.integration ?? "Chat provider";
	const lines = [`Listening on ${provider} (${statusLabel(chat.status).toLowerCase()}).`];
	if (chat.detail) {
		lines.push(chat.detail);
	}
	return lines.join("\n");
}

export function ChatInboundStatusBadge() {
	const { data, isLoading, isError } = useQuery({
		queryKey: ["daemon-status"],
		queryFn: () => api.daemonStatus(),
		refetchInterval: 10_000,
	});

	if (isLoading) {
		return (
			<Badge variant="outline" className="text-muted-foreground">
				Chat…
			</Badge>
		);
	}

	if (isError || !data) {
		return (
			<Badge variant="outline" className="text-muted-foreground">
				Chat unavailable
			</Badge>
		);
	}

	const chat = data.chatInbound;
	const showProvider =
		chat.enabled && Boolean(chat.integrationLabel ?? chat.integration);
	const summary = buildSummary(chat);

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Badge
					variant="outline"
					className={cn(
						"gap-1.5 font-normal max-w-56 truncate",
						chat.status === "connected"
							? "text-foreground"
							: "text-muted-foreground",
					)}
				>
					{showProvider ? (
						<span
							className={cn(
								"size-2 rounded-full shrink-0",
								statusDotClass(chat.status),
							)}
							aria-hidden
						/>
					) : (
						<MessageSquareOff className="size-3 shrink-0" aria-hidden />
					)}
					<span className="truncate">{summary}</span>
				</Badge>
			</TooltipTrigger>
			<TooltipContent side="bottom" className="max-w-sm whitespace-pre-wrap">
				{buildTooltip(chat)}
			</TooltipContent>
		</Tooltip>
	);
}

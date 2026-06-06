import { api } from "@/api/client";
import { badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { DaemonProcessInfo } from "@/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Power, RotateCw, Server } from "lucide-react";
import { useState } from "react";

async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDaemonHealth(
	maxAttempts = 40,
	intervalMs = 500,
): Promise<boolean> {
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		try {
			const health = await api.health();
			if (health.ok) return true;
		} catch {
			// Expected while the daemon is stopping or starting.
		}
		await sleep(intervalMs);
	}
	return false;
}

async function waitForDaemonDown(
	maxAttempts = 20,
	intervalMs = 500,
): Promise<boolean> {
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		try {
			await api.health();
		} catch {
			return true;
		}
		await sleep(intervalMs);
	}
	return false;
}

function formatUptime(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return "—";
	const days = Math.floor(seconds / 86_400);
	const hours = Math.floor((seconds % 86_400) / 3_600);
	const minutes = Math.floor((seconds % 3_600) / 60);
	const secs = Math.floor(seconds % 60);
	const parts: string[] = [];
	if (days) parts.push(`${days}d`);
	if (hours) parts.push(`${hours}h`);
	if (minutes) parts.push(`${minutes}m`);
	if (!days && !hours) parts.push(`${secs}s`);
	return parts.join(" ") || "0s";
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
	return (
		<div className="flex items-baseline justify-between gap-3">
			<span className="text-muted-foreground shrink-0">{label}</span>
			<span className="min-w-0 truncate text-right font-medium text-foreground">
				{value}
			</span>
		</div>
	);
}

export function DaemonStatusBadge() {
	const queryClient = useQueryClient();
	const [statusMessage, setStatusMessage] = useState<string | null>(null);
	const [offline, setOffline] = useState(false);

	const { data, isError } = useQuery({
		queryKey: ["daemon-status"],
		queryFn: () => api.daemonStatus(),
		refetchInterval: 10_000,
	});

	const restartMutation = useMutation({
		mutationFn: () => api.restartDaemon(),
		onMutate: () => {
			setOffline(false);
			setStatusMessage("Restarting daemon…");
		},
		onSuccess: async () => {
			await sleep(500);
			const back = await waitForDaemonHealth();
			if (back) {
				await queryClient.invalidateQueries();
				setStatusMessage("Daemon restarted.");
			} else {
				setStatusMessage("Restart timed out. Check `toby daemon status`.");
			}
			setTimeout(() => setStatusMessage(null), 4000);
		},
		onError: (error) => {
			const message =
				error instanceof Error ? error.message : "Failed to restart daemon.";
			const friendly =
				message === "Not found"
					? "Restart unavailable — run `toby daemon restart` once after updating Toby."
					: message;
			setStatusMessage(friendly);
			setTimeout(() => setStatusMessage(null), 8000);
		},
	});

	const stopMutation = useMutation({
		mutationFn: () => api.stopDaemon(),
		onMutate: () => {
			setStatusMessage("Stopping daemon…");
		},
		onSuccess: async () => {
			const down = await waitForDaemonDown();
			if (down) {
				setOffline(true);
				setStatusMessage("Daemon stopped. The web UI is now offline.");
			} else {
				setStatusMessage("Stop signalled — daemon may still be shutting down.");
			}
		},
		onError: (error) => {
			const message =
				error instanceof Error ? error.message : "Failed to stop daemon.";
			const friendly =
				message === "Not found"
					? "Stop unavailable — run `toby daemon stop` once after updating Toby."
					: message;
			setStatusMessage(friendly);
			setTimeout(() => setStatusMessage(null), 8000);
		},
	});

	const pending = restartMutation.isPending || stopMutation.isPending;
	const proc: DaemonProcessInfo | undefined = data?.process;
	const unreachable = offline || (isError && !pending);

	const dotClass = pending
		? "bg-amber-500 animate-pulse"
		: unreachable
			? "bg-destructive"
			: "bg-emerald-500";
	const label = pending
		? restartMutation.isPending
			? "Restarting"
			: "Stopping"
		: unreachable
			? "Daemon offline"
			: "Daemon";

	return (
		<Popover>
			<PopoverTrigger
				className={cn(
					badgeVariants({ variant: "secondary" }),
					"cursor-pointer",
				)}
				aria-label="Daemon status and controls"
			>
				<span
					className={cn("size-1.5 shrink-0 rounded-full", dotClass)}
					aria-hidden
				/>
				<span className="truncate">{label}</span>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-80 gap-3">
				<PopoverHeader className="flex-row items-center gap-2">
					<Server className="size-4 text-muted-foreground" aria-hidden />
					<PopoverTitle className="flex-1">Toby daemon</PopoverTitle>
					<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
						<span
							className={cn("size-1.5 rounded-full", dotClass)}
							aria-hidden
						/>
						{unreachable ? "Offline" : pending ? "Working" : "Running"}
					</span>
				</PopoverHeader>

				<div className="flex flex-col gap-1.5 text-xs">
					{proc ? (
						<>
							<InfoRow label="Process ID" value={proc.pid} />
							<InfoRow
								label="Uptime"
								value={formatUptime(proc.uptimeSeconds)}
							/>
							<InfoRow
								label="Poll interval"
								value={proc.intervalSeconds ? `${proc.intervalSeconds}s` : "—"}
							/>
							<InfoRow
								label="Web UI"
								value={proc.webPort ? `localhost:${proc.webPort}` : "Disabled"}
							/>
							<InfoRow
								label="Log"
								value={
									<span className="font-mono" title={proc.logPath}>
										{proc.logPath}
									</span>
								}
							/>
						</>
					) : (
						<p className="text-muted-foreground">
							{unreachable
								? "The daemon is not responding."
								: "Process details are unavailable."}
						</p>
					)}
				</div>

				{statusMessage ? (
					<p className="text-xs text-muted-foreground">{statusMessage}</p>
				) : null}

				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						className="flex-1 gap-1.5"
						disabled={pending}
						onClick={() => restartMutation.mutate()}
					>
						<RotateCw
							className={cn(
								"size-3.5",
								restartMutation.isPending && "animate-spin",
							)}
							aria-hidden
						/>
						Restart
					</Button>
					<Button
						variant="outline"
						size="sm"
						className="flex-1 gap-1.5 text-destructive hover:text-destructive"
						disabled={pending || unreachable}
						onClick={() => stopMutation.mutate()}
					>
						<Power className="size-3.5" aria-hidden />
						Stop
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}

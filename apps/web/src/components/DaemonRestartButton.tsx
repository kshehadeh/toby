import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/api/client";
import { cn } from "@/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RotateCw } from "lucide-react";
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

export function DaemonRestartButton() {
	const queryClient = useQueryClient();
	const [statusMessage, setStatusMessage] = useState<string | null>(null);

	const restartMutation = useMutation({
		mutationFn: () => api.restartDaemon(),
		onMutate: () => {
			setStatusMessage("Restarting daemon…");
		},
		onSuccess: async () => {
			await sleep(500);
			const back = await waitForDaemonHealth();
			if (back) {
				await queryClient.invalidateQueries();
				await queryClient.invalidateQueries({ queryKey: ["daemon-status"] });
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
					? "Restart unavailable — run `toby daemon restart` in the terminal once after updating Toby."
					: message;
			setStatusMessage(friendly);
			setTimeout(() => setStatusMessage(null), 8000);
		},
	});

	const pending = restartMutation.isPending;

	return (
		<div className="flex items-center gap-3 shrink-0">
				{statusMessage ? (
					<span className="text-muted-foreground text-xs max-w-48 truncate">
						{statusMessage}
					</span>
				) : null}
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="outline"
							size="sm"
							disabled={pending}
							onClick={() => restartMutation.mutate()}
							className="gap-1.5"
						>
							<RotateCw
								className={cn("size-4", pending && "animate-spin")}
								aria-hidden
							/>
							Restart daemon
						</Button>
					</TooltipTrigger>
					<TooltipContent side="bottom">
						Stop and start the Toby daemon (schedules, chat inbound, web UI)
					</TooltipContent>
				</Tooltip>
		</div>
	);
}

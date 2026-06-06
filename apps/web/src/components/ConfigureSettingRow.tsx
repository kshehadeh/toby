import { Label } from "@/components/ui/label";
import type { ReactNode } from "react";

interface ConfigureSettingRowProps {
	label: string;
	htmlFor?: string;
	children: ReactNode;
}

export function ConfigureSettingRow({
	label,
	htmlFor,
	children,
}: ConfigureSettingRowProps) {
	return (
		<div className="flex items-center justify-between gap-6">
			<Label
				htmlFor={htmlFor}
				className="min-w-0 flex-1 leading-snug font-normal text-foreground"
			>
				{label}
			</Label>
			<div className="shrink-0">{children}</div>
		</div>
	);
}

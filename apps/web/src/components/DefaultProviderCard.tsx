import { ConfigureSelect } from "@/components/ConfigureSelect";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getProviderCategoryIcon } from "@/lib/provider-category-icons";
import type { SettingsItem } from "@/types";

interface DefaultProviderCardProps {
	field: SettingsItem;
	value: string;
	onChange: (value: string) => void;
	disabled?: boolean;
	integrationLabels?: Record<string, string>;
}

export function DefaultProviderCard({
	field,
	value,
	onChange,
	disabled = false,
	integrationLabels,
}: DefaultProviderCardProps) {
	const Icon = getProviderCategoryIcon(field.key);

	return (
		<Card className="ring-0 shadow-none bg-muted/25">
			<CardHeader className="pb-3">
				<div className="flex items-center gap-3">
					<div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
						<Icon className="size-5" aria-hidden />
					</div>
					<CardTitle className="text-lg font-semibold leading-tight">
						{field.label}
					</CardTitle>
				</div>
			</CardHeader>
			<CardContent>
				<ConfigureSelect
					field={field}
					value={value}
					onChange={onChange}
					disabled={disabled}
					triggerClassName="w-full"
					integrationLabels={integrationLabels}
				/>
			</CardContent>
		</Card>
	);
}

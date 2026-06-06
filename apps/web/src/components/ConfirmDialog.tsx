import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface ConfirmDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	message: string;
	confirmLabel?: string;
	cancelLabel?: string;
	onConfirm: () => void;
	confirmVariant?: "default" | "destructive";
	disabled?: boolean;
}

export function ConfirmDialog({
	open,
	onOpenChange,
	title,
	message,
	confirmLabel = "Confirm",
	cancelLabel = "Cancel",
	onConfirm,
	confirmVariant = "default",
	disabled = false,
}: ConfirmDialogProps) {
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					<AlertDialogDescription>{message}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={disabled}>{cancelLabel}</AlertDialogCancel>
					<AlertDialogAction
						variant={confirmVariant}
						disabled={disabled}
						onClick={(event) => {
							event.preventDefault();
							onConfirm();
						}}
					>
						{confirmLabel}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

export function deleteConfirmCopy(
	fieldLabel: string,
	entityLabel: string,
): { title: string; message: string } {
	return {
		title: fieldLabel,
		message: `Are you sure you want to delete “${entityLabel}”? This cannot be undone.`,
	};
}

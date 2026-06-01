import { Box } from "ink";
import type React from "react";
import { ACCENT } from "../chat/constants";

export interface ViewModalProps {
	readonly children: React.ReactNode;
	readonly termCols: number;
	readonly borderColor?: string;
}

export function ViewModal({
	children,
	termCols,
	borderColor = ACCENT,
}: ViewModalProps) {
	return (
		<Box
			marginTop={1}
			flexShrink={0}
			flexDirection="column"
			borderStyle="round"
			borderColor={borderColor}
			paddingX={1}
			width={termCols}
		>
			{children}
		</Box>
	);
}

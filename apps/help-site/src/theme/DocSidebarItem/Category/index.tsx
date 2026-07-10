import React from "react";
import Category from "@theme-original/DocSidebarItem/Category";
import type CategoryType from "@theme/DocSidebarItem/Category";
import type { WrapperProps } from "@docusaurus/types";

type Props = WrapperProps<typeof CategoryType>;

/**
 * Forward `customProps.icon` from `_category_.json` into a stable CSS class so
 * parent sidebar categories can show icons without ejecting the full component.
 *
 * Example `_category_.json`:
 * ```json
 * {
 *   "label": "Getting Started",
 *   "customProps": { "icon": "rocket" }
 * }
 * ```
 */
export default function CategoryWrapper(props: Props): React.ReactNode {
	const icon = props.item.customProps?.icon;
	const iconClass =
		typeof icon === "string" && icon.length > 0
			? `sidebar-cat-icon sidebar-cat-icon--${icon}`
			: undefined;

	if (!iconClass) {
		return <Category {...props} />;
	}

	const existingClassName = props.item.className;
	const className = [existingClassName, iconClass].filter(Boolean).join(" ");

	return (
		<Category
			{...props}
			item={{
				...props.item,
				className,
			}}
		/>
	);
}

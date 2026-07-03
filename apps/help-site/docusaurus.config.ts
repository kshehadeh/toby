import type * as Preset from "@docusaurus/preset-classic";
import type { Config } from "@docusaurus/types";
import { themes as prismThemes } from "prism-react-renderer";

const config: Config = {
	title: "Toby",
	tagline:
		"Native macOS AI assistant for personal productivity workflows.",
	favicon: "img/64x64.png",

	future: {
		v4: true,
	},

	url: "https://toby.iwonderdesigns.com",
	baseUrl: "/",

	organizationName: "kshehadeh",
	projectName: "toby",
	trailingSlash: false,

	onBrokenLinks: "throw",
	markdown: {
		hooks: {
			onBrokenMarkdownLinks: "warn",
		},
	},

	i18n: {
		defaultLocale: "en",
		locales: ["en"],
	},

	presets: [
		[
			"classic",
			{
				docs: {
					sidebarPath: "./sidebars.ts",
					editUrl:
						"https://github.com/kshehadeh/toby/tree/main/apps/help-site/",
				},
				blog: false,
				theme: {
					customCss: "./src/css/custom.css",
				},
			} satisfies Preset.Options,
		],
	],

	headTags: [
		{
			tagName: "meta",
			attributes: {
				property: "og:image",
				content: "https://toby.iwonderdesigns.com/img/512x512.png",
			},
		},
		{
			tagName: "link",
			attributes: {
				rel: "preconnect",
				href: "https://fonts.googleapis.com",
			},
		},
		{
			tagName: "link",
			attributes: {
				rel: "preconnect",
				href: "https://fonts.gstatic.com",
				crossorigin: "anonymous",
			},
		},
	],

	themeConfig: {
		colorMode: {
			defaultMode: "dark",
			respectPrefersColorScheme: false,
			disableSwitch: true,
		},
		navbar: {
			title: "Toby",
			logo: {
				alt: "Toby",
				src: "img/128x128.png",
			},
			style: "dark",
			items: [
				{
					type: "docSidebar",
					sidebarId: "helpSidebar",
					position: "left",
					label: "Docs",
				},
				{
					href: "https://github.com/kshehadeh/toby",
					label: "GitHub",
					position: "right",
				},
			],
		},
		footer: {
			style: "dark",
			links: [
				{
					title: "Help",
					items: [
						{ label: "Introduction", to: "/docs/intro" },
						{ label: "Getting Started", to: "/docs/getting-started/install" },
						{ label: "Integrations", to: "/docs/integrations/overview" },
						{ label: "Examples", to: "/docs/examples" },
					],
				},
				{
					title: "Project",
					items: [
						{
							label: "GitHub",
							href: "https://github.com/kshehadeh/toby",
						},
						{
							label: "Releases",
							href: "https://github.com/kshehadeh/toby/releases",
						},
					],
				},
			],
			copyright: `Copyright © ${new Date().getFullYear()} Toby.`,
		},
		prism: {
			theme: prismThemes.github,
			darkTheme: prismThemes.oneDark,
			additionalLanguages: ["bash", "json", "yaml"],
		},
	} satisfies Preset.ThemeConfig,
};

export default config;

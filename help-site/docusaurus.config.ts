import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Toby',
  tagline: 'AI-assisted CLI for personal productivity workflows.',

  future: {
    v4: true,
  },

  url: 'https://kshehadeh.github.io',
  baseUrl: '/toby/',

  organizationName: 'kshehadeh',
  projectName: 'toby',
  trailingSlash: false,

  onBrokenLinks: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/kshehadeh/toby/tree/main/help-site/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Toby Docs',
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'helpSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          href: 'https://github.com/kshehadeh/toby',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Help',
          items: [{label: 'Introduction', to: '/docs/intro'}],
        },
        {
          title: 'Project',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/kshehadeh/toby',
            },
            {
              label: 'Releases',
              href: 'https://github.com/kshehadeh/toby/releases',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Toby.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;

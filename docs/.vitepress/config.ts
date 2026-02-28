import { defineConfig } from 'vitepress';

export default defineConfig({
    title: 'universal-rate-limit',
    description: 'Web-standards-based rate limiting with pluggable stores and framework middleware. Zero dependencies, works everywhere.',

    base: '/universal-rate-limit/',

    themeConfig: {
        nav: [
            { text: 'Guide', link: '/getting-started' },
            { text: 'API', link: '/api' },
            {
                text: 'npm',
                link: 'https://www.npmjs.com/package/universal-rate-limit'
            },
            {
                text: 'GitHub',
                link: 'https://github.com/KKonstantinov/universal-rate-limit'
            }
        ],

        sidebar: [
            {
                text: 'Guide',
                items: [
                    { text: 'Getting Started', link: '/getting-started' },
                    { text: 'Middleware', link: '/middleware' },
                    { text: 'Stores', link: '/stores' }
                ]
            },
            {
                text: 'Reference',
                items: [{ text: 'API Reference', link: '/api' }]
            }
        ],

        search: {
            provider: 'local'
        },

        socialLinks: [
            {
                icon: 'github',
                link: 'https://github.com/KKonstantinov/universal-rate-limit'
            }
        ]
    }
});

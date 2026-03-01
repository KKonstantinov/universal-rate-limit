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
                text: 'Packages',
                items: [
                    {
                        text: 'universal-rate-limit',
                        link: '/packages/core'
                    },
                    {
                        text: 'Stores',
                        items: [
                            {
                                text: '@universal-rate-limit/redis',
                                link: '/packages/redis'
                            }
                        ]
                    },
                    {
                        text: 'Middleware',
                        items: [
                            {
                                text: '@universal-rate-limit/express',
                                link: '/packages/express'
                            },
                            {
                                text: '@universal-rate-limit/fastify',
                                link: '/packages/fastify'
                            },
                            {
                                text: '@universal-rate-limit/hono',
                                link: '/packages/hono'
                            },
                            {
                                text: '@universal-rate-limit/nextjs',
                                link: '/packages/nextjs'
                            }
                        ]
                    }
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

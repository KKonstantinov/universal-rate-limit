import { defineConfig } from 'vitepress';

export default defineConfig({
    title: 'universal-rate-limit',
    description: 'Web-standards-based rate limiting with pluggable stores and framework middleware. Zero dependencies, works everywhere.',

    base: '/universal-rate-limit/',

    head: [
        ['meta', { property: 'og:title', content: 'universal-rate-limit' }],
        [
            'meta',
            {
                property: 'og:description',
                content:
                    'Web-standards-based rate limiting with pluggable stores and framework middleware. Zero dependencies, works everywhere.'
            }
        ],
        ['meta', { property: 'og:type', content: 'website' }],
        ['meta', { name: 'twitter:card', content: 'summary' }],
        ['meta', { name: 'twitter:title', content: 'universal-rate-limit' }],
        [
            'meta',
            {
                name: 'twitter:description',
                content:
                    'Web-standards-based rate limiting with pluggable stores and framework middleware. Zero dependencies, works everywhere.'
            }
        ]
    ],

    themeConfig: {
        nav: [
            { text: 'Guide', link: '/getting-started' },
            { text: 'API', link: '/api' },
            { text: 'Playground', link: 'https://universal-rate-limit-playground.vercel.app', target: '_blank' },
            {
                text: 'Packages',
                items: [
                    { text: 'universal-rate-limit', link: '/packages/core' },
                    { text: '@universal-rate-limit/redis', link: '/packages/redis' },
                    { text: '@universal-rate-limit/express', link: '/packages/express' },
                    { text: '@universal-rate-limit/fastify', link: '/packages/fastify' },
                    { text: '@universal-rate-limit/hono', link: '/packages/hono' },
                    { text: '@universal-rate-limit/nextjs', link: '/packages/nextjs' }
                ]
            },
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
        ],

        editLink: {
            pattern: 'https://github.com/KKonstantinov/universal-rate-limit/edit/main/docs/:path',
            text: 'Edit this page on GitHub'
        },

        footer: {
            message: 'Released under the MIT License.',
            copyright: 'Built with VitePress'
        }
    }
});

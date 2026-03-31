import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../../..');
const outDir = resolve(__dirname, '../content/docs/packages');

const mappings = [
    {
        source: 'packages/core/README.md',
        target: 'core.mdx',
        title: 'Core (universal-rate-limit)',
        description: 'Framework-agnostic rate limiter using Web Standard Request/Response. Zero dependencies.'
    },
    {
        source: 'packages/redis/README.md',
        target: 'redis.mdx',
        title: 'Redis Store (@universal-rate-limit/redis)',
        description: 'Redis store using Lua scripts for atomic operations. Works with any Redis client.'
    },
    {
        source: 'packages/middleware/express/README.md',
        target: 'express.mdx',
        title: 'Express Middleware (@universal-rate-limit/express)',
        description: 'Express middleware adapter for universal-rate-limit.'
    },
    {
        source: 'packages/middleware/fastify/README.md',
        target: 'fastify.mdx',
        title: 'Fastify Plugin (@universal-rate-limit/fastify)',
        description: 'Fastify plugin adapter for universal-rate-limit.'
    },
    {
        source: 'packages/middleware/hono/README.md',
        target: 'hono.mdx',
        title: 'Hono Middleware (@universal-rate-limit/hono)',
        description: 'Hono middleware adapter for universal-rate-limit.'
    },
    {
        source: 'packages/middleware/nextjs/README.md',
        target: 'nextjs.mdx',
        title: 'Next.js Middleware (@universal-rate-limit/nextjs)',
        description: 'Next.js App Router wrapper and Edge Middleware for universal-rate-limit.'
    }
];

// HTML badge pattern: <a href="..."><img src="...shields.io..." alt="..." /></a>
const htmlBadgeRe = /<a\s+href="([^"]+)">\s*<img\s+src="([^"]+shields\.io[^"]*)"[^/]*\/>\s*<\/a>/g;

// HTML badge block: <p align="center"> containing shields.io badges </p>
function transformHtmlBadgeBlock(content) {
    // Match <p align="center"> blocks that contain shields.io badges
    const blockRe = /<p\s+align="center">\s*((?:<a\s+href="[^"]*">\s*<img\s+src="[^"]*shields\.io[^"]*"[^/]*\/>\s*<\/a>\s*)+)<\/p>/gs;

    return content.replace(blockRe, (_, inner) => {
        const badges = [];
        for (const match of inner.matchAll(htmlBadgeRe)) {
            badges.push({ href: match[1], img: match[2] });
        }
        if (badges.length === 0) return _;

        const links = badges.map(b => `  <a href="${b.href}"><img src="${b.img}" alt="" /></a>`);
        return `<div style={{display:'flex',gap:'0.5rem',flexWrap:'wrap'}}>\n${links.join('\n')}\n</div>`;
    });
}

// Remove <h1 align="center"> (title comes from frontmatter)
function removeHtmlH1(content) {
    return content.replace(/<h1\s+align="center">[^<]*<\/h1>\s*/g, '');
}

// Convert <p align="center"><img ...></p> to markdown image (header/package images)
function transformHeaderImage(content) {
    return content.replace(/<p\s+align="center">\s*<img\s+src="([^"]+)"[^>]*\/>\s*<\/p>/g, (_, src) => `![header](${src})`);
}

// Remove centered <p> taglines (the <br> description block under the h1)
function removeTaglineBlock(content) {
    return content.replace(/<p\s+align="center">\s*[^<]*(?:<br\s*\/?>\s*[^<]*)*<\/p>/g, '');
}

function collapseBlankLines(content) {
    return content.replace(/\n{4,}/g, '\n\n\n');
}

function fixHtmlForMdx(content) {
    return content.replace(/<(br|hr|img|input|meta|link)(\s[^>]*)?\s*(?<!\/)>/gi, '<$1$2 />');
}

function transformContent(content) {
    let result = fixHtmlForMdx(content);
    result = transformHeaderImage(result);
    result = transformHtmlBadgeBlock(result);
    result = removeHtmlH1(result);
    result = removeTaglineBlock(result);
    result = collapseBlankLines(result);
    return result;
}

mkdirSync(outDir, { recursive: true });

for (const { source, target, title, description } of mappings) {
    const content = readFileSync(resolve(root, source), 'utf8');
    const transformed = transformContent(content);
    const frontmatter = `---\ntitle: "${title}"\ndescription: "${description}"\n---\n\n`;
    writeFileSync(resolve(outDir, target), frontmatter + transformed);
}

console.log(`Synced ${mappings.length} README files to ${outDir}`);

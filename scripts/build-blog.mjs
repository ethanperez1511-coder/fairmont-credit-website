#!/usr/bin/env node
/**
 * Fairmont Credit Partners — static blog generator.
 *
 * Reads Markdown files from content/posts/ and writes:
 *   blog/index.html                 article index, newest first
 *   blog/<slug>/index.html          one page per article
 *   sitemap.xml                     every indexable page on the site
 *   rss.xml                         feed of the 20 most recent articles
 *   robots.txt                      points crawlers at the sitemap
 *
 * No dependencies. Run with "npm run blog", then commit the generated HTML —
 * Vercel serves this repo as plain static files, so nothing builds at deploy time.
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://www.fairmontcreditpartners.com';
const SITE_NAME = 'Fairmont Credit Partners';
const AUTHOR = 'Fairmont Credit Partners';
const OG_IMAGE = `${ORIGIN}/assets/miami-skyline.jpeg`;
const LOGO = `${ORIGIN}/assets/logo.jpg`;

/* ═══════════════════════════════════════════════
   Small helpers
═══════════════════════════════════════════════ */

const esc = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const slugify = (s) => String(s).toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-09-09" -> "September 9, 2026" (parsed as UTC so it never shifts a day) */
function humanDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** RFC 822 date for RSS, pinned to 12:00 UTC on the publish day. */
function rssDate(iso) {
    return new Date(`${iso}T12:00:00Z`).toUTCString();
}

/* ═══════════════════════════════════════════════
   Frontmatter + Markdown (the subset we actually use)
═══════════════════════════════════════════════ */

function parseFrontmatter(raw) {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) throw new Error('missing frontmatter block');
    const meta = {};
    for (const line of match[1].split(/\r?\n/)) {
        if (!line.trim() || line.trimStart().startsWith('#')) continue;
        const at = line.indexOf(':');
        if (at === -1) throw new Error(`bad frontmatter line: ${line}`);
        const key = line.slice(0, at).trim();
        let value = line.slice(at + 1).trim();
        if (/^["'].*["']$/.test(value)) value = value.slice(1, -1);
        meta[key] = value;
    }
    return { meta, body: match[2] };
}

/** Markdown -> block tokens. Handles h2/h3, paragraphs, lists, quotes, tables. */
function parseBlocks(md) {
    const lines = md.split(/\r?\n/);
    const blocks = [];
    let i = 0;

    const isTableRow = (l) => /^\s*\|/.test(l);
    const isTableRule = (l) => /^\s*\|[\s:|-]+\|\s*$/.test(l) && l.includes('-');
    const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

    while (i < lines.length) {
        const line = lines[i];

        if (!line.trim()) { i++; continue; }

        if (/^###\s+/.test(line)) { blocks.push({ type: 'h3', text: line.replace(/^###\s+/, '') }); i++; continue; }
        if (/^##\s+/.test(line)) { blocks.push({ type: 'h2', text: line.replace(/^##\s+/, '') }); i++; continue; }

        if (isTableRow(line) && isTableRule(lines[i + 1] || '')) {
            const head = cells(line);
            i += 2;
            const rows = [];
            while (i < lines.length && isTableRow(lines[i])) { rows.push(cells(lines[i])); i++; }
            blocks.push({ type: 'table', head, rows });
            continue;
        }

        if (/^>\s?/.test(line)) {
            const paras = [];
            while (i < lines.length && /^>\s?/.test(lines[i])) { paras.push(lines[i].replace(/^>\s?/, '')); i++; }
            blocks.push({ type: 'quote', paras: paras.join('\n').split(/\n\s*\n/).filter(Boolean) });
            continue;
        }

        if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
            const ordered = /^\d+\.\s+/.test(line);
            const marker = ordered ? /^\d+\.\s+/ : /^[-*]\s+/;
            const items = [];
            while (i < lines.length && marker.test(lines[i])) {
                let item = lines[i].replace(marker, '');
                i++;
                // continuation lines are indented under the bullet
                while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !marker.test(lines[i].trim())) {
                    item += ' ' + lines[i].trim();
                    i++;
                }
                items.push(item);
            }
            blocks.push({ type: ordered ? 'ol' : 'ul', items });
            continue;
        }

        const para = [];
        while (i < lines.length && lines[i].trim()
            && !/^(#{2,3}\s|>\s?|[-*]\s|\d+\.\s)/.test(lines[i]) && !isTableRow(lines[i])) {
            para.push(lines[i].trim());
            i++;
        }
        blocks.push({ type: 'p', text: para.join(' ') });
    }

    return blocks;
}

/** Inline markdown: links, bold, italic, code. Escapes HTML first. */
function inline(text) {
    let out = esc(text);
    out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => `<a href="${href}">${label}</a>`);
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[\s(])\*([^*]+)\*/g, '$1<em>$2</em>');
    out = out.replace(/\s--\s/g, ' &mdash; ');
    return out;
}

/** Strip markup down to readable text (for schema + meta values). */
const plain = (text) => String(text)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*`_]/g, '')
    .trim();

/** Every word a reader actually sees, for read-time and wordCount. */
function blockText(blocks) {
    return blocks.map((b) => {
        if (b.type === 'ul' || b.type === 'ol') return b.items.join(' ');
        if (b.type === 'quote') return b.paras.join(' ');
        if (b.type === 'table') return [...b.head, ...b.rows.flat()].join(' ');
        return b.text;
    }).join(' ');
}

function renderBlocks(blocks) {
    const html = [];
    let first = true;

    for (const b of blocks) {
        switch (b.type) {
            case 'h2':
                html.push(`<h2 id="${slugify(plain(b.text))}">${inline(b.text)}</h2>`);
                break;
            case 'h3':
                html.push(`<h3 id="${slugify(plain(b.text))}">${inline(b.text)}</h3>`);
                break;
            case 'p':
                // The opening paragraph is the direct answer — pull it out visually.
                html.push(`<p${first ? ' class="lede"' : ''}>${inline(b.text)}</p>`);
                first = false;
                break;
            case 'ul':
                html.push(`<ul>\n${b.items.map((it) => `    <li>${inline(it)}</li>`).join('\n')}\n</ul>`);
                break;
            case 'ol':
                html.push(`<ol>\n${b.items.map((it) => `    <li>${inline(it)}</li>`).join('\n')}\n</ol>`);
                break;
            case 'quote':
                html.push(`<blockquote>\n${b.paras.map((p) => `    <p>${inline(p)}</p>`).join('\n')}\n</blockquote>`);
                break;
            case 'table':
                html.push(
                    `<div class="table-scroll">\n<table>\n<thead><tr>` +
                    b.head.map((h) => `<th>${inline(h)}</th>`).join('') +
                    `</tr></thead>\n<tbody>\n` +
                    b.rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('\n') +
                    `\n</tbody>\n</table>\n</div>`
                );
                break;
        }
        if (b.type !== 'p') first = false;
    }

    return html.join('\n\n');
}

/**
 * Pull question/answer pairs out of an H2 section whose heading mentions
 * questions or FAQ. Only visible on-page content becomes FAQPage schema,
 * which is what Google requires.
 */
function extractFaqs(blocks) {
    const faqs = [];
    let inSection = false;
    let current = null;

    for (const b of blocks) {
        if (b.type === 'h2') {
            if (current) { faqs.push(current); current = null; }
            inSection = /questions|faq/i.test(plain(b.text));
            continue;
        }
        if (!inSection) continue;

        if (b.type === 'h3') {
            if (current) faqs.push(current);
            current = { q: plain(b.text), a: [] };
        } else if (current && (b.type === 'p' || b.type === 'ul' || b.type === 'ol')) {
            if (b.type === 'p') current.a.push(plain(b.text));
            else current.a.push(b.items.map(plain).join(' '));
        }
    }
    if (current) faqs.push(current);

    return faqs.filter((f) => f.a.length).map((f) => ({ q: f.q, a: f.a.join(' ') }));
}

/* ═══════════════════════════════════════════════
   Shared page chrome
═══════════════════════════════════════════════ */

const ANALYTICS = `    <!-- Google Tag Manager -->
    <script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
    new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
    j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
    'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
    })(window,document,'script','dataLayer','GTM-PB3SVRCD');</script>
    <!-- End Google Tag Manager -->
    <!-- Google tag (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=AW-18138943490"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'AW-18138943490');
    </script>`;

const GTM_NOSCRIPT = `<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-PB3SVRCD"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->`;

const FAVICON = `<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='6' fill='%231B7FD4'/><text x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' font-family='Georgia,serif' font-size='18' font-weight='700' fill='white'>F</text></svg>">`;

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">`;

function head({ title, description, canonical, jsonld, ogType = 'website', published, modified }) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
${ANALYTICS}
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}">
    <link rel="canonical" href="${canonical}">
    <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">

    <!-- Open Graph -->
    <meta property="og:type" content="${ogType}">
    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(description)}">
    <meta property="og:image" content="${OG_IMAGE}">
    <meta property="og:url" content="${canonical}">
    <meta property="og:site_name" content="${SITE_NAME}">${published ? `
    <meta property="article:published_time" content="${published}T12:00:00Z">` : ''}${modified ? `
    <meta property="article:modified_time" content="${modified}T12:00:00Z">` : ''}

    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${esc(title)}">
    <meta name="twitter:description" content="${esc(description)}">
    <meta name="twitter:image" content="${OG_IMAGE}">

    ${FAVICON}
    ${FONTS}
    <link rel="alternate" type="application/rss+xml" title="${SITE_NAME} Insights" href="${ORIGIN}/rss.xml">
    <link rel="stylesheet" href="/assets/blog.css">

    <script type="application/ld+json">
${JSON.stringify(jsonld, null, 2)}
    </script>
</head>
<body>
${GTM_NOSCRIPT}

<header class="header">
    <div class="header-inner">
        <a href="/" class="logo"><img src="/assets/logo.jpg" alt="${SITE_NAME}" width="180" height="52"></a>
        <nav class="header-nav">
            <a href="/blog/">Insights</a>
            <a href="/faq/">FAQ</a>
            <a href="/#contact">Contact</a>
            <a href="/app/" class="nav-cta">Apply Now</a>
        </nav>
    </div>
</header>
`;
}

const FOOTER = `
<footer class="site-footer">
    <div class="footer-inner">
        <div class="footer-top">
            <div>
                <div class="footer-brand">${SITE_NAME}</div>
                <div class="footer-contact-info">
                    <a href="mailto:deals@fairmontcp.net">deals@fairmontcp.net</a>
                    <a href="tel:+17866002724">(786) 600-2724</a>
                    <span>66 W Flagler St, Miami, FL 33130</span>
                </div>
            </div>
            <div class="footer-links">
                <a href="/#about">About</a>
                <a href="/#solutions">Solutions</a>
                <a href="/blog/">Insights</a>
                <a href="/faq/">FAQ</a>
                <a href="/app/">Apply</a>
                <a href="/privacy-policy">Privacy Policy</a>
                <a href="/terms-of-service">Terms of Service</a>
            </div>
        </div>
        <div class="footer-bottom">
            <p>&copy; ${new Date().getFullYear()} ${SITE_NAME}. All rights reserved. Fairmont Credit Partners is a commercial finance company. We do not offer consumer loans.</p>

            <!-- ══════════════════════════════════════════════════════════════
                 GOOGLE PREFERRED SOURCE BUTTON — DISABLED ON PURPOSE.
                 Do not uncomment until fairmontcreditpartners.com actually
                 appears in Google's Preferred Sources picker. Linking there
                 before the site is listed sends users to a page where they
                 cannot find us, which reads as broken.
                 Enable by deleting this comment wrapper (also in
                 scripts/build-blog.mjs, then re-run "npm run blog").
                 See PREFERRED-SOURCE.md for the full checklist.
            <a class="preferred-source"
               href="https://www.google.com/preferences/source?q=fairmontcreditpartners.com"
               target="_blank" rel="noopener">
                Add us as a preferred source on Google
            </a>
            ══════════════════════════════════════════════════════════════ -->
        </div>
    </div>
</footer>
</body>
</html>
`;

/* ═══════════════════════════════════════════════
   Structured data
═══════════════════════════════════════════════ */

const ORGANIZATION = {
    '@type': 'FinancialService',
    '@id': `${ORIGIN}/#organization`,
    name: SITE_NAME,
    url: `${ORIGIN}/`,
    logo: { '@type': 'ImageObject', url: LOGO },
    image: OG_IMAGE,
    email: 'deals@fairmontcp.net',
    telephone: '+1-786-358-4675',
    description: 'Fairmont Credit Partners is a Miami-based commercial finance company providing working capital, asset-based lending, receivables factoring, and equipment leasing to small and mid-sized businesses.',
    address: {
        '@type': 'PostalAddress',
        streetAddress: '66 W Flagler St',
        addressLocality: 'Miami',
        addressRegion: 'FL',
        postalCode: '33130',
        addressCountry: 'US'
    },
    areaServed: { '@type': 'Country', name: 'United States' }
};

const WEBSITE = {
    '@type': 'WebSite',
    '@id': `${ORIGIN}/#website`,
    url: `${ORIGIN}/`,
    name: SITE_NAME,
    publisher: { '@id': `${ORIGIN}/#organization` },
    inLanguage: 'en-US'
};

function articleGraph(post, faqs) {
    const url = `${ORIGIN}/blog/${post.slug}/`;
    const graph = [
        ORGANIZATION,
        WEBSITE,
        {
            '@type': 'BlogPosting',
            '@id': `${url}#article`,
            isPartOf: { '@id': `${ORIGIN}/#website` },
            mainEntityOfPage: url,
            url,
            headline: post.title,
            name: post.title,
            description: post.description,
            articleSection: post.category,
            wordCount: post.words,
            datePublished: `${post.date}T12:00:00Z`,
            dateModified: `${post.updated || post.date}T12:00:00Z`,
            author: { '@id': `${ORIGIN}/#organization`, '@type': 'Organization', name: AUTHOR, url: `${ORIGIN}/` },
            publisher: { '@id': `${ORIGIN}/#organization` },
            image: { '@type': 'ImageObject', url: OG_IMAGE, width: 1200, height: 630 },
            inLanguage: 'en-US'
        },
        {
            '@type': 'BreadcrumbList',
            '@id': `${url}#breadcrumbs`,
            itemListElement: [
                { '@type': 'ListItem', position: 1, name: 'Home', item: `${ORIGIN}/` },
                { '@type': 'ListItem', position: 2, name: 'Insights', item: `${ORIGIN}/blog/` },
                { '@type': 'ListItem', position: 3, name: post.title }
            ]
        }
    ];

    if (faqs.length) {
        graph.push({
            '@type': 'FAQPage',
            '@id': `${url}#faq`,
            mainEntity: faqs.map((f) => ({
                '@type': 'Question',
                name: f.q,
                acceptedAnswer: { '@type': 'Answer', text: f.a }
            }))
        });
    }

    return { '@context': 'https://schema.org', '@graph': graph };
}

/* ═══════════════════════════════════════════════
   Page templates
═══════════════════════════════════════════════ */

const DISCLOSURE = 'This article is general information about commercial financing, not financial, legal, or tax advice for your specific situation. Costs, terms, and eligibility vary by business and by funder, and no outcome is guaranteed. Review every agreement in full &mdash; including total repayment amount, remittance schedule, and fees &mdash; and consider having an accountant or attorney read it before you sign.';

function postPage(post, all) {
    const url = `${ORIGIN}/blog/${post.slug}/`;
    const related = all.filter((p) => p.slug !== post.slug)
        .sort((a, b) => (a.category === post.category ? -1 : 1) - (b.category === post.category ? -1 : 1))
        .slice(0, 3);

    return head({
        title: post.metaTitle || `${post.title} | ${SITE_NAME}`,
        description: post.description,
        canonical: url,
        ogType: 'article',
        published: post.date,
        modified: post.updated || post.date,
        jsonld: articleGraph(post, post.faqs)
    }) + `
<div class="wrap">
    <nav class="crumbs" aria-label="Breadcrumb">
        <a href="/">Home</a> <span>/</span>
        <a href="/blog/">Insights</a> <span>/</span>
        <span aria-current="page">${esc(post.category)}</span>
    </nav>

    <article>
        <div class="article-head">
            <div class="eyebrow">${esc(post.category)}</div>
            <h1>${esc(post.title)}</h1>
            <p class="article-dek">${esc(post.description)}</p>
            <div class="byline">
                <span class="author">${AUTHOR}</span>
                <span class="sep">&middot;</span>
                <time datetime="${post.date}">${humanDate(post.date)}</time>
                <span class="sep">&middot;</span>
                <span>${post.readMinutes} min read</span>${post.updated && post.updated !== post.date ? `
                <span class="sep">&middot;</span>
                <span>Updated ${humanDate(post.updated)}</span>` : ''}
            </div>
        </div>

        <div class="article-body">
${post.html}
        </div>
    </article>

    <section class="article-cta">
        <h2>${esc(post.ctaHeading || 'See what your business qualifies for')}</h2>
        <p>${esc(post.ctaBody || 'Send us three to six months of business bank statements and we will tell you what we can offer, what it costs in total dollars, and what the repayment schedule looks like. No upfront fees, and no obligation to accept an offer.')}</p>
        <a href="/app/" class="btn-accent">Start an application</a>
    </section>

    <p class="disclosure">${DISCLOSURE}</p>

    <section class="related">
        <h2>Keep reading</h2>
        <div class="related-grid">
${related.map((p) => `            <a class="related-card" href="/blog/${p.slug}/">
                <span class="cat">${esc(p.category)}</span>
                <h3>${esc(p.title)}</h3>
            </a>`).join('\n')}
        </div>
    </section>
</div>
` + FOOTER;
}

function indexPage(posts) {
    const jsonld = {
        '@context': 'https://schema.org',
        '@graph': [
            ORGANIZATION,
            WEBSITE,
            {
                '@type': 'Blog',
                '@id': `${ORIGIN}/blog/#blog`,
                url: `${ORIGIN}/blog/`,
                name: `${SITE_NAME} Insights`,
                description: 'Plain-English guides to business funding: merchant cash advances, factor rates, term loans, lines of credit, and what lenders actually look for.',
                publisher: { '@id': `${ORIGIN}/#organization` },
                inLanguage: 'en-US',
                blogPost: posts.map((p) => ({
                    '@type': 'BlogPosting',
                    '@id': `${ORIGIN}/blog/${p.slug}/#article`,
                    headline: p.title,
                    url: `${ORIGIN}/blog/${p.slug}/`,
                    datePublished: `${p.date}T12:00:00Z`,
                    author: { '@type': 'Organization', name: AUTHOR }
                }))
            },
            {
                '@type': 'BreadcrumbList',
                '@id': `${ORIGIN}/blog/#breadcrumbs`,
                itemListElement: [
                    { '@type': 'ListItem', position: 1, name: 'Home', item: `${ORIGIN}/` },
                    { '@type': 'ListItem', position: 2, name: 'Insights' }
                ]
            }
        ]
    };

    return head({
        title: `Business Funding Insights | ${SITE_NAME}`,
        description: 'Straight answers on how business funding works: what a merchant cash advance really costs, how factor rates convert to APR, funding timelines, and what lenders look for in your bank statements.',
        canonical: `${ORIGIN}/blog/`,
        jsonld
    }) + `
<div class="wrap">
    <nav class="crumbs" aria-label="Breadcrumb">
        <a href="/">Home</a> <span>/</span>
        <span aria-current="page">Insights</span>
    </nav>

    <div class="index-hero">
        <div class="eyebrow">Insights</div>
        <h1>Business funding, explained plainly.</h1>
        <p>Most funding content online is written to sell you something before it tells you what anything costs. These guides do the opposite: real numbers, real timelines, and the tradeoffs of each option &mdash; including ours.</p>
    </div>

    <div class="post-list">
${posts.map((p) => `        <a class="post-card" href="/blog/${p.slug}/">
            <div class="post-meta">
                <span class="cat">${esc(p.category)}</span>
                <span class="dot">&middot;</span>
                <time datetime="${p.date}">${humanDate(p.date)}</time>
                <span class="dot">&middot;</span>
                <span>${p.readMinutes} min read</span>
            </div>
            <h2>${esc(p.title)}</h2>
            <p>${esc(p.description)}</p>
            <span class="read-more">Read the guide</span>
        </a>`).join('\n')}
    </div>
</div>
` + FOOTER;
}

/* ═══════════════════════════════════════════════
   Feeds and crawl files
═══════════════════════════════════════════════ */

// Static pages that belong in the sitemap, with their priority.
// /app/thanks/ and /elya/ are intentionally excluded — conversion and
// partner-specific pages have no business in search results.
const STATIC_PAGES = [
    { loc: `${ORIGIN}/`, priority: '1.0', changefreq: 'monthly' },
    { loc: `${ORIGIN}/blog/`, priority: '0.9', changefreq: 'weekly' },
    { loc: `${ORIGIN}/faq/`, priority: '0.7', changefreq: 'monthly' },
    { loc: `${ORIGIN}/app/`, priority: '0.8', changefreq: 'monthly' },
    { loc: `${ORIGIN}/privacy-policy`, priority: '0.3', changefreq: 'yearly' },
    { loc: `${ORIGIN}/terms-of-service`, priority: '0.3', changefreq: 'yearly' }
];

function sitemap(posts) {
    const today = new Date().toISOString().slice(0, 10);
    const entries = [
        ...STATIC_PAGES.map((p) => ({ ...p, lastmod: today })),
        ...posts.map((p) => ({
            loc: `${ORIGIN}/blog/${p.slug}/`,
            lastmod: p.updated || p.date,
            changefreq: 'monthly',
            priority: '0.8'
        }))
    ];

    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map((e) => `  <url>
    <loc>${e.loc}</loc>
    <lastmod>${e.lastmod}</lastmod>
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority}</priority>
  </url>`).join('\n')}
</urlset>
`;
}

function rss(posts) {
    const latest = posts.slice(0, 20);
    const built = latest.length ? rssDate(latest[0].updated || latest[0].date) : new Date().toUTCString();

    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${esc(SITE_NAME)} — Insights</title>
    <link>${ORIGIN}/blog/</link>
    <description>Plain-English guides to business funding from ${esc(SITE_NAME)}.</description>
    <language>en-us</language>
    <copyright>Copyright ${new Date().getFullYear()} ${esc(SITE_NAME)}</copyright>
    <lastBuildDate>${built}</lastBuildDate>
    <atom:link href="${ORIGIN}/rss.xml" rel="self" type="application/rss+xml"/>
${latest.map((p) => `    <item>
      <title>${esc(p.title)}</title>
      <link>${ORIGIN}/blog/${p.slug}/</link>
      <guid isPermaLink="true">${ORIGIN}/blog/${p.slug}/</guid>
      <pubDate>${rssDate(p.date)}</pubDate>
      <category>${esc(p.category)}</category>
      <description>${esc(p.description)}</description>
      <content:encoded><![CDATA[${p.html}]]></content:encoded>
    </item>`).join('\n')}
  </channel>
</rss>
`;
}

const ROBOTS = `# https://www.fairmontcreditpartners.com/robots.txt
User-agent: *
Allow: /

# Conversion and partner-specific pages should not appear in search results.
Disallow: /app/thanks/
Disallow: /elya/

Sitemap: ${ORIGIN}/sitemap.xml
`;

/* ═══════════════════════════════════════════════
   Build
═══════════════════════════════════════════════ */

function build() {
    const dir = join(ROOT, 'content', 'posts');
    const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();

    if (!files.length) {
        console.error('No posts found in content/posts/');
        process.exit(1);
    }

    const posts = files.map((file) => {
        let meta, body;
        try {
            ({ meta, body } = parseFrontmatter(readFileSync(join(dir, file), 'utf8')));
        } catch (err) {
            console.error(`${file}: ${err.message}`);
            process.exit(1);
        }

        for (const required of ['title', 'slug', 'description', 'date', 'category']) {
            if (!meta[required]) {
                console.error(`${file}: frontmatter is missing "${required}"`);
                process.exit(1);
            }
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date)) {
            console.error(`${file}: date must be YYYY-MM-DD, got "${meta.date}"`);
            process.exit(1);
        }

        const blocks = parseBlocks(body);
        const words = plain(blockText(blocks)).split(/\s+/).filter(Boolean).length;

        return {
            ...meta,
            words,
            readMinutes: Math.max(1, Math.round(words / 225)),
            html: renderBlocks(blocks),
            faqs: extractFaqs(blocks)
        };
    });

    const slugs = new Set();
    for (const p of posts) {
        if (slugs.has(p.slug)) { console.error(`Duplicate slug: ${p.slug}`); process.exit(1); }
        slugs.add(p.slug);
    }

    // Newest first; ties break on title so the order is stable between builds.
    posts.sort((a, b) => (b.date.localeCompare(a.date)) || a.title.localeCompare(b.title));

    for (const post of posts) {
        const out = join(ROOT, 'blog', post.slug);
        mkdirSync(out, { recursive: true });
        writeFileSync(join(out, 'index.html'), postPage(post, posts));
        console.log(`  /blog/${post.slug}/  ${String(post.words).padStart(5)} words  ${post.faqs.length} FAQ${post.faqs.length === 1 ? '' : 's'}`);
    }

    mkdirSync(join(ROOT, 'blog'), { recursive: true });
    writeFileSync(join(ROOT, 'blog', 'index.html'), indexPage(posts));
    writeFileSync(join(ROOT, 'sitemap.xml'), sitemap(posts));
    writeFileSync(join(ROOT, 'rss.xml'), rss(posts));
    writeFileSync(join(ROOT, 'robots.txt'), ROBOTS);

    const totalWords = posts.reduce((n, p) => n + p.words, 0);
    console.log(`\n${posts.length} posts, ${totalWords} words total.`);
    console.log('Wrote blog/index.html, sitemap.xml, rss.xml, robots.txt');
}

build();

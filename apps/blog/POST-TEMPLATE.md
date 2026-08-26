# Blog Post Template — Step by Step

Reusable step-by-step template for publishing any post to `apps/blog/`. Fill in the placeholders below, then execute the steps in order. Do not skip any step — a post that isn't in the sitemap/feed/index is incomplete.

## Post metadata (fill in)

| Field | Value |
|-------|-------|
| **Slug** | `{slug}` (kebab-case, e.g. `ai-inflation-fed-rate-debate-2026`) |
| **Title** | `{Title}` |
| **Date** | `{YYYY-MM-DD}` |
| **Category** | `finance` or `tech` |
| **Excerpt** | `{1-2 sentence summary}` |
| **Author** | Pyae Phyo Kyaw |
| **Read time** | `{N} min read` (~200 words/min) |
| **Tags** | `{5-8 keywords}` — feeds `keywords` meta + `article:tag` |
| **Post URL** | `https://pyaek.com/apps/blog/{yyyy}/{mm}/{slug}/` |
| **OG image** | `apps/blog/assets/images/{slug}.png` (1200×630) |

## Step-by-step checklist

| # | Step | File(s) | What to do |
|---|------|---------|------------|
| 1 | **Research & verify sources** | — (web) | WebSearch + WebFetch every claim to find working URLs. Prefer primary sources (company announcements, government reports) and major outlets (Reuters, Bloomberg, BBC, The Verge, TechCrunch, The Register, Ars Technica). **Never publish a dead link** — replace any 404/error with a working alternative. |
| 2 | **Write post content** | — (draft) | Compose the HTML body in the house style: opening hook → "Story at a glance" SVG diagram → 8Ws sections → References → Disclaimer. See [Post Style](#post-style) below. |
| 3 | **Append to posts.json** | `apps/blog/posts/posts.json` | Append the post object: `id`, `title`, `date`, `category`, `excerpt`, `content` (HTML), `author`, `readTime`, `tags`. Validate: `python3 -c "import json; json.load(open('apps/blog/posts/posts.json'))"` |
| 4 | **Generate OG image** | `apps/blog/assets/images/{slug}.png` | Run `deno run --allow-read --allow-write --allow-run apps/blog/scripts/generate-og-image.ts posts` (writes 1200×630 PNG for every post in posts.json). |
| 5 | **Create static post page** | `apps/blog/{yyyy}/{mm}/{slug}/index.html` | Copy an existing post page (template) and replace: title/description/keywords, canonical + og:url, og:image/twitter:image/JSON-LD image → `.../assets/images/{slug}.png`, article:published_time/modified_time, article:section + article:tag, BlogPosting + BreadcrumbList JSON-LD, `<h1 class="post-detail-title">` + unescaped body. Keep the full glass-header, header-nav IIFE, theme toggle, SW registration. **No** `.post-detail-back`, **no** `app.js`. |
| 6 | **Sync blog index** | `apps/blog/index.html` | Add the post (newest first) to all three places: `Blog` JSON-LD `blogPost` array, `ItemList` JSON-LD, and `<noscript>` post list. |
| 7 | **Update sitemap** | `sitemap.xml` | Add `<url>` entry: loc = post URL, lastmod = post date, changefreq monthly, priority 0.7, `<image:image>` → OG PNG. Update the blog entry's `<lastmod>` to the current date. |
| 8 | **Update feed** | `apps/blog/feed.xml` | Add `<item>`: title, link, guid (isPermaLink), pubDate (RFC 822), description (excerpt), `<content:encoded><![CDATA[...full HTML...]]></content:encoded>`, category, author `hello@pyaek.com (Pyae Phyo Kyaw)`. Update `<lastBuildDate>`. |
| 9 | **Bump SW cache** | `apps/blog/sw.js` | Bump `CACHE_NAME` from `pyaek-blog-v{N}` → `pyaek-blog-v{N+1}` (index.html changed; SW serves it cache-first). |
| 10 | **Verify** | all of the above | See [Verification](#verification) below. Report the post URL + SW cache version bumped. |

## Post Style

Every post MUST follow the **8Ws Framework**, include a **UML summary diagram**, be a **public-friendly narrative**, include **fact tables**, and cite **verified working sources**.

### 1. The 8Ws Framework (as `<h2>`/`<h3>` sections, in order)

1. **What** — What is happening right now. State the news in 1-2 plain sentences a non-expert can understand.
2. **Why** — Why it matters. Who is affected and what is at stake.
3. **Who** — The people, companies, and organizations involved.
4. **When** — The timeline: when it happened, key dates, what is scheduled next.
5. **Where** — Where it is happening (geography, market, platform, industry).
6. **Which** — The specific technologies, products, numbers, and data points involved.
7. **How** — How it works or how it happened (the mechanism, step by step).
8. **What next** — What will happen because of this. MUST include:
   - **Historical parallel**: a similar past event and what happened after it.
   - **Future outlook**: what experts/analysts predict, what to watch, 2-3 plausible scenarios.

### 2. UML summary diagram

After the intro paragraph, add a **"Story at a glance"** section: a simple SVG flowchart (boxes + arrows) summarizing the whole post — **Event → Impact → Historical parallel → Future outlook**. Use `<figure><svg>…<figcaption>`. Keep it simple: 4-6 boxes, one direction of flow, design tokens (`var(--color-accent)`, `var(--color-border)`, `var(--color-text)`, `var(--color-text-secondary)`). The `aria-label` on the `<svg>` must describe the diagram.

### 3. Public-friendly narrative

- General public audience: short sentences, plain words, explain jargon on first use.
- 8Ws as the skeleton; paragraphs 2-4 sentences.
- Lead with the most important fact; end with a clear takeaway.
- `<strong>` for key numbers, `<em>` sparingly.

### 4. Fact tables

- At least **2-3 tables** per post: `<table>` with `<thead>`, `<tbody>`, `<caption>`.
- Use for: key facts & figures, timelines, comparisons, rankings, scores, pros/cons.
- Every number sourced — cite with `[n]` in the caption or a note under the table.

### 5. Citations

- End with `<h2>References</h2>` numbered `<ol>`.
- Every factual claim cites its source with `[n]`.
- **Verify every link with WebFetch before publishing.** Never publish a dead link.

### 6. Images policy

- **No AI image generation** — never use DALL-E, Stable Diffusion, or any AI image generator. No credits spent on images.
- **No vision** — the model cannot read or write images via vision. Never attempt to read/view/analyze image files.
- **UML diagrams are SVG drawings only** — hand-authored inline SVG (boxes + arrows), not images.
- **OG image via script only** — `generate-og-image.ts` (deterministic text renderer, not AI, no credits).
- **Inline images: existing web images with credits** — hotlink an existing web image with descriptive `alt` + a credit line in the `<figcaption>` (e.g. "Image: {source name}, via {URL}"). Never fabricate or claim authorship of an image.

### Allowed tags

`<h2>`, `<h3>`, `<p>`, `<ul>`, `<ol>`, `<li>`, `<strong>`, `<em>`, `<code>`, `<pre><code>`, `<blockquote>`, `<a>`, `<img>`, `<figure>`, `<figcaption>`, `<svg>`, `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<th>`, `<td>`, `<caption>`. No inline styles, no `<h1>`, no `<script>`, no `<iframe>`. Escape `&` as `&amp;` in text content.

## Static page requirements (step 5 details)

- **Head structure** (in order): theme flash script → standard meta (charset, viewport, theme-color light+dark, apple-mobile-web-app-*) → SEO meta (title, description, author, keywords, robots index/follow, referrer, canonical, sitemap link, RSS alternate) → OG tags (og:type article, og:url, og:title, og:description, og:image + width/height/type, og:image:alt, og:site_name, og:locale, article:published_time/modified_time/author/section/tag) → Twitter tags (mirror OG) → favicon/manifest links → JSON-LD (BlogPosting + BreadcrumbList) → CSS links.
- **BlogPosting JSON-LD**: headline, description, datePublished, dateModified, image, url, articleSection, author (Person), publisher (Organization with 180×180 apple-touch-icon logo), mainEntityOfPage.
- **BreadcrumbList JSON-LD**: Home → Blog → post (position 3 name = title, item = post URL).
- **Relative paths** from `{yyyy}/{mm}/{slug}/`: root CSS `../../../../../assets/css/style.css`, blog CSS `../../../assets/css/style.css`, header link `../../../`, manifest `/apps/blog/manifest.json`, SW `/apps/blog/sw.js` with scope `/apps/blog/`.
- **Glass-header**: Blog title, All/Finance/Tech filter buttons, search input, theme toggle. Header-nav IIFE base `../../../` — filter buttons → `../../../?filter={category}`, search Enter → `../../../?q={query}`.
- **No** "Back to posts" link (`.post-detail-back`) — the header "Blog" link is the way back.
- **No** `app.js` on the static page (double-render).

## Verification

```bash
# 1. posts.json valid
python3 -c "import json; json.load(open('apps/blog/posts/posts.json'))"

# 2. JSON-LD blocks parse (BlogPosting + BreadcrumbList)
#    extract each <script type="application/ld+json"> from the new page and parse with python3

# 3. Exactly one <h1> on the page
python3 -m http.server 8000
curl -s localhost:8000/apps/blog/{yyyy}/{mm}/{slug}/ | grep -c "<h1"   # → 1

# 4. OG image exists
ls apps/blog/assets/images/{slug}.png

# 5. sitemap.xml and feed.xml well-formed XML

# 6. Every References link WebFetch-verified (no dead links)
```

Report: the new post URL and the SW cache version bumped (`v{N}` → `v{N+1}`).

## Batch mode

When several posts are written in one run, a **merge agent** handles all shared files so parallel agents never conflict. Each agent does only: read state → research → write content → create static page → write post object to `scripts/tmp/{rank}-{slug}.json`. The merge agent appends all posts, syncs shared files, runs the OG image script, and cleans up `scripts/tmp/`.

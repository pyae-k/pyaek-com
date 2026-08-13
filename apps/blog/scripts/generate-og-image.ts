// OG image generator for the blog.
// Modes:
//   default (no args): generic brand image -> /assets/images/og-image.png
//   home:              homepage brand image (custom tagline) -> /assets/images/og-image.png
//   posts:              one 1200x630 image per post -> apps/blog/assets/images/{slug}.png
// Uses design tokens from assets/css/base.css (light values).
// Run:
//   deno run --allow-read --allow-write --allow-run apps/blog/scripts/generate-og-image.ts
//   deno run --allow-read --allow-write --allow-run apps/blog/scripts/generate-og-image.ts home
//   deno run --allow-read --allow-write --allow-run apps/blog/scripts/generate-og-image.ts posts

const W = 1200;
const H = 630;
const TMP = "/tmp/pyaek-og.html";

const BRAND = "Pyaek";
const DOMAIN = "pyaek.com";
const CATEGORY_COLORS = { finance: "#0071E3", tech: "#34C759" };

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Word-wrap a title to at most `maxLines` lines of `maxChars` chars each.
function wrapTitle(title, maxChars, maxLines) {
  const words = String(title).split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const candidate = line ? line + " " + w : w;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = w;
    } else {
      line = candidate;
    }
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  // Truncate the last line with an ellipsis if it still overflows.
  const last = lines[lines.length - 1];
  if (last && last.length > maxChars) {
    lines[lines.length - 1] = last.slice(0, maxChars - 1).trimEnd() + "…";
  }
  return lines;
}

// Build the 1200x630 HTML template. With a title/category it renders the
// per-post layout; without, the generic brand layout (tagline overridable).
function buildTemplate({ title, category, tagline }) {
  const badge = category
    ? '<div class="badge" style="background:' +
      (CATEGORY_COLORS[category] || "#0071E3") +
      '">' +
      escapeHtml(category) +
      "</div>"
    : "";
  const main = title
    ? '<div class="title">' +
      wrapTitle(title, 42, 2)
        .map((l) => "<div>" + escapeHtml(l) + "</div>")
        .join("") +
      '</div><div class="post-brand">' +
      BRAND +
      "</div>"
    : '<div class="brand">' +
      BRAND +
      '</div><div class="tagline">' +
      (tagline || "Blog — Finance · Tech · Data") +
      "</div>";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${W}px; height: ${H}px; overflow: hidden; }
  body {
    background: #FFFFFF;
    font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
    display: flex;
    align-items: center;
    position: relative;
  }
  .accent {
    position: absolute;
    left: 0; top: 0; bottom: 0;
    width: 24px;
    background: #0071E3;
  }
  .content {
    padding-left: 120px;
    max-width: 900px;
  }
  .brand {
    font-size: 96px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: #1A1A1A;
    line-height: 1.1;
  }
  .tagline {
    margin-top: 24px;
    font-size: 40px;
    font-weight: 400;
    color: #6B6B6B;
    letter-spacing: -0.01em;
  }
  .badge {
    display: inline-block;
    padding: 10px 20px;
    border-radius: 999px;
    color: #FFFFFF;
    font-size: 24px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 28px;
  }
  .title {
    font-size: 40px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: #1A1A1A;
    line-height: 1.15;
  }
  .title div { margin-bottom: 4px; }
  .post-brand {
    margin-top: 32px;
    font-size: 28px;
    font-weight: 600;
    color: #1A1A1A;
  }
  .domain {
    position: absolute;
    bottom: 48px;
    left: 120px;
    font-size: 28px;
    color: #9A9A9A;
  }
</style>
</head>
<body>
  <div class="accent"></div>
  <div class="content">
    ${badge}
    ${main}
  </div>
  <div class="domain">${DOMAIN}</div>
</body>
</html>`;
}

async function render(html, outPath) {
  await Deno.writeTextFile(TMP, html);

  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const cmd = new Deno.Command(chrome, {
    args: [
      "--headless",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--screenshot=" + outPath,
      "--window-size=" + W + "," + H,
      "file://" + TMP,
    ],
  });
  const res = await cmd.output();
  if (!res.success) {
    console.error("Chrome screenshot failed:", new TextDecoder().decode(res.stderr));
    Deno.exit(1);
  }
  console.log("Wrote", outPath);
}

const mode = Deno.args[0] || "default";

if (mode === "posts") {
  const postsUrl = new URL("../posts/posts.json", import.meta.url);
  const posts = JSON.parse(await Deno.readTextFile(postsUrl));
  for (const post of posts) {
    const out = new URL("../assets/images/" + post.id + ".png", import.meta.url);
    await render(buildTemplate({ title: post.title, category: post.category }), out.pathname);
  }
} else {
  const out = new URL("../../../assets/images/og-image.png", import.meta.url);
  const tagline = mode === "home" ? "Free Tools for Chat, Data & More" : undefined;
  await render(buildTemplate({ tagline }), out.pathname);
}

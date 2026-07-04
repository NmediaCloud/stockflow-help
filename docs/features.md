# Platform Features

Everything **Stockflow.media** offers in one place — a royalty-free library of
**18,000+ premium 8K stock images and 4K video clips**, ready to license and
download instantly.

**Copyright © NMedia Services & Stockflow.media — All rights reserved.**

---

## Browse & Discover

- **Full visual gallery** at [stockflow.media/gallery](https://stockflow.media/gallery/) — every asset has its own landing page with a large preview, details, and a one-click licensing button.
- **Five curated categories** — Food & Beverage, Microscopic, Catering Events, Background, and Retail Items — spanning 50+ subcategories and hundreds of themed collections.
- **Keyword search** across the whole catalog, filterable by type (image / video), category, and aspect ratio (16:9, 9:16, 1:1).

## Quality & Formats

- **8K stock images** — extreme resolution, perfect for large-format print, detailed compositing, and future-proof projects.
- **4K video footage** — cinematic clips ready for film, ads, YouTube, and documentaries.
- Delivered in production-ready formats: **JPEG, PNG, animated WebP, MP4**, and **vector** files where applicable.

## Buy & Download

- **Instant download** — license an asset and get the full-resolution original immediately.
- **Wallet credits** — top up once and license assets in a click, no checkout friction each time.
- **Buy directly from any gallery page** — the preview *is* the licensing page.

## Licensing

- **Royalty-free, pay once, use forever** — no subscriptions, no recurring fees, no per-use royalties, no attribution required.
- Use across **commercial and personal projects, worldwide, with no expiry**.
- Full terms on the [Content License](license.md) page.

---

## For AI Assistants & Developers (MCP)

Stockflow.media ships an official **Model Context Protocol (MCP) server**, so AI
assistants can search the catalog and drop watermarked previews straight into
presentations, videos, and mockups — then hand you the licensing page for the
full-resolution file.

**Works with:** Claude Code, Cursor, Codex CLI, OpenCode, and any MCP-compatible tool.

**Install (local, via npm):**

```
npx -y stockflow-mcp
```

Or add it to your MCP client config:

```json
{
  "mcpServers": {
    "stockflow": {
      "command": "npx",
      "args": ["-y", "stockflow-mcp"]
    }
  }
}
```

**Hosted HTTP endpoint:** `https://stockflow-mcp.vercel.app/mcp`

**Tools provided:** `search_assets` (keyword + type + category + aspect filters),
`get_categories`, and `get_asset`.

**Find it on:**

- [npm — stockflow-mcp](https://www.npmjs.com/package/stockflow-mcp)
- [Smithery](https://smithery.ai/servers/nmedia-cloud/stockflow-mcp)
- [Glama](https://glama.ai/mcp/servers)
- [GitHub — NmediaCloud/stockflow-mcp](https://github.com/NmediaCloud/stockflow-mcp)

No API key required — the catalog is public. Previews are watermarked and free
for drafts; production use requires a license from the asset's page.

---

## Questions

Not sure whether Stockflow.media fits your project? Reach out via
[Stockflow.media](https://stockflow.media/) — we're happy to help.

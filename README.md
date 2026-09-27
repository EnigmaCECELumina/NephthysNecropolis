# Apex Codex & Sovereign Infrastructure Suite

This is a standalone product bundle, kept separate from the original tier catalog. The main storefront's product loader only reads Markdown files directly inside its root `products/` directory, so this bundle's listing is excluded from the existing Gumroad sync and catalog build until you deliberately integrate it.

## Bundle contents

- `products/apex-codex-sovereign-infrastructure.md` — product listing source, including Gumroad metadata.
- `core/` — downloadable local-first Node.js command engine and setup guide.

## Gumroad

Review the listing and attach the downloadable `core/` package as the customer deliverable in Gumroad. When you are ready to include this product in the current project's Gumroad sync, copy its Markdown file into the project's root `products/` directory. The root `npm run push:gumroad` processes every product in that directory, so it will sync the full catalog, not just Apex.

The Gumroad ID and URL in the listing are blank until the product is created and published. Keep the working bundle copy here as the separate source of truth, or copy the updated metadata back into this bundle after syncing.

## GitHub Actions and Pages

The existing catalog build and Pages workflow operate on the project root. To include an Apex product page in that catalog, copy the listing into the root `products/` directory, then run `npm run validate` and `npm run build:site`. This intentionally adds Apex to the main catalog. To keep it independent, publish this bundle from a separate repository or deployment project; the `core/` CLI itself is a local downloadable product and is not a Pages website.

## Run the customer CLI

See [`core/README.md`](./core/README.md). The CLI requires Node.js 20 or newer and stores its ledger, summaries, and backups locally within its working directory by default.

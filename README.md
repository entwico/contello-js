# contello-js

A collection of shared JavaScript/TypeScript libraries for Contello projects.

## Packages

| Package | Description |
|---------|-------------|
| [@contello/client](./packages/client) | GraphQL WebSocket client and codegen CLI |
| [@contello/store](./packages/store) | Framework-agnostic reactive data layer on top of the client |
| [@contello/astro](./packages/astro) | Astro integration |
| [@contello/media](./packages/media) | Asset primitives and rendering helpers, optional `/react` |
| [@contello/rich-text](./packages/rich-text) | Rich text document types and helpers |
| [@contello/extension](./packages/extension) | Client SDK for building Contello CMS extensions and custom properties |

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm run build

# Run tests
pnpm test

# Typecheck
pnpm run typecheck
```

## License

MIT

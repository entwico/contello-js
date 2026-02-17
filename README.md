# contello-js

A collection of shared JavaScript/TypeScript libraries for Contello projects.

## Packages

| Package | Description |
|---------|-------------|
| [@contello/rich-text](./packages/rich-text) | Rich text document types and helpers |
| [@contello/uploader](./packages/uploader) | File uploader with WebSocket and HTTP transports |
| [@contello/sdk-client](./packages/sdk-client) | GraphQL SDK client with WebSocket transport and connection pooling |
| [@contello/extension](./packages/extension) | Client SDK for building Contello CMS extensions and custom properties |

## Development

```bash
# Install dependencies
bun install

# Build all packages
bun run build

# Run tests
bun test

# Typecheck
bun run typecheck
```

## License

MIT

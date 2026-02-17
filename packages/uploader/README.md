# @contello/uploader

File uploader for Contello CMS with WebSocket (chunked) and HTTP (multipart) transports.

## Installation

```bash
npm install @contello/uploader rxjs
```

## Usage

### Simple upload

```ts
import { ContelloUploader } from '@contello/uploader';

const uploader = new ContelloUploader({
  url: 'https://example.com',
  project: 'myProjectId',
  token: 'app-a123b456c7890d123456789',
});

const { id } = await uploader.upload(file);
```

### Upload with progress

```ts
uploader.uploadWithEvents(file).subscribe((event) => {
  if ('progress' in event) {
    console.log(`${event.progress.toFixed(1)}%`);
  } else {
    console.log(`uploaded: ${event.id}`);
  }
});
```

### Upload with metadata

```ts
import { UploadAssetRetentionPolicy } from '@contello/uploader';

await uploader.upload(file, {
  annotations: [{ key: 'category', value: 'photos' }],
  collectionRefs: ['collection-id'],
  retentionPolicy: UploadAssetRetentionPolicy.retain,
  image: {
    transformations: [
      { name: 'fit', options: { width: 1920, height: 1080 } },
      { name: 'convert', options: { format: 'avif', options: { quality: 80, lossless: false } } },
    ],
  },
});
```

### Abort an upload

```ts
const controller = new AbortController();

uploader.upload(file, undefined, { abort: controller.signal });

controller.abort();
```

## API

### `ContelloUploader`

| Option      | Type             | Default          | Description                      |
| ----------- | ---------------- | ---------------- | -------------------------------- |
| `url`       | `string`         | —                | Base URL of the Contello server  |
| `project`   | `string`         | —                | Project identifier               |
| `token`     | `string`         | —                | Authentication token             |
| `transport` | `'ws' \| 'http'` | `'ws'`           | Transport protocol               |
| `chunkSize` | `number`         | `4194304` (4 MB) | Chunk size for WebSocket uploads |

### Methods

| Method                                    | Returns                                             | Description                          |
| ----------------------------------------- | --------------------------------------------------- | ------------------------------------ |
| `upload(file, meta?, options?)`           | `Promise<{ id: string }>`                           | Upload a file, resolve with asset ID |
| `uploadWithEvents(file, meta?, options?)` | `Observable<UploadAssetProgress \| { id: string }>` | Upload with progress events          |

## License

MIT

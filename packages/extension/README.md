# @contello/extension

Client SDK for building Contello CMS extensions and custom properties. Communicates with the Contello host application via postMessage channels.

## Installation

```bash
npm install @contello/extension
```

## Usage

### Extension

Extensions are full-page iframe apps embedded in the Contello UI.

```ts
import { ContelloExtension } from '@contello/extension';

const extension = await ContelloExtension.connect({
  trustedOrigins: ['https://your-contello-instance.com'],
});

await extension.ready();

// get URL path and query data
const { path, query } = await extension.getUrlData();

// set breadcrumbs
await extension.setBreadcrumbs([
  { label: 'Home', url: '/' },
  { label: 'Current Page' },
]);

// navigate
await extension.navigate(extension.createEntityDetailUrl('articles', { mode: 'edit', id: '123' }));

// show notifications
await extension.displayNotification('success', 'Saved successfully');
```

### Custom property

Custom properties are smaller iframe widgets used inside entity forms.

```ts
import { ContelloCustomProperty } from '@contello/extension';

const property = await ContelloCustomProperty.connect({
  trustedOrigins: ['https://your-contello-instance.com'],
  validator: () => true,
  newValue: (value) => console.log('new value:', value),
});

await property.ready();

// get / set the property value
const value = await property.getValue();
await property.setValue('new value');

// get / set values by path (for complex entities)
const nested = await property.getValueByPath('some.path');
await property.setValueByPath('some.path', 'new value');
```

### Dialogs

Open modal dialogs from extensions or custom properties.

```ts
const dialog = extension.openDialog<InputData, ResultData>({
  url: 'https://my-dialog.example.com',
  width: 800,
  data: { someInput: 'value' },
});

await dialog.open;
await dialog.ready;

const result = await dialog.complete;
```

Inside the dialog iframe:

```ts
import { ContelloDialog } from '@contello/extension';

const dialog = await ContelloDialog.connect<InputData, ResultData>({
  trustedOrigins: ['https://your-contello-instance.com'],
});

await dialog.ready();

// access data passed from the opener
console.log(dialog.data);

// close with a result
await dialog.close({ selectedId: '456' });
```

### Auth token

Retrieve the current authentication token from the host:

```ts
const token = await extension.getAuthToken();
```

## API

### Classes

| Class | Description |
|-------|-------------|
| `ContelloExtension` | Full-page extension client |
| `ContelloCustomProperty` | Custom property widget client |
| `ContelloDialog` | Dialog iframe client |
| `ContelloDialogRef` | Handle returned by `openDialog()` |
| `ExtensionChannel` | Low-level postMessage channel (advanced use) |

## License

MIT

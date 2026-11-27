import { afterEach, describe, expect, test, vi } from 'vitest';

import { ContelloCustomProperty } from './custom-property';
import { ContelloDialog } from './dialog';
import { ContelloExtension } from './extension';
import { type FakeHost, createFakeHost } from './test-host';

const stubGlobal = (name: string, value: unknown) => vi.stubGlobal(name, value);

function createConnectedHost(data?: unknown): FakeHost {
  const host = createFakeHost(stubGlobal);

  host.answer('connect', () => ({ connected: true, data }));

  return host;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ContelloExtension', () => {
  test('connect() reads the channel from the page url and shakes hands with the host', async () => {
    const host = createConnectedHost();
    const extension = await ContelloExtension.connect({ trustedOrigins: [host.origin] });

    expect(host.requests.map((request) => [request.channelId, request.method])).toEqual([[host.channelId, 'connect']]);
    expect(extension.createProjectUrl()).toBe(`${host.origin}/ui/projects/project-1`);
  });

  test('connect() refuses a host that is not trusted without sending anything', async () => {
    const host = createConnectedHost();

    await expect(ContelloExtension.connect({ trustedOrigins: ['https://other.example.com'] })).rejects.toThrow(
      'is not trusted',
    );
    expect(host.requests).toEqual([]);
    expect(host.listeners()).toBe(0);
  });

  test('getUrlData() and setBreadcrumbs() go to the host', async () => {
    const host = createConnectedHost();
    const extension = await ContelloExtension.connect({ trustedOrigins: [host.origin] });

    host.answer('getUrlData', () => ({ path: ['a', 'b'], query: { page: '2' } }));
    host.answer('setBreadcrumbs', () => ({}));

    await expect(extension.getUrlData()).resolves.toEqual({ path: ['a', 'b'], query: { page: '2' } });

    await extension.setBreadcrumbs([{ label: 'Reports', url: '/reports' }, { label: '2026' }]);

    expect(host.payloads('setBreadcrumbs')).toEqual([
      { breadcrumbs: [{ label: 'Reports', url: '/reports' }, { label: '2026' }] },
    ]);
  });
});

describe('ContelloDialog', () => {
  test('connect() exposes the data the opener passed', async () => {
    const host = createConnectedHost({ articleId: '7' });
    const dialog = await ContelloDialog.connect<{ articleId: string }, boolean>({ trustedOrigins: [host.origin] });

    expect(dialog.data).toEqual({ articleId: '7' });
  });

  test('close() completes the dialog with its value', async () => {
    const host = createConnectedHost();
    const dialog = await ContelloDialog.connect<void, { saved: boolean }>({ trustedOrigins: [host.origin] });

    host.answer('complete', () => ({}));

    await dialog.close({ saved: true });
    await dialog.close();

    expect(host.payloads('complete')).toEqual([{ value: { saved: true } }, { value: undefined }]);
  });
});

describe('ContelloCustomProperty', () => {
  test('reads and writes the value of its property', async () => {
    const host = createConnectedHost();
    const property = await ContelloCustomProperty.connect({ trustedOrigins: [host.origin] });

    host.answer('getValue', () => ({ value: 'stored' }));
    host.answer('setValue', () => ({}));

    await expect(property.getValue()).resolves.toBe('stored');

    await property.setValue('changed');

    expect(host.payloads('setValue')).toEqual([{ value: 'changed', valid: true }]);
  });

  test('setValue() reports what the validator says about the value', async () => {
    const host = createConnectedHost();
    const validator = vi.fn(() => false);
    const property = await ContelloCustomProperty.connect({ trustedOrigins: [host.origin], validator });

    host.answer('setValue', () => ({}));

    await property.setValue('bad');

    expect(host.payloads('setValue')).toEqual([{ value: 'bad', valid: false }]);
  });

  test('reads and writes other values of the entity by path', async () => {
    const host = createConnectedHost();
    const property = await ContelloCustomProperty.connect({ trustedOrigins: [host.origin] });

    host.answer('getValueByPath', ({ path }) => ({ value: `value of ${path}` }));
    host.answer('setValueByPath', () => ({}));

    await expect(property.getValueByPath('attributes.title')).resolves.toBe('value of attributes.title');

    await property.setValueByPath('attributes.title', { de: 'Titel' });

    expect(host.payloads('setValueByPath')).toEqual([{ path: 'attributes.title', value: { de: 'Titel' } }]);
  });

  test('answers the validation request of the host with the validator', async () => {
    const host = createConnectedHost();
    let valid = false;
    const property = await ContelloCustomProperty.connect({ trustedOrigins: [host.origin], validator: () => valid });

    await expect(host.call('validate')).resolves.toEqual({ valid: false });

    valid = true;

    await expect(host.call('validate')).resolves.toEqual({ valid: true });
    expect(property.validate()).toBe(true);
  });

  test('is valid without a validator', async () => {
    const host = createConnectedHost();

    await ContelloCustomProperty.connect({ trustedOrigins: [host.origin] });

    await expect(host.call('validate')).resolves.toEqual({ valid: true });
  });

  test('hands a value the host pushes to newValue', async () => {
    const host = createConnectedHost();
    const newValue = vi.fn();

    await ContelloCustomProperty.connect({ trustedOrigins: [host.origin], newValue });

    await host.call('newValue', { value: 'pushed' });

    expect(newValue).toHaveBeenCalledWith('pushed');
  });

  test('accepts a pushed value without a newValue callback', async () => {
    const host = createConnectedHost();

    await ContelloCustomProperty.connect({ trustedOrigins: [host.origin] });

    await expect(host.call('newValue', { value: 'pushed' })).resolves.toBeUndefined();
  });
});

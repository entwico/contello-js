import { ContelloClient } from './client';
import type { ContelloCustomPropertyChildMethods, ContelloCustomPropertyParentMethods } from './methods';
import { parseUrl } from './url-parser';

export type ContelloCustomPropertyValidator = (value: any) => boolean;

export interface ContelloCustomPropertyOptions {
  trustedOrigins: string[];
  validator?: () => boolean;
  newValue?: (value: any) => void;
}

export class ContelloCustomProperty extends ContelloClient<
  void,
  ContelloCustomPropertyChildMethods,
  ContelloCustomPropertyParentMethods
> {
  static connect(options: ContelloCustomPropertyOptions) {
    const { targetOrigin, channelId, applicationId, debug } = parseUrl(options.trustedOrigins);
    const customProperty = new ContelloCustomProperty(targetOrigin, channelId, applicationId, debug);

    customProperty.validate = options.validator || (() => true);
    customProperty.newValue = options.newValue || (() => null);

    return customProperty.connect().then(() => customProperty);
  }

  validate = () => true;
  newValue: (value: string) => void = () => null;

  constructor(targetOrigin: string, channelId: string, applicationId: string, debug: boolean) {
    super(targetOrigin, channelId, applicationId, debug);

    this.channel.on('validate', async () => {
      const valid = await Promise.resolve(this.validate());

      return { valid };
    });

    this.channel.on('newValue', async (msg) => {
      await Promise.resolve(this.newValue(msg.value));
    });
  }

  async getValue(): Promise<string> {
    const r = await this.channel.call('getValue');

    return r.value;
  }

  async setValue(value: string): Promise<void> {
    const valid = await Promise.resolve(this.validate());

    return await this.channel.call('setValue', { value, valid });
  }

  async getValueByPath(path: string): Promise<any> {
    const r = await this.channel.call('getValueByPath', { path });

    return r.value;
  }

  async setValueByPath(path: string, value: any): Promise<void> {
    return this.channel.call('setValueByPath', { value, path });
  }
}

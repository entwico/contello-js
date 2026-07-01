import { ContelloClient } from './client';
import type {
  ContelloExtensionBreadcrumb,
  ContelloExtensionChildMethods,
  ContelloExtensionParentMethods,
} from './methods';
import { parseUrl } from './url-parser';

export interface ContelloExtensionOptions {
  trustedOrigins: string[];
}

export class ContelloExtension extends ContelloClient<
  void,
  ContelloExtensionChildMethods,
  ContelloExtensionParentMethods
> {
  static async connect({ trustedOrigins }: ContelloExtensionOptions) {
    const { targetOrigin, channelId, applicationId, debug } = parseUrl(trustedOrigins);
    const extension = new ContelloExtension(targetOrigin, channelId, applicationId, debug);

    await extension.connect();

    return extension;
  }

  constructor(targetOrigin: string, channelId: string, applicationId: string, debug: boolean) {
    super(targetOrigin, channelId, applicationId, debug);
  }

  getUrlData() {
    return this.channel.call('getUrlData');
  }

  setBreadcrumbs(breadcrumbs: ContelloExtensionBreadcrumb[]) {
    return this.channel.call('setBreadcrumbs', { breadcrumbs });
  }
}

import { ContelloClient } from './client';
import { parseUrl } from './url-parser';

export class ContelloDialog<D, T> extends ContelloClient<D, any, any> {
  static connect<D, T>({ trustedOrigins }: { trustedOrigins: string[] }) {
    const { targetOrigin, channelId, applicationId, debug } = parseUrl(trustedOrigins);
    const dialog = new ContelloDialog<D, T>(targetOrigin, channelId, applicationId, debug);

    return dialog.connect().then(() => dialog);
  }

  constructor(targetOrigin: string, channelId: string, applicationId: string, debug: boolean) {
    super(targetOrigin, channelId, applicationId, debug);
  }

  close(value?: T) {
    return this.channel.call('complete', { value });
  }
}

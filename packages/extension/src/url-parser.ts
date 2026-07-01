export function parseUrl(trustedOrigins: string[]) {
  const url = new URL(globalThis.location.href);

  const channelId = url.searchParams.get('channelId');
  const targetOrigin = url.searchParams.get('origin');
  const applicationId = url.searchParams.get('applicationId');

  if (!channelId || !targetOrigin || !applicationId) {
    throw new Error('Missing required URL parameters');
  }

  if (!trustedOrigins?.length) {
    throw new Error('No trusted origins provided');
  }

  if (!trustedOrigins.includes(targetOrigin)) {
    throw new Error(`Origin ${targetOrigin} is not trusted`);
  }

  const debug = url.searchParams.get('debug') === 'true';

  return { channelId, targetOrigin, applicationId, debug };
}

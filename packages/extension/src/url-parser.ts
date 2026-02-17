export function parseUrl(trustedOrigins: string[]) {
  const url = new URL(location.href);

  const channelId = url.searchParams.get('channelId');
  const targetOrigin = url.searchParams.get('origin');
  const applicationId = url.searchParams.get('applicationId');
  const debug = url.searchParams.get('debug') === 'true';

  if (!channelId || !targetOrigin || !applicationId) {
    throw new Error('Missing required URL parameters');
  }

  if (!trustedOrigins?.length) {
    throw new Error('No trusted origins provided');
  }

  if (!trustedOrigins.includes(targetOrigin)) {
    throw new Error(`Origin ${targetOrigin} is not trusted`);
  }

  return { channelId, targetOrigin, applicationId, debug };
}

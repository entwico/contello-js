import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { REPLY_TIMEOUT, createReplyWatchdog } from './reply-watchdog';

describe('createReplyWatchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('terminates when a new connection is not acknowledged in time', () => {
    const terminate = vi.fn();
    const watchdog = createReplyWatchdog(terminate);

    watchdog.connecting();

    vi.advanceTimersByTime(REPLY_TIMEOUT - 1);
    expect(terminate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(terminate).toHaveBeenCalledOnce();
  });

  test('keeps a connection that is acknowledged in time', () => {
    const terminate = vi.fn();
    const watchdog = createReplyWatchdog(terminate);

    watchdog.connecting();
    vi.advanceTimersByTime(REPLY_TIMEOUT - 1);
    watchdog.connected();

    vi.advanceTimersByTime(REPLY_TIMEOUT);
    expect(terminate).not.toHaveBeenCalled();
  });

  test('terminates when a sent ping gets no pong in time', () => {
    const terminate = vi.fn();
    const watchdog = createReplyWatchdog(terminate);

    watchdog.ping(false);

    vi.advanceTimersByTime(REPLY_TIMEOUT - 1);
    expect(terminate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(terminate).toHaveBeenCalledOnce();
  });

  test('keeps a connection whose pong arrives in time', () => {
    const terminate = vi.fn();
    const watchdog = createReplyWatchdog(terminate);

    watchdog.ping(false);
    vi.advanceTimersByTime(REPLY_TIMEOUT - 1);
    watchdog.pong(true);

    vi.advanceTimersByTime(REPLY_TIMEOUT);
    expect(terminate).not.toHaveBeenCalled();
  });

  test('a pong the client sent does not count as an answer', () => {
    const terminate = vi.fn();
    const watchdog = createReplyWatchdog(terminate);

    watchdog.ping(false);
    watchdog.pong(false);

    vi.advanceTimersByTime(REPLY_TIMEOUT);
    expect(terminate).toHaveBeenCalledOnce();
  });

  test('a ping from the server starts no wait', () => {
    const terminate = vi.fn();
    const watchdog = createReplyWatchdog(terminate);

    watchdog.ping(true);

    vi.advanceTimersByTime(REPLY_TIMEOUT);
    expect(terminate).not.toHaveBeenCalled();
  });

  test('every ping is answered on its own', () => {
    const terminate = vi.fn();
    const watchdog = createReplyWatchdog(terminate);

    watchdog.ping(false);
    watchdog.pong(true);
    watchdog.ping(false);

    vi.advanceTimersByTime(REPLY_TIMEOUT);
    expect(terminate).toHaveBeenCalledOnce();
  });

  test('a closed connection is not terminated', () => {
    const terminate = vi.fn();
    const watchdog = createReplyWatchdog(terminate);

    watchdog.ping(false);
    watchdog.closed();

    vi.advanceTimersByTime(REPLY_TIMEOUT);
    expect(terminate).not.toHaveBeenCalled();
  });
});

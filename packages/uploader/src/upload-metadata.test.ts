import { describe, expect, test } from 'vitest';
import { UploadAssetRetentionPolicy } from './upload-metadata';

describe('UploadAssetRetentionPolicy', () => {
  test('maps members to their string literals', () => {
    expect(UploadAssetRetentionPolicy.retain).toBe('retain');
    expect(UploadAssetRetentionPolicy.deleteIfNotUsed).toBe('deleteIfNotUsed');
  });

  test('exposes exactly the two known policies', () => {
    expect(Object.values(UploadAssetRetentionPolicy)).toEqual(['retain', 'deleteIfNotUsed']);
  });
});

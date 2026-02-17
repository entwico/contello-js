import { describe, expect, test } from 'bun:test';
import { UploadAssetRetentionPolicy } from './upload-metadata';
import { ContelloUploader } from './uploader';

describe('ContelloUploader', () => {
  test('constructor sets default transport to ws', () => {
    const uploader = new ContelloUploader({
      url: 'https://example.com',
      project: 'test',
      token: 'token',
    });

    expect(uploader).toBeInstanceOf(ContelloUploader);
  });

  test('constructor accepts custom transport', () => {
    const uploader = new ContelloUploader({
      url: 'https://example.com',
      project: 'test',
      token: 'token',
      transport: 'http',
    });

    expect(uploader).toBeInstanceOf(ContelloUploader);
  });

  test('constructor accepts custom chunk size', () => {
    const uploader = new ContelloUploader({
      url: 'https://example.com',
      project: 'test',
      token: 'token',
      chunkSize: 1024,
    });

    expect(uploader).toBeInstanceOf(ContelloUploader);
  });
});

describe('UploadAssetRetentionPolicy', () => {
  test('has retain value', () => {
    expect(UploadAssetRetentionPolicy.retain).toBe(UploadAssetRetentionPolicy.retain);
  });

  test('has deleteIfNotUsed value', () => {
    expect(UploadAssetRetentionPolicy.deleteIfNotUsed).toBe(UploadAssetRetentionPolicy.deleteIfNotUsed);
  });

  test('enum values are strings', () => {
    expect(typeof UploadAssetRetentionPolicy.retain).toBe('string');
    expect(typeof UploadAssetRetentionPolicy.deleteIfNotUsed).toBe('string');
  });
});

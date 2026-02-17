export type UploadAssetMetadata = {
  name?: string | undefined;
  mimeType?: string | undefined;
  size?: number | undefined;
  annotations?: UploadAssetAnnotation[] | undefined;
  collectionRefs?: string[] | undefined;
  image?: UploadAssetImageMetadata | undefined;
  retentionPolicy?: UploadAssetRetentionPolicy | undefined;
  generatePreview?: boolean | undefined;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
};

export type UploadAssetAnnotation = {
  key: string;
  value: string;
};

export type UploadAssetProgress = {
  progress: number;
};

export enum UploadAssetRetentionPolicy {
  retain = 'retain',
  deleteIfNotUsed = 'deleteIfNotUsed',
}

export type UploadAssetImageMetadata = {
  transformations: UploadAssetImageTransformation[];
};

export type UploadAssetImageTransformation =
  | UploadAssetExtractTransformation
  | UploadAssetFitTransformation
  | UploadAssetConvertTransformation;

export type UploadAssetExtractTransformation = {
  name: 'extract';
  options: {
    top: number;
    left: number;
    areaWidth: number;
    areaHeight: number;
    rotate?: 0 | 90 | 180 | 270 | undefined;
  };
};

export type UploadAssetFitTransformation = {
  name: 'fit';
  options: {
    width: number;
    height: number;
  };
};

export type UploadAssetConvertTransformation = {
  name: 'convert';
  options:
    | UploadAssetConvertTransformationJpegOptions
    | UploadAssetConvertTransformationPngOptions
    | UploadAssetConvertTransformationAvifOptions;
};

export type UploadAssetConvertTransformationJpegOptions = {
  format: 'jpeg';
  options: {
    quality: number; // 0-100
    interlace: boolean;
  };
};

export type UploadAssetConvertTransformationPngOptions = {
  format: 'png';
  options: {
    compressionLevel: number; // 0-9
  };
};

export type UploadAssetConvertTransformationAvifOptions = {
  format: 'avif';
  options: {
    quality: number; // 0-100
    lossless: boolean;
  };
};

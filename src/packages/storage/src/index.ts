export type ObjectStoragePutInput = {
  key: string;
  contentType: string;
  body: Uint8Array;
};

export type PresignedUploadInput = {
  fileName: string;
  contentType: string;
};

export type PresignedUpload = {
  provider: "s3-compatible";
  bucket: string;
  key: string;
  method: "PUT";
  url: string;
  headers: Record<string, string>;
  expiresInSeconds: number;
};

export type ObjectStoragePort = {
  put(input: ObjectStoragePutInput): Promise<{ key: string }>;
  getUrl(key: string): Promise<string>;
  createPresignedUpload?(input: PresignedUploadInput): Promise<PresignedUpload>;
};

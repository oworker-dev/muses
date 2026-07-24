export type QueueJob<TPayload = unknown> = {
  name: string;
  payload: TPayload;
};

export type QueuePort = {
  enqueue<TPayload>(job: QueueJob<TPayload>): Promise<void>;
};

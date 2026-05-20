export const customerKeys = {
  me:     ['customers', 'me'] as const,
  detail: (id: string) => ['customers', id] as const,
};

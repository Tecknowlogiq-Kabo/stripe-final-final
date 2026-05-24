import { apiClient, ApiError } from './api-client';

// We mock the global fetch to avoid real network calls.
// Each test resets the mock so prior call history doesn't leak.
type MockResponseInit = { status?: number; body?: unknown; ok?: boolean };

function mockResponse({ status = 200, body = {}, ok }: MockResponseInit = {}): Response {
  const isOk = ok === undefined ? status >= 200 && status < 300 : ok;
  return {
    status,
    ok: isOk,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('apiClient', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe('GET requests', () => {
    it('returns parsed JSON on 2xx response', async () => {
      const payload = { id: 'pi_123', amount: 1000 };
      fetchMock.mockResolvedValueOnce(mockResponse({ status: 200, body: payload }));

      const result = await apiClient.get<typeof payload>('/payment-intents/pi_123');

      expect(result).toEqual(payload);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain('/api/v1/payment-intents/pi_123');
      expect((init as RequestInit).method).toBe('GET');
    });

    it('throws ApiError with status on non-2xx response (e.g. 400)', async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse({ status: 400, body: { message: 'Bad request' } }),
      );

      await expect(apiClient.get('/x')).rejects.toBeInstanceOf(ApiError);

      fetchMock.mockResolvedValueOnce(
        mockResponse({ status: 400, body: { message: 'Bad request' } }),
      );
      try {
        await apiClient.get('/x');
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        expect((e as ApiError).status).toBe(400);
        expect((e as ApiError).message).toBe('Bad request');
      }
    });
  });

  describe('401 → refresh flow', () => {
    it('refreshes and retries with new token on 401', async () => {
      fetchMock
        // 1) initial GET → 401
        .mockResolvedValueOnce(mockResponse({ status: 401, body: {} }))
        // 2) refresh call → 200
        .mockResolvedValueOnce(mockResponse({ status: 200, body: {} }))
        // 3) retry → 200 with data
        .mockResolvedValueOnce(mockResponse({ status: 200, body: { ok: true } }));

      const result = await apiClient.get<{ ok: boolean }>('/me');

      expect(result).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      // The second call must be the refresh endpoint
      expect(fetchMock.mock.calls[1][0]).toContain('/api/v1/auth/refresh');
    });

    it('throws ApiError(401) when refresh fails', async () => {
      fetchMock
        .mockResolvedValueOnce(mockResponse({ status: 401, body: {} }))
        // refresh fails
        .mockResolvedValueOnce(mockResponse({ status: 401, body: {} }));

      await expect(apiClient.get('/me')).rejects.toMatchObject({
        name: 'ApiError',
        status: 401,
        message: 'Session expired',
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('idempotency keys', () => {
    it('attaches Idempotency-Key header on POST', async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse({ status: 200, body: { id: 'pi_x' } }),
      );

      await apiClient.post('/payment-intents', { amount: 100, currency: 'usd' });

      const [, init] = fetchMock.mock.calls[0];
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers['Idempotency-Key']).toBeDefined();
      // UUID v4 shape (8-4-4-4-12 hex)
      expect(headers['Idempotency-Key']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it('does NOT attach Idempotency-Key on GET', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse({ status: 200, body: {} }));

      await apiClient.get('/health');

      const [, init] = fetchMock.mock.calls[0];
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers['Idempotency-Key']).toBeUndefined();
    });
  });
});

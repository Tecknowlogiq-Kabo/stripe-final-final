// Mock the api-client module before importing the action under test.
jest.mock('@/lib/api-client', () => ({
  apiClient: {
    post: jest.fn(),
    get: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(message: string, public status: number) {
      super(message);
      this.name = 'ApiError';
    }
  },
}));

import { createPaymentIntent } from './payment-intents';
import { apiClient } from '@/lib/api-client';

const postMock = apiClient.post as jest.Mock;

describe('createPaymentIntent server action', () => {
  beforeEach(() => {
    postMock.mockReset();
  });

  it('forwards a complete payload to the API and returns the response', async () => {
    const apiResponse = {
      id: 'pi-local-1',
      clientSecret: 'pi_secret_xyz',
      stripePaymentIntentId: 'pi_test_1',
      status: 'requires_confirmation',
    };
    postMock.mockResolvedValueOnce(apiResponse);

    const result = await createPaymentIntent({
      amount: 5000,
      currency: 'usd',
      setupFutureUsage: 'off_session',
      paymentMethodTypes: ['card'],
      metadata: { orderId: 'ord_1' },
      description: 'Test charge',
    });

    expect(result).toEqual(apiResponse);
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock).toHaveBeenCalledWith('/payment-intents', {
      amount: 5000,
      currency: 'usd',
      setupFutureUsage: 'off_session',
      paymentMethodTypes: ['card'],
      metadata: { orderId: 'ord_1' },
      description: 'Test charge',
    });
  });

  it('passes through undefined optional fields (server-side validation owns rejection)', async () => {
    // The action is a thin pass-through; it does not validate. The server is the
    // source of truth. We assert the forwarded body contains the keys exactly so
    // that backend validation will catch malformed input — not the client.
    postMock.mockResolvedValueOnce({
      id: 'x',
      clientSecret: 'cs',
      stripePaymentIntentId: 'pi',
      status: 'succeeded',
    });

    await createPaymentIntent({ amount: 100, currency: 'usd' });

    const [path, body] = postMock.mock.calls[0];
    expect(path).toBe('/payment-intents');
    expect(body).toEqual({
      amount: 100,
      currency: 'usd',
      setupFutureUsage: undefined,
      paymentMethodTypes: undefined,
      metadata: undefined,
      description: undefined,
    });
  });

  it('propagates ApiError from apiClient.post', async () => {
    const err = Object.assign(new Error('Card declined'), {
      name: 'ApiError',
      status: 402,
    });
    postMock.mockRejectedValueOnce(err);

    await expect(
      createPaymentIntent({ amount: 100, currency: 'usd' }),
    ).rejects.toMatchObject({ name: 'ApiError', status: 402 });
  });
});

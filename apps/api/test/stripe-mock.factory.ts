import Stripe from 'stripe';

/**
 * Builds a fully mocked Stripe SDK instance. Every resource method is a Jest
 * mock so tests never hit the real Stripe API.
 */
export function createMockStripe() {
  const mockFn = <T>() => jest.fn() as jest.Mock<T>;

  const webhooks = {
    constructEvent: mockFn<Stripe.Event>(),
    generateTestHeaderString: mockFn<string>(),
  };

  const customers = {
    create: mockFn<Stripe.Customer>(),
    retrieve: mockFn<Stripe.Customer | Stripe.DeletedCustomer>(),
    update: mockFn<Stripe.Customer>(),
    del: mockFn<Stripe.DeletedCustomer>(),
    list: mockFn<Stripe.ApiList<Stripe.Customer>>(),
    search: mockFn<Stripe.ApiSearchResult<Stripe.Customer>>(),
  };

  const paymentIntents = {
    create: mockFn<Stripe.PaymentIntent>(),
    retrieve: mockFn<Stripe.PaymentIntent>(),
    update: mockFn<Stripe.PaymentIntent>(),
    confirm: mockFn<Stripe.PaymentIntent>(),
    cancel: mockFn<Stripe.PaymentIntent>(),
    list: mockFn<Stripe.ApiList<Stripe.PaymentIntent>>(),
    search: mockFn<Stripe.ApiSearchResult<Stripe.PaymentIntent>>(),
  };

  const setupIntents = {
    create: mockFn<Stripe.SetupIntent>(),
    retrieve: mockFn<Stripe.SetupIntent>(),
    update: mockFn<Stripe.SetupIntent>(),
    confirm: mockFn<Stripe.SetupIntent>(),
    cancel: mockFn<Stripe.SetupIntent>(),
    list: mockFn<Stripe.ApiList<Stripe.SetupIntent>>(),
  };

  const paymentMethods = {
    create: mockFn<Stripe.PaymentMethod>(),
    retrieve: mockFn<Stripe.PaymentMethod>(),
    update: mockFn<Stripe.PaymentMethod>(),
    attach: mockFn<Stripe.PaymentMethod>(),
    detach: mockFn<Stripe.PaymentMethod>(),
    list: mockFn<Stripe.ApiList<Stripe.PaymentMethod>>(),
  };

  const subscriptions = {
    create: mockFn<Stripe.Subscription>(),
    retrieve: mockFn<Stripe.Subscription>(),
    update: mockFn<Stripe.Subscription>(),
    cancel: mockFn<Stripe.Subscription>(),
    del: mockFn<Stripe.Subscription>(),
    list: mockFn<Stripe.ApiList<Stripe.Subscription>>(),
    search: mockFn<Stripe.ApiSearchResult<Stripe.Subscription>>(),
  };

  const invoices = {
    create: mockFn<Stripe.Invoice>(),
    retrieve: mockFn<Stripe.Invoice>(),
    update: mockFn<Stripe.Invoice>(),
    pay: mockFn<Stripe.Invoice>(),
    list: mockFn<Stripe.ApiList<Stripe.Invoice>>(),
    search: mockFn<Stripe.ApiSearchResult<Stripe.Invoice>>(),
  };

  const prices = {
    create: mockFn<Stripe.Price>(),
    retrieve: mockFn<Stripe.Price>(),
    update: mockFn<Stripe.Price>(),
    list: mockFn<Stripe.ApiList<Stripe.Price>>(),
    search: mockFn<Stripe.ApiSearchResult<Stripe.Price>>(),
  };

  const products = {
    create: mockFn<Stripe.Product>(),
    retrieve: mockFn<Stripe.Product>(),
    update: mockFn<Stripe.Product>(),
    list: mockFn<Stripe.ApiList<Stripe.Product>>(),
    del: mockFn<Stripe.DeletedProduct>(),
    search: mockFn<Stripe.ApiSearchResult<Stripe.Product>>(),
  };

  const confirmationTokens = {
    create: mockFn<Stripe.ConfirmationToken>(),
  };

  const customerSessions = {
    create: mockFn<Stripe.CustomerSession>(),
  };

  return {
    webhooks,
    customers,
    paymentIntents,
    setupIntents,
    paymentMethods,
    subscriptions,
    invoices,
    prices,
    products,
    confirmationTokens,
    customerSessions,
  } as unknown as jest.Mocked<Stripe>;
}

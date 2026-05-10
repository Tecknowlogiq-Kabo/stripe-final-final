/**
 * Stripe test card numbers, PaymentMethod IDs, and tokens.
 * Sourced from https://docs.stripe.com/testing
 *
 * Use PaymentMethod IDs (pm_*) for server-side test code to maintain PCI
 * compliance readiness. Card numbers are for frontend/E2E tests.
 */

export const TEST_CARDS = {
  visa: '4242424242424242',
  visaDebit: '4000056655665556',
  mastercard: '5555555555554444',
  mastercard2Series: '2223003122003222',
  mastercardDebit: '5200828282828210',
  mastercardPrepaid: '5105105105105100',
  amex: '378282246310005',
  discover: '6011111111111117',
  diners: '3056930009020004',
  jcb: '3566002020360505',
  unionpay: '6200000000000005',

  /** Cards that trigger specific payment outcomes */
  declineChargeLost: '4000000000000002',
  declineFraudulent: '4100000000000019',
  declineInsufficientFunds: '4000000000009995',
  declineExpired: '4000000000000069',
  declineIncorrectCvc: '4000000000000127',
  declineProcessingError: '4000000000000119',

  /** 3D Secure / authentication */
  threeDSecureRequired: '4000002500003155',
  threeDSecure2Required: '4000002760003184',

  /** By country (subset of commonly used) */
  gb: '4000008260000000',
  gbDebit: '4000058260000005',
  gbMastercard: '5555558265554449',
  au: '4000000360000006',
  ca: '4000001240000000',
  de: '4000002760000016',
  fr: '4000002500000003',
  jp: '4000003920000003',
} as const;

export const TEST_PAYMENT_METHODS = {
  visa: 'pm_card_visa',
  visaDebit: 'pm_card_visa_debit',
  mastercard: 'pm_card_mastercard',
  mastercardDebit: 'pm_card_mastercard_debit',
  mastercardPrepaid: 'pm_card_mastercard_prepaid',
  amex: 'pm_card_amex',
  discover: 'pm_card_discover',
  diners: 'pm_card_diners',
  jcb: 'pm_card_jcb',
  unionpay: 'pm_card_unionpay',

  /** By country */
  us: 'pm_card_us',
  gb: 'pm_card_gb',
  gbDebit: 'pm_card_gb_debit',
  gbMastercard: 'pm_card_gb_mastercard',
  au: 'pm_card_au',
  ca: 'pm_card_ca',
  de: 'pm_card_de',
  fr: 'pm_card_fr',
  jp: 'pm_card_jp',

  /** Co-branded */
  visaCartesBancaires: 'pm_card_visa_cartesBancaires',
  mastercardCartesBancaires: 'pm_card_mastercard_cartesBancaires',
} as const;

export const TEST_TOKENS = {
  visa: 'tok_visa',
  visaDebit: 'tok_visa_debit',
  mastercard: 'tok_mastercard',
  mastercardDebit: 'tok_mastercard_debit',
  mastercardPrepaid: 'tok_mastercard_prepaid',
  amex: 'tok_amex',
  discover: 'tok_discover',
  diners: 'tok_diners',
  jcb: 'tok_jcb',
  unionpay: 'tok_unionpay',
} as const;

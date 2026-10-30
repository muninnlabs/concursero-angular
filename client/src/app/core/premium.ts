/** The Premium plan as sold (Stripe price: scripts/stripe-setup.mjs). */
export const PREMIUM = {
  /** R$ per month, as shown (Stripe: PRICE_CENTS in scripts/stripe-setup.mjs). */
  price: '49,99',
  /** Days of Premium every new account starts with (server: TRIAL_DAYS in users/store.ts). */
  trialDays: 7,
  perks: ['Comentários das questões da OAB', 'Experiência sem anúncios', 'Estatísticas avançadas'],
};

/** Where every "Assinar Premium" button leads. */
export const PREMIUM_LINK = { path: '/app/configuracoes', fragment: 'premium' };

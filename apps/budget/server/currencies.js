'use strict';
// Supported currencies with approximate default rates (units per 1 EUR).
// Rates can be refreshed live by an admin from the Admin → Exchange rates panel.
const CURRENCIES = [
  { code: 'EUR', name: 'Euro', rate: 1 },
  { code: 'USD', name: 'US Dollar', rate: 1.08 },
  { code: 'GBP', name: 'British Pound', rate: 0.84 },
  { code: 'RON', name: 'Romanian Leu', rate: 4.97 },
  { code: 'MDL', name: 'Moldovan Leu', rate: 19.4 },
  { code: 'CHF', name: 'Swiss Franc', rate: 0.94 },
  { code: 'PLN', name: 'Polish Złoty', rate: 4.28 },
  { code: 'CZK', name: 'Czech Koruna', rate: 25.2 },
  { code: 'HUF', name: 'Hungarian Forint', rate: 400 },
  { code: 'BGN', name: 'Bulgarian Lev', rate: 1.956 },
  { code: 'SEK', name: 'Swedish Krona', rate: 11.3 },
  { code: 'NOK', name: 'Norwegian Krone', rate: 11.6 },
  { code: 'DKK', name: 'Danish Krone', rate: 7.46 },
  { code: 'UAH', name: 'Ukrainian Hryvnia', rate: 44.5 },
  { code: 'TRY', name: 'Turkish Lira', rate: 37.5 },
  { code: 'JPY', name: 'Japanese Yen', rate: 162 },
  { code: 'CNY', name: 'Chinese Yuan', rate: 7.8 },
  { code: 'INR', name: 'Indian Rupee', rate: 91 },
  { code: 'CAD', name: 'Canadian Dollar', rate: 1.5 },
  { code: 'AUD', name: 'Australian Dollar', rate: 1.65 },
  { code: 'NZD', name: 'New Zealand Dollar', rate: 1.8 },
  { code: 'BRL', name: 'Brazilian Real', rate: 6.2 },
  { code: 'MXN', name: 'Mexican Peso', rate: 20.5 },
  { code: 'ZAR', name: 'South African Rand', rate: 19.8 },
  { code: 'AED', name: 'UAE Dirham', rate: 3.97 },
  { code: 'SGD', name: 'Singapore Dollar', rate: 1.45 },
  { code: 'HKD', name: 'Hong Kong Dollar', rate: 8.45 },
  { code: 'KRW', name: 'South Korean Won', rate: 1480 },
  { code: 'ILS', name: 'Israeli Shekel', rate: 3.95 },
  { code: 'GEL', name: 'Georgian Lari', rate: 2.95 },
];

const CURRENCY_CODES = new Set(CURRENCIES.map((c) => c.code));

const DEFAULT_CATEGORIES = [
  { name: 'Groceries', icon: 'shopping-cart', color: '#2a78d6', kind: 'expense', budget: 400 },
  { name: 'Dining out', icon: 'utensils', color: '#eb6834', kind: 'expense', budget: 150 },
  { name: 'Transport', icon: 'car', color: '#1baf7a', kind: 'expense', budget: 120 },
  { name: 'Housing', icon: 'home', color: '#eda100', kind: 'expense', budget: 900 },
  { name: 'Utilities', icon: 'zap', color: '#e87ba4', kind: 'expense', budget: 150 },
  { name: 'Health', icon: 'heart-pulse', color: '#008300', kind: 'expense', budget: 60 },
  { name: 'Entertainment', icon: 'film', color: '#6250d6', kind: 'expense', budget: 80 },
  { name: 'Shopping', icon: 'shopping-bag', color: '#e34948', kind: 'expense', budget: 150 },
  { name: 'Travel', icon: 'plane', color: '#0e8a9c', kind: 'expense', budget: 0 },
  { name: 'Subscriptions', icon: 'repeat', color: '#8a6d3b', kind: 'expense', budget: 40 },
  { name: 'Other', icon: 'circle-ellipsis', color: '#6b7280', kind: 'expense', budget: 0 },
  { name: 'Salary', icon: 'briefcase', color: '#1baf7a', kind: 'income', budget: 0 },
  { name: 'Freelance', icon: 'laptop', color: '#2a78d6', kind: 'income', budget: 0 },
  { name: 'Other income', icon: 'piggy-bank', color: '#eda100', kind: 'income', budget: 0 },
];

module.exports = { CURRENCIES, CURRENCY_CODES, DEFAULT_CATEGORIES };

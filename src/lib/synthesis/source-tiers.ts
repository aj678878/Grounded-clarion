import type { BiasLean, SourceTier } from './schema';

export const SOURCES = {
  tier1: [
    'reuters.com',
    'apnews.com',
    'bbc.com',
    'bbc.co.uk',
    'afp.com',
    'theguardian.com',
  ],
  tier2_open: [
    'aljazeera.com',
    'dw.com',
    'cnn.com',
    'thehill.com',
    'politico.com',
    'npr.org',
  ],
  tier2_paywall: [
    'nytimes.com',
    'washingtonpost.com',
    'wsj.com',
    'ft.com',
    'economist.com',
  ],
  tier3_regional: {
    asia: ['scmp.com', 'thehindu.com', 'timesofindia.indiatimes.com', 'japantimes.co.jp'],
    europe: ['elpais.com', 'lemonde.fr', 'spiegel.de'],
    north_america: ['cbc.ca', 'globeandmail.com'],
    south_america: ['mercopress.com'],
    middle_east: ['haaretz.com', 'arabnews.com'],
    africa: ['mg.co.za', 'theafricareport.com'],
  },
  business: ['bloomberg.com', 'cnbc.com', 'reuters.com'],
  excluded: [
    'dailymail.co.uk',
    'nypost.com',
    'mirror.co.uk',
    'breitbart.com',
    'oann.com',
    'foxnews.com',
    'msnbc.com',
    'thesun.co.uk',
  ],
  bias_lean: {
    'reuters.com': 'center',
    'apnews.com': 'center',
    'afp.com': 'center',
    'bbc.com': 'center-left',
    'bbc.co.uk': 'center-left',
    'theguardian.com': 'left',
    'nytimes.com': 'lean-left',
    'washingtonpost.com': 'lean-left',
    'wsj.com': 'lean-right',
    'ft.com': 'center',
    'economist.com': 'center',
    'aljazeera.com': 'center-left',
    'dw.com': 'center',
    'cnn.com': 'lean-left',
    'thehill.com': 'center',
    'politico.com': 'center',
    'npr.org': 'lean-left',
    'bloomberg.com': 'center',
    'cnbc.com': 'center',
  } as Record<string, BiasLean>,
} as const;

export const REGION_KEYS = Object.keys(SOURCES.tier3_regional) as Array<keyof typeof SOURCES.tier3_regional>;

const DOMAIN_FAMILIES: Record<string, string> = {
  'bbc.com': 'bbc',
  'bbc.co.uk': 'bbc',
  'aljazeera.com': 'aljazeera',
  'arabnews.com': 'arabnews',
  'apnews.com': 'apnews',
  'reuters.com': 'reuters',
  'cnn.com': 'cnn',
  'npr.org': 'npr',
  'politico.com': 'politico',
  'thehill.com': 'thehill',
  'dw.com': 'dw',
  'nytimes.com': 'nytimes',
  'washingtonpost.com': 'washingtonpost',
  'ft.com': 'ft',
  'wsj.com': 'wsj',
  'economist.com': 'economist',
  'mercopress.com': 'mercopress',
  'mg.co.za': 'mailandguardian',
  'theafricareport.com': 'theafricareport',
  'haaretz.com': 'haaretz',
};

export function normalizeDomain(domain: string): string {
  return domain.replace(/^https?:\/\//, '').replace(/^www\./, '').toLowerCase().trim();
}

export function isExcludedDomain(domain: string): boolean {
  const normalized = normalizeDomain(domain);
  return SOURCES.excluded.some((d) => normalized === d || normalized.endsWith(`.${d}`));
}

export function inferSourceTier(domain: string, regionalFocus?: string | null): SourceTier {
  const normalized = normalizeDomain(domain);
  if (SOURCES.tier1.includes(normalized as (typeof SOURCES.tier1)[number])) return 'tier1';
  if (SOURCES.tier2_open.includes(normalized as (typeof SOURCES.tier2_open)[number])) return 'tier2_open';
  if (SOURCES.tier2_paywall.includes(normalized as (typeof SOURCES.tier2_paywall)[number])) return 'tier2_paywall';
  if (
    regionalFocus &&
    REGION_KEYS.includes(regionalFocus as keyof typeof SOURCES.tier3_regional) &&
    SOURCES.tier3_regional[regionalFocus as keyof typeof SOURCES.tier3_regional].includes(
      normalized as never
    )
  ) {
    return 'tier3_regional';
  }
  for (const region of REGION_KEYS) {
    if (SOURCES.tier3_regional[region].includes(normalized as never)) {
      return 'tier3_regional';
    }
  }
  return 'unranked';
}

export function tierScore(tier: SourceTier): number {
  switch (tier) {
    case 'tier1':
      return 3;
    case 'tier2_open':
      return 2;
    case 'tier2_paywall':
      return 1;
    default:
      return 0;
  }
}

export function getBiasLean(domain: string): BiasLean {
  const normalized = normalizeDomain(domain);
  return SOURCES.bias_lean[normalized] ?? 'unknown';
}

export function getDomainFamily(domain: string): string {
  const normalized = normalizeDomain(domain);
  return DOMAIN_FAMILIES[normalized] ?? normalized;
}

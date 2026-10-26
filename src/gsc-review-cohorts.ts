/**
 * User-supplied GSC Links snapshot, 2026-10-26.
 * These are sampled inbound internal-link counts, NOT verified live-crawl counts.
 * Review candidates only: do not infer indexation, ranking loss or an SEO defect.
 * No writes to the live site and no automatic edits.
 */
export type ReviewGroup = 'product-links' | 'city-content';
export type ReviewStatus = 'İncelenmeli' | 'Koru' | 'Düzeltme öner' | 'Veri bekle';
export interface ReviewCandidate {
  readonly path: string;
  readonly name: string;
  readonly group: ReviewGroup;
  readonly gscInternalLinks: number;
}
const productRows: readonly [string, string, number][] = [
  ['/perakende-satis-fisi','Perakende Satış Fişi',8],
  ['/kitap-ayraci','Kitap Ayracı',19],
  ['/yag-karti','Yağ Kartı',19],
  ['/oto-paspas','Oto Paspas',22],
  ['/ambalaj','Ambalaj',33],
  ['/sigorta-policeleri','Sigorta Poliçeleri',33],
  ['/giris-bileti','Giriş Bileti',34],
  ['/recete','Reçete',35],
];
const cityRows: readonly [string,string][] = [
  ['aksaray','Aksaray'],['ardahan','Ardahan'],['bartin','Bartın'],
  ['bayburt','Bayburt'],['duzce','Düzce'],['igdir','Iğdır'],
  ['karabuk','Karabük'],['karaman','Karaman'],['kirikkale','Kırıkkale'],
  ['mus','Muş'],['sinop','Sinop'],['tekirdag','Tekirdağ'],
  ['tokat','Tokat'],['tunceli','Tunceli'],['van','Van'],
  ['yalova','Yalova'],['yozgat','Yozgat'],['zonguldak','Zonguldak'],
];
export const GSC_REVIEW_SOURCE = Object.freeze({
  observationDate: '2026-10-26',
  source: 'user-provided Search Console Links report',
  limitation: 'Search Console link report samples; numbers are not an exhaustive crawl or proof of problems',
});
export const GSC_REVIEW_CANDIDATES: readonly ReviewCandidate[] = Object.freeze([
  ...productRows.map(([path,name,gscInternalLinks]) => Object.freeze({path,name,group:'product-links' as const,gscInternalLinks})),
  ...cityRows.map(([slug,name]) => Object.freeze({path:`/${slug}-matbaa`,name:`${name} Matbaa`,group:'city-content' as const,gscInternalLinks:1})),
]);
export interface ReviewEvidence {
  /** Independent crawl has confirmed page exists and the actual inbound link graph. */
  crawlVerified: boolean;
  /** Relevant, complete, comparable GSC periods. */
  performanceVerified: boolean;
  /** Relevant problems independently supported by evidence; low link count alone is not a problem. */
  technicalOrIntentProblemConfirmed: boolean;
  /** Page performs acceptably; protect valuable traffic and queries. */
  performingWell: boolean;
  /** For city pages: reviewed for distinctive useful content and truthful service geography. */
  cityContentReviewed?: boolean;
}
export function classifyReview(candidate: ReviewCandidate, evidence?: ReviewEvidence): ReviewStatus {
  if (!evidence || !evidence.crawlVerified || !evidence.performanceVerified) return 'Veri bekle';
  if (candidate.group === 'city-content' && !evidence.cityContentReviewed) return 'İncelenmeli';
  if (evidence.performingWell && !evidence.technicalOrIntentProblemConfirmed) return 'Koru';
  if (evidence.technicalOrIntentProblemConfirmed) return 'Düzeltme öner';
  return 'İncelenmeli';
}
export function reviewChecks(candidate: ReviewCandidate): readonly string[] {
  const common = ['HTTP/canonical/indexability', 'Crawl-derived inbound source URLs and anchor text', 'GSC comparable finalized periods and protected queries'];
  return candidate.group === 'city-content'
    ? [...common,'Substantive city-specific value, duplication and accurate service coverage']
    : [...common,'Relevant category and contextual linking opportunities'];
}

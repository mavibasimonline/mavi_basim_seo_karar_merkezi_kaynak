import {describe,it,expect} from 'vitest';
import {GSC_REVIEW_CANDIDATES,GSC_REVIEW_SOURCE,classifyReview,reviewChecks} from '../src/gsc-review-cohorts';
describe('2026-10-26 GSC review cohorts',()=>{
  it('stores eight products and eighteen cities without duplicate paths',()=>{
    expect(GSC_REVIEW_CANDIDATES).toHaveLength(26);
    expect(GSC_REVIEW_CANDIDATES.filter(p=>p.group==='product-links')).toHaveLength(8);
    expect(GSC_REVIEW_CANDIDATES.filter(p=>p.group==='city-content')).toHaveLength(18);
    expect(new Set(GSC_REVIEW_CANDIDATES.map(p=>p.path)).size).toBe(26);
    expect(GSC_REVIEW_CANDIDATES.find(p=>p.path==='/perakende-satis-fisi')?.gscInternalLinks).toBe(8);
    expect(GSC_REVIEW_CANDIDATES.filter(p=>p.group==='city-content').every(p=>p.gscInternalLinks===1)).toBe(true);
    expect(GSC_REVIEW_SOURCE.limitation).toMatch(/not an exhaustive/);
  });
  it('does not turn sparse sampled links into confirmed SEO fixes',()=>{
    const product=GSC_REVIEW_CANDIDATES[0];
    expect(classifyReview(product)).toBe('Veri bekle');
    expect(classifyReview(product,{crawlVerified:true,performanceVerified:false,technicalOrIntentProblemConfirmed:true,performingWell:false})).toBe('Veri bekle');
    expect(classifyReview(product,{crawlVerified:true,performanceVerified:true,technicalOrIntentProblemConfirmed:false,performingWell:true})).toBe('Koru');
    expect(classifyReview(product,{crawlVerified:true,performanceVerified:true,technicalOrIntentProblemConfirmed:true,performingWell:false})).toBe('Düzeltme öner');
  });
  it('requires city quality review and does not invent geographic claims',()=>{
    const city=GSC_REVIEW_CANDIDATES.find(p=>p.path==='/ardahan-matbaa')!;
    expect(classifyReview(city,{crawlVerified:true,performanceVerified:true,technicalOrIntentProblemConfirmed:false,performingWell:true})).toBe('İncelenmeli');
    expect(reviewChecks(city).join(' ')).toContain('accurate service coverage');
  });
});

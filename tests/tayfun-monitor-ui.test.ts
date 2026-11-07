import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
const monitor=readFileSync('public/seo/tayfun-monitor.js','utf8');
const html=readFileSync('public/index.html','utf8');
const tayfun=readFileSync('public/seo/tayfun.js','utf8');
const css=readFileSync('public/seo/tayfun.css','utf8');
describe('Tayfun SEO Takibi compact category filter and sortable columns',()=>{
 it('removes duplicate large headings and comparison paragraph without removing the report tabs',()=>{
  expect(html).not.toContain('<h2>Tayfun · Aylık SEO Sürüm Defteri</h2>');
  expect(tayfun).not.toContain("el('h2','Tayfun · Aylık SEO Sürüm Defteri')");
  expect(monitor).not.toContain("SEO Takibi · Ürün, Kelime ve Tarihli SEO Arşivi");
  expect(monitor).not.toContain('Karşılaştırma: ');
 });
 it('provides user-selected category and instant search, not decoration',()=>{
  for(const name of ['Tüm Kategoriler','Broşürler ve El İlanları','Reklam Ürünleri','Kurumsal Ürünler','Makbuz ve Formlar'])
   expect(monitor).toContain("'"+name+"'");
  expect(monitor).toContain("search.addEventListener('input',applyFilters)");
  expect(monitor).toContain("btn.addEventListener('click'");
  expect(monitor).toContain('article.hidden=!(matchCategory&&matchQuery)');
  expect(css).toContain('.tayfun-monitor-products .tayfun-monitor-product[hidden]');
 });
 it('aligns and sorts all ten keyword columns by clicking header buttons',()=>{
  for(const key of ['query','previous_clicks','previous_impressions','previous_ctr','previous_position',
   'current_clicks','current_impressions','current_ctr','current_position','decision'])
   expect(monitor).toContain("'"+key+"'");
  expect(monitor).toContain("button.addEventListener('click'");
  expect(monitor).toContain('sortDirection*=-1');
  expect(monitor).toContain('table.replaceChildren(headers,');
  expect(css).toContain('.tayfun-monitor-sort:focus-visible');
 });
 it('also sorts 3, 6 and 12 month trends without changing SEO data',()=>{
  expect(monitor).toContain('function sortSeries()');
  expect(monitor).toContain('grid.replaceChildren(header,');
  expect(monitor).toContain("range.append(new Option('Son '+x+' ay'");
  expect(monitor).not.toContain('/api/independent/tayfun-ai\x27,{method:\x27POST\x27');
 });
});

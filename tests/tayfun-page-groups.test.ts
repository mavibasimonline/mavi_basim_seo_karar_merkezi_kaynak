import {describe,it,expect} from 'vitest';
import {pageGroupFor,groupOrder,PRODUCT_GROUPS} from '../public/seo/tayfun-page-groups.js';

describe('Tayfun Ürün Grupları site sayfası sınıflandırması',()=>{
 it('ürün kategorilerinin önceliğini korur',()=>{
  expect(PRODUCT_GROUPS).toEqual(['Broşürler ve El İlanları','Reklam Ürünleri','Kurumsal Ürünler','Makbuz ve Formlar']);
  expect(groupOrder(['Sektörel Sayfalar','Kurumsal Ürünler','Blog Sayfaları','Şehir Sayfaları']))
   .toEqual(['Kurumsal Ürünler','Şehir Sayfaları','Blog Sayfaları','Sektörel Sayfalar']);
 });
 it('blog, şehir, sektör ve bilgi sayfalarını doğru ayırır',()=>{
  expect(pageGroupFor('https://mavibasim.com/ankara-matbaa')).toBe('Şehir Sayfaları');
  expect(pageGroupFor('https://mavibasim.com/şanlıurfa-matbaa')).toBe('Şehir Sayfaları');
  expect(pageGroupFor('https://mavibasim.com/van-baski')).toBe('Şehir Sayfaları');
  expect(pageGroupFor('https://mavibasim.com/sektor/kuafor-kartvizit-baski')).toBe('Sektörel Sayfalar');
  expect(pageGroupFor('https://mavibasim.com/blog/magnet-secimi')).toBe('Blog Sayfaları');
  expect(pageGroupFor('https://mavibasim.com/iletisim')).toBe('Kurumsal ve Bilgi Sayfaları');
  expect(pageGroupFor('https://mavibasim.com/matbaa')).toBe('Matbaa ve Hizmet Sayfaları');
  expect(pageGroupFor('https://mavibasim.com/')).toBe('Ana Sayfa');
 });
 it('ürünü şehir sanmaz ve sahte site URL kabul etmez',()=>{
  expect(pageGroupFor('https://mavibasim.com/brosur-baski')).toBe('Diğer Sayfalar');
  expect(pageGroupFor('https://fake-mavibasim.com/ankara-matbaa')).toBe('Diğer Sayfalar');
  expect(pageGroupFor('https://mavibasim.com/bilinmeyen-sayfa')).toBe('Diğer Sayfalar');
 });
});

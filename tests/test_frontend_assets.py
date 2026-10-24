"""Performance/security budgets for shipped static assets, never customer metrics."""
import gzip
from html.parser import HTMLParser
import re
import unittest
from pathlib import Path
PUBLIC=Path(__file__).resolve().parents[1]/'public'
class FrontendAssetsTests(unittest.TestCase):
 def test_gzipped_code_and_self_hosted_fonts_fit_a_small_transfer_budget(self):
  scripts=sum(len(gzip.compress(p.read_bytes())) for p in PUBLIC.glob('*.js'))
  css=len(gzip.compress((PUBLIC/'app.css').read_bytes()))
  fonts=sum(p.stat().st_size for p in (PUBLIC/'fonts').glob('*.woff2'))
  self.assertLess(scripts,32*1024);self.assertLess(css,12*1024);self.assertLess(fonts,50*1024)
  self.assertLess(scripts+css+fonts,100*1024)
 def test_every_shipped_module_and_asset_reference_resolves_locally(self):
  for path in [*PUBLIC.glob('*.js'),PUBLIC/'app.css',PUBLIC/'index.html']:
   text=path.read_text()
   for ref in re.findall(r'from\s+[\"\'](.*?)[\"\']',text):
    self.assertTrue(ref.startswith('./'));self.assertTrue((PUBLIC/ref[2:]).is_file(),ref)
   for ref in re.findall(r'(?:src|href)=[\"\'](/[^\"\'#?]+)',text):
    if not ref.startswith('/api/'):self.assertTrue((PUBLIC/ref[1:]).is_file(),ref)
  self.assertNotIn('<script>',(PUBLIC/'index.html').read_text())
  class Forms(HTMLParser):
   def __init__(self):super().__init__();self.forms={}
   def handle_starttag(self,tag,attrs):
    if tag=='form':
     a=dict(attrs);self.forms[a.get('id')]=a.get('method','get')
  parser=Forms();parser.feed((PUBLIC/'index.html').read_text());self.assertEqual(parser.forms['login'],'post');self.assertEqual(parser.forms['question'],'post')
 def test_fonts_have_a_real_woff2_signature_and_open_font_license(self):
  for path in (PUBLIC/'fonts').glob('*.woff2'):self.assertEqual(path.read_bytes()[:4],b'wOF2')
  self.assertIn('SIL OPEN FONT LICENSE',(PUBLIC/'fonts/OFL.txt').read_text())

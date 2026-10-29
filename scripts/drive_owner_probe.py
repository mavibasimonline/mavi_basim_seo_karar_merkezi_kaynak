import json,urllib.request,urllib.error
APP='https://mavi-basim-seo-prod.mavibasimonline.workers.dev'
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None
opener=urllib.request.build_opener(NoRedirect())
for method,path,headers,data in [
 ('GET','/api/drive/status',{},None),
 ('POST','/api/oauth/google/start?purpose=drive',{},None),
 ('GET','/api/drive/status',{'User-Agent':'MaviBasimReleaseCheck/1.0','Accept':'application/json'},None),
 ('POST','/api/oauth/google/start?purpose=drive',{'User-Agent':'MaviBasimReleaseCheck/1.0','Accept':'application/json','Origin':APP,'Content-Type':'application/json'},b'{}')]:
 request=urllib.request.Request(APP+path,method=method,headers=headers,data=data)
 try:r=opener.open(request,timeout=15)
 except urllib.error.HTTPError as error:r=error
 with r:
  raw=r.read(20000)
  try:body=json.loads(raw)
  except ValueError:body={}
  print(json.dumps({'method':method,'path':path,'custom_headers':bool(headers),'status':r.status,'content_type':r.headers.get('Content-Type'),'location_path':urllib.parse.urlparse(r.headers.get('Location','')).path,'owner_login_message':body.get('error')=='Giriş yapmanız gerekiyor.','body_kind':'json' if body else 'other','cloudflare_error_marker':b'cloudflare' in raw.lower()}),flush=True)

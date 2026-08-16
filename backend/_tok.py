import urllib.request, json
req = urllib.request.Request(
    'http://127.0.0.1:8010/api/auth/login',
    data=json.dumps({'username':'admin','password':'yfzjlxy0527'}).encode(),
    headers={'Content-Type':'application/json'})
tok = json.loads(urllib.request.urlopen(req).read())['token']
print(tok)

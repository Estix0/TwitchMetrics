import requests

CLIENT_ID = ''
CLIENT_SECRET = ''
AUTH_CODE = '' 

url = 'https://id.twitch.tv/oauth2/token'
data = {
    'client_id': CLIENT_ID,
    'client_secret': CLIENT_SECRET,
    'code': AUTH_CODE,
    'grant_type': 'authorization_code',
    'redirect_uri': 'http://localhost:3000'
}

response = requests.post(url, data=data)

if response.status_code == 200:
    tokens = response.json()
    print(f"Access Token: {tokens.get('access_token')}")
    print(f"Refresh Token: {tokens.get('refresh_token')}")
else:
    print(f"Error: {response.json()}")

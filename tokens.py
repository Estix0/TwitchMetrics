import os
import requests

try:
    from dotenv import load_dotenv
    if os.path.exists(".env.channel1"):
        load_dotenv(".env.channel1")
    else:
        load_dotenv()
except ImportError:
    pass

CLIENT_ID = os.getenv("CLIENT_ID", "mjnewa4guu5qnams4uk1eqss23wnje")
CLIENT_SECRET = os.getenv("CLIENT_SECRET", "d6roq9kknzq036z8n6tfs6dwuoc0zk")
REFRESH_TOKEN = os.getenv("REFRESH_TOKEN", "")
REDIRECT_URI = "http://localhost:3000"

def exchange_code(code: str):
    url = 'https://id.twitch.tv/oauth2/token'
    data = {
        'client_id': CLIENT_ID,
        'client_secret': CLIENT_SECRET,
        'code': code.strip(),
        'grant_type': 'authorization_code',
        'redirect_uri': REDIRECT_URI
    }

    try:
        response = requests.post(url, data=data, timeout=10)
        if response.status_code == 200:
            tokens = response.json()
            access_token = tokens.get('access_token')
            new_refresh = tokens.get('refresh_token')
            print("\n" + "=" * 60)
            print("🎉 SUKCES! Wygenerowano nowe tokeny Twitch:")
            print("=" * 60)
            print(f'CHAT_TOKEN="{access_token}"')
            print(f'REFRESH_TOKEN="{new_refresh}"')
            print("=" * 60)
            print("Wklej powyższe wartości do swojego pliku .env.channel1!\n")
            return True
        else:
            print(f"\n❌ Błąd wymiany kodu {response.status_code}: {response.text}")
            return False
    except Exception as e:
        print(f"Błąd połączenia: {e}")
        return False

def refresh():
    if REFRESH_TOKEN:
        print("🔄 Próbuję odświeżyć istniejący REFRESH_TOKEN...")
        url = 'https://id.twitch.tv/oauth2/token'
        data = {
            'client_id': CLIENT_ID,
            'client_secret': CLIENT_SECRET,
            'grant_type': 'refresh_token',
            'refresh_token': REFRESH_TOKEN
        }

        try:
            response = requests.post(url, data=data, timeout=10)
            if response.status_code == 200:
                tokens = response.json()
                access_token = tokens.get('access_token')
                new_refresh = tokens.get('refresh_token')
                print("=" * 60)
                print("✅ Pomyślnie odświeżono tokeny Twitch!")
                print(f'CHAT_TOKEN="{access_token}"')
                print(f'REFRESH_TOKEN="{new_refresh}"')
                print("=" * 60)
                print("Wklej powyższe wartości do swojego pliku .env.channel1")
                return
            else:
                print(f"⚠️ Refresh token wygasł lub jest nieprawidłowy ({response.status_code}).")
        except Exception as e:
            print(f"Błąd połączenia: {e}")

    # Jeśli brak tokenu lub wygasł, przejdź do generowania nowego
    print("\n" + "=" * 60)
    print("🔑 GENEROWANIE NOWEGO REFRESH_TOKENU (OAuth Code Flow)")
    print("=" * 60)
    
    auth_url = (
        f"https://id.twitch.tv/oauth2/authorize"
        f"?client_id={CLIENT_ID}"
        f"&redirect_uri={REDIRECT_URI}"
        f"&response_type=code"
        f"&scope=chat:read+chat:edit"
    )

    print("\n1. Otwórz poniższy link w przeglądarce i kliknij 'Autoryzuj':\n")
    print(auth_url)
    print("\n2. Po kliknięciu przeglądarka przekieruje Cię na adres:")
    print("   http://localhost:3000/?code=TUTAJ_TWÓJ_KOD&scope=...")
    print("   (Strona może pokazać błąd 'Nie można połączyć', to normalne!)")
    print("\n3. Skopiuj sam kod z paska adresu (wartość po 'code=' i przed '&'):\n")

    try:
        user_code = input("Wklej skopiowany kod (lub cały adres URL): ").strip()
        if not user_code:
            print("Anulowano.")
            return

        if "code=" in user_code:
            user_code = user_code.split("code=")[1].split("&")[0]

        exchange_code(user_code)
    except KeyboardInterrupt:
        print("\nPrzerwano.")

if __name__ == "__main__":
    refresh()

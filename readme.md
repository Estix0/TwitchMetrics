# TwitchMetrics 🚀

TwitchMetrics to zoptymalizowany, zautomatyzowany tracker aktywności czatu i streamów na Twitchu, stworzony dla moderatorów i streamerów. Projekt zbiera statystyki na żywo, analizuje zaangażowanie czatujących, wskaźniki lojalności, szczyty hype'u oraz prezentuje wszystko w nowoczesnym webpanelu (HTML5 + Vanilla CSS + JS + Chart.js).

---

## 🌟 Najważniejsze Funkcje

- 💬 **Śledzenie wiadomości i czatujących**: Zapisuje każdą wiadomość, nicki, odznaki (Mod, VIP, Subskrybent) oraz czas.
- 🔴 **Automatyczna detekcja streamów**: Rozpoznaje start i koniec transmisji, zbiera próbki oglądalności z oficjalnego Helix API co 2 minuty.
- 📊 **Nowoczesny Webpanel HTML+JS**:
  - **Przegląd Kanału**: Suma wiadomości, unikalni czatujący, nowi widzowie, średnia i szczyt widzów, wykres aktywności w czasie, rozkład godzinowy (kiedy czat żyje najbardziej) oraz ranking Top 20 z procentowym udziałem.
  - **Śledzenie Widza**: Wyszukiwarka z autouzupełnianiem, wskaźnik lojalności (% obecności na streamach od pierwszego pojawienia się), średnia dzienna, wykres aktywności i historia wiadomości z eksportem do CSV.
  - **Historia i Detale Streamów**: Czas trwania, peak widzów, krzywa oglądalności, proporcja czatujący vs lurkerzy (wykres kołowy), analiza szczytu hype'u (najgorętsza minuta) oraz chmura/wykres najpopularniejszych słów i emotek.
  - **Status & Baza**: Podgląd rozmiaru bazy, liczby rekordów i stanu połączenia.
- 🔒 **Bezpieczeństwo na domenie**: Opcjonalna ochrona hasłem (`PANEL_PASSWORD`), zoptymalizowana baza SQLite WAL (brak blokad przy jednoczesnym zapisie bota i odczycie panelu).
- 🌐 **Zunifikowana architektura**: Bot w tle + FastAPI serwujące API i statyczny panel na **jednym porcie (8000)**. Brak problemów z CORS i Mixed Content przy HTTPS!

---

## 🛠️ Uruchomienie Lokalne / Docker

### 1. Konfiguracja zmiennych środowiskowych
Skopiuj plik szablonu:
```bash
cp template.env.channel1.template .env.channel1
```

Uzupełnij plik `.env.channel1`:
- `CHANNEL`: Nazwa kanału (np. `akiirie`)
- `CLIENT_ID`, `CLIENT_SECRET`: Z Twitch Developer Console
- `CHAT_TOKEN`, `REFRESH_TOKEN`: Wygenerowane za pomocą skryptu `tokens.py`
- `PANEL_PASSWORD`: Opcjonalne hasło do webpanelu (np. `tajnehaslo123`)

### 2. Uruchomienie przez Docker Compose
```bash
docker compose up -d --build
```
Webpanel będzie dostępny pod adresem: `http://localhost:8000` (lub IP Twojego serwera).

---

## 🌐 Tutorial: Wystawienie na Własnej Domenie (Oracle Cloud)

Poniżej znajduje się kompletny poradnik krok po kroku, jak poprawnie i bezpiecznie wystawić TwitchMetrics na darmowej instancji Oracle Cloud VM za pomocą domeny i darmowego certyfikatu SSL.

### Krok 1: Odblokowanie portów w Oracle Cloud (Najczęstsza pułapka!)
W Oracle Cloud ruch sieciowy jest blokowany na poziomie wirtualnej chmury (VCN) oraz na poziomie zapory wewnątrz systemu Linux.

1. Zaloguj się do **Oracle Cloud Console**.
2. Przejdź do: **Networking** -> **Virtual Cloud Networks (VCN)** -> Wybierz swoje VCN.
3. Kliknij **Security Lists** -> **Default Security List for...**.
4. W sekcji **Ingress Rules** dodaj dwie reguły:
   - **Port 80 (HTTP)**: Source CIDR: `0.0.0.0/0`, IP Protocol: `TCP`, Destination Port Range: `80`
   - **Port 443 (HTTPS)**: Source CIDR: `0.0.0.0/0`, IP Protocol: `TCP`, Destination Port Range: `443`
5. Na samej maszynie wirtualnej Ubuntu odblokuj firewall `iptables` / `ufw`:
   ```bash
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save
   ```

### Krok 2: Konfiguracja DNS domeny
U swojego rejestratora domeny (np. Cloudflare, OVH, Cyberfolks):
- Dodaj rekord typu **A**:
  - **Nazwa**: np. `stats` (jeśli subdomena: `stats.twojadomena.pl`) lub `@`
  - **Wartość (IP)**: Publiczny adres IP Twojej maszyny Oracle Cloud.

### Krok 3: Instalacja Nginx i Certbot
Na serwerze Oracle wykonaj:
```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

### Krok 4: Konfiguracja Nginx jako Reverse Proxy
Utwórz plik konfiguracyjny dla Nginx:
```bash
sudo nano /etc/nginx/sites-available/twitchmetrics
```

Wklej poniższą konfigurację (podmień `stats.twojadomena.pl` na swoją domenę):
```nginx
server {
    server_name stats.twojadomena.pl;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Aktywuj stronę i przetestuj konfigurację:
```bash
sudo ln -s /etc/nginx/sites-available/twitchmetrics /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Krok 5: Darmowy Certyfikat SSL (Let's Encrypt)
Wygeneruj certyfikat SSL za pomocą certbota:
```bash
sudo certbot --nginx -d stats.twojadomena.pl
```
Certbot automatycznie skonfiguruje przekierowanie z HTTP na HTTPS oraz ustawi auto-odnawianie certyfikatu.

### Krok 6: Konfiguracja po stronie Cloudflare (Ochrona, SSL i ukrycie IP)

Cloudflare świetnie sprawdza się w parze z Oracle Cloud, ponieważ darmowo ukrywa prawdziwy adres IP Twojego serwera, chroni przed atakami DDoS oraz zapewnia błyskawiczny CDN.

#### Opcja A: Klasyczny Cloudflare Proxy (Pomarańczowa Chmurka ☁️)
1. **Rekord DNS**:
   - W panelu Cloudflare przejdź do zakładki **DNS** -> **Records**.
   - Dodaj lub edytuj rekord:
     - **Type**: `A`
     - **Name**: `stats` (lub `@` jeśli domena główna)
     - **IPv4 address**: Publiczny adres IP Twojego serwera Oracle Cloud
     - **Proxy status**: **Proxied** (włączona pomarańczowa chmurka ☁️)
2. **Ustawienie SSL/TLS**:
   - W panelu Cloudflare przejdź do: **SSL/TLS** -> **Overview**.
   - Zmień tryb szyfrowania na **Full** lub **Full (strict)**.
   - *Ważne*: **NIE** ustawiaj trybu *Flexible*, bo spowoduje to pętlę nieskończonych przekierowań (`ERR_TOO_MANY_REDIRECTS`) z Nginxem!
3. **Prawdziwe IP odwiedzających w Nginx**:
   W pliku `/etc/nginx/sites-available/twitchmetrics` warto dopisać nagłówek Cloudflare:
   ```nginx
   proxy_set_header X-Real-IP $http_cf_connecting_ip;
   proxy_set_header CF-Connecting-IP $http_cf_connecting_ip;
   ```

---

#### Opcja B: Cloudflare Tunnel (Najprostsza i najbezpieczniejsza metoda!)
Cloudflare Tunnel (`cloudflared`) pozwala wystawić aplikację na świat **BEZ otwierania jakichkolwiek portów w Oracle Cloud** i bez konfigurowania Nginxa czy certyfikatów SSL:
1. W panelu Cloudflare wejdź w **Zero Trust** -> **Networks** -> **Tunnels** -> **Create a tunnel**.
2. Wybierz nazwę (np. `twitch-tracker`) i skopiuj polecenie instalacji dla Ubuntu/Debian (np. `curl -L --output cloudflared.deb ... && sudo dpkg -i ... && sudo cloudflared service install ...`).
3. W sekcji **Public Hostnames**:
   - **Subdomain**: `stats`, **Domain**: `twojadomena.pl`
   - **Service**: Type `HTTP`, URL: `localhost:8000`
4. Zapisz. Cloudflare automatycznie utworzy tunel i certyfikat HTTPS. Aplikacja od razu działa pod `https://stats.twojadomena.pl`!

---

### Krok 7: Uruchomienie aplikacji w Dockerze
W katalogu projektu:
```bash
docker compose up -d --build
```

Twój panel jest teraz dostępny pod adresem: `https://stats.twojadomena.pl`! Możesz bezpiecznie przekazać ten link streamerce.

---

## 🗄️ Kompatybilność Dotychczasowej Bazy Danych (`messages.db`)

**Tak, Twoja dotychczasowa baza danych działa w 100% z nowym kodem bez żadnych migracji!**
- Struktura tabel (`messages`, `streams`, `stream_stats`) pozostała w pełni zachowana.
- Wszystkie dotychczas zapisane wiadomości (11 300+ wpisów), zarejestrowane sesje streamów oraz historia widzów są natychmiast widoczne w nowym webpanelu.
- Nowy kod automatycznie i bezpiecznie dodaje brakujące indeksy przyspieszające (`CREATE INDEX IF NOT EXISTS`) bez modyfikowania istniejących danych.
- Baza została przetestowana z nowym backendem i zwraca poprawne, kompletne statystyki historyczne.

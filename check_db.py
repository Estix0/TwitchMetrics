import sqlite3
import os

# Ścieżka do bazy zmapowanej na Twoim hoście
DB_FILE = "messages.db"

def check_db():
    print(f"🔍 Sprawdzam plik bazy: {DB_FILE}\n")
    
    if not os.path.exists(DB_FILE):
        print("❌ BŁĄD: Plik bazy danych w ogóle nie istnieje w tej lokalizacji!")
        return

    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()

        # Sprawdzanie tabel
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = [t[0] for t in cursor.fetchall()]
        print(f"📁 Istniejące tabele: {', '.join(tables)}")

        if 'messages' not in tables:
            print("❌ BŁĄD: Tabela 'messages' nie została jeszcze utworzona. Bot prawdopodobnie nie połączył się poprawnie z bazą.")
            return

        # Sprawdzanie liczby wiadomości
        cursor.execute("SELECT COUNT(*) FROM messages;")
        count = cursor.fetchone()[0]
        print(f"📊 Łączna liczba zapisanych wiadomości: {count}\n")

        # Pobieranie ostatnich wiadomości
        if count > 0:
            print("📝 Ostatnie 5 wiadomości:")
            print("-" * 50)
            cursor.execute("SELECT created_at, username, content FROM messages ORDER BY id DESC LIMIT 5;")
            for row in cursor.fetchall():
                print(f"[{row[0]}] {row[1]}: {row[2]}")
            print("-" * 50)
        else:
            print("⚠️ Tabela istnieje, ale jest PUSTA. Bot działa, ale nie zapisuje wiadomości (nie słyszy czatu).")

    except sqlite3.Error as e:
        print(f"❌ Błąd bazy danych SQLite: {e}")
    finally:
        if 'conn' in locals():
            conn.close()

if __name__ == "__main__":
    check_db()

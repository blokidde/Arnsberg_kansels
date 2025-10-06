# Arnsberg Kansels

Een interactieve webapplicatie voor jagers waarmee jachthutten, voederplekken, wildakkers en andere zones op een kaart kunnen worden beheerd.  
De kaart draait op **GitHub Pages**, terwijl de **FastAPI-backend** met **MariaDB** draait op een **Raspberry Pi 4**, toegankelijk via een beveiligde **Ngrok-tunnel**.

---

## Overzicht

De applicatie toont een kaart van het Arnsberg-gebied, waarop gebruikers:
- Jachthutten kunnen toevoegen, bewerken of verwijderen  
- Zones kunnen tekenen (bos, grens, voederplek, wildakker)  
- Waarnemingen (“wel/niet gezien”) en schoten kunnen registreren  
- Een leaderboard kunnen bekijken met geregistreerde schoten per gebruiker  
- Hun huidige locatie en windrichting kunnen zien  

---

## Architectuur

**Frontend**
- HTML, CSS en JavaScript  
- Gebruikt Leaflet.js voor kaartvisualisatie  
- Gehost via GitHub Pages

**Backend**
- FastAPI-server met Python  
- MariaDB-database in Docker-container  
- JWT-authenticatie voor login en registratie  
- Externe toegang via Ngrok HTTPS-tunnel (bijv. `https://<id>.ngrok-free.app`)

**Dataflow**
Frontend-API-aanroepen → Ngrok-tunnel → FastAPI → MariaDB

---

## Functies

| Categorie | Functies |
|------------|-----------|
| **Authenticatie** | Inloggen, registreren met toegangscode, sessiebeheer via JWT |
| **Kaart** | Marker- en zonebeheer, Leaflet-lagen (satelliet/topo), locatiebepaling |
| **Rapportage** | Registratie van dierwaarnemingen en schoten via modals |
| **Wind & Locatie** | Live windoverlay en kompasrichting via DeviceOrientation |
| **Leaderboard** | Ranglijst met aantal geregistreerde schoten per gebruiker |
| **Mobielvriendelijk** | Volledig responsief en geoptimaliseerd voor smartphones |

---

## Belangrijke Bestanden

| Bestand | Omschrijving |
|----------|---------------|
| `index.html` | Hoofdpagina met kaart, login en modals |
| `map.js` | Alle kaartlogica: markers, zones, API-calls en event handlers |
| `login.js` | Login-, registratie- en sessiebeheer (JWT) |
| `config.js` | Centrale configuratie met API-URL en Ngrok-headers |
| `style.css` | UI- en layoutstijl, inclusief modals, knoppen en kaartcomponenten |

---

## 🔌 Backendverbinding

De frontend communiceert via een beveiligde Ngrok-tunnel met de backend.  
Ngrok fungeert als tussenlaag tussen de Raspberry Pi en het publieke internet.  
De Pi draait:
- een **FastAPI-container** op poort 8000  
- een **MariaDB-container** op poort 3306  
- een **Ngrok-tunnel** die het geheel extern bereikbaar maakt via HTTPS  

De frontend gebruikt één centrale configuratie in `config.js` om de juiste API-url en headers te gebruiken.

---

## Licentie

Dit project is ontwikkeld voor persoonlijk gebruik binnen het **Arnsberg Jachtgebied**.  
Gebruik, kopiëren of verspreiden zonder toestemming is niet toegestaan.
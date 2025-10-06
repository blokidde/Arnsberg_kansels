# Arnsberg Kansels

Een interactieve webapplicatie voor jagers waarmee jachthutten, voederplekken, wildakkers en andere zones op een kaart kunnen worden beheerd.  
De kaart draait op **GitHub Pages**, terwijl de **FastAPI-backend** met **MariaDB** draait op een **Raspberry Pi 4**, toegankelijk via een beveiligde **Ngrok-tunnel**.

---

## 🗺️ Overzicht

De applicatie toont een kaart van het Arnsberg-gebied, waarop gebruikers:
- 🏠 Jachthutten kunnen toevoegen, bewerken of verwijderen  
- 🌳 Zones kunnen tekenen (bos, grens, voederplek, wildakker)  
- 📋 Waarnemingen (“wel/niet gezien”) en schoten kunnen registreren  
- 📊 Een leaderboard kunnen bekijken met geregistreerde schoten per gebruiker  
- 📍 Hun huidige locatie en windrichting kunnen zien  

---

## ⚙️ Architectuur

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
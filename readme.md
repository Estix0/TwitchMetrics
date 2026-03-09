# TwitchMetrics

## Overview

TwitchMetrics is a fully containerized Twitch chat and stream analytics tracker. It logs chat messages, tracks live stream sessions, and calculates statistics such as viewer-to-lurker ratios, user retention, and peak activity moments. It operates independently of the official Twitch dashboard to provide specialized community insights.

## DevOps Architecture

This project is designed to demonstrate containerization, local data persistence, and secure networking:

* **Containerization**: The asynchronous Python bot and Streamlit frontend run concurrently within a single `python:3.11-slim` container.
* **Infrastructure as Code**: Managed via Docker Compose to allow isolated environments and easy scaling.
* **Data Persistence**: Uses a Write-Ahead Logging (WAL) enabled SQLite database mapped to a local host volume to ensure data retention across rebuilds.
* **Secure Access**: Hosted on an external server and accessed exclusively through a Tailscale network. The application is not exposed to the public internet.
* **Automation**: The backend automatically handles Twitch OAuth token rotation and safely persists the new tokens to the local database, requiring no manual intervention after the initial setup.

## Setup and Deployment

**1. Clone the repository**

```bash
git clone https://github.com/Estix0/TwitchMetrics.git
cd TwitchMetrics

```

**2. Configure the environment**
Copy the template environment file to create your configuration:

```bash
cp template.env.channel1.template .env.channel1

```

Open `.env.channel1` and provide your configuration details, including `CHANNEL`, `DB_FILE`, `CLIENT_ID`, `CLIENT_SECRET`, `ACCESS_TOKEN`, and `REFRESH_TOKEN`. You can execute the included `tokens.py` script locally to generate your initial access and refresh tokens.

**3. Deploy the container**
Build and start the container in detached mode:

```bash
docker compose up -d --build

```

## Usage

Once deployed, the backend will automatically monitor the specified Twitch channel. It detects when the channel goes live, records chat messages, and polls the Twitch API for viewer statistics.

To interact with the analytics dashboard, ensure your local machine is connected to the same Tailscale network as the host server. Open a web browser and navigate to port 8501 on your server's Tailscale IP:

```text
http://<SERVER_TAILSCALE_IP>:8501

```

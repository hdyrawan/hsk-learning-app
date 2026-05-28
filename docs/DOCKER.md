# Docker

The app runs as a static Vite build served by nginx.

## Build And Run

```bash
docker compose up --build -d
```

The Compose file maps host port `8080` to container port `80`:

```text
http://localhost:8080
```

From a Windows PC on the same LAN, use the Linux host IP and port:

```text
http://<your-lan-ip>:8080
```

If the host IP changes, find it with:

```bash
hostname -I
```

## Rebuild After Code Changes

```bash
docker compose up --build -d
```

## Stop

```bash
docker compose down
```

## Troubleshooting

Check whether the container is up:

```bash
docker compose ps
```

Check HTTP response locally:

```bash
curl -I http://127.0.0.1:8080
```

Check logs:

```bash
docker compose logs --tail 100 hsk-learning
```

If Windows cannot connect:

- Confirm both machines are on the same network.
- Confirm the Linux host IP has not changed.
- Confirm no firewall blocks inbound TCP port `8080`.
- Confirm Docker reports `0.0.0.0:8080->80/tcp` in `docker compose ps`.

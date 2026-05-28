# Deployment

The app is packaged as a Docker image: a Node.js build stage compiles the Vite bundle, and an nginx stage serves the resulting static files.

## Starting the App

```bash
docker compose up --build -d
```

The Compose file binds host port `8080` to the container's port `80`:

```
http://localhost:8080
```

## Accessing from Another Device

Find this machine's LAN IP:

```bash
hostname -I
```

Then open from any device on the same local network:

```
http://<LAN-IP>:8080
```

## Stopping the App

```bash
docker compose down
```

## Rebuilding After Code Changes

```bash
docker compose up --build -d
```

Rebuilding replaces the container. Browser-stored progress is unaffected because it lives in `localStorage`, not the container.

## Troubleshooting

**Check whether the container is running:**

```bash
docker compose ps
```

**Check the HTTP response directly:**

```bash
curl -I http://127.0.0.1:8080
```

**Tail the nginx logs:**

```bash
docker compose logs --tail 100 hsk-learning
```

**If a remote device cannot connect:**

1. Confirm both machines are on the same network.
2. Confirm the LAN IP has not changed (`hostname -I`).
3. Confirm no firewall is blocking inbound TCP port `8080`.
4. Confirm Docker reports `0.0.0.0:8080->80/tcp` in `docker compose ps`.

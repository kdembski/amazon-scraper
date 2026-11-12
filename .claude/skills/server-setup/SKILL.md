---
name: server-setup
description: Use when the user wants to set up the scraper on a new server - Docker, Tailscale, .env, docker compose and GitHub Actions auto-deploy.
---

# Server setup

Run these steps on the server (Ubuntu/Debian) over SSH from this machine: `ssh -i <ssh key> <user>@<host> '<command>'`.

## Inputs

The user gives these in the message. Ask for any that is missing before starting:

- server address and user
- local path to the SSH key that logs in to the server
- local path to the deploy key (the key GitHub Actions logs in with, `secrets.SSH_KEY`)
- local path to the `.env` file (never read or print it: it holds secrets)
- `NAME_PREFIX` for this server
- local path to the Tailscale auth key file (`tskey-auth-...`, never read or print it)

## 1. Docker and git

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # log out and back in
sudo apt install -y git
```

## 2. Tailscale

Copy the auth key from this machine:

```bash
scp -i <ssh key> <auth key file> <user>@<host>:/tmp/ts-authkey
```

On the server:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sed -i 's/[[:space:]]//g' /tmp/ts-authkey
sudo tailscale up --auth-key=file:/tmp/ts-authkey --timeout=60s
rm -f /tmp/ts-authkey
tailscale ip -4   # 100.x.y.z
```

## 3. Clone

```bash
git clone https://github.com/kdembski/amazon-scraper.git ~/amazon-scraper
cd ~/amazon-scraper
git checkout main
```

## 4. `.env`

Copy it from this machine:

```bash
scp -i <ssh key> <env file> <user>@<host>:~/amazon-scraper/.env
```

Set `NAME_PREFIX` on the server, without printing the file:

```bash
cd ~/amazon-scraper
grep -q '^#\? *NAME_PREFIX=' .env && sed -i 's/^#\? *NAME_PREFIX=.*/NAME_PREFIX=<prefix>/' .env || printf '\nNAME_PREFIX=<prefix>\n' >> .env
grep '^NAME_PREFIX=' .env
```

## 5. Start

```bash
docker compose up -d --build --remove-orphans
docker compose logs -f
```

## 6. Auto-deploy (GitHub Actions)

`.github/workflows/deploy.yml` runs on every push to `main`: `git pull --ff-only` + `docker compose up -d --build --remove-orphans` on each host.

- Add the server to repo variable `DEPLOY_HOSTS`: `{"host":"<host>","user":"<user>","path":"/home/<user>/amazon-scraper"}`. `host` is the public IP or the tailnet IP (`tailscale ip -4`)
- Add the deploy key's public part to `authorized_keys` on the server (from this machine; for a private key path use `ssh-keygen -y -f <deploy key>` instead of `cat`):

  ```bash
  cat <deploy key>.pub | ssh -i <ssh key> <user>@<host> 'mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'
  ```
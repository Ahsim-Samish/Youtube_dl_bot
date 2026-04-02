#!/bin/bash
# Скрипт установки YouTube Telegram Bot на Debian 12
set -e

echo "=== YouTube Telegram Bot — Установка на Debian 12 ==="

# 1. Обновление системы
echo "[1/6] Обновление системы..."
apt update && apt upgrade -y

# 2. Установка Node.js 20 LTS
echo "[2/6] Установка Node.js..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
fi
echo "Node.js: $(node -v)"
echo "npm: $(npm -v)"

# 3. Установка ffmpeg
echo "[3/6] Установка ffmpeg..."
apt install -y ffmpeg
echo "ffmpeg: $(ffmpeg -version | head -1)"

# 4. Установка yt-dlp
echo "[4/6] Установка yt-dlp..."
if ! command -v yt-dlp &> /dev/null; then
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
    chmod a+rx /usr/local/bin/yt-dlp
fi
echo "yt-dlp: $(yt-dlp --version)"

# 5. Установка зависимостей бота
echo "[5/6] Установка зависимостей бота..."
cd /opt/youtube-bot
npm install --production

# 6. Создание systemd сервиса
echo "[6/6] Настройка systemd сервиса..."
cp /opt/youtube-bot/deploy/youtube-bot.service /etc/systemd/system/youtube-bot.service
systemctl daemon-reload
systemctl enable youtube-bot
systemctl restart youtube-bot

echo ""
echo "=== Готово! ==="
echo "Статус бота: systemctl status youtube-bot"
echo "Логи: journalctl -u youtube-bot -f"
echo "Перезапуск: systemctl restart youtube-bot"
echo "Стоп: systemctl stop youtube-bot"

import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sanitizeFilename, getCookiesPath } from './utils.js';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOWNLOADS_DIR = path.join(__dirname, '..', 'downloads');
const YT_DLP_PATH = process.env.YT_DLP_PATH || 'yt-dlp';
const MAX_QUALITY = process.env.VIDEO_QUALITY || '480p';

// Создаём папку для загрузок
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

/**
 * Аргументы cookies для yt-dlp
 * @param {number} userId - Telegram user ID
 */
function cookiesArgs(userId) {
  const cookiesPath = getCookiesPath(userId);
  if (cookiesPath) {
    return ['--cookies', cookiesPath];
  }
  return [];
}

/**
 * Скачивание видео с YouTube через yt-dlp
 * @param {string} url - URL видео
 * @param {object} options - Опции скачивания
 * @param {string} options.quality - Качество видео
 * @param {function} options.onProgress - Колбэк прогресса
 * @param {number} options.userId - Telegram user ID
 * @returns {Promise<{filePath: string, title: string}>}
 */
export async function downloadVideo(url, options = {}) {
  const { quality = MAX_QUALITY, onProgress = null, userId = null } = options;

  const { stdout: infoJson } = await execFileAsync(YT_DLP_PATH, [
    url,
    '--dump-json',
    '--no-download',
    '--no-warnings',
    '--quiet',
    ...cookiesArgs(userId)
  ], { maxBuffer: 10 * 1024 * 1024 });

  const videoInfo = JSON.parse(infoJson.trim());
  const title = videoInfo.title || 'video';
  const safeTitle = sanitizeFilename(title);
  const fileName = `${Date.now()}_${safeTitle}.mp4`;
  const filePath = path.join(DOWNLOADS_DIR, fileName);

  const maxHeight = parseInt(quality) || 480;

  return new Promise((resolve, reject) => {
    const args = [
      url,
      '-f', `bestvideo[height<=${maxHeight}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${maxHeight}]+bestaudio/best[height<=${maxHeight}]/best`,
      '--merge-output-format', 'mp4',
      '-o', filePath,
      '--no-playlist',
      '--no-warnings',
      '--newline',
      ...cookiesArgs(userId)
    ];

    const proc = spawn(YT_DLP_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let lastProgress = '';

    proc.stdout.on('data', (data) => {
      const line = data.toString().trim();
      if (line && onProgress) {
        const percentMatch = line.match(/([\d.]+)%/);
        if (percentMatch) {
          const percent = parseFloat(percentMatch[1]);
          if (percent.toString() !== lastProgress) {
            lastProgress = percent.toString();
            onProgress({ percent, raw: line });
          }
        }
      }
    });

    proc.stderr.on('data', (data) => {
      const line = data.toString().trim();
      if (line) console.log('[yt-dlp]', line);
    });

    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(filePath)) {
        resolve({ filePath, title });
      } else {
        reject(new Error(`yt-dlp завершился с кодом ${code}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Не удалось запустить yt-dlp: ${err.message}`));
    });
  });
}

/**
 * Скачивание только аудио (MP3) с YouTube
 * @param {string} url - URL видео
 * @param {function} onProgress - Колбэк прогресса
 * @param {number} userId - Telegram user ID
 * @returns {Promise<{filePath: string, title: string}>}
 */
export async function downloadAudio(url, onProgress = null, userId = null) {
  const { stdout: infoJson } = await execFileAsync(YT_DLP_PATH, [
    url,
    '--dump-json',
    '--no-download',
    '--no-warnings',
    '--quiet',
    ...cookiesArgs(userId)
  ], { maxBuffer: 10 * 1024 * 1024 });

  const videoInfo = JSON.parse(infoJson.trim());
  const title = videoInfo.title || 'audio';
  const safeTitle = sanitizeFilename(title);
  const fileName = `${Date.now()}_${safeTitle}.mp3`;
  const filePath = path.join(DOWNLOADS_DIR, fileName);

  return new Promise((resolve, reject) => {
    const args = [
      url,
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '-o', filePath,
      '--no-playlist',
      '--no-warnings',
      '--newline',
      ...cookiesArgs(userId)
    ];

    const proc = spawn(YT_DLP_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let lastProgress = '';

    proc.stdout.on('data', (data) => {
      const line = data.toString().trim();
      if (line && onProgress) {
        const percentMatch = line.match(/([\d.]+)%/);
        if (percentMatch) {
          const percent = parseFloat(percentMatch[1]);
          if (percent.toString() !== lastProgress) {
            lastProgress = percent.toString();
            onProgress({ percent, raw: line });
          }
        }
      }
    });

    proc.stderr.on('data', (data) => {
      const line = data.toString().trim();
      if (line) console.log('[yt-dlp audio]', line);
    });

    proc.on('close', (code) => {
      if (code === 0) {
        if (fs.existsSync(filePath)) {
          resolve({ filePath, title });
        } else {
          const dir = path.dirname(filePath);
          const base = path.basename(filePath, '.mp3');
          const files = fs.readdirSync(dir).filter(f => f.startsWith(base));
          if (files.length > 0) {
            resolve({ filePath: path.join(dir, files[0]), title });
          } else {
            reject(new Error('Файл не найден после скачивания'));
          }
        }
      } else {
        reject(new Error(`yt-dlp завершился с кодом ${code}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Не удалось запустить yt-dlp: ${err.message}`));
    });
  });
}

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const YT_DLP_PATH = process.env.YT_DLP_PATH || 'yt-dlp';
const COOKIES_DIR = path.join(__dirname, '..', 'cookies');

// Создаём папку для cookies
if (!fs.existsSync(COOKIES_DIR)) {
  fs.mkdirSync(COOKIES_DIR, { recursive: true });
}

/**
 * Проверка наличия yt-dlp и ffmpeg в системе
 */
export async function checkDependencies() {
  const results = { ytdlp: false, ffmpeg: false };

  try {
    await execFileAsync(YT_DLP_PATH, ['--version']);
    results.ytdlp = true;
  } catch {
    console.error('❌ yt-dlp не найден! Установите: winget install yt-dlp');
  }

  try {
    await execFileAsync('ffmpeg', ['-version']);
    results.ffmpeg = true;
  } catch {
    console.error('❌ ffmpeg не найден! Установите: winget install ffmpeg');
  }

  return results;
}

/**
 * Форматирование длительности из секунд в ЧЧ:ММ:СС
 */
export function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return 'N/A';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Форматирование количества просмотров
 */
export function formatViews(views) {
  if (!views || isNaN(views)) return 'N/A';
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M`;
  if (views >= 1_000) return `${(views / 1_000).toFixed(1)}K`;
  return String(views);
}

/**
 * Форматирование размера файла
 */
export function formatFileSize(bytes) {
  if (!bytes || isNaN(bytes)) return 'N/A';
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} ГБ`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} МБ`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} КБ`;
  return `${bytes} Б`;
}

/**
 * Очистка строки для использования в имени файла
 */
export function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 80);
}

/**
 * Получить путь к cookies.txt для конкретного пользователя
 * @param {number} userId - Telegram user ID (опционально, для общих cookies)
 */
export function getCookiesPath(userId) {
  // Сначала проверяем пользовательский файл
  if (userId) {
    const userCookies = path.join(COOKIES_DIR, `${userId}_cookies.txt`);
    if (fs.existsSync(userCookies)) return userCookies;
  }

  // Затем общий файл
  const globalCookies = path.join(COOKIES_DIR, 'cookies.txt');
  if (fs.existsSync(globalCookies)) return globalCookies;

  // Проверяем в корне проекта
  const rootCookies = path.join(__dirname, '..', 'cookies.txt');
  if (fs.existsSync(rootCookies)) return rootCookies;

  return null;
}

/**
 * Сохранить cookies.txt от пользователя
 * @param {number} userId - Telegram user ID
 * @param {Buffer|string} content - Содержимое cookies.txt
 * @returns {string} путь к сохранённому файлу
 */
export function saveCookies(userId, content) {
  const cookiesPath = path.join(COOKIES_DIR, `${userId}_cookies.txt`);
  fs.writeFileSync(cookiesPath, content);
  return cookiesPath;
}

/**
 * Проверить наличие cookies для пользователя
 */
export function hasCookies(userId) {
  return getCookiesPath(userId) !== null;
}

/**
 * Удалить cookies пользователя
 */
export function deleteCookies(userId) {
  const cookiesPath = path.join(COOKIES_DIR, `${userId}_cookies.txt`);
  if (fs.existsSync(cookiesPath)) {
    fs.unlinkSync(cookiesPath);
    return true;
  }
  return false;
}

/**
 * Разбивка файла на части для Telegram (макс 50 МБ)
 * @param {string} filePath - путь к файлу
 * @param {number} maxSizeBytes - максимальный размер части
 * @returns {Promise<string[]>} пути к частям
 */
export async function splitFile(filePath, maxSizeBytes = 49 * 1024 * 1024) {
  const stats = fs.statSync(filePath);
  if (stats.size <= maxSizeBytes) {
    return [filePath];
  }

  const parts = [];
  const totalParts = Math.ceil(stats.size / maxSizeBytes);
  const ext = path.extname(filePath);
  const baseName = path.basename(filePath, ext);
  const dir = path.dirname(filePath);

  const readStream = fs.createReadStream(filePath, { highWaterMark: maxSizeBytes });
  let partIndex = 0;

  for await (const chunk of readStream) {
    partIndex++;
    const partPath = path.join(dir, `${baseName}_part${partIndex}of${totalParts}${ext}`);
    fs.writeFileSync(partPath, chunk);
    parts.push(partPath);
  }

  return parts;
}

/**
 * Удаление файла/файлов
 */
export function cleanupFiles(...filePaths) {
  for (const fp of filePaths) {
    try {
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch (e) {
      console.error(`Ошибка удаления ${fp}:`, e.message);
    }
  }
}

/**
 * Проверка, является ли строка YouTube ссылкой
 */
export function isYouTubeUrl(text) {
  return /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)[\w-]+/.test(text);
}

/**
 * Извлечение YouTube URL из текста
 */
export function extractYouTubeUrl(text) {
  const match = text.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]+)/);
  if (match) {
    return `https://www.youtube.com/watch?v=${match[1]}`;
  }
  return null;
}

import { execFile } from 'child_process';
import { promisify } from 'util';
import { formatDuration, formatViews, getCookiesPath } from './utils.js';

const execFileAsync = promisify(execFile);

const YT_DLP_PATH = process.env.YT_DLP_PATH || 'yt-dlp';

/**
 * Базовые аргументы yt-dlp (включая cookies если есть)
 * @param {number} userId - Telegram user ID для поиска cookies
 */
function baseArgs(userId) {
  const args = ['--no-warnings', '--quiet'];
  const cookiesPath = getCookiesPath(userId);
  if (cookiesPath) {
    args.push('--cookies', cookiesPath);
  }
  return args;
}

// Префиксы настоящих плейлистов (не миксов) — эти пропускаем
const REAL_PLAYLIST_PREFIXES = ['PL', 'UU', 'OL', 'FL', 'LL', 'WL'];

/**
 * Извлекает video ID из mix/radio ID
 * RD5i_Ckyc6g8Y → 5i_Ckyc6g8Y (seed video)
 * RDMM → null (нет seed)
 * RDGMEMxxxxxx → null
 */
function extractVideoIdFromMix(id) {
  if (!id || !id.startsWith('RD')) return null;
  // Убираем префикс RD
  const rest = id.substring(2);
  // RDMM, RDGMEM, RDEM — специальные миксы без явного seed video
  if (!rest || rest.startsWith('MM') || rest.startsWith('GMEM') || rest.startsWith('EM')) {
    return null;
  }
  // Остаток — это video ID
  return rest;
}

/**
 * Парсинг JSON-строк из вывода yt-dlp в массив видео
 * Миксы (RD...) конвертируются в первое видео микса
 */
function parseVideoLines(stdout) {
  const lines = stdout.trim().split('\n').filter(line => line.trim());
  const results = [];
  const seenIds = new Set(); //避免дубликатов

  for (const line of lines) {
    try {
      const data = JSON.parse(line);
      let videoId = data.id;
      let title = data.title || 'Без названия';

      // Пропускаем настоящие плейлисты (PL, UU и т.д.)
      if (videoId && REAL_PLAYLIST_PREFIXES.some(p => videoId.startsWith(p))) {
        console.log(`[skip] Плейлист: ${videoId} — ${title}`);
        continue;
      }

      // Пропускаем каналы
      const url = data.url || '';
      if (url.includes('/channel/') || url.includes('/user/')) {
        continue;
      }

      // Миксы (RD...) → извлекаем seed video ID
      if (videoId && videoId.startsWith('RD')) {
        const seedId = extractVideoIdFromMix(videoId);
        if (seedId) {
          console.log(`[mix] ${videoId} → seed video: ${seedId}`);
          videoId = seedId;
          // Для микса название может быть "Mix - ...", оставляем как есть
        } else {
          console.log(`[skip] Микс без seed video: ${videoId}`);
          continue;
        }
      }

      // Пропускаем дубли
      if (seenIds.has(videoId)) continue;
      seenIds.add(videoId);

      results.push({
        id: videoId,
        title: title,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        duration: data.duration,
        durationFormatted: formatDuration(data.duration),
        views: data.view_count,
        viewsFormatted: formatViews(data.view_count),
        channel: data.channel || data.uploader || data.uploader_id || '',
        thumbnail: data.thumbnail || data.thumbnails?.[data.thumbnails?.length - 1]?.url || null
      });
    } catch (e) {
      console.error('[parse] Ошибка парсинга строки:', e.message);
    }
  }

  return results;
}

/**
 * Поиск видео на YouTube через yt-dlp
 * @param {string} query - Поисковый запрос
 * @param {number} limit - Количество результатов (макс 10)
 * @param {number} userId - Telegram user ID
 * @returns {Promise<Array>} Массив видео
 */
export async function searchVideos(query, limit = 10, userId = null) {
  try {
    const { stdout } = await execFileAsync(YT_DLP_PATH, [
      `ytsearch${limit}:${query}`,
      '--flat-playlist',
      '--dump-json',
      '--no-download',
      ...baseArgs(userId)
    ], { maxBuffer: 10 * 1024 * 1024 });

    return parseVideoLines(stdout);
  } catch (error) {
    console.error('Ошибка поиска YouTube:', error.message);
    throw new Error('Не удалось выполнить поиск. Проверьте подключение к интернету.');
  }
}

/**
 * Получение информации о видео по URL
 * @param {string} url - URL видео
 * @param {number} userId - Telegram user ID
 * @returns {Promise<Object>} Информация о видео
 */
export async function getVideoInfo(url, userId = null) {
  try {
    const { stdout } = await execFileAsync(YT_DLP_PATH, [
      url,
      '--dump-json',
      '--no-download',
      ...baseArgs(userId)
    ], { maxBuffer: 10 * 1024 * 1024 });

    const data = JSON.parse(stdout.trim());
    
    return {
      id: data.id,
      title: data.title || 'Без названия',
      url: data.webpage_url || url,
      duration: data.duration,
      durationFormatted: formatDuration(data.duration),
      views: data.view_count,
      viewsFormatted: formatViews(data.view_count),
      channel: data.channel || data.uploader || 'Неизвестный канал',
      thumbnail: data.thumbnail || data.thumbnails?.[0]?.url || null,
      filesize: data.filesize_approx || data.filesize || null
    };
  } catch (error) {
    console.error('Ошибка получения информации о видео:', error.message);
    throw new Error('Не удалось получить информацию о видео.');
  }
}

/**
 * Получение популярных/трендовых видео
 * @param {number} limit - Количество результатов
 * @param {number} userId - Telegram user ID
 * @returns {Promise<Array>} Массив видео
 */
export async function getTrendingVideos(limit = 8, userId = null) {
  try {
    const { stdout } = await execFileAsync(YT_DLP_PATH, [
      'https://www.youtube.com/feed/trending',
      '--flat-playlist',
      '--dump-json',
      '--no-download',
      '--playlist-end', String(limit),
      ...baseArgs(userId)
    ], { maxBuffer: 10 * 1024 * 1024, timeout: 30000 });

    return parseVideoLines(stdout);
  } catch (error) {
    console.error('Ошибка загрузки трендов:', error.message);
    console.log('Пробую фолбэк через поиск...');
    return searchVideos('trending music videos 2026', limit, userId);
  }
}

/**
 * Получение рекомендаций пользователя (нужен cookies.txt)
 * @param {number} limit - Количество результатов
 * @param {number} userId - Telegram user ID
 * @returns {Promise<Array>} Массив видео
 */
export async function getRecommendations(limit = 8, userId) {
  const cookiesPath = getCookiesPath(userId);
  if (!cookiesPath) {
    throw new Error('NO_COOKIES');
  }

  try {
    // Запрашиваем больше, т.к. часть будет отфильтрована (миксы/плейлисты)
    const fetchLimit = limit + 10;

    const { stdout } = await execFileAsync(YT_DLP_PATH, [
      'https://www.youtube.com/feed/recommended',
      '--flat-playlist',
      '--dump-json',
      '--no-download',
      '--playlist-end', String(fetchLimit),
      '--cookies', cookiesPath,
      '--no-warnings',
      '--quiet'
    ], { maxBuffer: 10 * 1024 * 1024, timeout: 60000 });

    // parseVideoLines автоматически отфильтрует миксы и плейлисты
    const videos = parseVideoLines(stdout);
    
    if (videos.length === 0) {
      throw new Error('EMPTY_FEED');
    }

    // Возвращаем только запрошенное количество
    return videos.slice(0, limit);
  } catch (error) {
    if (error.message === 'NO_COOKIES' || error.message === 'EMPTY_FEED') throw error;
    console.error('Ошибка загрузки рекомендаций:', error.message);
    throw new Error('Не удалось загрузить рекомендации. Проверьте cookies.txt.');
  }
}

import { Telegraf, Markup } from 'telegraf';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import dotenv from 'dotenv';
import { searchVideos, getVideoInfo, getTrendingVideos, getRecommendations } from './youtube.js';
import { downloadVideo, downloadAudio } from './downloader.js';
import {
  checkDependencies,
  formatFileSize,
  splitFile,
  cleanupFiles,
  isYouTubeUrl,
  extractYouTubeUrl,
  saveCookies,
  hasCookies,
  deleteCookies,
  getCookiesPath
} from './utils.js';

dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

const MAX_FILE_SIZE = (parseInt(process.env.MAX_FILE_SIZE_MB) || 50) * 1024 * 1024;

// Хранилище для результатов поиска пользователей
const userSearchResults = new Map();

// ═══════════════════════════════════════════════════════
// КОМАНДЫ
// ═══════════════════════════════════════════════════════

bot.start((ctx) => {
  const hasCk = hasCookies(ctx.from.id);
  ctx.reply(
    '🎬 YouTube Downloader Bot\n\n' +
    'Я помогу тебе найти и скачать видео или аудио с YouTube!\n\n' +
    '📋 Команды:\n' +
    '🔍 /search <запрос> — поиск видео\n' +
    '🔥 /trending — популярные видео\n' +
    '⭐ /recommendations — мои рекомендации' + (hasCk ? ' ✅' : ' (нужен cookies.txt)') + '\n' +
    '🍪 /cookies — управление cookies\n' +
    '❓ /help — помощь\n\n' +
    '💡 Или просто отправь мне:\n' +
    '• Текст — и я найду видео\n' +
    '• Ссылку на YouTube — и я скачаю видео\n' +
    '• Файл cookies.txt — для доступа к рекомендациям'
  );
});

bot.help((ctx) => {
  ctx.reply(
    '📖 Как пользоваться ботом:\n\n' +
    '1. Отправь текстовый запрос или команду /search\n' +
    '2. Выбери видео из списка результатов\n' +
    '3. Выбери формат: 🎬 Видео или 🎵 MP3\n' +
    '4. Дождись скачивания и получи файл!\n\n' +
    '🔗 Можешь отправить прямую ссылку на YouTube видео\n\n' +
    '⭐ Рекомендации:\n' +
    'Отправь файл cookies.txt из браузера, чтобы я мог\n' +
    'показывать твои персональные рекомендации YouTube.\n' +
    'Получить cookies.txt можно расширением браузера\n' +
    '"Get cookies.txt LOCALLY" или "EditThisCookie".\n\n' +
    '⚠️ Ограничения:\n' +
    '• Видео скачиваются в качестве до 480p\n' +
    '• Файлы больше 50 МБ будут разбиты на части'
  );
});

// ═══════════════════════════════════════════════════════
// COOKIES
// ═══════════════════════════════════════════════════════

bot.command('cookies', async (ctx) => {
  const hasCk = hasCookies(ctx.from.id);
  
  const buttons = [];
  if (hasCk) {
    buttons.push([Markup.button.callback('🗑 Удалить мои cookies', 'delete_cookies')]);
    buttons.push([Markup.button.callback('📤 Загрузить новые', 'upload_cookies_info')]);
  } else {
    buttons.push([Markup.button.callback('📤 Как загрузить cookies?', 'upload_cookies_info')]);
  }

  ctx.reply(
    '🍪 Управление cookies\n\n' +
    (hasCk
      ? '✅ Cookies загружены! Рекомендации доступны по /recommendations'
      : '❌ Cookies не загружены. Отправь файл cookies.txt для доступа к рекомендациям.'),
    Markup.inlineKeyboard(buttons)
  );
});

bot.action('delete_cookies', async (ctx) => {
  await ctx.answerCbQuery();
  const deleted = deleteCookies(ctx.from.id);
  ctx.reply(deleted ? '✅ Cookies удалены.' : '⚠️ Cookies не найдены.');
});

bot.action('upload_cookies_info', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.reply(
    '📤 Как получить cookies.txt:\n\n' +
    '1. Установи расширение "Get cookies.txt LOCALLY"\n' +
    '   для Chrome/Firefox/Edge\n' +
    '2. Зайди на youtube.com и авторизуйся\n' +
    '3. Нажми на иконку расширения\n' +
    '4. Нажми "Export" → скачается cookies.txt\n' +
    '5. Отправь этот файл мне в чат\n\n' +
    '🔒 Файл хранится только на сервере бота\n' +
    'и используется исключительно для yt-dlp.'
  );
});

// ═══════════════════════════════════════════════════════
// РЕКОМЕНДАЦИИ
// ═══════════════════════════════════════════════════════

bot.command('recommendations', async (ctx) => {
  if (!hasCookies(ctx.from.id)) {
    return ctx.reply(
      '⭐ Для рекомендаций нужен cookies.txt\n\n' +
      'Отправь файл cookies.txt из браузера, чтобы я мог видеть твою ленту YouTube.\n' +
      'Подробнее: /cookies'
    );
  }

  const statusMsg = await ctx.reply('⭐ Загружаю твои рекомендации...');

  try {
    const videos = await getRecommendations(8, ctx.from.id);

    if (!videos || videos.length === 0) {
      return ctx.reply('😕 Не удалось загрузить рекомендации. Попробуйте обновить cookies.txt');
    }

    userSearchResults.set(ctx.from.id, videos);
    await sendVideoList(ctx, videos, '⭐ Твои рекомендации:');
    try { await ctx.deleteMessage(statusMsg.message_id); } catch {}

  } catch (error) {
    if (error.message === 'NO_COOKIES') {
      ctx.reply('🍪 Cookies не загружены. Отправь файл cookies.txt. Подробнее: /cookies');
    } else if (error.message === 'EMPTY_FEED') {
      ctx.reply('😕 Лента пуста. Попробуй обновить cookies.txt');
    } else {
      console.error('Ошибка рекомендаций:', error);
      ctx.reply('❌ Ошибка при загрузке рекомендаций. Попробуйте обновить cookies.txt');
    }
  }
});

// ═══════════════════════════════════════════════════════
// ПОИСК ВИДЕО
// ═══════════════════════════════════════════════════════

bot.command('search', async (ctx) => {
  const query = ctx.message.text.replace('/search', '').trim();
  if (!query) {
    return ctx.reply('🔍 Укажите запрос. Например: /search lo-fi music');
  }
  await performSearch(ctx, query);
});

bot.command('trending', async (ctx) => {
  await performSearch(ctx, null, true);
});

/**
 * Выполнить поиск и показать результаты
 */
async function performSearch(ctx, query, isTrending = false) {
  const statusMsg = await ctx.reply(
    isTrending ? '🔥 Загружаю популярные видео...' : `🔍 Ищу: ${query}...`
  );

  try {
    const userId = ctx.from.id;
    const videos = isTrending
      ? await getTrendingVideos(8, userId)
      : await searchVideos(query, 8, userId);

    if (!videos || videos.length === 0) {
      return ctx.reply('😕 Ничего не найдено. Попробуйте другой запрос.');
    }

    userSearchResults.set(ctx.from.id, videos);

    const title = isTrending ? '🔥 Популярные видео:' : '🔍 Результаты поиска:';
    await sendVideoList(ctx, videos, title);

    try { await ctx.deleteMessage(statusMsg.message_id); } catch {}

  } catch (error) {
    console.error('Ошибка поиска:', error);
    ctx.reply('❌ Ошибка при поиске. Попробуйте ещё раз.');
  }
}

/**
 * Отправить список видео с кнопками
 */
async function sendVideoList(ctx, videos, title) {
  let text = `${title}\n\n`;

  videos.forEach((video, i) => {
    const videoTitle = video.title.length > 55
      ? video.title.substring(0, 55) + '...'
      : video.title;
    text += `${i + 1}. ${videoTitle}\n`;

    // Собираем мета-данные (могут быть пустые из flat-playlist)
    const meta = [];
    if (video.durationFormatted && video.durationFormatted !== 'N/A') meta.push(`⏱ ${video.durationFormatted}`);
    if (video.viewsFormatted && video.viewsFormatted !== 'N/A') meta.push(`👁 ${video.viewsFormatted}`);
    if (video.channel) meta.push(`📺 ${video.channel.substring(0, 25)}`);

    if (meta.length > 0) {
      text += `   ${meta.join(' · ')}\n`;
    }
    text += '\n';
  });

  text += '👇 Выберите видео:';

  const buttons = videos.map((video, i) => [
    Markup.button.callback(
      `${i + 1}. ${video.title.substring(0, 40)}${video.title.length > 40 ? '...' : ''}`,
      `select_${i}`
    )
  ]);

  await ctx.reply(text, Markup.inlineKeyboard(buttons));
}

// ═══════════════════════════════════════════════════════
// ОБРАБОТКА ВЫБОРА ВИДЕО
// ═══════════════════════════════════════════════════════

bot.action(/select_(\d+)/, async (ctx) => {
  const videoIndex = parseInt(ctx.match[1]);
  const userId = ctx.from.id;
  const videos = userSearchResults.get(userId);

  if (!videos || !videos[videoIndex]) {
    return ctx.answerCbQuery('⚠️ Видео не найдено. Выполните поиск заново.');
  }

  let video = videos[videoIndex];
  await ctx.answerCbQuery();

  // Если нет канала/просмотров (flat-playlist), подгружаем полную инфу
  if (!video.channel || !video.views) {
    try {
      const fullInfo = await getVideoInfo(video.url, userId);
      // Обновляем данные в кеше
      video = { ...video, ...fullInfo };
      videos[videoIndex] = video;
    } catch (e) {
      console.log('[select] Не удалось подгрузить полную инфу:', e.message);
    }
  }

  // Собираем текст с доступными данными
  let text = `🎬 ${video.title}\n\n`;
  if (video.channel) text += `📺 ${video.channel}\n`;
  const meta = [];
  if (video.durationFormatted && video.durationFormatted !== 'N/A') meta.push(`⏱ ${video.durationFormatted}`);
  if (video.viewsFormatted && video.viewsFormatted !== 'N/A') meta.push(`👁 ${video.viewsFormatted}`);
  if (meta.length > 0) text += `${meta.join(' · ')}\n`;
  text += '\nВыберите формат скачивания:';

  await ctx.reply(text, Markup.inlineKeyboard([
    [
      Markup.button.callback('🎬 Видео (MP4)', `dl_video_${videoIndex}`),
      Markup.button.callback('🎵 Аудио (MP3)', `dl_audio_${videoIndex}`)
    ],
    [
      Markup.button.callback('❌ Отмена', 'cancel')
    ]
  ]));
});

// ═══════════════════════════════════════════════════════
// СКАЧИВАНИЕ
// ═══════════════════════════════════════════════════════

bot.action(/dl_video_(\d+)/, async (ctx) => {
  const videoIndex = parseInt(ctx.match[1]);
  const videos = userSearchResults.get(ctx.from.id);

  if (!videos || !videos[videoIndex]) {
    return ctx.answerCbQuery('⚠️ Видео не найдено.');
  }

  await ctx.answerCbQuery();
  await handleDownload(ctx, videos[videoIndex], 'video');
});

bot.action(/dl_audio_(\d+)/, async (ctx) => {
  const videoIndex = parseInt(ctx.match[1]);
  const videos = userSearchResults.get(ctx.from.id);

  if (!videos || !videos[videoIndex]) {
    return ctx.answerCbQuery('⚠️ Видео не найдено.');
  }

  await ctx.answerCbQuery();
  await handleDownload(ctx, videos[videoIndex], 'audio');
});

bot.action('cancel', async (ctx) => {
  await ctx.answerCbQuery('Отменено');
  await ctx.deleteMessage();
});

/**
 * Основная функция скачивания и отправки
 */
async function handleDownload(ctx, video, type) {
  const typeLabel = type === 'audio' ? '🎵 аудио' : '🎬 видео';
  const shortTitle = video.title.substring(0, 50);
  const statusMsg = await ctx.reply(
    `⏳ Скачиваю ${typeLabel}: ${shortTitle}...\n\nЭто может занять некоторое время ⏳`
  );

  let lastUpdateTime = 0;

  const onProgress = async ({ percent }) => {
    const now = Date.now();
    if (now - lastUpdateTime < 3000) return;
    lastUpdateTime = now;

    const progressBar = makeProgressBar(percent);
    try {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        null,
        `⏳ Скачиваю ${typeLabel}...\n\n${progressBar} ${percent.toFixed(1)}%`
      );
    } catch {}
  };

  try {
    let result;
    const userId = ctx.from.id;
    if (type === 'audio') {
      result = await downloadAudio(video.url, onProgress, userId);
    } else {
      result = await downloadVideo(video.url, { onProgress, userId });
    }

    const { filePath, title } = result;
    const stats = fs.statSync(filePath);

    if (stats.size > MAX_FILE_SIZE) {
      // Разбиваем на части
      try {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          null,
          `📦 Файл большой (${formatFileSize(stats.size)}). Разбиваю на части...`
        );
      } catch {}

      const parts = await splitFile(filePath);

      for (let i = 0; i < parts.length; i++) {
        const caption = `${title}\n\n📦 Часть ${i + 1}/${parts.length}`;
        const ext = type === 'audio' ? 'mp3' : 'mp4';
        await ctx.replyWithDocument(
          { source: parts[i], filename: `${sanitizeFilenameForTg(title)}_part${i + 1}.${ext}` },
          { caption }
        );
      }

      cleanupFiles(filePath, ...parts);

    } else {
      if (type === 'audio') {
        await ctx.replyWithAudio(
          { source: filePath, filename: `${sanitizeFilenameForTg(title)}.mp3` },
          { caption: `🎵 ${title}`, title: title }
        );
      } else {
        await ctx.replyWithVideo(
          { source: filePath },
          { caption: `🎬 ${title}\n\n🔗 ${video.url}` }
        );
      }

      cleanupFiles(filePath);
    }

    try { await ctx.deleteMessage(statusMsg.message_id); } catch {}

  } catch (error) {
    console.error('Ошибка скачивания:', error);
    try {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        null,
        '❌ Не удалось скачать. Возможные причины:\n' +
        '• Видео защищено от скачивания\n' +
        '• Проблемы с YouTube\n' +
        '• Видео недоступно в вашем регионе\n\n' +
        'Попробуйте другое видео.'
      );
    } catch {
      ctx.reply('❌ Ошибка при скачивании. Попробуйте другое видео.');
    }
  }
}

// ═══════════════════════════════════════════════════════
// ОБРАБОТКА ФАЙЛОВ (cookies.txt)
// ═══════════════════════════════════════════════════════

bot.on('document', async (ctx) => {
  const doc = ctx.message.document;
  
  // Проверяем, что это cookies.txt или текстовый файл
  const fileName = doc.file_name || '';
  if (!fileName.toLowerCase().includes('cookie') && !fileName.endsWith('.txt')) {
    return; // Игнорируем другие файлы
  }

  try {
    const statusMsg = await ctx.reply('🍪 Обрабатываю файл cookies...');

    // Получаем ссылку на файл
    const fileLink = await ctx.telegram.getFileLink(doc.file_id);
    
    // Скачиваем файл
    const content = await downloadFile(fileLink.href);
    
    // Проверяем, похож ли файл на cookies
    const textContent = content.toString('utf-8');
    if (!textContent.includes('youtube.com') && !textContent.includes('.youtube.com')) {
      return ctx.reply(
        '⚠️ Этот файл не похож на cookies от YouTube.\n' +
        'Убедитесь, что вы экспортировали cookies находясь на youtube.com'
      );
    }

    // Сохраняем
    saveCookies(ctx.from.id, content);
    
    try { await ctx.deleteMessage(statusMsg.message_id); } catch {}
    
    ctx.reply(
      '✅ Cookies успешно загружены!\n\n' +
      'Теперь доступны:\n' +
      '⭐ /recommendations — твои рекомендации\n\n' +
      '🗑 Удалить cookies: /cookies'
    );

  } catch (error) {
    console.error('Ошибка обработки cookies:', error);
    ctx.reply('❌ Не удалось обработать файл. Попробуйте ещё раз.');
  }
});

/**
 * Скачать файл по URL
 */
function downloadFile(url) {
  return new Promise((resolve, reject) => {
    const getter = url.startsWith('https') ? https : http;
    getter.get(url, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ═══════════════════════════════════════════════════════
// ОБРАБОТКА ТЕКСТОВЫХ СООБЩЕНИЙ И ССЫЛОК
// ═══════════════════════════════════════════════════════

bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();

  // Игнорируем команды
  if (text.startsWith('/')) return;

  // Проверяем YouTube ссылку
  if (isYouTubeUrl(text)) {
    const url = extractYouTubeUrl(text);
    if (!url) {
      return ctx.reply('❌ Не удалось распознать YouTube ссылку.');
    }

    try {
      const statusMsg = await ctx.reply('🔍 Получаю информацию о видео...');
      const videoInfo = await getVideoInfo(url, ctx.from.id);

      userSearchResults.set(ctx.from.id, [videoInfo]);

      try { await ctx.deleteMessage(statusMsg.message_id); } catch {}

      const infoText =
        `🎬 ${videoInfo.title}\n\n` +
        `📺 ${videoInfo.channel}\n` +
        `⏱ ${videoInfo.durationFormatted} · 👁 ${videoInfo.viewsFormatted}\n\n` +
        `Выберите формат скачивания:`;

      await ctx.reply(infoText, Markup.inlineKeyboard([
        [
          Markup.button.callback('🎬 Видео (MP4)', 'dl_video_0'),
          Markup.button.callback('🎵 Аудио (MP3)', 'dl_audio_0')
        ],
        [
          Markup.button.callback('❌ Отмена', 'cancel')
        ]
      ]));
    } catch (error) {
      console.error('Ошибка при обработке ссылки:', error);
      ctx.reply('❌ Не удалось получить информацию о видео. Проверьте ссылку.');
    }

  } else {
    // Обычный текст → поиск
    await performSearch(ctx, text);
  }
});

// ═══════════════════════════════════════════════════════
// УТИЛИТЫ
// ═══════════════════════════════════════════════════════

function makeProgressBar(percent) {
  const filled = Math.round(percent / 5);
  const empty = 20 - filled;
  return '▓'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, empty));
}

function sanitizeFilenameForTg(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 60);
}

// ═══════════════════════════════════════════════════════
// ЗАПУСК
// ═══════════════════════════════════════════════════════

async function start() {
  console.log('🔍 Проверяю зависимости...');
  const deps = await checkDependencies();

  if (!deps.ytdlp) {
    console.error('❌ yt-dlp не найден! Установите: winget install yt-dlp');
    process.exit(1);
  }
  if (!deps.ffmpeg) {
    console.error('⚠️  ffmpeg не найден. Некоторые функции могут не работать.');
  }

  // Обработка ошибок чтобы бот не падал
  bot.catch((err, ctx) => {
    console.error('Ошибка бота:', err.message);
    try {
      ctx.reply('❌ Произошла ошибка. Попробуйте ещё раз.');
    } catch {}
  });

  bot.launch();
  console.log('✅ Бот запущен!');
  console.log('📋 Команды: /start, /search, /trending, /recommendations, /cookies, /help');
  console.log('💡 Также принимает текстовые запросы, YouTube ссылки и cookies.txt');
}

start();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

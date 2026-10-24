(() => {
  'use strict';

  const tg = window.Telegram?.WebApp;
  const initData = typeof tg?.initData === 'string' ? tg.initData : '';
  const isPreview = !initData;
  const state = { characters: [], favorites: new Set(), quota: null, quotaTimer: null, quotaRefreshInFlight: false, lastQuotaRefreshAt: 0, style: 'all', query: '', role: '', age: '', sortByName: false, selected: null, selectedGreetingIndex: null, toastTimer: null, avatarUrls: new Map(), canManageAvatars: false, shop: { kind: 'messages', data: null, pendingProductId: '', termsPending: false } };
  const $ = selector => document.querySelector(selector);
  // Адрес API: на туннеле — тот же сайт; на GitHub Pages — параметр ?api= от бота или tunnel.json.
  const isTunnelHost = /(^|\.)(lhr\.life|localhost\.run|trycloudflare\.com)$/i.test(location.hostname) || ['127.0.0.1', 'localhost'].includes(location.hostname);
  const validApiBase = value => {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'https:' && /(^|\.)(lhr\.life|localhost\.run|trycloudflare\.com)$/i.test(url.hostname) ? url.origin : '';
    } catch { return ''; }
  };
  async function loadPublishedTunnel() {
    const sources = [window.NOCTRA_TUNNEL_SOURCE, 'tunnel.json'].filter(Boolean);
    for (const source of sources) {
      try {
        const response = await fetch(source + (source.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
        const base = validApiBase((await response.json()).api);
        if (base) return base;
      } catch {}
    }
    return '';
  }
  let apiBasePromise = null;
  function resolveApiBase(force) {
    if (isTunnelHost) return Promise.resolve('');
    if (!apiBasePromise || force) {
      const fromQuery = force ? '' : validApiBase(new URLSearchParams(location.search).get('api'));
      apiBasePromise = fromQuery ? Promise.resolve(fromQuery) : loadPublishedTunnel();
    }
    return apiBasePromise;
  }
  async function apiFetch(path, options) {
    const base = await resolveApiBase(false);
    if (!isTunnelHost && !base) throw new Error('Каталог открывается кнопкой «Персонажи» в чате с ботом.');
    try {
      return await fetch(base + path, options);
    } catch (error) {
      if (isTunnelHost) throw error;
      const fresh = await resolveApiBase(true);
      if (!fresh || fresh === base) throw error;
      return fetch(fresh + path, options);
    }
  }

  const grid = $('#character-grid');
  const status = $('#status');
  const empty = $('#empty-state');
  const backdrop = $('#detail-backdrop');
  const sheet = $('#detail-sheet');
  let favoriteSaveTimer = null;
  let favoriteSaveChain = Promise.resolve();
  let favoriteSaveRevision = 0;

  if (tg) {
    tg.ready();
    tg.expand();
    tg.setHeaderColor?.('#17131f');
    tg.setBackgroundColor?.('#17131f');
    tg.disableVerticalSwipes?.();
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  function cardStyle(character) {
    return `--tone-a:${escapeHtml(character.toneA || '#9474b2')};--tone-b:${escapeHtml(character.toneB || '#392d48')};--glow:${escapeHtml(character.glow || '#d89bd5')}`;
  }

  function normalizeStyle(character) {
    const style = String(character.style || character.imageStyle || '').toLocaleLowerCase('ru');
    const searchable = `${style} ${(character.tags || []).join(' ')}`.toLocaleLowerCase('ru');
    if (/реал|photo|photoreal|realistic/.test(searchable)) return 'realistic';
    if (/аниме|anime|manga/.test(searchable)) return 'anime';
    return style === 'realistic' ? 'realistic' : style === 'anime' ? 'anime' : 'anime';
  }

  function styleLabel(character) {
    return normalizeStyle(character) === 'realistic' ? 'Реализм' : 'Аниме';
  }

  function ageLabel(character) {
    if (character.ageLabel) return String(character.ageLabel);
    const age = Number(character.age) || 0;
    return age >= 18 ? `${age} лет` : '';
  }

  function ageBand(age) {
    const value = Number(age) || 0;
    if (value >= 35) return '35';
    if (value >= 25) return '25';
    if (value >= 18) return '18';
    return '';
  }

  function safeTags(character) {
    return (Array.isArray(character.tags) ? character.tags : [])
      .map(tag => String(tag || '').replace(/[<>]/g, '').trim())
      .filter(Boolean).slice(0, 4);
  }

  function characterLabel(character) {
    return String(character.displayName || character.name || 'Персонаж');
  }

  function charactersForView() {
    return state.characters.filter(character => {
      if (state.style !== 'all' && normalizeStyle(character) !== state.style) return false;
      if (state.role && String(character.role || '').toLocaleLowerCase('ru') !== state.role) return false;
      if (state.age && ageBand(character.age) !== state.age) return false;
      if (state.query) {
        const haystack = [characterLabel(character), character.role, character.subtitle, character.description, ...safeTags(character)].join(' ').toLocaleLowerCase('ru');
        if (!haystack.includes(state.query)) return false;
      }
      return true;
    }).sort((a, b) => state.sortByName ? a.name.localeCompare(b.name, 'ru') : 0);
  }

  function countStyles() {
    const realistic = state.characters.filter(character => normalizeStyle(character) === 'realistic').length;
    const anime = state.characters.length - realistic;
    $('#count-all').textContent = String(state.characters.length);
    $('#count-realistic').textContent = String(realistic);
    $('#count-anime').textContent = String(anime);
    $('#character-count').textContent = String(state.characters.length);
  }

  function refreshRoleOptions() {
    const select = $('#role-filter');
    const roles = [...new Set(state.characters.map(character => String(character.role || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
    select.innerHTML = '<option value="">Любая</option>' + roles.map(role => `<option value="${escapeHtml(role.toLocaleLowerCase('ru'))}">${escapeHtml(role)}</option>`).join('');
  }

  function refreshFilterLabels() {
    const roleSelect = $('#role-filter');
    const ageSelect = $('#age-filter');
    $('#role-label').textContent = roleSelect.value ? roleSelect.options[roleSelect.selectedIndex].textContent : 'Роль';
    $('#age-label').textContent = ageSelect.value ? ageSelect.options[ageSelect.selectedIndex].textContent : 'Возраст';
  }

  function cardMarkup(character, index) {
    const tags = safeTags(character);
    // Для карточек с возрастом показываем компактный порядок:
    // возраст → раса → жанр → характер. Остальные карточки сохраняют прежнюю высоту.
    const cardTagLimit = character.ageTag ? 4 : 3;
    const cardTags = [character.ageTag || ageLabel(character), ...tags].filter(Boolean).slice(0, cardTagLimit);
    const greetingCount = Math.max(0, Math.floor(Number.isFinite(Number(character.greetingCount))
      ? Number(character.greetingCount)
      : (Array.isArray(character.greetings) ? character.greetings.length : 0)));
    const subtitle = character.subtitle || character.description || character.role || 'Новая история начинается здесь';
    const avatar = character.avatar ? `<img class="is-loading" data-avatar="${escapeHtml(character.avatar)}" data-avatar-size="thumb" data-avatar-version="${Number(character.avatarVersion) || 0}" alt="" loading="lazy">` : '';
    const demoPhoto = isPreview && character.avatar === 'Qwark.png' ? '<img class="is-loading" data-demo-avatar="/assets/Qwark.png" alt="" loading="lazy">' : '';
    return `<article class="character-card" role="button" tabindex="0" data-index="${index}" style="${cardStyle(character)}">
      <div class="card-art">${avatar}${demoPhoto}<span class="card-glow"></span></div>
      <span class="card-vibe">${styleLabel(character)}</span>
      <button class="favorite" type="button" data-favorite="${escapeHtml(character.avatar || character.name)}" aria-label="Добавить в избранное" aria-pressed="false">♡</button>
      <div class="card-gradient"></div>
      <div class="card-copy"><h3 class="card-name">${escapeHtml(characterLabel(character))}</h3><p class="card-subtitle">${escapeHtml(subtitle)}</p>
        <div class="tag-list">${cardTags.map((tag, tagIndex) => `<span class="tag ${tagIndex === 0 ? 'accent' : ''}">${escapeHtml(tag)}</span>`).join('')}<span class="tag greeting-count" title="Количество историй">Истории: ${greetingCount}</span></div>
      </div>
    </article>`;
  }

  function render() {
    const visible = charactersForView();
    grid.innerHTML = visible.map(character => cardMarkup(character, state.characters.indexOf(character))).join('');
    grid.hidden = visible.length === 0;
    empty.hidden = visible.length !== 0;
    countStyles();
    loadVisibleAvatars();
    grid.querySelectorAll('.character-card').forEach(card => {
      card.addEventListener('click', event => {
        if (event.target.closest('.favorite')) return;
        const character = state.characters[Number(card.dataset.index)];
        if (character) openDetails(character);
      });
      card.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          const character = state.characters[Number(card.dataset.index)];
          if (character) openDetails(character);
        }
      });
    });
    grid.querySelectorAll('.favorite').forEach(button => {
      const isFavorite = state.favorites.has(button.dataset.favorite);
      button.textContent = isFavorite ? '♥' : '♡';
      button.setAttribute('aria-pressed', String(isFavorite));
      button.setAttribute('aria-label', isFavorite ? 'Убрать из избранного' : 'Добавить в избранное');
      button.addEventListener('click', event => {
        event.stopPropagation();
        const name = button.dataset.favorite;
        const nowFavorite = !state.favorites.has(name);
        if (nowFavorite) state.favorites.add(name); else state.favorites.delete(name);
        button.textContent = nowFavorite ? '♥' : '♡';
        button.setAttribute('aria-pressed', String(nowFavorite));
        button.setAttribute('aria-label', nowFavorite ? 'Убрать из избранного' : 'Добавить в избранное');
        if (isPreview) {
          try { localStorage.setItem('spicy-talks-favorites', JSON.stringify([...state.favorites])); } catch { /* storage may be unavailable in preview */ }
        } else {
          scheduleFavoriteSave();
        }
        showToast(nowFavorite ? 'Добавлено в избранное' : 'Убрано из избранного');
      });
    });
  }

  function getLegacyFavorites() {
    try { const value = JSON.parse(localStorage.getItem('spicy-talks-favorites') || '[]'); return Array.isArray(value) ? value : []; }
    catch { return []; }
  }

  async function saveFavoriteSnapshot(favorites, revision) {
    const response = await apiFetch('/api/favorites', {
      method: 'PUT',
      headers: { 'X-Telegram-Init-Data': initData, 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorites }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Не удалось сохранить избранное.');
    if (revision === favoriteSaveRevision && Array.isArray(result.favorites)) {
      state.favorites = new Set(result.favorites);
      render();
    }
    try { localStorage.removeItem('spicy-talks-favorites'); } catch { /* storage may be unavailable in Telegram */ }
  }

  function scheduleFavoriteSave(immediate = false) {
    const revision = ++favoriteSaveRevision;
    const save = () => {
      const snapshot = [...state.favorites];
      favoriteSaveChain = favoriteSaveChain.catch(() => {}).then(() => saveFavoriteSnapshot(snapshot, revision)).catch(error => {
        if (revision === favoriteSaveRevision) showToast(error.message || 'Избранное не удалось синхронизировать.');
      });
    };
    clearTimeout(favoriteSaveTimer);
    if (immediate) save();
    else favoriteSaveTimer = setTimeout(save, 350);
  }

  function formatCountdown(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const clock = [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':');
    return days ? `${days} д. ${clock}` : clock;
  }

  function renderQuotaCountdown() {
    const countdown = $('#quota-countdown');
    const resetsAt = Number(state.quota?.resetsAt);
    if (!resetsAt) return;
    const remaining = resetsAt - Date.now();
    if (remaining <= 0) {
      countdown.textContent = 'обновляю лимит…';
      if (!state.quotaRefreshInFlight && Date.now() - state.lastQuotaRefreshAt > 30000) {
        state.lastQuotaRefreshAt = Date.now();
        refreshCatalogData().catch(() => {});
      }
      return;
    }
    countdown.textContent = formatCountdown(remaining);
  }

  function renderQuota(quota) {
    if (!quota) return;
    state.quota = quota;
    const card = $('#quota-card');
    if (!card || isPreview) return;
    card.hidden = false;
    const freeMessages = Math.max(0, Number(quota.freeMessagesRemaining) || 0);
    const freeMessageLimit = Math.max(0, Number(quota.freeMessagesLimit) || 15);
    const freeImages = Math.max(0, Number(quota.freeImagesRemaining) || 0);
    const freeImageLimit = Math.max(0, Number(quota.freeImagesLimit) || 1);
    $('#free-message-count').textContent = `${freeMessages}/${freeMessageLimit} 💬 · ${freeImages}/${freeImageLimit} ▧`;
    $('#free-message-note').textContent = 'На аккаунт, общее для всех персонажей';
    const subscription = quota.subscription;
    const daily = $('#daily-quota');
    const reset = $('#quota-reset');
    $('.quota-grid').classList.toggle('has-subscription', Boolean(subscription));
    daily.hidden = !subscription;
    reset.hidden = !quota.resetsAt;
    if (subscription) {
      $('#daily-message-count').textContent = String(Math.max(0, Number(subscription.messagesRemaining) || 0));
      $('#daily-image-count').textContent = String(Math.max(0, Number(subscription.imagesRemaining) || 0));
    }
    $('#quota-reset-label').textContent = 'Общий лимит обновится в 00:00 МСК через';
    renderQuotaCountdown();
    $('#quota-note').textContent = subscription
      ? 'Бесплатный лимит общий для всех персонажей. Сначала расходуется подписка, затем бесплатный дневной лимит и купленные кредиты.'
      : '15 сообщений и 1 изображение в день на аккаунт, общие для всех персонажей. Сначала расходуется бесплатный лимит, затем купленные кредиты.';
    clearInterval(state.quotaTimer);
    state.quotaTimer = quota.resetsAt ? setInterval(renderQuotaCountdown, 1000) : null;
  }

  function loadVisibleAvatars() {
    const images = [...document.querySelectorAll('img[data-avatar],img[data-demo-avatar]')];
    if (!('IntersectionObserver' in window)) { images.forEach(loadAvatar); return; }
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) { observer.unobserve(entry.target); loadAvatar(entry.target); }
    }, { rootMargin: '120px' });
    images.forEach(image => observer.observe(image));
  }

  async function loadAvatar(image) {
    if (image.dataset.loaded === 'yes') return;
    image.dataset.loaded = 'yes';
    image.addEventListener('load', () => {
      image.classList.remove('is-loading');
      image.classList.add('is-ready');
    }, { once: true });
    image.addEventListener('error', () => image.remove(), { once: true });

    try {
      let source;
      if (image.dataset.demoAvatar) {
        source = image.dataset.demoAvatar;
      } else if (image.dataset.greetingThumb) {
        const file = image.dataset.greetingThumb;
        if (!initData) { image.remove(); return; }
        const cacheKey = 'greet' + String.fromCharCode(0) + file;
        let objectUrl = state.avatarUrls.get(cacheKey);
        if (!objectUrl) {
          const response = await apiFetch('/api/greeting-thumb?file=' + encodeURIComponent(file), { headers: { 'X-Telegram-Init-Data': initData } });
          if (!response.ok) throw new Error('HTTP ' + response.status);
          const blob = await response.blob();
          if (!blob.size || !blob.type.startsWith('image/')) throw new Error('Пустой ответ вместо изображения');
          objectUrl = URL.createObjectURL(blob);
          state.avatarUrls.set(cacheKey, objectUrl);
        }
        source = objectUrl;
      } else {
        const avatar = image.dataset.avatar;
        const size = image.dataset.avatarSize || 'thumb';
        const version = Number(image.dataset.avatarVersion) || 0;
        if (!avatar || !initData) {
          image.remove();
          return;
        }
        const cacheKey = avatar + String.fromCharCode(0) + size + String.fromCharCode(0) + version;
        let objectUrl = state.avatarUrls.get(cacheKey);
        if (!objectUrl && size === 'thumb' && state.avatarBatch) {
          const batch = await state.avatarBatch;
          objectUrl = batch.get(avatar) || '';
          if (objectUrl) state.avatarUrls.set(cacheKey, objectUrl);
        }
        if (!objectUrl) {
          const response = await apiFetch('/api/avatar?name=' + encodeURIComponent(avatar) + '&size=' + encodeURIComponent(size) + '&v=' + version, {
            headers: { 'X-Telegram-Init-Data': initData },
          });
          if (!response.ok) throw new Error('HTTP ' + response.status);
          const blob = await response.blob();
          if (!blob.size || !blob.type.startsWith('image/')) throw new Error('Пустой ответ вместо изображения');
          objectUrl = URL.createObjectURL(blob);
          state.avatarUrls.set(cacheKey, objectUrl);
        }
        source = objectUrl;
      }
      image.src = source;
    } catch (error) {
      console.warn('Не удалось загрузить портрет персонажа', image.dataset.avatar || '', error);
      image.remove();
    }
  }

  function availableGreetings(character) {
    if (!Array.isArray(character?.greetings)) return [];
    return character.greetings.filter(greeting => Number.isInteger(greeting.index) && greeting.index >= 0 && greeting.label);
  }

  function updateGreetingChoices() {
    const greetings = availableGreetings(state.selected);
    const options = $('#greeting-options');
    const lastTwoDigits = greetings.length % 100;
    const lastDigit = greetings.length % 10;
    const variantWord = lastTwoDigits >= 11 && lastTwoDigits <= 14
      ? 'вариантов'
      : lastDigit === 1 ? 'вариант' : lastDigit >= 2 && lastDigit <= 4 ? 'варианта' : 'вариантов';
    $('#greeting-count').textContent = `${greetings.length} ${variantWord}`;
    options.innerHTML = greetings.map((greeting, index) => {
      const selected = greeting.index === state.selectedGreetingIndex;
      return `<button class="greeting-option${selected ? ' selected' : ''}" type="button" aria-pressed="${selected}" data-greeting-index="${greeting.index}">
        ${greeting.image ? `<span class="greeting-option-thumb"><img class="is-loading" data-greeting-thumb="${escapeHtml(greeting.image)}" alt="" loading="lazy"></span>` : `<span class="greeting-option-number">${String(index + 1).padStart(2, '0')}</span>`}
        <span class="greeting-option-copy"><span class="greeting-option-title">${escapeHtml(greeting.label)}</span><span class="greeting-option-preview">${escapeHtml(greeting.preview || 'Начать эту историю')}</span></span>
        <span class="greeting-option-check" aria-hidden="true">✓</span>
      </button>`;
    }).join('');
    options.querySelectorAll('img[data-greeting-thumb]').forEach(loadAvatar);
  }

  function renderSavedDialogs(character) {
    const dialogs = Array.isArray(character.savedDialogs) ? character.savedDialogs.slice(0, 2) : [];
    const list = $('#saved-dialog-list');
    $('#saved-dialog-count').textContent = `${dialogs.length}/2`;
    $('#saved-dialog-empty').hidden = dialogs.length > 0;
    list.innerHTML = dialogs.map(dialog => {
      const savedAt = Number(dialog.savedAt);
      const date = savedAt > 0
        ? new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(savedAt))
        : 'сохранённый диалог';
      return `<div class="saved-dialog-row"><span class="saved-dialog-label">Диалог ${Number(dialog.slotNumber) || 1} · ${escapeHtml(date)}</span><button class="saved-dialog-continue" type="button" data-saved-dialog="${Number(dialog.slotNumber) || 1}">Продолжить</button></div>`;
    }).join('');
    list.querySelectorAll('[data-saved-dialog]').forEach(button => button.addEventListener('click', () => {
      continueSavedDialog(Number(button.dataset.savedDialog), button);
    }));
  }

  function openDetails(character) {
    state.selected = character;
    const greetings = availableGreetings(character);
    const greetingChoice = $('#greeting-choice');
    greetingChoice.hidden = greetings.length < 2;
    state.selectedGreetingIndex = greetings.length > 1 ? greetings[0].index : null;
    updateGreetingChoices();
    $('#detail-name').textContent = characterLabel(character);
    $('#detail-style').textContent = styleLabel(character);
    $('#detail-age').textContent = ageLabel(character);
    $('#detail-description').textContent = character.description || character.subtitle || 'Открой диалог и узнай историю персонажа.';
    renderSavedDialogs(character);
    $('#detail-tags').innerHTML = safeTags(character).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('');
    $('#avatar-manager').hidden = !state.canManageAvatars;
    $('#upload-avatar').textContent = character.avatarVersion ? 'Заменить портрет Mini App' : 'Загрузить портрет в каталог';
    const cover = $('#detail-cover');
    cover.setAttribute('style', cardStyle(character));
    cover.innerHTML = ``;
    if (character.cover) cover.insertAdjacentHTML('beforeend', `<img class="detail-cover-art" src="${escapeHtml(character.cover)}" alt="">`);
    else if (isPreview && character.avatar === 'Qwark.png') cover.insertAdjacentHTML('beforeend', '<img src="assets/Qwark.png" alt="">');
    else if (character.avatar && initData) cover.insertAdjacentHTML('beforeend', `<img data-avatar="${escapeHtml(character.avatar)}" data-avatar-size="thumb" data-avatar-version="${Number(character.avatarVersion) || 0}" alt="">`);
    const detailImage = cover.querySelector('[data-avatar]');
    if (detailImage) loadAvatar(detailImage);
    backdrop.hidden = false;
    sheet.hidden = false;
    document.body.classList.add('sheet-open');
    tg?.BackButton?.show();
    tg?.BackButton?.onClick(closeDetails);
  }

  function closeDetails() {
    backdrop.hidden = true;
    sheet.hidden = true;
    document.body.classList.remove('sheet-open');
    tg?.BackButton?.hide();
    tg?.BackButton?.offClick(closeDetails);
  }

  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
  }

  function shopRequest(path, options = {}) {
    return apiFetch(path, {
      ...options,
      headers: { 'X-Telegram-Init-Data': initData, ...(options.headers || {}) },
    }).then(async response => {
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Не удалось открыть магазин.');
      return result;
    });
  }

  function renderShop() {
    const data = state.shop.data;
    const productsEl = $('#shop-products');
    $('#shop-message-balance').textContent = String(data?.messageBalance ?? '—');
    $('#shop-image-balance').textContent = String(data?.imageBalance ?? '—');
    $('#message-balance').textContent = String(data?.messageBalance ?? '—');
    $('#image-balance').textContent = String(data?.imageBalance ?? '—');
    $('#shop-terms-text').textContent = String(data?.terms || '');
    const termsAccepted = Boolean(data?.termsAccepted);
    const termsCheckbox = $('#shop-terms-accept');
    termsCheckbox.checked = termsAccepted;
    termsCheckbox.disabled = termsAccepted || state.shop.termsPending;
    $('#shop-terms-state').textContent = state.shop.termsPending
      ? 'Сохраняю подтверждение…'
      : termsAccepted ? 'Условия приняты.' : 'Для оформления покупки сначала прими условия.';

    const subscription = data?.subscription;
    const subscriptionInfo = $('#shop-subscription');
    subscriptionInfo.hidden = !subscription;
    subscriptionInfo.textContent = subscription
      ? `Активна подписка «${subscription.name}»: сегодня осталось ${subscription.messagesRemaining} сообщений и ${subscription.imagesRemaining} изображений. Управление продлением — в чате с ботом.`
      : '';

    document.querySelectorAll('.shop-tab').forEach(button => {
      const active = button.dataset.shopKind === state.shop.kind;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    if (!data) {
      productsEl.textContent = 'Загружаю товары…';
      return;
    }
    const products = (Array.isArray(data.products) ? data.products : []).filter(product => product.kind === state.shop.kind);
    if (!products.length) {
      productsEl.textContent = state.shop.error || 'В этом разделе пока нет товаров.';
      return;
    }
    productsEl.innerHTML = products.map(product => {
      const title = product.kind === 'subscription' ? escapeHtml(product.name) : `${Number(product.amount) || 0} ${product.kind === 'messages' ? 'сообщений' : 'изображений'}`;
      const description = product.kind === 'subscription'
        ? `${Number(product.messagesPerDay) || 0} сообщений и ${Number(product.imagesPerDay) || 0} изображений каждый день · автопродление раз в 30 дней`
        : product.kind === 'images' ? 'Разовый пакет · 1 генерация расходует 1 кредит · кредиты не сгорают'
          : 'Разовый пакет · сообщения не сгорают';
      const blockedBySubscription = product.kind === 'subscription' && Boolean(subscription);
      const disabled = !termsAccepted || Boolean(state.shop.pendingProductId) || blockedBySubscription;
      const label = state.shop.pendingProductId === product.id ? 'Готовлю счёт…' : `${Number(product.stars) || 0} ⭐`;
      return `<article class="shop-product"><div class="shop-product-copy"><strong>${title}</strong><span>${escapeHtml(description)}</span></div><button class="shop-buy" data-product-id="${escapeHtml(product.id)}" type="button" ${disabled ? 'disabled' : ''}>${label}</button></article>`;
    }).join('');
  }

  async function loadShopData() {
    state.shop.error = '';
    try {
      state.shop.data = await shopRequest('/api/shop');
      renderShop();
    } catch (error) {
      state.shop.data = null;
      state.shop.error = error.message || 'Не удалось загрузить магазин.';
      $('#shop-products').textContent = state.shop.error;
      throw error;
    }
  }

  async function openShop() {
    if (isPreview) {
      showToast('Магазин доступен при открытии каталога в Telegram.');
      return;
    }
    closeDetails();
    $('#shop-backdrop').hidden = false;
    $('#shop-sheet').hidden = false;
    document.body.classList.add('shop-open');
    tg?.BackButton?.show();
    tg?.BackButton?.onClick(closeShop);
    state.shop.data = null;
    renderShop();
    try { await loadShopData(); }
    catch (error) { showToast(error.message || 'Не удалось загрузить магазин.'); }
  }

  function closeShop() {
    $('#shop-backdrop').hidden = true;
    $('#shop-sheet').hidden = true;
    document.body.classList.remove('shop-open');
    tg?.BackButton?.hide();
    tg?.BackButton?.offClick(closeShop);
  }

  async function acceptShopTerms() {
    if (state.shop.termsPending || state.shop.data?.termsAccepted) return;
    state.shop.termsPending = true;
    renderShop();
    try {
      await shopRequest('/api/shop/accept-terms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accept: true }),
      });
      state.shop.data.termsAccepted = true;
      tg?.HapticFeedback?.notificationOccurred?.('success');
      showToast('Условия приняты. Можно выбрать пакет.');
    } catch (error) {
      $('#shop-terms-accept').checked = false;
      showToast(error.message || 'Не удалось сохранить подтверждение.');
    } finally {
      state.shop.termsPending = false;
      renderShop();
    }
  }

  async function buyShopProduct(productId) {
    if (!tg?.openInvoice) {
      showToast('Открой магазин в приложении Telegram, чтобы оплатить покупку.');
      return;
    }
    state.shop.pendingProductId = productId;
    renderShop();
    try {
      const result = await shopRequest('/api/shop/invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId }),
      });
      tg.openInvoice(result.invoiceUrl, status => {
        state.shop.pendingProductId = '';
        renderShop();
        if (status === 'paid') {
          tg?.HapticFeedback?.notificationOccurred?.('success');
          showToast('Оплата прошла. Обновляю баланс…');
          setTimeout(() => {
            loadShopData().catch(() => {});
            refreshCatalogData().catch(() => {});
          }, 900);
        } else if (status === 'failed') {
          showToast('Telegram не завершил оплату. Попробуй ещё раз.');
        }
      });
    } catch (error) {
      state.shop.pendingProductId = '';
      renderShop();
      showToast(error.message || 'Не удалось открыть оплату.');
    }
  }
  function setStatus(message, type = '') {
    status.textContent = message;
    status.className = `status ${type}`.trim();
  }

  // Все превью одним запросом; при ошибке картинки догрузятся по одной.
  async function loadAvatarBatch() {
    const urls = new Map();
    try {
      const response = await apiFetch('/api/avatar-batch', { headers: { 'X-Telegram-Init-Data': initData } });
      if (!response.ok) return urls;
      const result = await response.json();
      const type = result.type || 'image/webp';
      for (const [name, data] of Object.entries(result.items || {})) {
        const binary = atob(data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        urls.set(name, URL.createObjectURL(new Blob([bytes], { type })));
      }
    } catch (error) {
      console.warn('Пакет превью не загрузился', error);
    }
    return urls;
  }

  async function loadCatalogData() {
    const response = await apiFetch('/api/characters', { headers: { 'X-Telegram-Init-Data': initData } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Не удалось загрузить каталог');
    state.characters = Array.isArray(result.characters) ? result.characters : [];
    if (!state.avatarBatch) state.avatarBatch = loadAvatarBatch();
    state.canManageAvatars = Boolean(result.canManageAvatars);
    $('#message-balance').textContent = String(result.messageBalance ?? '—');
    $('#image-balance').textContent = String(result.imageBalance ?? '—');
    const visibleKeys = new Set(state.characters.map(character => character.avatar || character.name));
    const serverFavorites = (Array.isArray(result.favorites) ? result.favorites : []).filter(key => visibleKeys.has(key));
    const migratedFavorites = getLegacyFavorites().filter(key => visibleKeys.has(key));
    state.favorites = new Set([...serverFavorites, ...migratedFavorites]);
    if (migratedFavorites.some(key => !serverFavorites.includes(key))) scheduleFavoriteSave(true);
    renderQuota(result.quota);
    refreshRoleOptions();
    render();
    setStatus(state.characters.length ? '' : 'В SillyTavern пока нет доступных карточек.');
  }

  async function refreshCatalogData() {
    if (state.quotaRefreshInFlight) return;
    state.quotaRefreshInFlight = true;
    try {
      await loadCatalogData();
    } finally {
      state.quotaRefreshInFlight = false;
    }
  }

  function resetFilters() {
    state.style = 'all'; state.query = ''; state.role = ''; state.age = '';
    $('#search').value = ''; $('#role-filter').value = ''; $('#age-filter').value = '';
    refreshFilterLabels();
    document.querySelectorAll('.style-tab').forEach(button => button.classList.toggle('active', button.dataset.style === 'all'));
    render();
  }

  async function runDialogAction(action, slotNumber, button) {
    if (!state.selected) return;
    if (isPreview) {
      showToast('Сохранения и диалоги доступны в Telegram Mini App');
      return;
    }
    const originalLabel = action === 'new' ? 'Начать новый диалог' : 'Продолжить';
    button.disabled = true;
    if (action === 'new') button.querySelector('span:first-child').textContent = 'Открываю диалог…';
    else button.textContent = 'Открываю…';
    try {
      const response = await apiFetch('/api/dialogs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData },
        body: JSON.stringify({
          action,
          name: state.selected.name,
          avatar: state.selected.avatar,
          ...(action === 'continue' ? { slotNumber } : {}),
          ...(action === 'new' && state.selectedGreetingIndex !== null ? { greetingIndex: state.selectedGreetingIndex } : {}),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Не удалось открыть диалог');
      tg?.HapticFeedback?.notificationOccurred?.('success');
      tg?.close();
    } catch (error) {
      showToast(error.message || 'Связь с ботом временно недоступна');
      button.disabled = false;
      if (action === 'new') button.querySelector('span:first-child').textContent = originalLabel;
      else button.textContent = originalLabel;
    }
  }

  async function selectCharacter() {
    await runDialogAction('new', null, $('#select-character'));
  }

  async function continueSavedDialog(slotNumber, button) {
    await runDialogAction('continue', slotNumber, button);
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }

  async function uploadMiniAppAvatar(file) {
    const character = state.selected;
    if (!file || !character || !state.canManageAvatars) return;
    if (file.size > 4 * 1024 * 1024) {
      showToast('Файл слишком большой. Максимум 4 МБ.');
      return;
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      showToast('Подойдут изображения PNG, JPG или WebP.');
      return;
    }

    const button = $('#upload-avatar');
    button.disabled = true;
    button.textContent = 'Загружаю портрет…';
    try {
      const data = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
      const response = await apiFetch('/api/avatar-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData },
        body: JSON.stringify({ avatar: character.avatar, mimeType: file.type, data }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Не удалось загрузить портрет');

      character.avatarVersion = Number(result.avatarVersion) || Date.now();
      const oldKeyPrefix = `${character.avatar}\u0000`;
      for (const [key, objectUrl] of state.avatarUrls) {
        if (key.startsWith(oldKeyPrefix)) {
          URL.revokeObjectURL(objectUrl);
          state.avatarUrls.delete(key);
        }
      }
      render();
      const cover = $('#detail-cover');
      cover.querySelector('img')?.remove();
      const image = document.createElement('img');
      image.dataset.avatar = character.avatar;
      image.dataset.avatarSize = 'original';
      image.dataset.avatarVersion = String(character.avatarVersion);
      image.alt = '';
      cover.append(image);
      await loadAvatar(image);
      showToast('Портрет обновлён в каталоге для всех пользователей');
    } catch (error) {
      showToast(error.message || 'Не удалось загрузить портрет');
    } finally {
      button.disabled = false;
      button.textContent = character.avatarVersion ? 'Заменить портрет Mini App' : 'Загрузить портрет в каталог';
      $('#avatar-file').value = '';
    }
  }

  function connectControls() {
    $('#search').addEventListener('input', event => { state.query = event.target.value.trim().toLocaleLowerCase('ru'); render(); });
    document.querySelectorAll('.style-tab').forEach(button => button.addEventListener('click', () => {
      state.style = button.dataset.style;
      document.querySelectorAll('.style-tab').forEach(tab => tab.classList.toggle('active', tab === button));
      render();
    }));
    $('#role-filter').addEventListener('change', event => { state.role = event.target.value; refreshFilterLabels(); render(); });
    $('#age-filter').addEventListener('change', event => { state.age = event.target.value; refreshFilterLabels(); render(); });
    $('#sort-button').addEventListener('click', event => { state.sortByName = !state.sortByName; event.currentTarget.classList.toggle('sorted', state.sortByName); render(); });
    $('#reset-filters').addEventListener('click', resetFilters);
    $('#empty-reset').addEventListener('click', resetFilters);
    $('#detail-close').addEventListener('click', closeDetails);
    $('#upload-avatar').addEventListener('click', () => $('#avatar-file').click());
    $('#avatar-file').addEventListener('change', event => uploadMiniAppAvatar(event.target.files?.[0]));
    backdrop.addEventListener('click', closeDetails);
    $('#greeting-options').addEventListener('click', event => {
      const option = event.target.closest('[data-greeting-index]');
      if (!option) return;
      state.selectedGreetingIndex = Number(option.dataset.greetingIndex);
      updateGreetingChoices();
    });
    $('#select-character').addEventListener('click', selectCharacter);
    $('#shop-button').addEventListener('click', openShop);
    $('#shop-close').addEventListener('click', closeShop);
    $('#shop-backdrop').addEventListener('click', closeShop);
    $('#shop-tabs').addEventListener('click', event => {
      const button = event.target.closest('[data-shop-kind]');
      if (!button) return;
      state.shop.kind = button.dataset.shopKind;
      renderShop();
    });
    $('#shop-products').addEventListener('click', event => {
      const button = event.target.closest('[data-product-id]');
      if (button && !button.disabled) buyShopProduct(button.dataset.productId);
    });
    $('#shop-terms-accept').addEventListener('change', event => { if (event.target.checked) acceptShopTerms(); });
    document.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k') { event.preventDefault(); $('#search').focus(); }
      if (event.key === 'Escape' && !sheet.hidden) closeDetails();
      else if (event.key === 'Escape' && !document.getElementById('shop-sheet').hidden) closeShop();
      if (event.key === '/' && document.activeElement !== $('#search')) { event.preventDefault(); $('#search').focus(); }
    });
  }

  async function initialize() {
    connectControls();
    if (isPreview) {
      state.characters = Array.isArray(window.MINIAPP_DEMO_CHARACTERS) ? window.MINIAPP_DEMO_CHARACTERS : [];
      state.favorites = new Set(getLegacyFavorites());
      setStatus('Предпросмотр · здесь показаны примеры, в Telegram загрузятся карточки из SillyTavern');
      $('.catalog-heading').insertAdjacentHTML('afterend', '<p class="preview-ribbon">ПРЕДПРОСМОТР · демонстрационные карточки</p>');
      $('#message-balance').textContent = '15';
      $('#image-balance').textContent = '1';
      refreshRoleOptions();
      render();
      return;
    }
    try {
      await loadCatalogData();
    } catch (error) {
      setStatus(error.message || 'Не удалось подключиться к каталогу. Попробуй открыть Mini App ещё раз.', 'error');
      grid.hidden = true;
    }
  }

  initialize();
})();

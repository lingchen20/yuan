// ============================================================
// notification-battery.js
// 从 script.js 拆分出来的通知、水印功能模块
// 包含：聊天内通知、系统级通知、截图水印
// ============================================================

// ========== 聊天内通知 ==========
  function playNotificationSound() {
    const player = document.getElementById('notification-sound-player');
    const soundUrl = state.globalSettings.notificationSoundUrl || DEFAULT_NOTIFICATION_SOUND;

    if (soundUrl && soundUrl.trim()) {
      player.src = soundUrl;
      player.volume = state.globalSettings.notificationVolume !== undefined ? state.globalSettings.notificationVolume : 1.0;
      player.play().catch(error => console.log("播放被中断，这是正常行为:", error));
    }
  }

  // 内部弹窗队列
  let myNotificationQueue = [];
  let isMyNotificationShowing = false;

  function showNotification(chatId, messageContent) {
    const chat = state.chats[chatId];
    if (!chat) return;

    const disableInternalNotification = state.globalSettings.systemNotification?.disableInternalNotification || false;

    // 内部弹窗排队
    if (!disableInternalNotification) {
      myNotificationQueue.push({ chatId, messageContent, chat });
      playNextNotification();
    }

    // 触发真正的手机系统级通知
    if (state.globalSettings.systemNotification?.enabled) {
      handleSystemNotification(chatId, messageContent);
    }
  }

  function playNextNotification() {
    if (isMyNotificationShowing || myNotificationQueue.length === 0) return;
    
    isMyNotificationShowing = true;
    const { chatId, messageContent, chat } = myNotificationQueue.shift();
    
    playNotificationSound();
    if(window.notificationTimeout) clearTimeout(window.notificationTimeout);

    const oldBar = document.getElementById('notification-bar');
    if (!oldBar) {
        isMyNotificationShowing = false;
        return;
    }

    const newBar = oldBar.cloneNode(false);
    newBar.classList.remove('visible');
    
    newBar.style.display = 'flex';
    newBar.style.alignItems = 'center';
    newBar.style.padding = '12px 15px';
    
    newBar.innerHTML = `
      <img src="${chat.settings.aiAvatar || chat.settings.groupAvatar || defaultAvatar}" style="width: 42px; height: 42px; border-radius: 10px; object-fit: cover; margin-right: 12px; flex-shrink: 0;">
      <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; text-align: left;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; width: 100%;">
              <span style="font-weight: 600; font-size: 15px; color: #000; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${chat.name}</span>
              <span style="font-size: 12px; color: #8a8a8a; flex-shrink: 0; margin-left: 10px;">现在</span>
          </div>
          <div style="font-size: 14px; color: #333; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.4; white-space: normal;">${messageContent}</div>
      </div>
    `;

    oldBar.parentNode.replaceChild(newBar, oldBar);

    void newBar.offsetWidth;
    newBar.classList.add('visible');

    newBar.addEventListener('click', () => {
      if(typeof openChat === 'function') openChat(chatId);
      newBar.classList.remove('visible');
      if(window.notificationTimeout) clearTimeout(window.notificationTimeout);
      setTimeout(() => {
        isMyNotificationShowing = false;
        playNextNotification();
      }, 300);
    });

    window.notificationTimeout = setTimeout(() => {
      newBar.classList.remove('visible');
      setTimeout(() => {
        isMyNotificationShowing = false;
        playNextNotification();
      }, 300);
    }, 3500);

    if(typeof updateBackButtonUnreadCount === 'function') updateBackButtonUnreadCount();
  }

  function triggerSystemNotificationInChatPage(chatId, messageContent) {
    const notifyInChatPage = state.globalSettings.systemNotification?.notifyInChatPage || false;
    if (notifyInChatPage && state.globalSettings.systemNotification?.enabled) {
      handleSystemNotification(chatId, messageContent);
    }
  }

// ========== 真实系统级通知功能 (突破防连弹与折叠) ==========
  
  // 🔥 新增：真实手机系统通知的排队引擎
  let systemNotificationQueue = [];
  let isProcessingSystemQueue = false;

  function initSystemNotification() {
    if (!('Notification' in window)) return;
    updateNotificationPermissionStatus();
    bindSystemNotificationEvents();
    loadSystemNotificationSettings(); 
    setInterval(() => {
      updateNotificationPermissionStatus();
    }, 3000);
  }

  async function updateNotificationPermissionStatus() {
    const statusEl = document.getElementById('permission-status-text');
    const statusContainer = document.getElementById('notification-permission-status');
    if (!statusEl) return;

    const permission = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
    if (permission === 'granted') {
      statusEl.textContent = '已授权';
      statusEl.style.color = '#4cd964';
      if (window.notificationManager) window.notificationManager.permissionGranted = true;
    } else if (permission === 'denied') {
      statusEl.textContent = '已拒绝';
      statusEl.style.color = '#ff3b30';
    } else if (permission === 'default') {
      statusEl.textContent = '未请求';
      statusEl.style.color = '#999';
    } else {
      statusEl.textContent = '不支持';
      statusEl.style.color = '#999';
    }

    if (statusContainer) {
      statusContainer.style.display = state.globalSettings.systemNotification?.enabled ? 'flex' : 'none';
    }
  }

  async function requestNotificationPermission() {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

    if (isIOS && !isStandalone) {
      alert('iOS设备需要先将网页添加到主屏幕才能使用系统通知功能\n\n1. 点击 Safari 分享按钮\n2. 选择"添加到主屏幕"');
      return false;
    }

    if (!('Notification' in window)) return false;

    try {
      let currentPermission = Notification.permission;
      if (currentPermission === 'granted') {
        if (window.notificationManager) window.notificationManager.permissionGranted = true;
        updateNotificationPermissionStatus();
        return true;
      }
      if (currentPermission === 'denied') {
        alert('通知权限已被拒绝，请在手机设置中开启');
        return false;
      }

      if (typeof Notification.requestPermission === 'function') {
        const permission = await Notification.requestPermission();
        await updateNotificationPermissionStatus();

        if (permission !== 'granted') {
          const switchEl = document.getElementById('system-notification-enabled-switch');
          if (switchEl) switchEl.checked = false;
          state.globalSettings.systemNotification.enabled = false;
          return false;
        }
        return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  function vibrateDevice() {
    if (!('vibrate' in navigator)) return;
    const patterns = { short: [200], medium: [200, 100, 200], long: [400, 100, 400, 100, 400] };
    const pattern = state.globalSettings.systemNotification?.vibration?.pattern || 'short';
    navigator.vibrate(patterns[pattern]);
  }

  function playSystemNotificationSound() {
    const soundConfig = state.globalSettings.systemNotification?.sound;
    if (!soundConfig || !soundConfig.enabled) return;

    let soundUrl = soundConfig.useGlobalSound 
        ? (state.globalSettings.notificationSoundUrl || DEFAULT_NOTIFICATION_SOUND) 
        : (soundConfig.customSoundUrl || DEFAULT_NOTIFICATION_SOUND);

    if (soundUrl && soundUrl.trim()) {
      const audio = new Audio(soundUrl);
      audio.volume = state.globalSettings.notificationVolume !== undefined ? state.globalSettings.notificationVolume : 1.0;
      audio.play().catch(() => {});
    }
  }

  // 将消息推入真实系统通知的队列，防止连发时系统折叠
  async function handleSystemNotification(chatId, messageContent) {
    const config = state.globalSettings.systemNotification;
    if (!config || !config.enabled) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

    // 放入系统队列
    systemNotificationQueue.push({ chatId, messageContent });
    processSystemNotificationQueue();
  }

  // 处理手机系统通知队列
  async function processSystemNotificationQueue() {
    // 如果正在呼叫底层系统，或者没消息了，就等待
    if (isProcessingSystemQueue || systemNotificationQueue.length === 0) return;
    isProcessingSystemQueue = true;

    const { chatId, messageContent } = systemNotificationQueue.shift();

    // 触发底层的通知唤起
    await showSystemNotification(chatId, messageContent);

    // 核心修复：间隔 2000 毫秒 (2秒)。这能完美避开安卓系统的“防打扰折叠”，让悬浮窗一个个按顺序弹！
    setTimeout(() => {
      isProcessingSystemQueue = false;
      processSystemNotificationQueue();
    }, 2000); 
  }

  async function showSystemNotification(chatId, messageContent, options = {}) {
    const chat = state.chats[chatId];
    if (!chat) return;

    const title = options.title || chat.name;
    const icon = chat.settings.aiAvatar || chat.settings.groupAvatar || 'https://i.postimg.cc/nMbyyt1t/D7CD735A73F5FD1D7B8407E0EB8BBAC0.png';

    // 确保每次通知的 tag 绝对独立，防止系统合并覆盖
    const uniqueTag = `chat-${chatId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // 核心修复：强制撑开安卓弹窗布局显示时间
    // 如果字数太少，安卓系统为了省空间会隐藏右侧时间。我们补上隐形全角空格欺骗系统。
    let displayBody = messageContent;
    if (displayBody.length < 10) {
      displayBody = displayBody.padEnd(10, '　'); // 补全角空格
    }

    try {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

      const notifyOptions = {
        body: displayBody,
        icon: icon,
        badge: icon,
        tag: uniqueTag,
        timestamp: Date.now(), // 强制向操作系统申报该通知的时间戳
        data: { chatId }
      };

      if (!isIOS) {
        notifyOptions.renotify = true;
      }

      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification(title, notifyOptions);
      } else if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, notifyOptions);
      }

      if (state.globalSettings.systemNotification.sound?.enabled) {
        playSystemNotificationSound();
      }

      if (state.globalSettings.systemNotification.vibration?.enabled) {
        if (navigator.vibrate) {
          navigator.vibrate(isIOS ? 200 : [200, 100, 200, 100, 200]);
        } else {
          vibrateDevice();
        }
      }
    } catch (error) {
      console.error('[系统通知] 创建通知失败:', error);
    }
  }

  async function sendTestNotification() {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
      alert('请先开启系统通知权限');
      return;
    }

    const appName = state.globalSettings.systemNotification?.appName || 'EPhone';

    try {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

      const testNotifyOptions = {
        body: '这是一条测试通知 🎉　　　　　　', // 加了空白占位撑开时间显示
        icon: 'https://i.postimg.cc/nMbyyt1t/D7CD735A73F5FD1D7B8407E0EB8BBAC0.png',
        badge: 'https://i.postimg.cc/nMbyyt1t/D7CD735A73F5FD1D7B8407E0EB8BBAC0.png',
        tag: 'test-notification-' + Date.now(),
        timestamp: Date.now()
      };

      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification(appName, testNotifyOptions);
      } else if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(appName, testNotifyOptions);
      }

      if (state.globalSettings.systemNotification?.sound?.enabled) playSystemNotificationSound();
      if (state.globalSettings.systemNotification?.vibration?.enabled) vibrateDevice();
    } catch (error) {
      alert('创建测试通知失败: ' + error.message);
    }
  }

  function bindSystemNotificationEvents() {
    const enabledSwitch = document.getElementById('system-notification-enabled-switch');
    const detailsDiv = document.getElementById('system-notification-details');
    const appNameInput = document.getElementById('system-notification-app-name');
    const testBtn = document.getElementById('test-system-notification-btn');

    const pushServerSwitch = document.getElementById('push-server-enabled-switch');
    const pushServerDetails = document.getElementById('push-server-details');
    const pushServerUrl = document.getElementById('push-server-url');
    const pushServerApiKey = document.getElementById('push-server-api-key');

    const vibrationSwitch = document.getElementById('notification-vibration-enabled-switch');
    const vibrationSelector = document.getElementById('vibration-pattern-selector');
    const vibrationPattern = document.getElementById('vibration-pattern-select');

    const soundSwitch = document.getElementById('notification-sound-enabled-switch');
    const soundDetails = document.getElementById('notification-sound-details');
    const useGlobalSound = document.getElementById('use-global-sound-switch');
    const customSoundWrapper = document.getElementById('custom-sound-input-wrapper');
    const customSoundUrl = document.getElementById('custom-notification-sound-url');

    if (enabledSwitch) {
      enabledSwitch.addEventListener('change', async () => {
        if (enabledSwitch.checked) {
          const granted = await requestNotificationPermission();
          if (granted) {
            state.globalSettings.systemNotification.enabled = true;
            detailsDiv.style.display = 'block';
            updateNotificationPermissionStatus();
          } else {
            enabledSwitch.checked = false;
          }
        } else {
          state.globalSettings.systemNotification.enabled = false;
          detailsDiv.style.display = 'none';
          updateNotificationPermissionStatus();
        }
      });
    }

    if (appNameInput) {
      appNameInput.addEventListener('input', () => {
        state.globalSettings.systemNotification.appName = appNameInput.value.trim() || 'EPhone';
      });
    }

    if (testBtn) testBtn.addEventListener('click', sendTestNotification);

    if (pushServerSwitch) {
      pushServerSwitch.addEventListener('change', () => {
        state.globalSettings.systemNotification.pushServer.enabled = pushServerSwitch.checked;
        pushServerDetails.style.display = pushServerSwitch.checked ? 'block' : 'none';
      });
    }
    if (pushServerUrl) pushServerUrl.addEventListener('input', () => { state.globalSettings.systemNotification.pushServer.serverUrl = pushServerUrl.value.trim(); });
    if (pushServerApiKey) pushServerApiKey.addEventListener('input', () => { state.globalSettings.systemNotification.pushServer.apiKey = pushServerApiKey.value.trim(); });

    if (vibrationSwitch) {
      vibrationSwitch.addEventListener('change', () => {
        state.globalSettings.systemNotification.vibration.enabled = vibrationSwitch.checked;
        vibrationSelector.style.display = vibrationSwitch.checked ? 'block' : 'none';
      });
    }
    if (vibrationPattern) vibrationPattern.addEventListener('change', () => { state.globalSettings.systemNotification.vibration.pattern = vibrationPattern.value; });

    if (soundSwitch) {
      soundSwitch.addEventListener('change', () => {
        state.globalSettings.systemNotification.sound.enabled = soundSwitch.checked;
        soundDetails.style.display = soundSwitch.checked ? 'block' : 'none';
      });
    }
    if (useGlobalSound) {
      useGlobalSound.addEventListener('change', () => {
        state.globalSettings.systemNotification.sound.useGlobalSound = useGlobalSound.checked;
        customSoundWrapper.style.display = useGlobalSound.checked ? 'none' : 'block';
      });
    }
    if (customSoundUrl) customSoundUrl.addEventListener('input', () => { state.globalSettings.systemNotification.sound.customSoundUrl = customSoundUrl.value.trim(); });

    const notifyInChatPageSwitch = document.getElementById('notify-in-chat-page-switch');
    if (notifyInChatPageSwitch) notifyInChatPageSwitch.addEventListener('change', () => { state.globalSettings.systemNotification.notifyInChatPage = notifyInChatPageSwitch.checked; });

    const disableInternalNotificationSwitch = document.getElementById('disable-internal-notification-switch');
    if (disableInternalNotificationSwitch) disableInternalNotificationSwitch.addEventListener('change', () => { state.globalSettings.systemNotification.disableInternalNotification = disableInternalNotificationSwitch.checked; });
  }

  function loadSystemNotificationSettings() {
    const config = state.globalSettings.systemNotification;
    if (!config) return;

    const enabledSwitch = document.getElementById('system-notification-enabled-switch');
    const detailsDiv = document.getElementById('system-notification-details');
    const appNameInput = document.getElementById('system-notification-app-name');
    const pushServerSwitch = document.getElementById('push-server-enabled-switch');
    const pushServerDetails = document.getElementById('push-server-details');
    const pushServerUrl = document.getElementById('push-server-url');
    const pushServerApiKey = document.getElementById('push-server-api-key');
    const vibrationSwitch = document.getElementById('notification-vibration-enabled-switch');
    const vibrationSelector = document.getElementById('vibration-pattern-selector');
    const vibrationPattern = document.getElementById('vibration-pattern-select');
    const soundSwitch = document.getElementById('notification-sound-enabled-switch');
    const soundDetails = document.getElementById('notification-sound-details');
    const useGlobalSound = document.getElementById('use-global-sound-switch');
    const customSoundWrapper = document.getElementById('custom-sound-input-wrapper');
    const customSoundUrl = document.getElementById('custom-notification-sound-url');

    if (enabledSwitch) { enabledSwitch.checked = config.enabled || false; detailsDiv.style.display = config.enabled ? 'block' : 'none'; }
    if (appNameInput) appNameInput.value = config.appName || 'EPhone';
    if (pushServerSwitch) { pushServerSwitch.checked = config.pushServer?.enabled || false; pushServerDetails.style.display = config.pushServer?.enabled ? 'block' : 'none'; }
    if (pushServerUrl) pushServerUrl.value = config.pushServer?.serverUrl || '';
    if (pushServerApiKey) pushServerApiKey.value = config.pushServer?.apiKey || '';
    if (vibrationSwitch) { vibrationSwitch.checked = config.vibration?.enabled || false; vibrationSelector.style.display = config.vibration?.enabled ? 'block' : 'none'; }
    if (vibrationPattern) vibrationPattern.value = config.vibration?.pattern || 'short';
    if (soundSwitch) { soundSwitch.checked = config.sound?.enabled || false; soundDetails.style.display = config.sound?.enabled ? 'block' : 'none'; }
    if (useGlobalSound) { useGlobalSound.checked = config.sound?.useGlobalSound !== false; customSoundWrapper.style.display = config.sound?.useGlobalSound !== false ? 'none' : 'block'; }
    if (customSoundUrl) customSoundUrl.value = config.sound?.customSoundUrl || '';

    const notifyInChatPageSwitch = document.getElementById('notify-in-chat-page-switch');
    if (notifyInChatPageSwitch) notifyInChatPageSwitch.checked = config.notifyInChatPage || false;

    const disableInternalNotificationSwitch = document.getElementById('disable-internal-notification-switch');
    if (disableInternalNotificationSwitch) disableInternalNotificationSwitch.checked = config.disableInternalNotification || false;

    updateNotificationPermissionStatus();
  }

  // ========== 系统级通知功能结束 ==========

  // ========== 截图水印功能开始 ==========

  let watermarkConfig = {
    enabled: false, text: '保密内容 请勿外传', layout: 'diagonal', color: '#000000', opacity: 0.1, fontSize: 20, fontFamily: "'Microsoft YaHei', sans-serif"
  };

  function createWatermarkLayer() {
    const existingWatermark = document.getElementById('screenshot-watermark-layer');
    if (existingWatermark) existingWatermark.remove();

    if (!watermarkConfig.enabled) return;

    const watermarkLayer = document.createElement('div');
    watermarkLayer.id = 'screenshot-watermark-layer';
    watermarkLayer.style.cssText = `position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 999999; overflow: hidden;`;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    const screenWidth = window.innerWidth;
    const isMobile = screenWidth < 768;
    const scaleFactor = isMobile ? Math.max(0.5, screenWidth / 768) : 1;
    
    let canvasWidth, canvasHeight;
    switch (watermarkConfig.layout) {
      case 'diagonal': canvasWidth = Math.round(400 * scaleFactor); canvasHeight = Math.round(200 * scaleFactor); break;
      case 'grid': canvasWidth = Math.round(300 * scaleFactor); canvasHeight = Math.round(150 * scaleFactor); break;
      case 'sparse': canvasWidth = Math.round(600 * scaleFactor); canvasHeight = Math.round(300 * scaleFactor); break;
      case 'dense': canvasWidth = Math.round(250 * scaleFactor); canvasHeight = Math.round(125 * scaleFactor); break;
      default: canvasWidth = Math.round(400 * scaleFactor); canvasHeight = Math.round(200 * scaleFactor);
    }

    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    const adaptiveFontSize = Math.round(watermarkConfig.fontSize * scaleFactor);

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.font = `${adaptiveFontSize}px ${watermarkConfig.fontFamily}`;
    ctx.fillStyle = watermarkConfig.color;
    ctx.globalAlpha = watermarkConfig.opacity;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (watermarkConfig.layout === 'diagonal') {
      ctx.translate(canvasWidth / 2, canvasHeight / 2);
      ctx.rotate(-25 * Math.PI / 180);
      ctx.fillText(watermarkConfig.text, 0, 0);
    } else if (watermarkConfig.layout === 'grid') {
      ctx.fillText(watermarkConfig.text, canvasWidth / 2, canvasHeight / 2);
    } else if (watermarkConfig.layout === 'sparse' || watermarkConfig.layout === 'dense') {
      ctx.translate(canvasWidth / 2, canvasHeight / 2);
      ctx.rotate(-30 * Math.PI / 180);
      ctx.fillText(watermarkConfig.text, 0, 0);
    }

    const dataURL = canvas.toDataURL('image/png');
    watermarkLayer.style.backgroundImage = `url(${dataURL})`;
    watermarkLayer.style.backgroundRepeat = 'repeat';
    
    document.body.appendChild(watermarkLayer);
  }

  function loadWatermarkSettings() {
    const savedConfig = localStorage.getItem('watermarkConfig');
    if (savedConfig) {
      try { watermarkConfig = { ...watermarkConfig, ...JSON.parse(savedConfig) }; } catch (e) {}
    }

    const enabledSwitch = document.getElementById('watermark-enabled-switch');
    const textInput = document.getElementById('watermark-text');
    const layoutSelect = document.getElementById('watermark-layout');
    const colorInput = document.getElementById('watermark-color');
    const opacityInput = document.getElementById('watermark-opacity');
    const fontSizeInput = document.getElementById('watermark-font-size');
    const fontFamilySelect = document.getElementById('watermark-font-family');
    const settingsContainer = document.getElementById('watermark-settings-container');

    if (enabledSwitch) enabledSwitch.checked = watermarkConfig.enabled;
    if (textInput) textInput.value = watermarkConfig.text;
    if (layoutSelect) layoutSelect.value = watermarkConfig.layout;
    if (colorInput) colorInput.value = watermarkConfig.color;
    if (opacityInput) opacityInput.value = watermarkConfig.opacity;
    if (fontSizeInput) fontSizeInput.value = watermarkConfig.fontSize;
    if (fontFamilySelect) fontFamilySelect.value = watermarkConfig.fontFamily;
    if (settingsContainer) settingsContainer.style.display = watermarkConfig.enabled ? 'block' : 'none';

    updateWatermarkDisplayValues();
    if (watermarkConfig.enabled) createWatermarkLayer();
  }

  function saveWatermarkSettings() { localStorage.setItem('watermarkConfig', JSON.stringify(watermarkConfig)); }

  function updateWatermarkDisplayValues() {
    const colorDisplay = document.getElementById('watermark-color-display');
    const opacityDisplay = document.getElementById('watermark-opacity-display');
    const fontSizeDisplay = document.getElementById('watermark-font-size-display');
    if (colorDisplay) colorDisplay.textContent = watermarkConfig.color;
    if (opacityDisplay) opacityDisplay.textContent = Math.round(watermarkConfig.opacity * 100) + '%';
    if (fontSizeDisplay) fontSizeDisplay.textContent = watermarkConfig.fontSize + 'px';
  }

  function bindWatermarkEvents() {
    const enabledSwitch = document.getElementById('watermark-enabled-switch');
    const textInput = document.getElementById('watermark-text');
    const layoutSelect = document.getElementById('watermark-layout');
    const colorInput = document.getElementById('watermark-color');
    const opacityInput = document.getElementById('watermark-opacity');
    const fontSizeInput = document.getElementById('watermark-font-size');
    const fontFamilySelect = document.getElementById('watermark-font-family');
    const previewBtn = document.getElementById('watermark-preview-btn');
    const settingsContainer = document.getElementById('watermark-settings-container');

    if (enabledSwitch) enabledSwitch.addEventListener('change', function() { watermarkConfig.enabled = this.checked; if (settingsContainer) settingsContainer.style.display = this.checked ? 'block' : 'none'; saveWatermarkSettings(); createWatermarkLayer(); });
    if (textInput) textInput.addEventListener('input', function() { watermarkConfig.text = this.value || '保密内容 请勿外传'; saveWatermarkSettings(); if (watermarkConfig.enabled) createWatermarkLayer(); });
    if (layoutSelect) layoutSelect.addEventListener('change', function() { watermarkConfig.layout = this.value; saveWatermarkSettings(); if (watermarkConfig.enabled) createWatermarkLayer(); });
    if (colorInput) colorInput.addEventListener('input', function() { watermarkConfig.color = this.value; updateWatermarkDisplayValues(); saveWatermarkSettings(); if (watermarkConfig.enabled) createWatermarkLayer(); });
    if (opacityInput) opacityInput.addEventListener('input', function() { watermarkConfig.opacity = parseFloat(this.value); updateWatermarkDisplayValues(); saveWatermarkSettings(); if (watermarkConfig.enabled) createWatermarkLayer(); });
    if (fontSizeInput) fontSizeInput.addEventListener('input', function() { watermarkConfig.fontSize = parseInt(this.value); updateWatermarkDisplayValues(); saveWatermarkSettings(); if (watermarkConfig.enabled) createWatermarkLayer(); });
    if (fontFamilySelect) fontFamilySelect.addEventListener('change', function() { watermarkConfig.fontFamily = this.value; saveWatermarkSettings(); if (watermarkConfig.enabled) createWatermarkLayer(); });
    if (previewBtn) previewBtn.addEventListener('click', function() {
        const wasEnabled = watermarkConfig.enabled;
        watermarkConfig.enabled = true;
        createWatermarkLayer();
        showCustomAlert('预览水印', '水印效果已显示，将在3秒后自动隐藏');
        setTimeout(() => { watermarkConfig.enabled = wasEnabled; createWatermarkLayer(); }, 3000);
      });
  }

  setTimeout(() => { loadWatermarkSettings(); bindWatermarkEvents(); }, 500);

  let resizeTimer;
  window.addEventListener('resize', () => { if (watermarkConfig.enabled) { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { createWatermarkLayer(); }, 300); } });

  // ========== 截图水印功能结束 ==========

// ========== 电池管理 ==========
  let lastKnownBatteryLevel = 1;
  let alertFlags = { hasShown40: false, hasShown20: false, hasShown10: false };
  let batteryAlertTimeout;

  function showBatteryAlert(imageUrl, text) {
    const batteryAlertModal = document.getElementById('battery-alert-modal');
    if (!batteryAlertModal) return;
    clearTimeout(batteryAlertTimeout);
    document.getElementById('battery-alert-image').src = imageUrl;
    document.getElementById('battery-alert-text').textContent = text;
    batteryAlertModal.classList.add('visible');
    const closeAlert = () => {
      batteryAlertModal.classList.remove('visible');
      batteryAlertModal.removeEventListener('click', closeAlert);
    };
    batteryAlertModal.addEventListener('click', closeAlert);
    batteryAlertTimeout = setTimeout(closeAlert, 4000);
  }

  function updateBatteryDisplay(battery) {
    const batteryContainer = document.getElementById('status-bar-battery');
    if (!batteryContainer) return;
    const batteryLevelEl = batteryContainer.querySelector('.battery-level');
    const batteryTextEl = batteryContainer.querySelector('.battery-text');
    const level = Math.floor(battery.level * 100);
    batteryLevelEl.style.width = `${level}%`;
    batteryTextEl.textContent = `${level}`;
    if (battery.charging) batteryContainer.classList.add('charging');
    else batteryContainer.classList.remove('charging');
  }

  function handleBatteryChange(battery) {
    updateBatteryDisplay(battery);
    const level = battery.level;
    if (!battery.charging) {
      if (level <= 0.4 && lastKnownBatteryLevel > 0.4 && !alertFlags.hasShown40) { showBatteryAlert('https://i.postimg.cc/R0Q4TSBx/mmexport1778962596832.gif', '有点饿了，可以去找充电器惹'); alertFlags.hasShown40 = true; }
      if (level <= 0.2 && lastKnownBatteryLevel > 0.2 && !alertFlags.hasShown20) { showBatteryAlert('https://i.postimg.cc/SR5hKjW7/mmexport1778962673107.gif'); alertFlags.hasShown20 = true; }
      if (level <= 0.1 && lastKnownBatteryLevel > 0.1 && !alertFlags.hasShown10) { showBatteryAlert('https://i.postimg.cc/ZKBmMFSV/mmexport1778962810385.gif', '已阵亡，还有30秒爆炸'); alertFlags.hasShown10 = true; }
    }
    if (level > 0.4) alertFlags.hasShown40 = false;
    if (level > 0.2) alertFlags.hasShown20 = false;
    if (level > 0.1) alertFlags.hasShown10 = false;
    lastKnownBatteryLevel = level;
  }

  async function initBatteryManager() {
    if ('getBattery' in navigator) {
      try {
        const battery = await navigator.getBattery();
        lastKnownBatteryLevel = battery.level;
        handleBatteryChange(battery);
        battery.addEventListener('levelchange', () => handleBatteryChange(battery));
        battery.addEventListener('chargingchange', () => {
          handleBatteryChange(battery);
          if (battery.charging) showBatteryAlert('https://i.postimg.cc/FsdvBgv9/mmexport1778962827263.gif', '窝爱泥，电量吃饱饱');
        });
      } catch (err) {
        const batteryText = document.querySelector('.battery-text');
        if (batteryText) batteryText.textContent = 'ᗜωᗜ';
      }
    } else {
      const batteryText = document.querySelector('.battery-text');
      if (batteryText) batteryText.textContent = 'ᗜωᗜ';
    }
  }

  // ========== 全局暴露 ==========
  window.initSystemNotification = initSystemNotification;
  window.initBatteryManager = initBatteryManager;

  function updateUnreadIndicator(count) {
    unreadPostsCount = count;
    localStorage.setItem('unreadPostsCount', count);
    const navItem = document.querySelector('.nav-item[data-view="qzone-screen"]');
    if (!navItem) return;
    const targetSpan = navItem.querySelector('span');
    let indicator = navItem.querySelector('.unread-indicator');
    if (count > 0) {
      if (!indicator) {
        indicator = document.createElement('span');
        indicator.className = 'unread-indicator';
        targetSpan.style.position = 'relative';
        targetSpan.appendChild(indicator);
      }
      indicator.textContent = count > 99 ? '99+' : count;
      indicator.style.display = 'block';
    } else {
      if (indicator) indicator.style.display = 'none';
    }
    if (typeof updateBackButtonUnreadCount === 'function') updateBackButtonUnreadCount();
  }
  window.updateUnreadIndicator = updateUnreadIndicator;

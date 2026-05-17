// ============================================================
// chat-list.js
// 聊天列表模块：showScreen、switchToChatListView、renderChatList、
// createChatListItem、createChatGroupContainer、loadMoreChats、
// showChatListActions、appendLoadMoreChatsButton
// ============================================================

(function () {
  var isFavoritesSelectionMode = false;

  function showScreen(screenId) {
    const currentActiveScreen = document.querySelector('.screen.active');
    if (currentActiveScreen && currentActiveScreen.id === 'draw-guess-screen' && screenId !== 'draw-guess-screen') {
      if (drawGuessState.isActive && drawGuessState.partnerId && drawGuessState.history.length > 1) {
        (async () => {
          try {
            const chat = state.chats[drawGuessState.partnerId];
            if (chat) {
              let gameRecord = `[系统提示：刚刚你们玩了你画我猜游戏]\n\n`;
              drawGuessState.history.forEach(msg => { gameRecord += `${msg.sender}: ${msg.content}\n`; });
              const gameLog = { role: 'system', content: gameRecord, timestamp: Date.now(), isHidden: true, isGrayNotice: true };
              chat.history.push(gameLog);
              await db.chats.put(chat);
            }
          } catch (error) { console.error('保存记录失败:', error); }
        })();
      }
    }

    if (currentActiveScreen && currentActiveScreen.id === 'chat-interface-screen' && screenId !== 'chat-interface-screen' && screenId !== 'voice-call-screen' && screenId !== 'video-call-screen') {
      if (typeof stopChatMessageTtsOnly === 'function') stopChatMessageTtsOnly();
    }

    if (screenId === 'chat-list-screen') {
      renderChatList();
      switchToChatListView('messages-view');
      checkPendingCartNotifications();
    }
    if (screenId === 'api-settings-screen') {
      window.renderApiSettingsProxy();
      if (state.globalSettings.cleanApiSettings && typeof window.openCleanApiSettings === 'function') {
        setTimeout(() => window.openCleanApiSettings(), 50);
      }
    }
    if (screenId === 'wallpaper-screen') window.renderWallpaperScreenProxy();
    if (screenId === 'world-book-screen') window.renderWorldBookScreenProxy();
    if (screenId === 'x-social-screen') window.renderXSocialScreenProxy();
    if (screenId === 'douban-screen') renderDoubanScreen();
    if (screenId === 'online-app-screen' && typeof onlineChatManager !== 'undefined') {
      onlineChatManager.renderChatList();
      onlineChatManager.showView('online-app-list-view');
    }
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const screenToShow = document.getElementById(screenId);
    if (screenToShow) screenToShow.classList.add('active');
    if (screenId === 'chat-interface-screen') window.updateListenTogetherIconProxy(state.activeChatId);
    if (screenId === 'font-settings-screen') {
      loadFontPresetsDropdown();
      document.getElementById('font-url-input').value = state.globalSettings.fontUrl || '';
      applyCustomFont(state.globalSettings.fontUrl || '', true);
      const hasLocalFont = !!state.globalSettings.fontLocalData;
      document.getElementById('font-local-filename').textContent = hasLocalFont ? '已加载本地字体' : '';
      document.getElementById('font-local-clear-btn').style.display = hasLocalFont ? 'inline-block' : 'none';
      const fontSize = state.globalSettings.globalFontSize || 16;
      document.getElementById('font-size-slider').value = fontSize;
      document.getElementById('font-size-value').textContent = fontSize;
      const scope = state.globalSettings.fontScope || { all: true };
      const allCb = document.getElementById('font-scope-all');
      const scopeList = document.getElementById('font-scope-list');
      allCb.checked = !!scope.all;
      scopeList.style.display = scope.all ? 'none' : 'flex';
      document.querySelectorAll('#font-scope-list input[data-scope]').forEach(cb => {
        cb.checked = scope[cb.dataset.scope] !== false;
      });
    }
  }

  function switchToChatListView(viewId) {
    const views = {
      'messages-view': document.getElementById('messages-view'),
      'qzone-screen': document.getElementById('qzone-screen'),
      'favorites-view': document.getElementById('favorites-view'),
      'memories-view': document.getElementById('memories-view'),
      'npc-list-view': document.getElementById('npc-list-view')
    };
    const mainHeader = document.getElementById('main-chat-list-header');
    const mainBottomNav = document.getElementById('chat-list-bottom-nav');
    if (isFavoritesSelectionMode) document.getElementById('favorites-edit-btn').click();
    Object.values(views).forEach(v => v.classList.remove('active'));
    if (views[viewId]) views[viewId].classList.add('active');
    document.querySelectorAll('#chat-list-bottom-nav .nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.view === viewId);
    });
    if (viewId === 'messages-view') { mainHeader.style.display = 'flex'; mainBottomNav.style.display = 'flex'; }
    else { mainHeader.style.display = 'none'; mainBottomNav.style.display = 'none'; }
    if (viewId === 'qzone-screen') { updateUnreadIndicator(0); renderQzoneScreen(); renderQzonePosts(); }
    else if (viewId === 'favorites-view') renderFavoritesScreen();
    else if (viewId === 'npc-list-view') renderNpcListScreen();
  }

  async function renderChatList() {
    const chatListEl = document.getElementById('chat-list');
    chatListEl.innerHTML = '';
    const allChats = Object.values(state.chats).filter(chat => !chat.isOnlineFriend && !chat.isGroupChat).sort((a, b) => {
      const pinDiff = (b.isPinned || false) - (a.isPinned || false);
      if (pinDiff !== 0) return pinDiff;
      return (b.history.slice(-1)[0]?.timestamp || 0) - (a.history.slice(-1)[0]?.timestamp || 0);
    });
    const allGroups = await db.qzoneGroups.toArray();
    if (allChats.length === 0) {
      chatListEl.innerHTML = '<p style="text-align:center; color: #8a8a8a; margin-top: 50px;">点击右上角 "+" 添加聊天</p>';
      return;
    }
    allGroups.forEach(group => {
      const latestChatInGroup = allChats.find(chat => chat.groupId === group.id);
      group.latestTimestamp = latestChatInGroup ? (latestChatInGroup.history.slice(-1)[0]?.timestamp || 0) : 0;
    });
    allGroups.sort((a, b) => b.latestTimestamp - a.latestTimestamp);
    sortedChatListItems = [];
    const processedChatIds = new Set();
    allChats.forEach(chat => { if (chat.isPinned) { sortedChatListItems.push({ type: 'chatItem', chat }); processedChatIds.add(chat.id); } });
    allGroups.forEach(group => {
      const groupChats = allChats.filter(chat => !chat.isPinned && !chat.isGroup && chat.groupId === group.id);
      if (groupChats.length > 0) {
        sortedChatListItems.push({ type: 'groupHeader', group });
        groupChats.forEach(chat => { sortedChatListItems.push({ type: 'chatItem', chat }); processedChatIds.add(chat.id); });
      }
    });
    allChats.forEach(chat => { if (!processedChatIds.has(chat.id)) { sortedChatListItems.push({ type: 'chatItem', chat }); processedChatIds.add(chat.id); } });
    chatListRenderCount = 0;
    loadMoreChats();
  }

  function createChatGroupContainer(group) {
    const groupContainer = document.createElement('div');
    groupContainer.className = 'chat-group-container';
    groupContainer.innerHTML = `<div class="chat-group-header"><span class="arrow">▼</span><span class="group-name">${group.name}</span></div><div class="chat-group-content"></div>`;
    return groupContainer;
  }

  function loadMoreChats() {
    if (isLoadingMoreChats) return;
    const chatListEl = document.getElementById('chat-list');
    const scrollContainer = document.getElementById('messages-view');
    if (!chatListEl || !scrollContainer || chatListRenderCount >= sortedChatListItems.length) return;
    isLoadingMoreChats = true;
    const isInitialLoad = chatListRenderCount === 0;
    const renderContent = () => {
      hideLoader(chatListEl);
      const renderWindow = state.globalSettings.chatListRenderWindow || 30;
      const itemsToAppend = sortedChatListItems.slice(chatListRenderCount, chatListRenderCount + renderWindow);
      const fragment = document.createDocumentFragment();
      let currentGroupContent = chatListEl.querySelector('.chat-group-content:last-of-type');
      itemsToAppend.forEach(item => {
        if (item.type === 'groupHeader') {
          const groupContainer = createChatGroupContainer(item.group); fragment.appendChild(groupContainer);
          currentGroupContent = groupContainer.querySelector('.chat-group-content');
        } else if (item.type === 'chatItem') {
          const listItem = createChatListItem(item.chat);
          if (!listItem) return;
          if (item.chat.groupId && currentGroupContent) currentGroupContent.appendChild(listItem);
          else { fragment.appendChild(listItem); if (!item.chat.groupId) currentGroupContent = null; }
        }
      });
      chatListEl.appendChild(fragment);
      chatListRenderCount += itemsToAppend.length;
      chatListEl.querySelectorAll('.chat-group-header:not([data-has-listener="true"])').forEach(header => {
        header.dataset.hasListener = "true";
        header.addEventListener('click', () => { header.classList.toggle('collapsed'); header.nextElementSibling.classList.toggle('collapsed'); });
      });
      isLoadingMoreChats = false;
      if (scrollContainer.scrollHeight <= scrollContainer.clientHeight && chatListRenderCount < sortedChatListItems.length) loadMoreChats();
    };
    if (isInitialLoad) renderContent();
    else { showLoader(chatListEl, 'bottom'); setTimeout(renderContent, 500); }
  }

  // ==================== 重点修改部分：渲染列表项 ====================
  function createChatListItem(chat) {
    // 内部辅助：超详细时间格式化
    function formatChatTime(timestamp) {
      if (!timestamp) return "";
      const now = new Date();
      const date = new Date(timestamp);
      const diffTime = now - date;
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      const formatHM = (d) => `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
      if (now.toDateString() === date.toDateString()) return formatHM(date);
      const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
      if (yesterday.toDateString() === date.toDateString()) return `昨天 ${formatHM(date)}`;
      const beforeYesterday = new Date(now); beforeYesterday.setDate(now.getDate() - 2);
      if (beforeYesterday.toDateString() === date.toDateString()) return `前天 ${formatHM(date)}`;
      if (diffDays < 7) return ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][date.getDay()];
      if (now.getFullYear() === date.getFullYear()) return `${date.getMonth() + 1}/${date.getDate()}`;
      return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
    }

    try {
      // 1. 获取内容预览 (单聊不再显示在线状态)
      const lastMsgObj = chat.history.filter(msg => !msg.isHidden).slice(-1)[0] || {};
      const timeDisplay = formatChatTime(lastMsgObj.timestamp);
      let lastMsgDisplay = "";

      if (!chat.isGroup && chat.relationship?.status === 'pending_user_approval') {
        lastMsgDisplay = `<span style="color: #ff8c00;">[好友申请] ${chat.relationship.applicationReason || '请求添加你为好友'}</span>`;
      } else if (!chat.isGroup && chat.relationship?.status === 'blocked_by_ai') {
        lastMsgDisplay = `<span style="color: #dc3545;">[你已被对方拉黑]</span>`;
      } else {
        // 统一提取消息内容逻辑
        if (lastMsgObj.type === 'pat_message') lastMsgDisplay = `[系统消息] ${lastMsgObj.content}`;
        else if (lastMsgObj.type === 'transfer') lastMsgDisplay = '[转账]';
        else if (['ai_image', 'user_photo', 'naiimag', 'googleimag'].includes(lastMsgObj.type)) lastMsgDisplay = '[图片]';
        else if (lastMsgObj.type === 'voice_message') lastMsgDisplay = '[语音]';
        else if (typeof lastMsgObj.content === 'string' && STICKER_REGEX.test(lastMsgObj.content)) {
          lastMsgDisplay = lastMsgObj.meaning ? `[表情: ${lastMsgObj.meaning}]` : '[表情]';
        } else if (Array.isArray(lastMsgObj.content)) lastMsgDisplay = `[图片]`;
        else lastMsgDisplay = String(lastMsgObj.content || '...').substring(0, 30);

        if (chat.isGroup && lastMsgObj.senderName && lastMsgObj.type !== 'pat_message') {
          const senderDisplayName = getDisplayNameInGroup(chat, lastMsgObj.senderName);
          lastMsgDisplay = `${senderDisplayName}: ${lastMsgDisplay}`;
        }
      }

      const item = document.createElement('div');
      item.className = 'chat-list-item';
      item.dataset.chatId = chat.id;
      if (chat.isPinned) item.classList.add('pinned');

      const avatar = chat.isGroup ? chat.settings.groupAvatar : chat.settings.aiAvatar;
      const avatarFrameSrc = chat.isGroup ? '' : (chat.settings.aiAvatarFrame || '');
      let avatarHtml = avatarFrameSrc 
        ? `<div class="avatar-with-frame"><img src="${avatar || defaultAvatar}" class="avatar-img"><img src="${avatarFrameSrc}" class="avatar-frame"></div>`
        : `<img src="${avatar || defaultAvatar}" class="avatar">`;
      const avatarGroupHtml = `<div class="avatar-group ${avatarFrameSrc ? 'has-frame' : ''}">${avatarHtml}</div>`;

      // 修改布局结构：添加 name-line 和 msg-line
      item.innerHTML = `
            ${avatarGroupHtml}
            <div class="info">
                <div class="name-line">
                    <span class="name">${chat.name}</span>
                    <span class="chat-time">${timeDisplay}</span>
                </div>
                <div class="msg-line">
                    <div class="last-msg">${lastMsgDisplay}</div>
                    <div class="unread-count-wrapper">
                        <span class="unread-count" style="display: none;">0</span>
                    </div>
                </div>
            </div>
        `;

      const unreadCount = chat.unreadCount || 0;
      const unreadEl = item.querySelector('.unread-count');
      if (unreadCount > 0) { unreadEl.textContent = unreadCount > 99 ? '99+' : unreadCount; unreadEl.style.display = 'inline-flex'; }

      const avatarGroupEl = item.querySelector('.avatar-group');
      if (avatarGroupEl) {
        avatarGroupEl.style.cursor = 'pointer';
        avatarGroupEl.addEventListener('dblclick', (e) => {
          e.stopPropagation(); handleUserPat(chat.id, chat.isGroup ? chat.name : chat.originalName);
        });
      }
      item.querySelector('.info').addEventListener('click', () => openChat(chat.id));

      addLongPressListener(item, async (e) => {
        const action = await showChatListActions(chat);
        if (action === 'pin') { chat.isPinned = !chat.isPinned; await db.chats.put(chat); renderChatList(); }
        else if (action === 'delete') {
          if (await showCustomConfirm('删除', `确认删除与 "${chat.name}" 的对话吗？`)) {
            delete state.chats[chat.id]; await db.chats.delete(chat.id); renderChatList();
          }
        }
      });
      return item;
    } catch (error) { console.error(`渲染错误:`, error); return null; }
  }

  function showChatListActions(chat) {
    return new Promise(resolve => {
      const modal = document.getElementById('chat-list-actions-modal');
      const pinBtn = document.getElementById('chat-list-action-pin');
      const deleteBtn = document.getElementById('chat-list-action-delete');
      const cancelBtn = document.getElementById('chat-list-action-cancel');
      pinBtn.textContent = chat.isPinned ? '取消置顶' : '置顶聊天';
      const newPinBtn = pinBtn.cloneNode(true); pinBtn.parentNode.replaceChild(newPinBtn, pinBtn);
      newPinBtn.onclick = () => { modal.classList.remove('visible'); resolve('pin'); };
      const newDeleteBtn = deleteBtn.cloneNode(true); deleteBtn.parentNode.replaceChild(newDeleteBtn, deleteBtn);
      newDeleteBtn.onclick = () => { modal.classList.remove('visible'); resolve('delete'); };
      const newCancelBtn = cancelBtn.cloneNode(true); cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
      newCancelBtn.onclick = () => { modal.classList.remove('visible'); resolve(null); };
      modal.classList.add('visible');
    });
  }

  window.renderChatList = renderChatList;
  window.loadMoreChats = loadMoreChats;
  window.switchToChatListView = switchToChatListView;
})();

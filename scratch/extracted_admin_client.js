
    let token = localStorage.getItem('admin_token') || '';
    let currentTab = 'overview';

    function showToast(message, type = 'success') {
      const toasts = document.getElementById('toasts');
      const toast = document.createElement('div');
      toast.className = 'toast';
      const icon = type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation';
      const color = type === 'success' ? 'var(--accent-emerald)' : 'var(--accent-rose)';
      toast.innerHTML = `<i class="fa-solid ${icon}" style="color:${color}; font-size:1.2rem;"></i> <span>${message}</span>`;
      toasts.appendChild(toast);
      setTimeout(() => toast.remove(), 4000);
    }

    async function handleLogin(e) {
      e.preventDefault();
      const pass = document.getElementById('pass').value;
      try {
        const res = await fetch('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pass })
        });
        const data = await res.json();
        if (data.success) {
          token = data.token;
          localStorage.setItem('admin_token', token);
          showToast('Connexion réussie ! Bienvenue Admin.');
          renderAppLayout();
          loadTab('overview');
        } else {
          showToast(data.error || 'Mot de passe incorrect', 'error');
        }
      } catch (err) {
        showToast('Erreur de connexion au serveur', 'error');
      }
    }

    function logout() {
      localStorage.removeItem('admin_token');
      token = '';
      location.reload();
    }

    function renderAppLayout() {
      document.getElementById('app').innerHTML = `
        <header>
          <div class="brand">
            <i class="fa-solid fa-shield-cat brand-icon"></i>
            <span>WEREWOLF ADMIN PRO</span>
          </div>
          <div class="header-actions">
            <div class="status-badge"><div class="status-dot"></div> SYSTEM ONLINE</div>
            <button class="btn btn-secondary" onclick="loadTab(currentTab)"><i class="fa-solid fa-rotate-right"></i> Actualiser</button>
            <button class="btn btn-danger" onclick="logout()"><i class="fa-solid fa-power-off"></i> Déconnexion</button>
          </div>
        </header>
        <div class="dashboard-container">
          <sidebar>
            <button class="nav-btn active" id="nav-overview" onclick="loadTab('overview')"><i class="fa-solid fa-chart-pie"></i> Vue d'ensemble</button>
            <button class="nav-btn" id="nav-games" onclick="loadTab('games')"><i class="fa-solid fa-gamepad"></i> Parties en Direct</button>
            <button class="nav-btn" id="nav-players" onclick="loadTab('players')"><i class="fa-solid fa-users"></i> Joueurs & Ban</button>
            <button class="nav-btn" id="nav-groups" onclick="loadTab('groups')"><i class="fa-solid fa-building-user"></i> Groupes Telegram</button>
            <button class="nav-btn" id="nav-backups" onclick="loadTab('backups')"><i class="fa-solid fa-database"></i> Sauvegardes 15J</button>
            <button class="nav-btn" id="nav-broadcast" onclick="loadTab('broadcast')"><i class="fa-solid fa-bullhorn"></i> Annonce Globale</button>
            <button class="nav-btn" id="nav-logs" onclick="loadTab('logs')"><i class="fa-solid fa-terminal"></i> Logs Winston</button>
          </sidebar>
          <main id="main-content">
            <div style="text-align:center; padding:50px;"><i class="fa-solid fa-spinner fa-spin fa-2x"></i> Chargement...</div>
          </main>
        </div>
      `;
    }

    function setActiveNav(tab) {
      currentTab = tab;
      document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
      const activeBtn = document.getElementById('nav-' + tab);
      if (activeBtn) activeBtn.classList.add('active');
    }

    async function apiFetch(endpoint, options = {}) {
      options.headers = { ...options.headers, 'Authorization': 'Bearer ' + token };
      const res = await fetch(endpoint, options);
      if (res.status === 401) {
        showToast('Session expirée', 'error');
        logout();
        throw new Error('Unauthorized');
      }
      return res.json();
    }

    async function loadTab(tab) {
      setActiveNav(tab);
      const main = document.getElementById('main-content');

      if (tab === 'overview') {
        const data = await apiFetch('/api/admin/stats');
        const s = data.stats;
        main.innerHTML = `
          <div class="page-header"><h1 class="page-title">📊 Vue d'Ensemble du Bot</h1></div>
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-icon" style="background:rgba(139,92,246,0.15); color:var(--accent-purple);"><i class="fa-solid fa-gamepad"></i></div>
              <div class="stat-lbl">Parties Actives</div>
              <div class="stat-val">${s.activeGames}</div>
            </div>
            <div class="stat-card">
              <div class="stat-icon" style="background:rgba(16,185,129,0.15); color:var(--accent-emerald);"><i class="fa-solid fa-users"></i></div>
              <div class="stat-lbl">Joueurs Enregistrés</div>
              <div class="stat-val">${s.totalPlayers}</div>
            </div>
            <div class="stat-card">
              <div class="stat-icon" style="background:rgba(6,182,212,0.15); color:var(--accent-cyan);"><i class="fa-solid fa-building-user"></i></div>
              <div class="stat-lbl">Groupes Configurés</div>
              <div class="stat-val">${s.totalGroups}</div>
            </div>
            <div class="stat-card">
              <div class="stat-icon" style="background:rgba(245,158,11,0.15); color:var(--accent-amber);"><i class="fa-solid fa-clock"></i></div>
              <div class="stat-lbl">Uptime Système</div>
              <div class="stat-val">${s.uptimeSeconds}s</div>
            </div>
          </div>
          <div class="table-container" style="padding:24px;">
            <h3 style="margin-bottom:16px;"><i class="fa-solid fa-microchip"></i> Ressources Système</h3>
            <p><strong>Node.js Version :</strong> ${s.nodeVersion}</p>
            <p style="margin-top:8px;"><strong>Mémoire Heap Utilisée :</strong> ${(s.memory.heapUsed / 1024 / 1024).toFixed(1)} MB / ${(s.memory.heapTotal / 1024 / 1024).toFixed(1)} MB</p>
            <p style="margin-top:8px;"><strong>RSS Total :</strong> ${(s.memory.rss / 1024 / 1024).toFixed(1)} MB</p>
          </div>
        `;
      } else if (tab === 'games') {
        const data = await apiFetch('/api/admin/games');
        let rows = data.games.map(g => `
          <tr>
            <td><strong>${g.groupId}</strong></td>
            <td><span class="badge badge-purple">${g.gameMode}</span></td>
            <td><span class="badge badge-emerald">${g.phase}</span></td>
            <td>${g.aliveCount} / ${g.playerCount} vivants</td>
            <td>
              <button class="btn btn-secondary" onclick="viewGameDetails('${g.groupId}')"><i class="fa-solid fa-eye"></i> Inspecter</button>
              <button class="btn btn-danger" onclick="killGame('${g.groupId}')"><i class="fa-solid fa-trash"></i> Purger</button>
            </td>
          </tr>
        `).join('');

        main.innerHTML = `
          <div class="page-header"><h1 class="page-title">🎮 Spectateur des Parties en Direct</h1></div>
          <div class="table-container">
            <table>
              <thead>
                <tr><th>Chat ID Groupe</th><th>Mode</th><th>Phase</th><th>Vivants</th><th>Actions</th></tr>
              </thead>
              <tbody>${rows || '<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-muted);">Aucune partie active en ce moment</td></tr>'}</tbody>
            </table>
          </div>
        `;
      } else if (tab === 'players') {
        const data = await apiFetch('/api/admin/players');
        let rows = data.players.map(p => `
          <tr>
            <td><strong>${p.username ? '@' + p.username : (p.displayName || 'Joueur #' + p.telegramId)}</strong><br><small style="color:var(--text-muted);">ID: ${p.telegramId}</small></td>
            <td>${p.isBanned ? '<span class="badge badge-rose">BANNIS</span>' : '<span class="badge badge-emerald">ACTIF</span>'}</td>
            <td>${p.banReason || '—'}</td>
            <td>
              <button class="btn ${p.isBanned ? 'btn-primary' : 'btn-danger'}" onclick="togglePlayerBan('${p.telegramId}', ${!p.isBanned})">
                <i class="fa-solid ${p.isBanned ? 'fa-user-check' : 'fa-user-slash'}"></i> ${p.isBanned ? 'Débannir' : 'Bannir'}
              </button>
            </td>
          </tr>
        `).join('');

        main.innerHTML = `
          <div class="page-header"><h1 class="page-title">👥 Modération des Joueurs</h1></div>
          <div class="table-container">
            <table>
              <thead>
                <tr><th>Joueur</th><th>Statut</th><th>Raison du Ban</th><th>Actions</th></tr>
              </thead>
              <tbody>${rows || '<tr><td colspan="4" style="text-align:center; padding:30px; color:var(--text-muted);">Aucun joueur inscrit</td></tr>'}</tbody>
            </table>
          </div>
        `;
      } else if (tab === 'groups') {
        const data = await apiFetch('/api/admin/groups');
        let rows = data.groups.map(g => `
          <tr>
            <td><strong>${g.title || 'Groupe sans nom'}</strong><br><small style="color:var(--text-muted);">ID: ${g.chatId}</small></td>
            <td><span class="badge badge-purple">${g.gameMode}</span></td>
            <td>${g.isBanned ? '<span class="badge badge-rose">BLOQUÉ</span>' : '<span class="badge badge-emerald">AUTORISÉ</span>'}</td>
            <td>
              <button class="btn ${g.isBanned ? 'btn-primary' : 'btn-danger'}" onclick="toggleGroupBan('${g.chatId}', ${!g.isBanned})">
                <i class="fa-solid ${g.isBanned ? 'fa-unlock' : 'fa-lock'}"></i> ${g.isBanned ? 'Débloquer' : 'Bloquer'}
              </button>
            </td>
          </tr>
        `).join('');

        main.innerHTML = `
          <div class="page-header"><h1 class="page-title">🏢 Modération des Groupes Telegram</h1></div>
          <div class="table-container">
            <table>
              <thead>
                <tr><th>Groupe</th><th>Mode Préféré</th><th>Statut</th><th>Actions</th></tr>
              </thead>
              <tbody>${rows || '<tr><td colspan="4" style="text-align:center; padding:30px; color:var(--text-muted);">Aucun groupe enregistré</td></tr>'}</tbody>
            </table>
          </div>
        `;
      } else if (tab === 'backups') {
        const data = await apiFetch('/api/admin/backups');
        let rows = data.backups.map(b => `
          <tr>
            <td><strong>${b.filename}</strong></td>
            <td>${(b.sizeBytes / 1024).toFixed(1)} KB</td>
            <td>${new Date(b.createdAt).toLocaleString('fr-FR')}</td>
            <td>
              <button class="btn btn-secondary" onclick="restoreBackup('${b.filename}')"><i class="fa-solid fa-clock-rotate-left"></i> Restaurer</button>
            </td>
          </tr>
        `).join('');

        main.innerHTML = `
          <div class="page-header">
            <h1 class="page-title">🗄️ Sauvegardes DB (Rétention 15 Jours)</h1>
            <button class="btn btn-primary" onclick="createBackup()"><i class="fa-solid fa-plus"></i> Nouvelle Sauvegarde</button>
          </div>
          <div class="table-container">
            <table>
              <thead>
                <tr><th>Nom du Fichier</th><th>Taille</th><th>Date de Création</th><th>Action</th></tr>
              </thead>
              <tbody>${rows || '<tr><td colspan="4" style="text-align:center; padding:30px; color:var(--text-muted);">Aucune sauvegarde disponible</td></tr>'}</tbody>
            </table>
          </div>
        `;
      } else if (tab === 'broadcast') {
        main.innerHTML = `
          <div class="page-header"><h1 class="page-title">📢 Annonce Globale Telegram</h1></div>
          <div class="table-container" style="padding:32px; max-width:700px;">
            <p style="margin-bottom:20px; color:var(--text-muted);">Envoyer un message de maintenance ou une notification à tous les groupes actifs.</p>
            <textarea id="broadcast-msg" class="input-field" rows="6" placeholder="Saisissez votre message ici... (Support HTML léger)"></textarea>
            <button class="btn btn-primary" onclick="sendBroadcast()"><i class="fa-solid fa-paper-plane"></i> Diffuser le Message</button>
          </div>
        `;
      } else if (tab === 'logs') {
        const data = await apiFetch('/api/admin/logs');
        main.innerHTML = `
          <div class="page-header">
            <h1 class="page-title">🪵 Logs Système Winston (Dernières Lignes)</h1>
            <button class="btn btn-secondary" onclick="loadTab('logs')"><i class="fa-solid fa-rotate-right"></i> Rafraîchir Logs</button>
          </div>
          <div class="log-box">${data.logs || 'Aucun log enregistré'}</div>
        `;
      }
    }

    async function viewGameDetails(groupId) {
      try {
        const data = await apiFetch('/api/admin/games');
        const game = (data.games || []).find(g => String(g.groupId) === String(groupId));
        if (!game) return showToast('Partie introuvable', 'error');

        let playersRows = (game.players || []).map(p => `
          <tr>
            <td><strong>${p.name || ('Joueur #' + p.id)}</strong><br><small style="color:var(--text-muted);">ID: ${p.id}</small></td>
            <td><span class="badge badge-purple">${p.role || 'Inconnu'}</span></td>
            <td>${p.isAlive ? '<span class="badge badge-emerald">VIVANT</span>' : '<span class="badge badge-rose">MORT</span>'}</td>
            <td>${p.isBot ? '🤖 Bot' : '👤 Joueur'}</td>
          </tr>
        `).join('');

        const modalHtml = `
          <div class="modal-overlay active" id="game-modal" onclick="if(event.target===this)closeModal()">
            <div class="modal-card" style="max-width:650px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                <h2 style="font-size:1.3rem; margin:0;"><i class="fa-solid fa-gamepad" style="color:var(--accent-purple);"></i> Inspection Groupe ${game.groupId}</h2>
                <button class="btn btn-secondary" onclick="closeModal()" style="padding:6px 12px;"><i class="fa-solid fa-xmark"></i></button>
              </div>
              <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border); padding:16px; border-radius:12px; margin-bottom:20px; font-size:0.9rem;">
                <p><strong>Mode :</strong> <span class="badge badge-purple">${game.gameMode}</span> | <strong>Phase :</strong> <span class="badge badge-emerald">${game.phase}</span> | <strong>Jour :</strong> #${game.dayCount}</p>
                <p style="margin-top:8px;"><strong>Joueurs Vivants :</strong> ${game.aliveCount} / ${game.playerCount}</p>
              </div>
              <h4 style="margin-bottom:12px;"><i class="fa-solid fa-users"></i> Composition des Joueurs & Rôles Secrets</h4>
              <div class="table-container" style="max-height:260px; overflow-y:auto; margin-bottom:24px;">
                <table>
                  <thead>
                    <tr><th>Joueur</th><th>Rôle Secret</th><th>Statut</th><th>Type</th></tr>
                  </thead>
                  <tbody>${playersRows || '<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--text-muted);">Aucun joueur trouvé</td></tr>'}</tbody>
                </table>
              </div>
              <div style="display:flex; gap:12px; justify-content:flex-end;">
                <button class="btn btn-danger" onclick="killGame('${game.groupId}'); closeModal();"><i class="fa-solid fa-trash"></i> Purger cette Partie</button>
                <button class="btn btn-secondary" onclick="closeModal()">Fermer</button>
              </div>
            </div>
          </div>
        `;

        closeModal();
        document.body.insertAdjacentHTML('beforeend', modalHtml);
      } catch (err) {
        showToast("Erreur lors de l'inspection de la partie", "error");
      }
    }

    function closeModal() {
      const modal = document.getElementById('game-modal');
      if (modal) modal.remove();
    }

    async function killGame(chatId) {
      if (confirm('Purger immédiatement la partie dans le groupe ' + chatId + ' ?')) {
        const res = await apiFetch('/api/admin/games/' + chatId + '/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'kill_game' })
        });
        showToast(res.message || 'Partie purgée !');
        loadTab('games');
      }
    }

    async function togglePlayerBan(telegramId, ban) {
      const reason = ban ? prompt('Raison du bannissement :') : null;
      if (ban && !reason) return;
      const res = await apiFetch('/api/admin/players/' + telegramId + '/ban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ban, reason })
      });
      showToast(ban ? 'Joueur banni' : 'Joueur débanni');
      loadTab('players');
    }

    async function toggleGroupBan(chatId, ban) {
      const res = await apiFetch('/api/admin/groups/' + chatId + '/ban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ban })
      });
      showToast(ban ? 'Groupe bloqué' : 'Groupe débloqué');
      loadTab('groups');
    }

    async function createBackup() {
      showToast("Création de la sauvegarde en cours...");
      const res = await apiFetch('/api/admin/backups/create', { method: 'POST' });
      showToast(res.message || 'Sauvegarde créée !');
      loadTab('backups');
    }

    async function restoreBackup(filename) {
      if (confirm('ATTENTION: Restaurer la base de données à partir de ' + filename + ' ?')) {
        const res = await apiFetch('/api/admin/backups/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename })
        });
        showToast(res.message || 'Restauration effectuée !');
      }
    }

    async function sendBroadcast() {
      const input = document.getElementById('broadcast-msg');
      const message = input ? input.value : '';
      if (!message || !message.trim()) return showToast('Veuillez saisir un message', 'error');
      
      try {
        showToast("Diffusion de l'annonce en cours...");
        const res = await apiFetch('/api/admin/broadcast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message })
        });
        if (res.success) {
          showToast(res.message || 'Annonce diffusée avec succès !');
          if (input) input.value = '';
        } else {
          showToast(res.error || 'Erreur lors de la diffusion', 'error');
        }
      } catch (err) {
        showToast("Erreur lors de l'envoi de l'annonce", "error");
      }
    }

    if (token) {
      renderAppLayout();
      loadTab('overview');
    }
  
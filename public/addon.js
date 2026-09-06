/* ============================================================
 * Stockroom — add-on module (v2.1)
 * Loaded AFTER /app.js. Hooks into the existing app without
 * modifying any working file.
 *
 * v2.1 changes (bug fix pass):
 *   - All injected SVG icons now use innerHTML strings to match
 *     the v1 nav-link markup exactly, so they render reliably.
 *   - Topbar gets a clean Export / Import / Scan group + the
 *     language switcher. The confusing "↧ movements" download
 *     button is gone.
 *   - A new #admin page (admin-only) links every admin feature.
 *   - Language switcher now runs after every page render and
 *     walks all data-i18n nodes including those we inject.
 *   - Search input gets a proper border + focus ring.
 *   - Reorder button on Alerts page now actually opens the v1
 *     stock-in dialog by clicking the right buttons.
 * ============================================================ */
(function () {
  'use strict';
  if (window.__stockroomAddon) return;
  window.__stockroomAddon = true;

  // ---- tiny helpers (re-derived locally to avoid coupling) ----
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const toast = (msg, kind = '') => {
    const wrap = $('#toast-wrap');
    if (!wrap) { console.log('[toast]', msg); return; }
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 280); }, 3200);
  };
  const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => (
    { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]
  ));
  const fmtDate = s => {
    if (!s) return '—';
    const d = new Date(s.replace(' ', 'T') + 'Z');
    if (isNaN(d)) return s;
    return d.toLocaleString();
  };
  const fmtMoney = (n) => {
    if (!Number.isFinite(+n)) return '—';
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(+n);
  };

  // Build a single icon-bearing element by innerHTML — same shape
  // the v1 nav links use, so the symbol resolves reliably.
  // We emit BOTH href and xlink:href on <use> because some browsers
  // (older Samsung Browser, JSDOM) don't resolve href on namespaced
  // <use> elements even when inline; xlink:href is the universal fallback.
  const iconHTML = (id, size = 20) => {
    const cls = size === 18 ? 'i-18' : 'i-20';
    return `<svg class="${cls}" aria-hidden="true"><use href="#icon-${id}" xlink:href="#icon-${id}"></use></svg>`;
  };
  const mkIconBtn = (id, label, onClick, cls = 'btn btn-ghost', size = 18) => {
    // For icon-only buttons (`.icon-btn`) the CSS sets a fixed 32×32 box
    // meant to hold only the icon glyph. Rendering the label text in
    // addition squashes the icon and leaks the word "Remove" into the
    // table cell. Skip the label span in that case; the button's title
    // attribute (set below) still conveys the action to screen readers
    // and tooltips.
    const iconOnly = cls.split(/\s+/).includes('icon-btn');
    const btn = document.createElement('button');
    btn.className = cls;
    if (iconOnly) {
      btn.title = label;
      btn.innerHTML = iconHTML(id, size);
    } else {
      btn.title = label;
      btn.innerHTML = iconHTML(id, size) + '<span data-i18n="' + label + '"></span>';
    }
    btn.addEventListener('click', onClick);
    return btn;
  };
  const mkNavLink = (route, icon, label) => {
    const a = document.createElement('a');
    a.href = '#' + route;
    a.dataset.route = route;
    a.className = 'nav-link';
    a.dataset.i18n = label;
    a.innerHTML = iconHTML(icon, 20) + '<span data-i18n="' + label + '"></span>';
    a.addEventListener('click', () => {
      $$('.nav-link').forEach(n => n.classList.toggle('active', n.dataset.route === route));
    });
    return a;
  };

  // ---- State ----
  const state = {
    lang: localStorage.getItem('sm_lang') || 'en',
    user: null,
  };
  window.__addonState = state;

  // ---- i18n ----
  const I18N = {
    en: {
      dashboard: 'Dashboard', items: 'Items', movements: 'Movements', people: 'People',
      alerts: 'Alerts', requesters: 'Requesters', departments: 'Departments', scan: 'Scan',
      admin: 'Admin', settings: 'Settings', account: 'My account',
      export_items: 'Export items', import_items: 'Import items',
      search_placeholder: 'Search items, SKUs…',
      sign_out: 'Sign out',
      new_item: 'New item', stock_in: 'Stock in', stock_out: 'Stock out',
      low_stock: 'Low stock', on_hand: 'On hand', min: 'Min', category: 'Category', status: 'Status',
      sku: 'SKU', name: 'Name', email: 'Email', phone: 'Phone', description: 'Description',
      actions: 'Actions', new_requester: 'New requester', new_department: 'New department',
      remove: 'Remove', cancel: 'Cancel', create: 'Create', save: 'Save',
      supplier: 'Supplier', delivery_note: 'Delivery note', entry_type: 'Entry type',
      requester: 'Requester', department: 'Department', comment: 'Comment',
      quantity: 'Quantity', reason: 'Reason', reorder: 'Reorder',
      opening: 'Opening stock', purchase: 'Purchase order', transfer: 'Transfer in', ret: 'Return',
      session_warning: 'You will be signed out in 1 minute due to inactivity.',
      session_expired: 'Your session has expired. Please sign in again.',
      scan_placeholder: 'Scan or type SKU…', look_up: 'Look up',
      no_alerts: 'No items are below their minimum stock level.',
      no_requesters: 'No requesters yet.', no_departments: 'No departments yet.',
      admin_title: 'Admin', admin_subtitle: 'System overview and admin actions',
      users_mgmt: 'Users', settings_link: 'Settings',
      import_export: 'Import / Export', scan_link: 'Scan a code',
      session_timeout: 'Idle timeout (minutes)', default_lang: 'Default language',
      session_saved: 'Settings saved', imported: 'Imported', skipped: 'Skipped',
      move_for: 'Move for', out_of: 'out of', low: 'Low', out: 'Out of stock', ok: 'OK',
      last_movement: 'Last movement',
      inventory_value: 'Inventory value', out_of_stock: 'Out of stock',
      all_categories: 'all categories',
      low_stock_only: 'Low stock only',
      recent_activity: 'Recent activity', last_10: 'Last 10 movements',
      top_consumed: 'Most-consumed items (30 days)', by_movement_count: 'by movement count',
      on_hand: 'On hand', min: 'Min', stock_level: 'Stock level',
      status: 'Status', unit_price: 'Unit price', purchase_price: 'Purchase price',
      total_value: 'Total value', updated: 'Updated', sku: 'SKU',
      name: 'Name', value: 'Value',
      sign_in: 'Sign in', username: 'Username', password: 'Password',
      quantity: 'Quantity', reason: 'Reason', cancel: 'Cancel',
      save: 'Save', create_item: 'Create item', remove: 'Remove',
      edit_item: 'Edit item', new_requester: 'New requester',
      create: 'Create', default_creds: 'Default credentials:',
      brand_sub: 'Office furnishings manager',
      add_stock: 'Add stock', remove_stock: 'Remove stock',
      source_supplier: 'Source / supplier', taken_by: 'Taken by',
      reorder_soon: 'reorder soon', zero_on_hand: 'zero on hand',
      last_7_days: 'last 7 days', units: 'units',
      no_items_match: 'No items match your filters.',
      no_movements_yet: 'No movements yet.',
      no_users_yet: 'No users yet.',
      when: 'When', type: 'Type', qty: 'Qty', person: 'Person',
      counterparty: 'Counterparty', item: 'Item',
      inventory: 'Inventory', inventory_title: 'Inventory audit',
      inventory_link: 'Inventory audit',
      inventory_subtitle: 'Count each item and enter the actual quantity. Saving records the difference as a stock movement.',
      inventory_counted: 'Counted',
      inventory_delta: 'Delta',
      inventory_audit_note: 'Audit note',
      inventory_audit_note_placeholder: 'optional note',
      inventory_save: 'Save audit',
      inventory_save_done: 'Audit applied',
      inventory_edited: 'Rows edited',
      inventory_deltas: 'With delta',
      inventory_no_changes: 'Enter at least one counted quantity first.',
      audit_reason: 'Inventory audit',
      edit: 'Edit', email: 'Email', manager: 'Manager', department_none: '— none —',
      backup_title: 'Backup & restore',
      backup_subtitle: 'Download a snapshot of the database, or upload a previously-saved snapshot to restore. Restoring replaces the current data.',
      backup_download: 'Download backup',
      backup_restore: 'Restore from file',
      backup_done: 'Backup downloaded',
      backup_restored: 'Restore complete — refresh to see the new data',
      backup_confirm_restore: 'Restoring replaces ALL current data with the uploaded file. This cannot be undone. Continue?',
      audit_title: 'Audit log',
      audit_subtitle: 'Last 100 changes',
      audit_when: 'When',
      audit_who: 'Who',
      audit_action: 'Action',
      audit_entity: 'Entity',
      audit_changes: 'Changes',
      audit_loading: 'Loading…',
      audit_empty: 'No audit entries yet.',
      // Stockie (AI assistant widget)
      stockie_title: 'Stockie',
      stockie_fab_title: 'Open Stockie (AI assistant)',
      stockie_placeholder: 'Ask Stockie anything…',
      stockie_send: 'Send',
      stockie_clear: 'Clear chat',
      stockie_thinking: 'Stockie is thinking…',
      stockie_status_checking: 'checking…',
      stockie_status_ready: (n) => 'ready · ' + n + ' tools',
      stockie_status_unavailable: 'unavailable',
      stockie_status_not_configured: 'not configured',
      stockie_status_sign_in: 'sign in to use',
      stockie_status_error: 'error',
      stockie_not_configured_long: 'Stockie is not configured on this server. Ask your admin to set OMNIROUTE_BASE_URL, OMNIROUTE_MODEL, OMNIROUTE_API_KEY in the server .env.',
      stockie_greeting: "Hi! I'm Stockie, your Stockroom assistant. Ask me about stock levels, who took what, or tell me what to add or remove. Writes always need your confirmation.",
      stockie_cancelled: '✕ Cancelled',
      stockie_applying: '⏳ Applying…',
      stockie_done: (label) => '✅ Done — ' + label,
      stockie_failed: (msg) => '❌ Failed: ' + msg,
      stockie_reads_summary: (n) => '🔍 ' + n + ' read' + (n === 1 ? '' : 's'),
      stockie_propose: '📝',
      stockie_confirm: 'Confirm',
      stockie_cancel: 'Cancel',
      stockie_error_prefix: 'Error: ',
      stockie_network_error: (msg) => 'Network error: ' + msg,
    },
    fr: {
      dashboard: 'Tableau de bord', items: 'Articles', movements: 'Mouvements', people: 'Personnes',
      alerts: 'Alertes', requesters: 'Demandeurs', departments: 'Services', scan: 'Scanner',
      admin: 'Administration', settings: 'Paramètres', account: 'Mon compte',
      export_items: 'Exporter articles', import_items: 'Importer articles',
      search_placeholder: 'Rechercher articles, SKU…',
      sign_out: 'Se déconnecter',
      new_item: 'Nouvel article', stock_in: 'Entrée', stock_out: 'Sortie',
      low_stock: 'Stock faible', on_hand: 'En stock', min: 'Min', category: 'Catégorie', status: 'Statut',
      sku: 'SKU', name: 'Nom', email: 'Email', phone: 'Téléphone', description: 'Description',
      actions: 'Actions', new_requester: 'Nouveau demandeur', new_department: 'Nouveau service',
      remove: 'Supprimer', cancel: 'Annuler', create: 'Créer', save: 'Enregistrer',
      supplier: 'Fournisseur', delivery_note: 'Bon de livraison', entry_type: 'Type d\'entrée',
      requester: 'Demandeur', department: 'Service', comment: 'Commentaire',
      quantity: 'Quantité', reason: 'Motif', reorder: 'Réapprovisionner',
      opening: 'Stock initial', purchase: 'Bon de commande', transfer: 'Transfert', ret: 'Retour',
      session_warning: 'Vous serez déconnecté dans 1 minute pour cause d\'inactivité.',
      session_expired: 'Votre session a expiré. Veuillez vous reconnecter.',
      scan_placeholder: 'Scanner ou saisir le SKU…', look_up: 'Rechercher',
      no_alerts: 'Aucun article sous le seuil de stock.',
      no_requesters: 'Aucun demandeur.', no_departments: 'Aucun service.',
      admin_title: 'Administration', admin_subtitle: 'Vue d\'ensemble et actions d\'administration',
      users_mgmt: 'Utilisateurs', settings_link: 'Paramètres',
      import_export: 'Import / Export', scan_link: 'Scanner un code',
      session_timeout: 'Délai d\'inactivité (minutes)', default_lang: 'Langue par défaut',
      session_saved: 'Paramètres enregistrés', imported: 'Importés', skipped: 'Ignorés',
      move_for: 'Mouvement pour', out_of: 'sur', low: 'Faible', out: 'Rupture', ok: 'OK',
      last_movement: 'Dernier mouvement',
      inventory_value: 'Valeur du stock', out_of_stock: 'En rupture',
      all_categories: 'toutes catégories',
      low_stock_only: 'Stock faible uniquement',
      recent_activity: 'Activité récente', last_10: '10 derniers mouvements',
      top_consumed: 'Articles les plus consommés (30 jours)', by_movement_count: 'par nombre de mouvements',
      on_hand: 'En stock', min: 'Min', stock_level: 'Niveau de stock',
      status: 'Statut', unit_price: 'Prix unitaire', purchase_price: 'Prix d\'achat',
      total_value: 'Valeur totale', updated: 'Mis à jour', sku: 'SKU',
      name: 'Nom', value: 'Valeur',
      sign_in: 'Se connecter', username: 'Nom d\'utilisateur', password: 'Mot de passe',
      quantity: 'Quantité', reason: 'Motif', cancel: 'Annuler',
      save: 'Enregistrer', create_item: 'Créer l\'article', remove: 'Supprimer',
      edit_item: 'Modifier l\'article', new_requester: 'Nouvelle personne',
      create: 'Créer', default_creds: 'Identifiants par défaut :',
      brand_sub: 'Gestionnaire d\'ameublement de bureau',
      add_stock: 'Ajouter du stock', remove_stock: 'Retirer du stock',
      source_supplier: 'Source / fournisseur', taken_by: 'Pris par',
      reorder_soon: 'à recommander bientôt', zero_on_hand: 'rupture de stock',
      last_7_days: '7 derniers jours', units: 'unités',
      no_items_match: 'Aucun article ne correspond à vos filtres.',
      no_movements_yet: 'Aucun mouvement pour l\'instant.',
      no_users_yet: 'Aucun utilisateur pour l\'instant.',
      when: 'Date', type: 'Type', qty: 'Qté', person: 'Personne',
      counterparty: 'Contrepartie', item: 'Article',
      inventory: 'Inventaire', inventory_title: 'Audit d\'inventaire',
      inventory_link: 'Audit d\'inventaire',
      inventory_subtitle: 'Comptez chaque article et saisissez la quantité réelle. L\'enregistrement crée un mouvement de stock pour la différence.',
      inventory_counted: 'Compté',
      inventory_delta: 'Écart',
      inventory_audit_note: 'Note d\'audit',
      inventory_audit_note_placeholder: 'note facultative',
      inventory_save: 'Enregistrer l\'audit',
      inventory_save_done: 'Audit appliqué',
      inventory_edited: 'Lignes modifiées',
      inventory_deltas: 'Avec écart',
      inventory_no_changes: 'Saisissez au moins une quantité comptée.',
      audit_reason: 'Audit d\'inventaire',
      edit: 'Modifier', email: 'Email', manager: 'Manager', department_none: '— aucun —',
      backup_title: 'Sauvegarde & restauration',
      backup_subtitle: 'Téléchargez une sauvegarde de la base, ou uploadez une sauvegarde existante pour restaurer. La restauration remplace les données actuelles.',
      backup_download: 'Télécharger la sauvegarde',
      backup_restore: 'Restaurer depuis un fichier',
      backup_done: 'Sauvegarde téléchargée',
      backup_restored: 'Restauration terminée — actualisez pour voir les nouvelles données',
      backup_confirm_restore: 'La restauration remplace TOUTES les données actuelles. Cette action est irréversible. Continuer ?',
      audit_title: 'Journal d\'audit',
      audit_subtitle: 'Les 100 dernières modifications',
      audit_when: 'Quand',
      audit_who: 'Qui',
      audit_action: 'Action',
      audit_entity: 'Entité',
      audit_changes: 'Modifications',
      audit_loading: 'Chargement…',
      audit_empty: 'Aucune entrée d\'audit.',
      // Stockie (AI assistant widget)
      stockie_title: 'Stockie',
      stockie_fab_title: 'Ouvrir Stockie (assistant IA)',
      stockie_placeholder: 'Demandez anything à Stockie…',
      stockie_send: 'Envoyer',
      stockie_clear: 'Effacer',
      stockie_thinking: 'Stockie réfléchit…',
      stockie_status_checking: 'vérification…',
      stockie_status_ready: (n) => 'prêt · ' + n + ' outils',
      stockie_status_unavailable: 'indisponible',
      stockie_status_not_configured: 'non configuré',
      stockie_status_sign_in: 'connectez-vous',
      stockie_status_error: 'erreur',
      stockie_not_configured_long: 'Stockie n\'est pas configuré sur ce serveur. Demandez à votre admin de définir OMNIROUTE_BASE_URL, OMNIROUTE_MODEL, OMNIROUTE_API_KEY dans le .env du serveur.',
      stockie_greeting: "Bonjour ! Je suis Stockie, votre assistant Stockroom. Demandez-moi les niveaux de stock, qui a pris quoi, ou dites-moi quoi ajouter ou retirer. Les modifications demandent toujours votre confirmation.",
      stockie_cancelled: '✕ Annulé',
      stockie_applying: '⏳ Application…',
      stockie_done: (label) => '✅ Terminé — ' + label,
      stockie_failed: (msg) => '❌ Échec : ' + msg,
      stockie_reads_summary: (n) => '🔍 ' + n + ' lecture' + (n === 1 ? '' : 's'),
      stockie_propose: '📝',
      stockie_confirm: 'Confirmer',
      stockie_cancel: 'Annuler',
      stockie_error_prefix: 'Erreur : ',
      stockie_network_error: (msg) => 'Erreur réseau : ' + msg,
    },
    ar: {
      dashboard: 'لوحة التحكم', items: 'الأصناف', movements: 'الحركات', people: 'الأشخاص',
      alerts: 'التنبيهات', requesters: 'الطالبون', departments: 'الأقسام', scan: 'مسح',
      admin: 'الإدارة', settings: 'الإعدادات', account: 'حسابي',
      export_items: 'تصدير الأصناف', import_items: 'استيراد الأصناف',
      search_placeholder: 'بحث عن صنف، رمز…',
      sign_out: 'تسجيل الخروج',
      new_item: 'صنف جديد', stock_in: 'إضافة', stock_out: 'سحب',
      low_stock: 'مخزون منخفض', on_hand: 'متوفر', min: 'الحد الأدنى', category: 'الفئة', status: 'الحالة',
      sku: 'الرمز', name: 'الاسم', email: 'البريد', phone: 'الهاتف', description: 'الوصف',
      actions: 'إجراءات', new_requester: 'طالب جديد', new_department: 'قسم جديد',
      remove: 'حذف', cancel: 'إلغاء', create: 'إنشاء', save: 'حفظ',
      supplier: 'المورّد', delivery_note: 'إيصال التسليم', entry_type: 'نوع الإدخال',
      requester: 'الطالب', department: 'القسم', comment: 'تعليق',
      quantity: 'الكمية', reason: 'السبب', reorder: 'إعادة طلب',
      opening: 'مخزون افتتاحي', purchase: 'أمر شراء', transfer: 'تحويل', ret: 'إرجاع',
      session_warning: 'ستسجل خروجك خلال دقيقة بسبب عدم النشاط.',
      session_expired: 'انتهت جلستك. الرجاء تسجيل الدخول مرة أخرى.',
      scan_placeholder: 'امسح أو اكتب الرمز…', look_up: 'بحث',
      no_alerts: 'لا توجد أصناف تحت الحد الأدنى.',
      no_requesters: 'لا يوجد طالبون.', no_departments: 'لا توجد أقسام.',
      admin_title: 'الإدارة', admin_subtitle: 'نظرة عامة على النظام وإجراءات الإدارة',
      users_mgmt: 'المستخدمون', settings_link: 'الإعدادات',
      import_export: 'استيراد / تصدير', scan_link: 'مسح رمز',
      session_timeout: 'مدة الخمول (دقائق)', default_lang: 'اللغة الافتراضية',
      session_saved: 'تم حفظ الإعدادات', imported: 'تم الاستيراد', skipped: 'تم التخطي',
      move_for: 'حركة لـ', out_of: 'من', low: 'منخفض', out: 'منتهي', ok: 'جيد',
      last_movement: 'آخر حركة',
      inventory_value: 'قيمة المخزون', out_of_stock: 'منتهي من المخزون',
      all_categories: 'كل الفئات',
      low_stock_only: 'المخزون المنخفض فقط',
      recent_activity: 'النشاط الأخير', last_10: 'آخر 10 حركات',
      top_consumed: 'الأصناف الأكثر استهلاكاً (30 يوماً)', by_movement_count: 'حسب عدد الحركات',
      on_hand: 'متوفر', min: 'الحد الأدنى', stock_level: 'مستوى المخزون',
      status: 'الحالة', unit_price: 'سعر الوحدة', purchase_price: 'سعر الشراء',
      total_value: 'القيمة الإجمالية', updated: 'محدّث', sku: 'الرمز',
      name: 'الاسم', value: 'القيمة',
      sign_in: 'تسجيل الدخول', username: 'اسم المستخدم', password: 'كلمة المرور',
      quantity: 'الكمية', reason: 'السبب', cancel: 'إلغاء',
      save: 'حفظ', create_item: 'إنشاء الصنف', remove: 'حذف',
      edit_item: 'تعديل الصنف', new_requester: 'شخص جديد',
      create: 'إنشاء', default_creds: 'بيانات الاعتماد الافتراضية:',
      brand_sub: 'مدير أثاث المكاتب',
      add_stock: 'إضافة مخزون', remove_stock: 'سحب مخزون',
      source_supplier: 'المصدر / المورّد', taken_by: 'أخذه',
      reorder_soon: 'يُرجى إعادة الطلب قريباً', zero_on_hand: 'مخزون صفري',
      last_7_days: 'آخر 7 أيام', units: 'وحدات',
      no_items_match: 'لا توجد أصناف تطابق عوامل التصفية.',
      no_movements_yet: 'لا توجد حركات بعد.',
      no_users_yet: 'لا يوجد مستخدمون بعد.',
      when: 'التاريخ', type: 'النوع', qty: 'الكمية', person: 'الشخص',
      counterparty: 'الطرف الآخر', item: 'الصنف',
      inventory: 'الجرد', inventory_title: 'تدقيق الجرد',
      inventory_link: 'تدقيق الجرد',
      inventory_subtitle: 'عدّ كل صنف وأدخل الكمية الفعلية. يحفظ الحفظ الفرق كحركة مخزون.',
      inventory_counted: 'المعدود',
      inventory_delta: 'الفرق',
      inventory_audit_note: 'ملاحظة التدقيق',
      inventory_audit_note_placeholder: 'ملاحظة اختيارية',
      inventory_save: 'حفظ التدقيق',
      inventory_save_done: 'تم تطبيق التدقيق',
      inventory_edited: 'صفوف معدّلة',
      inventory_deltas: 'لها فرق',
      inventory_no_changes: 'أدخل كمية معدودة واحدة على الأقل.',
      audit_reason: 'تدقيق الجرد',
      edit: 'تعديل', email: 'البريد الإلكتروني', manager: 'مدير', department_none: '— لا شيء —',
      backup_title: 'النسخ الاحتياطي والاستعادة',
      backup_subtitle: 'نزّل نسخة احتياطية من قاعدة البيانات، أو ارفع نسخة محفوظة لاستعادتها. الاستعادة تستبدل البيانات الحالية.',
      backup_download: 'تنزيل النسخة الاحتياطية',
      backup_restore: 'استعادة من ملف',
      backup_done: 'تم تنزيل النسخة الاحتياطية',
      backup_restored: 'اكتملت الاستعادة — حدّث لرؤية البيانات الجديدة',
      backup_confirm_restore: 'الاستعادة تستبدل جميع البيانات الحالية. لا يمكن التراجع. هل تريد المتابعة؟',
      audit_title: 'سجل التدقيق',
      audit_subtitle: 'آخر 100 تغيير',
      audit_when: 'متى',
      audit_who: 'من',
      audit_action: 'الإجراء',
      audit_entity: 'الكيان',
      audit_changes: 'التغييرات',
      audit_loading: 'جارٍ التحميل…',
      audit_empty: 'لا توجد إدخالات تدقيق.',
      // Stockie (AI assistant widget)
      stockie_title: 'ستوكي',
      stockie_fab_title: 'افتح ستوكي (مساعد ذكاء اصطناعي)',
      stockie_placeholder: 'اسأل ستوكي عن أي شيء…',
      stockie_send: 'إرسال',
      stockie_clear: 'مسح',
      stockie_thinking: 'ستوكي يفكّر…',
      stockie_status_checking: 'جارٍ التحقق…',
      stockie_status_ready: (n) => 'جاهز · ' + n + ' أدوات',
      stockie_status_unavailable: 'غير متاح',
      stockie_status_not_configured: 'غير مُهيأ',
      stockie_status_sign_in: 'سجّل الدخول أولاً',
      stockie_status_error: 'خطأ',
      stockie_not_configured_long: 'ستوكي غير مُهيأ على هذا الخادم. اطلب من المدير ضبط OMNIROUTE_BASE_URL و OMNIROUTE_MODEL و OMNIROUTE_API_KEY في ملف .env.',
      stockie_greeting: 'مرحباً! أنا ستوكي، مساعدك في ستوكروم. اسألني عن مستويات المخزون، أو من أخذ ماذا، أو أخبرني بما تريد إضافته أو سحبه. التعديلات تحتاج دائماً إلى موافقتك.',
      stockie_cancelled: '✕ تم الإلغاء',
      stockie_applying: '⏳ جارٍ التطبيق…',
      stockie_done: (label) => '✅ تم — ' + label,
      stockie_failed: (msg) => '❌ فشل: ' + msg,
      stockie_reads_summary: (n) => '🔍 ' + n + ' قراءة',
      stockie_propose: '📝',
      stockie_confirm: 'تأكيد',
      stockie_cancel: 'إلغاء',
      stockie_error_prefix: 'خطأ: ',
      stockie_network_error: (msg) => 'خطأ في الشبكة: ' + msg,
    },
  };
  const t = (k, ...args) => {
    const v = (I18N[state.lang] && I18N[state.lang][k]) || I18N.en[k] || k;
    return typeof v === 'function' ? v(...args) : v;
  };
  // Expose for other scripts (assistant.js widget).
  window.__smI18n = { I18N, t, getLang: () => state.lang, applyLang };

  // Maps English label text that the v1 SPA renders directly into the DOM
  // (table headers, card titles, status chips, KPI labels, etc.) to i18n
  // keys. The applyLang() walker uses this to translate strings that v1
  // doesn't tag with data-i18n. Each entry is the trimmed source string
  // (case-sensitive — v1's strings are consistent).
  const I18N_TEXT = [
    'Dashboard', 'Items', 'Movements', 'People',
    'Low stock only', 'All categories', 'New item',
    'Stock in', 'Stock out', 'Recent activity',
    'Most-consumed items (30 days)', 'Last 10 movements',
    'Out of stock', 'Low stock', 'In stock',
    'On hand', 'Min qty', 'Stock level', 'Status', 'Unit price',
    'Purchase price', 'Total value', 'Location', 'Category',
    'Updated', 'SKU', 'Name', 'Value',
    'Sign in', 'Sign out', 'Username', 'Password',
    'Quantity', 'Reason', 'Cancel', 'Save changes', 'Create item', 'Delete',
    'Edit item', 'New person', 'Create user', 'Remove',
    'Default credentials:',
    'Office furnishings manager',
    'Add stock', 'Remove stock', 'Source / supplier', 'Taken by',
    'Items tracked', 'Inventory value', 'reorder soon', 'zero on hand', 'all categories',
    'last 7 days', 'units', 'No items match your filters.',
    'No movements yet. Add some stock or hand items out from the Items page.',
    'No movements yet.', 'No users yet.',
    'Stock movements', 'by movement count', 'Item', 'Movements',
    'When', 'Type', 'Qty', 'Person', 'Counterparty',
    'Inventory', 'Inventory audit', 'Counted', 'Delta',
    'Audit note', 'Save audit', 'Rows edited', 'With delta',
  ];
  const I18N_KEY = [
    'dashboard', 'items', 'movements', 'people',
    'low_stock_only', 'all_categories', 'new_item',
    'stock_in', 'stock_out', 'recent_activity',
    'top_consumed', 'last_10',
    'out', 'low', 'ok',  // status chips
    'on_hand', 'min', 'stock_level', 'status', 'unit_price',
    'purchase_price', 'total_value', 'location', 'category',
    'updated', 'sku', 'name', 'value',
    'sign_in', 'sign_out', 'username', 'password',
    'quantity', 'reason', 'cancel', 'save', 'create_item', 'remove',
    'edit_item', 'new_requester', 'create', 'remove',
    'default_creds',
    'brand_sub',
    'add_stock', 'remove_stock', 'source_supplier', 'taken_by',
    'items', 'inventory_value', 'reorder_soon', 'zero_on_hand', 'all_categories',
    'last_7_days', 'units', 'no_items_match',
    'no_movements_yet',
    'no_movements_yet', 'no_users_yet',
    'movements', 'by_movement_count', 'item', 'movements',
    'when', 'type', 'qty', 'person', 'counterparty',
    'inventory', 'inventory_title', 'inventory_counted', 'inventory_delta',
    'inventory_audit_note', 'inventory_save', 'inventory_edited', 'inventory_deltas',
  ];

  function applyLang() {
    document.documentElement.lang = state.lang;
    document.documentElement.dir = (state.lang === 'ar') ? 'rtl' : 'ltr';
    // Translate every data-i18n node in the document
    $$('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      const val = (I18N[state.lang] && I18N[state.lang][key]) || I18N.en[key];
      if (val == null) return;
      // Preserve any SVG icon as the first child
      const svg = el.querySelector(':scope > svg');
      if (svg) {
        // Text comes after the svg
        el.innerHTML = '';
        el.appendChild(svg);
        el.appendChild(document.createTextNode(val));
      } else {
        el.textContent = val;
      }
    });
    // Translate elements with data-i18n-placeholder (input placeholders)
    $$('[data-i18n-placeholder]').forEach(el => {
      const key = el.dataset.i18nPlaceholder;
      const val = (I18N[state.lang] && I18N[state.lang][key]) || I18N.en[key];
      if (val) el.placeholder = val;
    });
    // Title attribute
    $$('[data-i18n-title]').forEach(el => {
      const key = el.dataset.i18nTitle;
      const val = (I18N[state.lang] && I18N[state.lang][key]) || I18N.en[key];
      if (val) el.title = val;
    });
    // Walk v1's hardcoded text nodes and rewrite any whose text exactly
    // matches an English source string. Skips elements inside elements
    // that already carry data-i18n (so we don't double-translate).
    const idx = new Map();
    for (let i = 0; i < I18N_TEXT.length; i++) idx.set(I18N_TEXT[i], I18N_KEY[i]);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentNode;
        if (!p || p.nodeType !== 1) return NodeFilter.FILTER_REJECT;
        if (p.closest('[data-i18n]')) return NodeFilter.FILTER_REJECT;
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let n; while ((n = walker.nextNode())) {
      const t0 = n.nodeValue.trim();
      // Only translate when the entire trimmed text matches an English
      // source string — avoids mangling phrases like "Stock in: 3 units".
      const key = idx.get(t0);
      if (!key) continue;
      const val = (I18N[state.lang] && I18N[state.lang][key]) || I18N.en[key];
      if (val && val !== t0) {
        // Preserve leading/trailing whitespace
        const lead = n.nodeValue.match(/^\s*/)[0];
        const trail = n.nodeValue.match(/\s*$/)[0];
        n.nodeValue = lead + val + trail;
      }
    }
  }

  // ---- api() ----
  async function api(path, opts = {}) {
    const headers = Object.assign({}, opts.headers || {});
    const tk = localStorage.getItem('sm_jwt');
    if (tk) headers['Authorization'] = 'Bearer ' + tk;
    let body = opts.body;
    if (body && typeof body !== 'string' && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    } else if (typeof body === 'string') {
      headers['Content-Type'] = 'text/csv; charset=utf-8';
    }
    const res = await fetch('/api' + path, Object.assign({ credentials: 'include' }, opts, { headers, body }));
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
    if (!res.ok) throw new Error((json && json.error) || ('HTTP ' + res.status));
    return json === null ? {} : json;
  }

  // ---- Nav links (inserted after the Movements link) ----
  function injectNav() {
    const nav = $('.sidebar nav');
    if (!nav || nav.dataset.addonInjected) return;
    nav.dataset.addonInjected = '1';
    // Hide the v1 People nav link — user management now lives on the
    // Admin page (and remains reachable via the in-page "Users" link).
    const peopleLink = nav.querySelector('a[data-route="users"]');
    if (peopleLink) peopleLink.style.display = 'none';
    nav.appendChild(mkNavLink('alerts', 'alert', 'alerts'));
    nav.appendChild(mkNavLink('requesters', 'users', 'requesters'));
    nav.appendChild(mkNavLink('departments', 'shield', 'departments'));
    // No sidebar entry for the Scan page — the topbar Scan button opens
    // the same lookup via the floating mini-modal from any page, so the
    // full-page #scan route is redundant in the nav.
    nav.appendChild(mkNavLink('inventory', 'box', 'inventory'));
    nav.appendChild(mkNavLink('admin', 'edit', 'admin'));
  }

  // ---- Topbar extras: language switcher + Import/Export + Scan ----
  function injectTopbar() {
    const right = $('.topbar .topbar-right');
    if (!right || right.dataset.addonInjected) return;
    right.dataset.addonInjected = '1';

    // Scan button (global). Opens the v1 floating Scan mini-modal so
    // the user can scan from any page without losing context. The
    // standalone #scan page still exists for keyboard-wedge users who
    // want a dedicated full-screen scanner.
    right.appendChild(mkIconBtn('search', 'scan', () => {
      if (typeof window.__smOpenScanMini === 'function') {
        window.__smOpenScanMini((it) => {
          toast((it.name ? it.name : it.sku) + ' — opened', 'good');
          if (typeof window.__smOpenItemDetail === 'function') window.__smOpenItemDetail(it.id);
        });
      } else {
        location.hash = '#scan';
      }
    }, 'btn btn-ghost'));
    // Import items
    right.appendChild(mkIconBtn('plus', 'import_items', () => openImportModal(), 'btn btn-ghost'));
    // Export items (Excel .xlsx — CSV is converted to a workbook client-side)
    right.appendChild(mkIconBtn('arrow-down', 'export_items', () => downloadXlsx('/api/export/items', 'items.xlsx', 'Items'), 'btn btn-ghost'));
    // Language switcher
    const langSel = document.createElement('select');
    langSel.className = 'lang-select';
    langSel.title = 'Language';
    for (const opt of [['en','EN'],['fr','FR'],['ar','AR']]) {
      const o = document.createElement('option');
      o.value = opt[0]; o.textContent = opt[1];
      if (opt[0] === state.lang) o.selected = true;
      langSel.appendChild(o);
    }
    langSel.addEventListener('change', e => {
      state.lang = e.target.value;
      localStorage.setItem('sm_lang', state.lang);
      applyLang();
    });
    right.appendChild(langSel);
  }

  async function downloadXlsx(url, name, sheetName) {
    try {
      const tk = localStorage.getItem('sm_jwt');
      const res = await fetch(url, { headers: tk ? { Authorization: 'Bearer ' + tk } : {}, credentials: 'include' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const csv = await res.text();
      // Convert server CSV to a real Excel workbook using SheetJS
      // (xlsx.full.min.js, loaded before addon.js). The two-step
      // read → sheet_to_json → aoa_to_sheet round-trip preserves the
      // header row and cell values, including any quoted CSV strings.
      const parsed = XLSX.read(csv, { type: 'string' });
      const firstSheet = parsed.Sheets[parsed.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, blankrows: false });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName || 'Sheet1');
      const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast('Downloaded ' + name, 'good');
    } catch (e) { toast(e.message, 'bad'); }
  }

  function openImportModal() {
    const body = document.createElement('form');
    body.onsubmit = async (e) => {
      e.preventDefault();
      const file = body.querySelector('input[name=file]').files[0];
      const csv  = body.querySelector('textarea[name=csv]').value;
      try {
        let payload = '';
        if (file) {
          // Read .xlsx or .csv file from disk. Convert Excel to CSV before
          // sending to the server (server endpoint accepts CSV only).
          const buf = await file.arrayBuffer();
          if (/\.xlsx?$/i.test(file.name)) {
            const wb = XLSX.read(buf, { type: 'array' });
            const first = wb.SheetNames[0];
            payload = XLSX.utils.sheet_to_csv(wb.Sheets[first]);
          } else {
            payload = new TextDecoder().decode(buf);
          }
        } else if (csv && csv.trim()) {
          payload = csv;
        } else {
          toast('Pick a file or paste CSV first', 'bad');
          return;
        }
        const r = await api('/import/items', { method: 'POST', body: payload });
        toast(`${t('imported')}: ${r.imported || 0}, ${t('skipped')}: ${r.skipped || 0}`, 'good');
        $('#modal-root').hidden = true; $('#modal-body').innerHTML = '';
        const r2 = location.hash.replace('#', '');
        if (r2 === 'items' || r2 === '' || r2 === 'dashboard') {
          window.dispatchEvent(new Event('hashchange'));
        }
      } catch (err) { toast(err.message, 'bad'); }
    };
    body.innerHTML = `
      <p class="muted" style="margin-top:0">Excel or CSV columns: <code>sku,name,category,unit,quantity,min_quantity,location,supplier</code></p>
      <div class="field">
        <label data-i18n="import_items"></label>
        <input type="file" name="file" accept=".xlsx,.csv">
      </div>
      <div class="field">
        <label>…or paste CSV below</label>
        <textarea name="csv" rows="6" style="width:100%;font-family:ui-monospace,monospace;background:var(--bg-2);color:var(--text-0);border:1px solid var(--line);border-radius:6px;padding:8px" placeholder="sku,name,category,unit,quantity,min_quantity,location,supplier
PEN-001,Ballpoint pen,Stationery,pcs,100,20,Drawer A,Acme"></textarea>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="imp-cancel" data-i18n="cancel"></button>
        <button type="submit" class="btn btn-primary" data-i18n="import_items"></button>
      </div>`;
    body.querySelector('#imp-cancel').addEventListener('click', () => {
      $('#modal-root').hidden = true; $('#modal-body').innerHTML = '';
    });
    $('#modal-title').textContent = t('import_items');
    const mb = $('#modal-body'); mb.innerHTML = ''; mb.appendChild(body);
    $('#modal-root').hidden = false;
    applyLang();
  }

  // ---- Page renderers ----
  async function renderAlerts(root) {
    root.innerHTML = '';
    let data;
    try { data = await api('/alerts'); } catch (e) { root.appendChild(card('Alerts', e.message, true)); return; }
    const alerts = (data && data.alerts) || [];
    const cardEl = document.createElement('div');
    cardEl.className = 'card';
    cardEl.innerHTML = `
      <div class="card-head">
        <h3 data-i18n="alerts"></h3>
        <span class="muted">${alerts.length} item${alerts.length === 1 ? '' : 's'}</span>
      </div>
      ${alerts.length === 0
        ? `<div class="empty" data-i18n="no_alerts"></div>`
        : `<div style="overflow-x:auto"><table>
            <thead><tr>
              <th data-i18n="sku"></th>
              <th data-i18n="name"></th>
              <th data-i18n="category"></th>
              <th data-i18n="on_hand"></th>
              <th data-i18n="min"></th>
              <th data-i18n="status"></th>
              <th data-i18n="last_movement"></th>
              <th></th>
            </tr></thead>
            <tbody></tbody>
          </table></div>`}`;
    const tbody = cardEl.querySelector('tbody');
    if (tbody) {
      for (const a of alerts) {
        const tr = document.createElement('tr');
        if (a.quantity === 0) tr.className = 'out';
        const status = a.quantity === 0
          ? `<span class="chip bad" data-i18n="out"></span>`
          : `<span class="chip warn" data-i18n="low"></span>`;
        tr.innerHTML = `
          <td><span class="tag">${escapeHtml(a.sku)}</span></td>
          <td>${escapeHtml(a.name)}</td>
          <td><span class="chip neutral">${escapeHtml(a.category)}</span></td>
          <td><strong>${a.quantity}</strong> <span class="muted">${escapeHtml(a.unit || '')}</span></td>
          <td>${a.min_quantity}</td>
          <td>${status}</td>
          <td class="muted">${escapeHtml(fmtDate(a.last_movement_at))}</td>
          <td></td>`;
        const btn = mkIconBtn('plus', 'reorder', () => openReorder(a), 'btn btn-good', 18);
        tr.lastElementChild.appendChild(btn);
        tbody.appendChild(tr);
      }
    }
    root.appendChild(cardEl);
    applyLang();
  }

  function openReorder(item) {
    // Reorder = go to the Items page and pre-open the stock-in dialog for this item.
    // The v1 app exposes window.__app or we can use the v1 openMoveDialog by clicking
    // a row. As a safe fallback, open a custom stock-in modal that posts to the API.
    openMoveDialogPublic(item, 'in');
  }

  async function renderRequesters(root) {
    root.innerHTML = '';
    let data;
    try { data = await api('/requesters'); } catch (e) { data = { requesters: [] }; }
    const list = data.requesters || [];
    const cardEl = document.createElement('div');
    cardEl.className = 'card';
    cardEl.innerHTML = `
      <div class="card-head">
        <h3 data-i18n="requesters"></h3>
        <span class="muted">${list.length} people</span>
      </div>
      ${list.length === 0
        ? `<div class="empty" data-i18n="no_requesters"></div>`
        : `<div style="overflow-x:auto"><table>
            <thead><tr>
              <th data-i18n="name"></th>
              <th data-i18n="email"></th>
              <th data-i18n="phone"></th>
              <th data-i18n="actions"></th>
            </tr></thead>
            <tbody></tbody>
          </table></div>`}`;
    const tbody = cardEl.querySelector('tbody');
    if (tbody) {
      for (const r of list) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${escapeHtml(r.name)}</td>
          <td>${r.email ? escapeHtml(r.email) : '<span class="muted">—</span>'}</td>
          <td>${r.phone ? escapeHtml(r.phone) : '<span class="muted">—</span>'}</td>
          <td></td>`;
        const del = mkIconBtn('trash', 'remove', () => removeRequester(r), 'icon-btn', 18);
        tr.lastElementChild.appendChild(del);
        tbody.appendChild(tr);
      }
    }
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    toolbar.innerHTML = '<div class="grow"></div>';
    toolbar.appendChild(mkIconBtn('plus', 'new_requester', () => openRequesterEditor(), 'btn btn-primary', 18));
    root.appendChild(toolbar);
    root.appendChild(cardEl);
    applyLang();
  }

  function openRequesterEditor() {
    const body = document.createElement('form');
    body.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      try {
        await api('/requesters', { method: 'POST', body: Object.fromEntries(fd.entries()) });
        toast('Requester added', 'good');
        $('#modal-root').hidden = true; $('#modal-body').innerHTML = '';
        renderRequesters($('#view-root'));
      } catch (err) { toast(err.message, 'bad'); }
    };
    body.innerHTML = `
      <div class="field"><label data-i18n="name"></label><input type="text" name="name" required></div>
      <div class="row-2">
        <div class="field"><label data-i18n="email"></label><input type="email" name="email"></div>
        <div class="field"><label data-i18n="phone"></label><input type="text" name="phone"></div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="rq-cancel" data-i18n="cancel"></button>
        <button type="submit" class="btn btn-primary" data-i18n="create"></button>
      </div>`;
    body.querySelector('#rq-cancel').addEventListener('click', () => {
      $('#modal-root').hidden = true; $('#modal-body').innerHTML = '';
    });
    $('#modal-title').textContent = t('new_requester');
    const mb = $('#modal-body'); mb.innerHTML = ''; mb.appendChild(body);
    $('#modal-root').hidden = false;
    applyLang();
  }

  function removeRequester(r) {
    if (!confirm(`Remove ${r.name}?`)) return;
    api('/requesters/' + r.id, { method: 'DELETE' })
      .then(() => { toast('Removed', 'good'); renderRequesters($('#view-root')); })
      .catch(e => toast(e.message, 'bad'));
  }

  async function renderDepartments(root) {
    root.innerHTML = '';
    let data;
    try { data = await api('/departments'); } catch (e) { data = { departments: [] }; }
    const list = data.departments || [];
    const cardEl = document.createElement('div');
    cardEl.className = 'card';
    cardEl.innerHTML = `
      <div class="card-head">
        <h3 data-i18n="departments"></h3>
        <span class="muted">${list.length} service${list.length === 1 ? '' : 's'}</span>
      </div>
      ${list.length === 0
        ? `<div class="empty" data-i18n="no_departments"></div>`
        : `<div style="overflow-x:auto"><table>
            <thead><tr>
              <th data-i18n="name"></th>
              <th data-i18n="description"></th>
              <th data-i18n="actions"></th>
            </tr></thead>
            <tbody></tbody>
          </table></div>`}`;
    const tbody = cardEl.querySelector('tbody');
    if (tbody) {
      for (const d of list) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${escapeHtml(d.name)}</td>
          <td>${d.description ? escapeHtml(d.description) : '<span class="muted">—</span>'}</td>
          <td></td>`;
        const actions = tr.lastElementChild;
        actions.style.whiteSpace = 'nowrap';
        const edit = document.createElement('button');
        edit.className = 'icon-btn';
        edit.title = 'Edit';
        edit.innerHTML = iconHTML('edit', 18);
        edit.addEventListener('click', () => openDeptEditor(d));
        actions.appendChild(edit);
        const del = mkIconBtn('trash', 'remove', () => removeDept(d), 'icon-btn', 18);
        del.style.marginLeft = '4px';
        actions.appendChild(del);
        tbody.appendChild(tr);
      }
    }
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    toolbar.innerHTML = '<div class="grow"></div>';
    toolbar.appendChild(mkIconBtn('plus', 'new_department', () => openDeptEditor(null), 'btn btn-primary', 18));
    root.appendChild(toolbar);
    root.appendChild(cardEl);
    applyLang();
  }

  // Editable dept editor. `dept === null` means create; otherwise update.
  function openDeptEditor(dept) {
    const editing = !!dept;
    const body = document.createElement('form');
    body.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      try {
        if (editing) {
          await api('/departments/' + dept.id, { method: 'PUT', body: Object.fromEntries(fd.entries()) });
          toast('Department updated', 'good');
        } else {
          await api('/departments', { method: 'POST', body: Object.fromEntries(fd.entries()) });
          toast('Department added', 'good');
        }
        $('#modal-root').hidden = true; $('#modal-body').innerHTML = '';
        renderDepartments($('#view-root'));
      } catch (err) { toast(err.message, 'bad'); }
    };
    body.innerHTML = `
      <div class="field"><label data-i18n="name"></label><input type="text" name="name" required value="${editing ? escapeHtml(dept.name) : ''}"></div>
      <div class="field"><label data-i18n="description"></label><textarea name="description" rows="2">${editing ? escapeHtml(dept.description || '') : ''}</textarea></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="dp-cancel" data-i18n="cancel"></button>
        <button type="submit" class="btn btn-primary" data-i18n="${editing ? 'save' : 'create'}"></button>
      </div>`;
    body.querySelector('#dp-cancel').addEventListener('click', () => {
      $('#modal-root').hidden = true; $('#modal-body').innerHTML = '';
    });
    $('#modal-title').textContent = editing ? t('edit') + ' — ' + dept.name : t('new_department');
    const mb = $('#modal-body'); mb.innerHTML = ''; mb.appendChild(body);
    $('#modal-root').hidden = false;
    applyLang();
  }

  function removeDept(d) {
    if (!confirm(`Remove ${d.name}?`)) return;
    api('/departments/' + d.id, { method: 'DELETE' })
      .then(() => { toast('Removed', 'good'); renderDepartments($('#view-root')); })
      .catch(e => toast(e.message, 'bad'));
  }

  // ---- Admin page ----
  async function renderAdmin(root) {
    root.innerHTML = '';
    if (!state.user || state.user.role !== 'admin') {
      root.appendChild(card(t('admin'), 'Admins only.', true));
      applyLang(); return;
    }
    let summary = null, s = null;
    try {
      [summary, s] = await Promise.all([api('/stats/summary'), api('/settings')]);
    } catch { /* leave nulls */ }
    const t0 = (summary && summary.totals) || {};
    const wrap = document.createElement('div');
    wrap.className = 'kpi-grid';
    const kpi = (label, value, sub) => {
      const d = document.createElement('div');
      d.className = 'kpi';
      d.innerHTML = `<div class="kpi-label" data-i18n="${label}"></div><div class="kpi-value">${value}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ''}`;
      return d;
    };
    wrap.appendChild(kpi('items', t0.item_count || 0, ''));
    wrap.appendChild(kpi('inventory_value', fmtMoney(t0.inventory_value || 0), t('all categories')));
    wrap.appendChild(kpi('low_stock', t0.low_stock_count || 0, ''));
    wrap.appendChild(kpi('out_of_stock', t0.out_of_stock_count || 0, ''));
    const links = document.createElement('div');
    links.className = 'kpi-grid';
    links.style.marginTop = '14px';
    const linkCard = (label, hash, icon) => {
      const a = document.createElement('a');
      a.href = hash;
      a.className = 'card';
      a.style.cursor = 'pointer';
      a.style.textDecoration = 'none';
      a.innerHTML = `<div class="row" style="gap:10px;align-items:center">${iconHTML(icon, 20)}<strong data-i18n="${label}"></strong></div>`;
      return a;
    };
    links.appendChild(linkCard('users_mgmt', '#users', 'users'));
    links.appendChild(linkCard('requesters', '#requesters', 'users'));
    links.appendChild(linkCard('departments', '#departments', 'shield'));
    links.appendChild(linkCard('inventory_link', '#inventory', 'box'));
    links.appendChild(linkCard('import_export', '#items', 'arrow-down'));
    links.appendChild(linkCard('scan_link', '#scan', 'search'));

    // Settings form
    const settings = document.createElement('div');
    settings.className = 'card';
    settings.style.marginTop = '14px';
    settings.innerHTML = `
      <div class="card-head"><h3 data-i18n="settings_link"></h3></div>
      <div class="row-2">
        <div class="field"><label data-i18n="session_timeout"></label>
          <input id="set-timeout" type="number" min="1" max="240" value="${(s && s.session_timeout_min) || 30}"></div>
        <div class="field"><label data-i18n="default_lang"></label>
          <select id="set-lang">
            <option value="en">English</option>
            <option value="fr">Français</option>
            <option value="ar">العربية</option>
          </select></div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-primary" id="set-save" data-i18n="save"></button>
      </div>`;
    settings.querySelector('#set-lang').value = (s && s.default_lang) || state.lang;
    settings.querySelector('#set-save').addEventListener('click', async () => {
      try {
        await api('/settings', { method: 'PUT', body: {
          session_timeout_min: parseInt(settings.querySelector('#set-timeout').value, 10) || 30,
          default_lang: settings.querySelector('#set-lang').value,
        }});
        localStorage.setItem('sm_idle_min', String(parseInt(settings.querySelector('#set-timeout').value, 10) || 30));
        toast(t('session_saved'), 'good');
        resetIdle();
      } catch (e) { toast(e.message, 'bad'); }
    });

    const header = document.createElement('div');
    header.innerHTML = `<h2 style="margin:0 0 12px" data-i18n="admin_title"></h2><p class="muted" style="margin:0 0 12px" data-i18n="admin_subtitle"></p>`;
    root.appendChild(header);
    root.appendChild(wrap);
    root.appendChild(links);

    // ---- Backup / Restore card ----
    const backup = document.createElement('div');
    backup.className = 'card';
    backup.style.marginTop = '14px';
    backup.innerHTML = `
      <div class="card-head">
        <h3 data-i18n="backup_title"></h3>
      </div>
      <p class="muted" data-i18n="backup_subtitle" style="margin:0 0 12px"></p>
      <div class="modal-actions">
        <button type="button" class="btn btn-primary" id="bk-download">
          ${iconHTML('arrow-down', 18)}<span data-i18n="backup_download"></span>
        </button>
        <input type="file" id="bk-restore" accept=".sqlite,.db" style="display:none">
        <button type="button" class="btn btn-warn" id="bk-restore-btn">
          ${iconHTML('plus', 18)}<span data-i18n="backup_restore"></span>
        </button>
      </div>
      <p class="muted" id="bk-status" style="margin:10px 0 0;font-size:12px"></p>`;
    root.appendChild(backup);
    backup.querySelector('#bk-download').addEventListener('click', () => {
      // Fetch the backup endpoint with the JWT and stream the response
      // to a downloadable file. Using a fetch + blob keeps the JWT in
      // the Authorization header (an <a download> can't set headers).
      const tk = localStorage.getItem('sm_jwt');
      fetch('/api/backup.sqlite', { headers: { Authorization: 'Bearer ' + tk } })
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
        .then(blob => {
          const a = document.createElement('a');
          const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          a.href = URL.createObjectURL(blob);
          a.download = 'stockroom-backup-' + stamp + '.sqlite';
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
          toast(t('backup_done'), 'good');
        })
        .catch(e => toast(e.message, 'bad'));
    });
    const restoreBtn = backup.querySelector('#bk-restore-btn');
    const restoreInput = backup.querySelector('#bk-restore');
    restoreBtn.addEventListener('click', () => restoreInput.click());
    restoreInput.addEventListener('change', async () => {
      const f = restoreInput.files[0];
      if (!f) return;
      if (!confirm(t('backup_confirm_restore'))) { restoreInput.value = ''; return; }
      const tk = localStorage.getItem('sm_jwt');
      backup.querySelector('#bk-status').textContent = 'Uploading…';
      try {
        // Send the file as a raw binary body with the right Content-Type
        // so express.raw() picks it up on the server.
        const res = await fetch('/api/restore.sqlite', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/octet-stream' },
          body: f,
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
        backup.querySelector('#bk-status').textContent = body.note || 'Restored.';
        toast(t('backup_restored'), 'good');
      } catch (e) {
        backup.querySelector('#bk-status').textContent = 'Failed: ' + e.message;
        toast(e.message, 'bad');
      }
      restoreInput.value = '';
    });

    // ---- Audit log card ----
    const auditCard = document.createElement('div');
    auditCard.className = 'card';
    auditCard.style.marginTop = '14px';
    auditCard.innerHTML = `
      <div class="card-head">
        <h3 data-i18n="audit_title"></h3>
        <span class="muted" data-i18n="audit_subtitle"></span>
      </div>
      <div style="overflow-x:auto;max-height:420px;overflow-y:auto">
        <table id="audit-table">
          <thead><tr>
            <th data-i18n="audit_when"></th>
            <th data-i18n="audit_who"></th>
            <th data-i18n="audit_action"></th>
            <th data-i18n="audit_entity"></th>
            <th data-i18n="audit_changes"></th>
          </tr></thead>
          <tbody><tr><td colspan="5" class="muted" data-i18n="audit_loading"></td></tr></tbody>
        </table>
      </div>`;
    root.appendChild(auditCard);
    api('/audit-log?limit=100').then(r => {
      const tbody = auditCard.querySelector('tbody');
      const entries = (r && r.entries) || [];
      tbody.innerHTML = '';
      if (entries.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="muted" data-i18n="audit_empty"></td></tr>`;
        applyLang(); return;
      }
      for (const e of entries) {
        const tr = document.createElement('tr');
        const before = e.before_json ? JSON.parse(e.before_json) : null;
        const after  = e.after_json  ? JSON.parse(e.after_json)  : null;
        // Highlight what changed for update actions.
        let diff = '';
        if (e.action === 'create') {
          diff = after ? summarizeRow(after) : '';
        } else if (e.action === 'update' && before && after) {
          diff = Object.keys(after).filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
                              .map(k => `<div><span class="muted">${escapeHtml(k)}:</span> ${escapeHtml(JSON.stringify(before[k]))} → <strong>${escapeHtml(JSON.stringify(after[k]))}</strong></div>`)
                              .join('');
        } else if (e.action === 'delete') {
          diff = before ? summarizeRow(before) : '';
        }
        tr.innerHTML = `
          <td class="muted" style="white-space:nowrap">${escapeHtml(fmtDate(e.created_at))}</td>
          <td>${escapeHtml(e.actor_full_name || e.actor_username || 'system')}</td>
          <td><span class="tag ${actionClass(e.action)}">${escapeHtml(e.action)}</span></td>
          <td>${escapeHtml(e.entity)} #${escapeHtml(String(e.entity_id))}</td>
          <td style="font-size:12px">${diff}</td>`;
        tbody.appendChild(tr);
      }
      applyLang();
    }).catch(err => {
      const tbody = auditCard.querySelector('tbody');
      tbody.innerHTML = `<tr><td colspan="5" class="muted">${escapeHtml(err.message)}</td></tr>`;
    });

    root.appendChild(settings);
    applyLang();
  }

  // Compact one-line summary for create/delete rows in the audit log.
  function summarizeRow(obj) {
    const fields = ['sku','name','username','email','role','quantity','type','reason'];
    const bits = [];
    for (const k of fields) if (obj[k] !== undefined) bits.push(`${k}=${obj[k]}`);
    return escapeHtml(bits.join(' · '));
  }
  // Tailwind-style class mapping for the action tag (we don't actually
  // use tailwind — these map onto the existing .good/.warn/.bad chips).
  function actionClass(a) {
    if (a === 'create') return 'good';
    if (a === 'update') return 'warn';
    if (a === 'delete') return 'bad';
    return 'neutral';
  }

  function card(title, body, isEmpty) {
    const d = document.createElement('div');
    d.className = 'card' + (isEmpty ? ' empty' : '');
    d.innerHTML = `<div class="card-head"><h3>${escapeHtml(title)}</h3></div><div>${escapeHtml(body)}</div>`;
    return d;
  }

  // ---- Inventory audit page ----
  // Shows every item with its current system quantity and an editable
  // 'counted' column. Saving records one 'in' or 'out' movement per item
  // with the delta and a reason of "Inventory audit". The movement type
  // is constrained to 'in'/'out' by the schema, so we use the sign of
  // (counted - current) to choose which one.
  async function renderInventory(root) {
    root.innerHTML = '';
    let items = [];
    try { ({ items } = await api('/items')); } catch (e) {
      root.appendChild(card(t('inventory'), e.message, true));
      applyLang(); return;
    }

    // Local state: which items have been edited, and the user's counted values.
    const counts = new Map(); // id -> counted value (string)
    const dirty = new Set(); // ids whose counted value differs from system

    const headerEl = document.createElement('div');
    headerEl.innerHTML = `<h2 style="margin:0 0 6px" data-i18n="inventory_title"></h2>
      <p class="muted" style="margin:0 0 12px" data-i18n="inventory_subtitle"></p>`;
    root.appendChild(headerEl);

    const summaryEl = document.createElement('div');
    summaryEl.className = 'kpi-grid';
    const setSummary = () => {
      const totItems = items.length;
      let counted = 0, deltas = 0;
      for (const it of items) if (dirty.has(it.id)) { counted++; if (counts.get(it.id) !== it.quantity) deltas++; }
      summaryEl.innerHTML = `
        <div class="kpi"><div class="kpi-label" data-i18n="items"></div><div class="kpi-value">${totItems}</div></div>
        <div class="kpi"><div class="kpi-label" data-i18n="inventory_edited"></div><div class="kpi-value">${counted}</div></div>
        <div class="kpi"><div class="kpi-label" data-i18n="inventory_deltas"></div><div class="kpi-value">${deltas}</div></div>`;
      applyLang();
    };
    root.appendChild(summaryEl);

    const tableCard = document.createElement('div');
    tableCard.className = 'card';
    tableCard.style.marginTop = '14px';
    tableCard.innerHTML = `
      <div class="card-head">
        <h3 data-i18n="inventory_title"></h3>
        <span class="muted" data-i18n="inventory_count_hint"></span>
      </div>
      <div style="overflow-x:auto">
        <table id="inv-table">
          <thead>
            <tr>
              <th data-i18n="sku"></th>
              <th data-i18n="name"></th>
              <th data-i18n="on_hand"></th>
              <th data-i18n="inventory_counted"></th>
              <th data-i18n="inventory_delta"></th>
              <th data-i18n="inventory_audit_note"></th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
      <div class="modal-actions" style="margin-top:14px">
        <button type="button" class="btn btn-ghost" id="inv-reset" data-i18n="cancel"></button>
        <button type="button" class="btn btn-primary" id="inv-save" data-i18n="inventory_save"></button>
      </div>`;
    root.appendChild(tableCard);
    const tbody = tableCard.querySelector('tbody');

    const updateRow = (it) => {
      const row = tbody.querySelector(`tr[data-id="${it.id}"]`);
      if (!row) return;
      const countedStr = counts.has(it.id) ? counts.get(it.id) : '';
      const countedNum = countedStr === '' ? it.quantity : Number(countedStr);
      const valid = countedStr === '' || (Number.isFinite(countedNum) && countedNum >= 0);
      const deltaEl = row.querySelector('.delta');
      const countedInput = row.querySelector('input.counted');
      countedInput.classList.toggle('bad', !valid);
      if (!valid) {
        deltaEl.textContent = '—';
        deltaEl.className = 'delta muted';
      } else {
        const d = countedNum - it.quantity;
        if (d === 0) {
          deltaEl.textContent = '0';
          deltaEl.className = 'delta muted';
        } else if (d > 0) {
          deltaEl.textContent = '+' + d;
          deltaEl.className = 'delta good';
        } else {
          deltaEl.textContent = String(d);
          deltaEl.className = 'delta bad';
        }
      }
    };

    const markDirty = (it, hasValue) => {
      if (hasValue) dirty.add(it.id); else dirty.delete(it.id);
      setSummary();
    };

    // Build all rows once; in-place updates avoid re-render churn while
    // the user is typing in the counted column.
    for (const it of items) {
      const tr = document.createElement('tr');
      tr.dataset.id = String(it.id);
      tr.innerHTML = `
        <td><span class="tag">${escapeHtml(it.sku)}</span></td>
        <td>${escapeHtml(it.name)}</td>
        <td><strong>${it.quantity}</strong> <span class="muted">${escapeHtml(it.unit || 'pcs')}</span></td>
        <td><input type="number" min="0" step="1" class="counted" style="width:90px"
                   placeholder="${it.quantity}" aria-label="counted"></td>
        <td><span class="delta muted">—</span></td>
        <td><input type="text" class="note" placeholder="${escapeHtml(t('inventory_audit_note_placeholder'))}" style="width:180px"></td>`;
      tbody.appendChild(tr);
      const input = tr.querySelector('input.counted');
      const note  = tr.querySelector('input.note');
      input.addEventListener('input', () => {
        const v = input.value.trim();
        counts.set(it.id, v);
        markDirty(it, v !== '');
        updateRow(it);
      });
    }

    tableCard.querySelector('#inv-reset').addEventListener('click', () => {
      counts.clear(); dirty.clear();
      tbody.querySelectorAll('input.counted').forEach(i => i.value = '');
      tbody.querySelectorAll('input.note').forEach(i => i.value = '');
      tbody.querySelectorAll('tr').forEach(tr => {
        const it = items.find(x => String(x.id) === tr.dataset.id);
        if (it) updateRow(it);
      });
      setSummary();
    });

    tableCard.querySelector('#inv-save').addEventListener('click', async () => {
      // Snapshot the rows that have a counted value (and a non-empty one)
      const toProcess = [];
      tbody.querySelectorAll('tr').forEach(tr => {
        const id = +tr.dataset.id;
        const it = items.find(x => x.id === id);
        if (!it) return;
        const v = counts.get(id);
        if (v === undefined || v === '') return;
        const counted = Number(v);
        if (!Number.isFinite(counted) || counted < 0) {
          toast(`${it.name}: invalid count`, 'bad');
          return;
        }
        const note = tr.querySelector('input.note').value.trim();
        toProcess.push({ it, counted, note });
      });

      if (toProcess.length === 0) { toast(t('inventory_no_changes'), 'bad'); return; }

      tableCard.querySelector('#inv-save').disabled = true;
      let applied = 0, skipped = 0;
      try {
        for (const { it, counted, note } of toProcess) {
          const delta = counted - it.quantity;
          if (delta === 0) { skipped++; continue; }
          const body = {
            quantity: Math.abs(delta),
            reason: 'Inventory audit',
            counterparty: null,
            comment: note || null,
          };
          try {
            await api(`/items/${it.id}/${delta > 0 ? 'in' : 'out'}`, { method: 'POST', body });
            applied++;
          } catch (e) { skipped++; toast(`${it.name}: ${e.message}`, 'bad'); }
        }
        toast(`${t('inventory_save_done')}: ${applied}, ${t('skipped')}: ${skipped}`, applied ? 'good' : 'bad');
        // Refresh item data so the on-hand column matches the new reality.
        try {
          const fresh = await api('/items');
          items = fresh.items || [];
          // Re-render the table: update on-hand values, clear inputs.
          for (const it of items) {
            const tr = tbody.querySelector(`tr[data-id="${it.id}"]`);
            if (!tr) continue;
            tr.children[2].innerHTML = `<strong>${it.quantity}</strong> <span class="muted">${escapeHtml(it.unit || 'pcs')}</span>`;
            const input = tr.querySelector('input.counted');
            input.value = '';
            input.placeholder = String(it.quantity);
            tr.querySelector('input.note').value = '';
          }
          counts.clear(); dirty.clear(); setSummary();
        } catch {}
      } finally {
        tableCard.querySelector('#inv-save').disabled = false;
      }
    });

    setSummary();
    applyLang();
  }

  // ---- Scan page ----
  async function renderScan(root) {
    root.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'card';
    wrap.innerHTML = `
      <div class="card-head">
        <h3 data-i18n="scan"></h3>
        <span class="muted">Type or paste a SKU; press Enter to look up</span>
      </div>
      <div class="row" style="gap:8px;margin-bottom:14px">
        <input id="scan-input" data-i18n-placeholder="scan_placeholder" autofocus
          style="flex:1;padding:10px 12px;background:var(--bg-2);color:var(--text-0);border:1px solid var(--line);border-radius:6px">
        <button class="btn btn-primary" id="scan-go" data-i18n="look_up"></button>
      </div>
      <div id="scan-result"></div>`;
    root.appendChild(wrap);
    applyLang();
    const input = wrap.querySelector('#scan-input');
    const go = wrap.querySelector('#scan-go');
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doScan(); } });
    go.addEventListener('click', doScan);
    setTimeout(() => input.focus(), 50);

    async function doScan() {
      const code = input.value.trim();
      const out = wrap.querySelector('#scan-result');
      if (!code) { out.innerHTML = ''; return; }
      out.innerHTML = '<div class="empty muted">Looking up…</div>';
      try {
        const { item } = await api('/scan?code=' + encodeURIComponent(code));
        out.innerHTML = '';
        const detail = document.createElement('div');
        detail.className = 'card';
        detail.style.marginTop = '12px';
        const statusChip = item.quantity === 0
          ? `<span class="chip bad" data-i18n="out"></span>`
          : item.quantity <= item.min_quantity
            ? `<span class="chip warn" data-i18n="low"></span>`
            : `<span class="chip good" data-i18n="ok"></span>`;
        detail.innerHTML = `
          <div class="row" style="gap:10px;align-items:center">
            <span class="tag">${escapeHtml(item.sku)}</span>
            <h3 style="margin:0">${escapeHtml(item.name)}</h3>
            <div class="spacer"></div>${statusChip}
          </div>
          <div class="row-3" style="margin-top:10px">
            <div class="field"><label data-i18n="on_hand"></label><div>${item.quantity} ${escapeHtml(item.unit || '')}</div></div>
            <div class="field"><label data-i18n="min"></label><div>${item.min_quantity}</div></div>
            <div class="field"><label data-i18n="category"></label><div>${escapeHtml(item.category)}</div></div>
          </div>
          <div class="row" style="gap:8px;margin-top:12px">
            <button class="btn btn-good" id="sc-in" data-i18n="stock_in"></button>
            <button class="btn btn-warn" id="sc-out" data-i18n="stock_out"></button>
          </div>`;
        detail.querySelector('#sc-in').addEventListener('click', () => openMoveDialogPublic(item, 'in'));
        detail.querySelector('#sc-out').addEventListener('click', () => openMoveDialogPublic(item, 'out'));
        out.appendChild(detail);
        applyLang();
      } catch (e) {
        out.innerHTML = '';
        const err = document.createElement('div');
        err.className = 'empty';
        err.style.color = 'var(--bad)';
        err.textContent = '✕ ' + e.message;
        out.appendChild(err);
      }
    }
  }

  // ---- Move dialog (addon's own — used from scan + alerts reorder) ----
  async function openMoveDialogPublic(item, type) {
    let requesters = { requesters: [] }, departments = { departments: [] };
    try {
      const r = await api('/requesters'); requesters = r;
    } catch {}
    try {
      const d = await api('/departments'); departments = d;
    } catch {}
    const body = document.createElement('form');
    body.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const payload = Object.fromEntries(fd.entries());
      payload.quantity = parseInt(payload.quantity, 10);
      try {
        await api('/items/' + item.id + '/' + type, { method: 'POST', body: payload });
        toast(type === 'in' ? t('stock_in') + ' ✓' : t('stock_out') + ' ✓', 'good');
        $('#modal-root').hidden = true; $('#modal-body').innerHTML = '';
        const r = location.hash.replace('#', '');
        if (r === 'scan') renderScan($('#view-root'));
        else if (r === 'alerts') renderAlerts($('#view-root'));
      } catch (e2) { toast(e2.message, 'bad'); }
    };
    const reqOpts = (requesters.requesters || []).map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
    const depOpts = (departments.departments || []).map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');
    body.innerHTML = `
      <p class="muted" style="margin-top:0">${type === 'in' ? t('stock_in') : t('stock_out')} —
        <strong>${escapeHtml(item.name)}</strong> · ${t('on_hand')}: ${item.quantity} ${escapeHtml(item.unit || '')}</p>
      <div class="row-2">
        <div class="field"><label data-i18n="quantity"></label>
          <input name="quantity" type="number" min="1" step="1" required autofocus></div>
        <div class="field"><label data-i18n="reason"></label>
          <input type="text" name="reason" placeholder="${type === 'in' ? 'purchase, transfer…' : 'request, breakage…'}"></div>
      </div>
      ${type === 'in' ? `
        <div class="row-3">
          <div class="field"><label data-i18n="supplier"></label><input type="text" name="supplier"></div>
          <div class="field"><label data-i18n="delivery_note"></label><input type="text" name="delivery_note"></div>
          <div class="field"><label data-i18n="entry_type"></label>
            <select name="entry_type">
              <option value="">—</option>
              <option value="opening" data-i18n="opening"></option>
              <option value="purchase" data-i18n="purchase"></option>
              <option value="transfer" data-i18n="transfer"></option>
              <option value="return" data-i18n="ret"></option>
            </select></div>
        </div>` : `
        <div class="row-2">
          <div class="field"><label data-i18n="requester"></label>
            <select name="requester_id"><option value="">—</option>${reqOpts}</select></div>
          <div class="field"><label data-i18n="department"></label>
            <select name="department_id"><option value="">—</option>${depOpts}</select></div>
        </div>`}
      <div class="field"><label data-i18n="comment"></label><textarea name="comment" rows="2"></textarea></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="mv-cancel" data-i18n="cancel"></button>
        <button type="submit" class="btn ${type === 'in' ? 'btn-good' : 'btn-warn'}" data-i18n="${type === 'in' ? 'stock_in' : 'stock_out'}"></button>
      </div>`;
    body.querySelector('#mv-cancel').addEventListener('click', () => {
      $('#modal-root').hidden = true; $('#modal-body').innerHTML = '';
    });
    $('#modal-title').textContent = (type === 'in' ? t('stock_in') : t('stock_out')) + ' — ' + item.name;
    const mb = $('#modal-body'); mb.innerHTML = ''; mb.appendChild(body);
    $('#modal-root').hidden = false;
    applyLang();
  }
  window.__openMoveDialogPublic = openMoveDialogPublic;

  // ---- Idle session timer (default 30 min) ----
  const IDLE_MS = (parseInt(localStorage.getItem('sm_idle_min'), 10) || 30) * 60 * 1000;
  let idleTimer = null, warnTimer = null;
  function resetIdle() {
    if (warnTimer) { clearTimeout(warnTimer); warnTimer = null; }
    if (idleTimer) clearTimeout(idleTimer);
    if (!localStorage.getItem('sm_jwt')) return;
    warnTimer = setTimeout(showIdleWarning, Math.max(IDLE_MS - 60_000, 1000));
    idleTimer = setTimeout(expireSession, IDLE_MS);
  }
  function showIdleWarning() {
    if (!$('#app-shell') || $('#app-shell').hidden) return;
    toast(t('session_warning'), 'warn');
  }
  async function expireSession() {
    try { await api('/auth/logout', { method: 'POST' }); } catch {}
    localStorage.removeItem('sm_jwt');
    state.user = null;
    alert(t('session_expired'));
    location.reload();
  }
  ['mousemove','keydown','click','touchstart'].forEach(ev =>
    document.addEventListener(ev, resetIdle, { passive: true })
  );

  // ---- Hook the v1 hashchange router ----
  const NEW_ROUTES = new Set(['alerts','requesters','departments','scan','admin','inventory']);
  // Generation counter for addon-rendered pages — protects against the
  // same route firing twice in quick succession (which happens when the
  // test harness sets location.hash AND dispatches a synthetic
  // hashchange event). When a render resumes from an `await`, it bails
  // out if the generation has moved on.
  let addonGen = 0;
  // Coalesce identical rapid-fire hashchanges for the same route within
  // a microtask. Without this, double-fires (location.hash assignment +
  // synthetic dispatchEvent) cause the renderer to run twice and append
  // duplicate rows. Setting `pending = true` schedules a single render
  // for the most recent target.
  let pending = null;
  let pendingTimer = null;
  function scheduleRender(target) {
    pending = target;
    if (pendingTimer != null) return;
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      const r = pending; pending = null;
      runRender(r);
    }, 0);
  }
  function runRender(r) {
    const myGen = ++addonGen;
    const stillHere = () => addonGen === myGen && $('#view-root') && true;
    $$('.nav-link').forEach(a => a.classList.toggle('active', a.dataset.route === r));
    const tEl = $('#page-title');
    if (tEl) tEl.textContent = t(TITLES[r] || r);
    const root = $('#view-root'); if (!root) return; root.innerHTML = '';
    try {
      (async () => {
        if (r === 'alerts') await renderAlerts(root);
        else if (r === 'requesters') await renderRequesters(root);
        else if (r === 'departments') await renderDepartments(root);
        else if (r === 'scan') await renderScan(root);
        else if (r === 'admin') await renderAdmin(root);
        else if (r === 'inventory') await renderInventory(root);
        if (!stillHere()) return;
      })();
    } catch (e2) {
      if (!stillHere()) return;
      root.innerHTML = '';
      const err = document.createElement('div');
      err.className = 'card empty';
      err.textContent = 'Failed to load: ' + e2.message;
      root.appendChild(err);
    }
  }
  const TITLES = {
    alerts: 'alerts', requesters: 'requesters', departments: 'departments',
    scan: 'scan', admin: 'admin', inventory: 'inventory',
  };
  window.addEventListener('hashchange', (e) => {
    const r = location.hash.replace('#', '');
    if (NEW_ROUTES.has(r)) {
      // Stop v1's bubble-phase hashchange handler from rendering the
      // dashboard fallback for unknown routes. (v1's whitelist is hard-coded
      // to dashboard|items|movements|users, so without this it would clear
      // our content and render dashboard on top.)
      e.stopImmediatePropagation();
      // Bump v1's viewGen so any in-flight v1 render (e.g. a slow
      // dashboard fetch that started before the user clicked Admin)
      // bails out via its own stillHere() guard instead of appending
      // stale content into our freshly-cleared view-root.
      if (typeof window.__smViewGen === 'function') window.__smViewGen();
      scheduleRender(r);
    } else {
      // v1 page — re-apply language after the new content is in
      setTimeout(applyLang, 60);
    }
  }, true /* capture phase, so we run BEFORE v1's bubble-phase handler */);

  // ---- Augment the v1 search input (border + i18n placeholder) ----
  function fixSearchInput() {
    const input = $('#global-search');
    if (!input || input.dataset.addonFixed) return;
    input.dataset.addonFixed = '1';
    input.dataset.i18nPlaceholder = 'search_placeholder';
  }

  // ---- Tag the v1 static elements so applyLang can translate them ----
  function tagV1Elements() {
    if (document.body.dataset.v1Tagged) return;
    // Tag the text spans inside the 4 v1 nav links
    for (const [route, key] of [['dashboard','dashboard'],['items','items'],['movements','movements'],['users','people']]) {
      const a = document.querySelector(`.nav-link[data-route="${route}"] span`);
      if (a && key) a.dataset.i18n = key;
    }
    // The logout button's text is a direct text node after the <svg> — wrap it
    const logout = document.getElementById('logout-btn');
    if (logout && !logout.dataset.i18n) {
      logout.dataset.i18n = 'sign_out';
    }
    document.body.dataset.v1Tagged = '1';
  }

  // ---- Watch the v1 view-root for any re-render (filter change, hash
  // change, modal close, etc.) and re-apply translations immediately.
  // Without this, switching language sometimes misses the most recent
  // v1 render and you have to refresh to see the new strings.
  function watchViewRoot() {
    const root = $('#view-root');
    if (!root || root.dataset.addonLangWatch) return;
    root.dataset.addonLangWatch = '1';
    // Throttle: many mutations in a tick → one applyLang.
    let scheduled = false;
    const mo = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; applyLang(); });
    });
    mo.observe(root, { childList: true, subtree: true, characterData: true });
  }

  // ---- After the v1 app has rendered the shell, install our extras ----
  function hookShell() {
    const shell = $('#app-shell');
    if (!shell || shell.dataset.addonHooked) return;
    if (shell.hidden) return;
    shell.dataset.addonHooked = '1';
    tagV1Elements();
    injectNav();
    injectTopbar();
    fixSearchInput();
    watchViewRoot();
    applyLang();
    // Pick up the current user from the v1 "who" block
    const whoName = ($('#who-name') || {}).textContent;
    if (whoName) {
      // state.user.role is not exposed; assume admin if "Administrator" appears
      const isAdmin = /admin/i.test($('#who-role') ? $('#who-role').textContent : '');
      state.user = { name: whoName.trim(), role: isAdmin ? 'admin' : 'staff' };
    }
    resetIdle();
  }
  // The shell becomes visible only after login, and route changes
  // re-render the topbar. We watch for #app-shell[hidden] going false.
  const shellObs = new MutationObserver(hookShell);
  shellObs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
  // Try once on load in case the shell is already visible.
  setTimeout(hookShell, 200);
  setTimeout(hookShell, 800);
  setTimeout(applyLang, 1200);
})();

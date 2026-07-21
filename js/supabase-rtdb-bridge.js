/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  SUPABASE RTDB BRIDGE — supabase-rtdb-bridge.js                ║
 * ║  MiniESports Admin Panel — Firebase → Supabase Migration        ║
 * ║                                                                  ║
 * ║  Firebase RTDB SIRF in cheezoin ke liye:                        ║
 * ║    ✅ support/  — Real-time chat                                 ║
 * ║    ✅ chats/    — Secondary chat path                            ║
 * ║    ✅ deviceJoins/ — Anti-cheat fingerprint                      ║
 * ║    ✅ appSettings/ adminConfig/ — Live config (TDS, maintenance) ║
 * ║    ✅ tdsRecords/ tdsHeld/ — Tax records (koi Supabase table     ║
 * ║       nahi banaya gaya inke liye, isliye Firebase pe hi rehna)   ║
 * ║    ✅ adminActions/ earlyAccessUsers/ — Legacy logs (no schema)  ║
 * ║    ✅ creatorVideos/ videoReports/ — fa-creator-video-review.js  ║
 * ║       ka primary store (Supabase mein sirf analytics-mirror)    ║
 * ║    ✅ users/$uid/videoStrikes — sirf is ek nested field ke liye   ║
 * ║       (users/ root khud Supabase 'users' table pe jaata hai)     ║
 * ║    ✅ Firebase Auth — Admin login (email/pass)                   ║
 * ║    ✅ Firebase Analytics + Crashlytics — Auto SDK                ║
 * ║                                                                  ║
 * ║  NOTE: 'admins', 'activityLogs', 'adminAlerts' yahan Firebase-   ║
 * ║  only NAHI hain — yeh teen Supabase tables (admins,              ║
 * ║  admin_activity_log, admin_alerts) pe TABLE_MAP se route hote    ║
 * ║  hain. (Pehle yeh banner inhe galat tarike se "Firebase-only"    ║
 * ║  bata raha tha jabki code kuch alag karta tha — fix kiya gaya.)  ║
 * ║                                                                  ║
 * ║  Baaki SABB → Supabase                                          ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════════
     1. FIREBASE-ONLY PATHS — Koi change nahi, real RTDB use hoga
  ═══════════════════════════════════════════════════════════════════ */
  var FIREBASE_ONLY = [
    /* ── Real-time chat (keep forever) ── */
    'support', 'chats', 'supportChats', 'supportTyping',
    /* ── Anti-cheat fingerprints (keep forever) ── */
    'deviceJoins', 'flaggedDevices', 'deviceBlacklist',
    /* ── Live config (keep, no user data) ── */
    'appSettings', 'appConfig', 'adminConfig',
    /* ── Presence / connection ── */
    '.info', 'presence',
    /* ── Analytics / read-only aggregates ── */
    'analytics', 'platformEarnings', 'seasonStats',
    /* ── ✅ FIX (Audit H3): yeh 6 paths code mein use ho rahe the lekin
       na TABLE_MAP mein the na yahan — bridge silently `null` return
       karta tha (na Firebase na Supabase, data kahin nahi jaata tha).
       Inke liye koi Supabase table bhi nahi banaya gaya hai, isliye
       asli fix Firebase pe wapas route karna hai. ── */
    'tdsRecords', 'tdsHeld', 'adminActions', 'earlyAccessUsers',
    'creatorVideos', 'videoReports'
  ];

  /* ── ✅ FIX (Audit H3): 'users' root Supabase 'users' table pe jaata hai,
     lekin 'users/{uid}/videoStrikes' ek exception hai — yeh field kabhi
     Postgres mein column nahi bana (Creator Video Review feature ke liye
     Firebase mein hi rakha gaya, jaisa fa-creator-video-review.js aur
     COMPLETE_SCHEMA.sql ka comment dono confirm karte hain). ── */
  var FIREBASE_ONLY_SUBPATHS = [
    /^users\/[^/]+\/videoStrikes(\/.*)?$/
  ];

  function isFirebasePath(path) {
    if (!path) return true;
    var clean = path.replace(/^\//, '');
    var first = clean.split('/')[0];
    for (var i = 0; i < FIREBASE_ONLY.length; i++) {
      if (first === FIREBASE_ONLY[i]) return true;
    }
    for (var j = 0; j < FIREBASE_ONLY_SUBPATHS.length; j++) {
      if (FIREBASE_ONLY_SUBPATHS[j].test(clean)) return true;
    }
    return false;
  }

  /* ═══════════════════════════════════════════════════════════════════
     2. PATH → SUPABASE TABLE MAPPING
  ═══════════════════════════════════════════════════════════════════ */
  var TABLE_MAP = {
    'matches':               { table: 'matches',             id: 'id'      },
    'users':                 { table: 'users',               id: 'id'      },
    'joinRequests':          { table: 'join_requests',       id: 'id'      },
    'walletRequests':        { table: 'sd_requests',         id: 'id'      },
    'profileRequests':       { table: 'profile_requests',    id: 'id'      },
    'profileUpdates':        { table: 'profile_updates',     id: 'id'      },
    'teamRequests':          { table: 'team_requests',       id: 'id'      },
    'notifications':         { table: 'notifications',       id: 'id'      },
    'activityLogs':          { table: 'admin_activity_log',  id: 'id'      },
    'adminActivityLog':      { table: 'admin_activity_log',  id: 'id'      },
    'admins':                { table: 'admins',              id: 'uid'     },
    'disputes':              { table: 'disputes',            id: 'id'      },
    'coinRequests':          { table: 'coin_requests',       id: 'id'      },
    'premiumRequests':       { table: 'premium_requests',    id: 'id'      },
    'matchTemplates':        { table: 'match_templates',     id: 'id'      },
    'vouchers':              { table: 'vouchers',            id: 'id'      },
    'skyDiamondRequests':    { table: 'sd_requests',         id: 'id'      },
    'results':               { table: 'match_results',       id: 'id'      },
    'polls':                 { table: 'polls',               id: 'id'      },
    'suggestions':           { table: 'suggestions',         id: 'id'      },
    'sponsoredTournaments':  { table: 'sponsored_tournaments', id: 'id'    },
    'creatorCodes':          { table: 'creator_codes',       id: 'code'    },
    'ffUIDIndex':            { table: 'ff_uid_index',        id: 'ff_uid'  },
    'supportRequests':       { table: 'support_tickets',     id: 'id'      },
    'walletAuditLog':        { table: 'wallet_audit_log',    id: 'id'      },
    'userMatches':           { table: 'user_matches',        id: 'id'      },
    'adminAlerts':           { table: 'admin_alerts',        id: 'id'      },
    'cheatReports':          { table: 'cheat_reports',       id: 'id'      },
    'refundRequests':        { table: 'refund_requests',     id: 'id'      },
    'fraudCases':            { table: 'fraud_cases',         id: 'id'      },
    'scheduledBroadcasts':   { table: 'scheduled_broadcasts', id: 'id'     },
    'kycRequests':           { table: 'kyc_requests',        id: 'id'      },
    'adminNotes':            { table: 'admin_notes',         id: 'id'      },
    'platformStats':         { table: 'platform_stats',      id: 'id'      },

    /* ── Additional paths ── */
    'withdrawalRequests':    { table: 'sd_requests',          id: 'id'      },
    'seasonPassRequests':    { table: 'premium_requests',     id: 'id'      },
    'coinTransactions':      { table: 'wallet_transactions',  id: 'id'      },
    'userWallet':            { table: 'wallet_transactions',  id: 'id'      },
    'matchResults':          { table: 'match_results',        id: 'id'      },
    'resultScreenshots':     { table: 'match_results',        id: 'id'      },
    'killProofs':            { table: 'match_results',        id: 'id'      },
    'joinedMatches':         { table: 'join_requests',        id: 'id'      },
    'brackets':              { table: 'tournament_brackets',  id: 'id'      },
    'clanWars':              { table: 'clan_wars',            id: 'id'      },
    'clans':                 { table: 'clans',                id: 'id'      },
    'mentors':               { table: 'mentor_profiles',      id: 'id'      },
    'cityChampionship':      { table: 'city_championship',    id: 'id'      },
    'creatorStats':          { table: 'creator_stats',        id: 'id'      },
    'creatorPayouts':        { table: 'creator_payouts',      id: 'id'      },
    'banAppeals':            { table: 'ban_appeals',          id: 'id'      },
    'battlePass':            { table: 'battle_pass_progress', id: 'id'      },
    'blacklist':             { table: 'blacklist',            id: 'id'      },
    'utrBlacklist':          { table: 'blacklist',            id: 'id'      },
    'referrals':             { table: 'referrals',            id: 'id'      },
    'giftTickets':           { table: 'gift_tickets',         id: 'id'      },
    'adminWatchlist':        { table: 'admin_watchlist',      id: 'id'      },
    'matchFeedback':         { table: 'match_feedback',       id: 'id'      },
    'leaderboard':           { table: 'leaderboard',          id: 'id'      },
    'leaderboardArchive':    { table: 'leaderboard_archive',  id: 'id'      },
    /* ✅ FIX (Audit H4): 'season_history' / 'auto_match_queue' tables don't
       exist — real tables are 'seasonal_league_history' / 'auto_squad_queue'.
       Every admin call through these paths was throwing a Postgres
       "relation does not exist" error before this fix. */
    'seasonHistory':         { table: 'seasonal_league_history', id: 'id'  },
    'season':                { table: 'seasonal_league_history', id: 'id'  },
    'autoMatchQueue':        { table: 'auto_squad_queue',     id: 'id'      },
    'suspiciousActivity':    { table: 'fraud_cases',          id: 'id'      },
    'announcements':         { table: 'scheduled_broadcasts', id: 'id'      },
    'scheduledAnnouncements':{ table: 'scheduled_broadcasts', id: 'id'      }
  };

  /* ═══════════════════════════════════════════════════════════════════
     3. FIELD NAME CONVERTERS — camelCase ↔ snake_case
  ═══════════════════════════════════════════════════════════════════ */

  /* camelCase → snake_case */
  function toSnake(key) {
    return key.replace(/([A-Z])/g, function(m) { return '_' + m.toLowerCase(); });
  }

  /* ✅ BUG FIX (2026-07): Firebase RTDB code commonly does
     .orderByChild('timestamp') — but NO table in the real Postgres
     schema has a literal "timestamp" column (they're all "created_at" /
     "updated_at"). Forwarding 'timestamp' straight through toSnake()
     produced queries like ".order('timestamp')" against
     admin_activity_log / admin_alerts / etc, which Postgres rejected
     with "column ... timestamp does not exist" on every single read.
     This resolver is used for BOTH the .order() call and the
     .gte/.gt/.lte/.lt range calls below, so ordering and range-filtering
     both point at the real column. */
  function resolveOrderCol(field) {
    var col = toSnake(field);
    if (col === 'match_time') return 'scheduled_at';
    if (col === 'timestamp' || col === 'time') return 'created_at';
    return col;
  }

  /* ✅ BUG FIX (2026-07-21, CRITICAL): "date/time field value out of range"
     errors traced via live Supabase log entries to their exact failing
     queries — both were range-filtered SELECTs (admin_alerts.created_at,
     matches.completed_at) built by the generic startAt/startAfter/endAt/
     endBefore translation below. Firebase RTDB's .startAt()/.endAt() take
     raw millisecond numbers (Date.now()-style) by convention — that's
     correct for RTDB, but when resolveOrderCol() maps the ordering field
     to a real TIMESTAMPTZ column (created_at, completed_at, scheduled_at,
     etc, which it does for 'timestamp'/'time'/'matchTime' and potentially
     any other column name a caller passes), a raw millisecond integer
     handed to Postgres for a timestamp comparison is what produces this
     exact error — Postgres tries to parse a huge unquoted integer as a
     literal date/time field, not as epoch milliseconds. This is the same
     underlying class of bug as the users/join_requests/etc GRANT
     ON CONFLICT issue fixed earlier (a generic, column-agnostic bridge
     function assuming a shape that doesn't hold for every column it's
     used against) — different mechanism, same root lesson: a truly
     generic path-translation layer needs to know each target column's
     TYPE, not just its name, or it silently sends whatever shape the
     Firebase-style caller happens to use. */
  var TIMESTAMP_COLUMNS = {
    'created_at':1, 'updated_at':1, 'scheduled_at':1, 'completed_at':1,
    'cancelled_at':1, 'result_published_at':1, 'room_released_at':1,
    'checkin_at':1, 'claimed_at':1, 'approved_at':1, 'rejected_at':1,
    'reviewed_at':1, 'processed_at':1, 'paid_at':1, 'sent_at':1,
    'send_at':1, 'watched_at':1, 'purchased_at':1, 'joined_at':1,
    'in_room_at':1, 'unlocked_at':1, 'distributed_at':1, 'granted_at':1,
    'disbanded_at':1, 'started_at':1, 'added_at':1, 'expires_at':1,
    'hold_until':1, 'eligible_at':1, 'claim_deadline':1,
    'last_checkin_date':1, 'last_seen':1, 'accepted_policy_at':1,
    'fcm_updated_at':1, 'vip_granted_at':1, 'referral_applied_at':1,
    'clean_badge_revoked_at':1, 'premium_expires':1
  };
  /* Normalizes a raw range-query bound to whatever format the target
     column actually needs. A bare millisecond number (the Firebase RTDB
     convention) becomes an ISO string for a real timestamp column;
     anything else (numbers/strings for non-timestamp columns, or values
     that are already strings) passes through unchanged. */
  function normalizeRangeVal(col, val) {
    if (TIMESTAMP_COLUMNS[col] && typeof val === 'number') {
      return new Date(val).toISOString();
    }
    return val;
  }

  /* ✅ BUG FIX (2026-07): the generic collection-read default ("order by
     created_at desc") assumed EVERY table has a created_at column. Two
     don't — creator_stats and app_settings only have updated_at — which
     produced "column creator_stats.created_at does not exist" on every
     read through the bridge. */
  var TABLES_WITHOUT_CREATED_AT = { 'creator_stats': 1, 'app_settings': 1 };
  function defaultTimeCol(table) {
    return TABLES_WITHOUT_CREATED_AT[table] ? 'updated_at' : 'created_at';
  }

  /* Convert a plain object keys from camelCase to snake_case */
  function objectToSnake(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    var out = {};
    Object.keys(obj).forEach(function(k) {
      out[toSnake(k)] = obj[k];
    });
    return out;
  }

  /* ── USER-specific conversions ── */
  function userToSupa(d) {
    if (!d) return {};
    var s = {};
    if (d.ign         !== undefined) s.ign            = d.ign;
    if (d.ffUid       !== undefined) s.ff_uid          = d.ffUid;
    if (d.phone       !== undefined) s.phone           = d.phone;
    if (d.email       !== undefined) s.email           = d.email;
    if (d.avatar      !== undefined) s.avatar_url      = d.avatar;
    if (d.coins       !== undefined) s.coins           = d.coins;
    if (d.skyDiamonds !== undefined) s.sky_diamonds    = d.skyDiamonds;
    if (d.greenDiamonds !== undefined) s.green_diamonds = d.greenDiamonds;
    if (d.level       !== undefined) s.level           = d.level;
    if (d.exp         !== undefined) s.exp             = d.exp;
    if (d.isBanned    !== undefined) s.is_banned       = d.isBanned;
    if (d.blocked     !== undefined) s.is_banned       = d.blocked;
    if (d.profileVerified !== undefined) s.profile_verified = d.profileVerified;
    if (d.profile_status  !== undefined) s.profile_status   = d.profile_status;
    if (d.profileStatus   !== undefined) s.profile_status   = d.profileStatus;
    if (d.status      !== undefined) s.status          = d.status;
    if (d.approved    !== undefined) s.approved        = d.approved;
    if (d.pendingIgn  !== undefined) s.pending_ign     = d.pendingIgn;
    if (d.pendingUid  !== undefined) s.pending_uid     = d.pendingUid;
    if (d.profileRequired !== undefined) s.profile_required = d.profileRequired;
    if (d.accessMode  !== undefined) s.access_mode     = d.accessMode;
    if (d.totalKills  !== undefined) s.total_kills     = d.totalKills;
    if (d.totalWinnings !== undefined) s.total_winnings = d.totalWinnings;
    if (d.is_banned   !== undefined) s.is_banned       = d.is_banned;
    if (d.is_deleted  !== undefined) s.is_deleted      = d.is_deleted;
    if (d.deleted_at  !== undefined) s.deleted_at      = d.deleted_at;
    if (d.win_streak  !== undefined) s.win_streak      = d.win_streak;
    if (d.updated_at  !== undefined) s.updated_at      = d.updated_at;
    if (d.lastSeen    !== undefined) s.last_seen        = typeof d.lastSeen === 'number' ? new Date(d.lastSeen).toISOString() : d.lastSeen;
    if (d.last_seen   !== undefined) s.last_seen        = d.last_seen;
    s.updated_at = new Date().toISOString();
    return s;
  }

  function userFromSupa(row) {
    if (!row) return null;
    return {
      id:                row.id,
      ign:               row.ign           || '',
      ffUid:             row.ff_uid        || '',
      phone:             row.phone         || '',
      email:             row.email         || '',
      avatar:            row.avatar_url    || '',
      coins:             row.coins         || 0,
      skyDiamonds:       row.sky_diamonds  || 0,
      greenDiamonds:     row.green_diamonds || 0,
      level:             row.level         || 1,
      exp:               row.exp           || 0,
      isBanned:          row.is_banned     || false,
      blocked:           row.is_banned     || false,
      profileVerified:   row.profile_verified || false,
      profile_status:    row.profile_status || '',
      profileStatus:     row.profile_status || '',
      status:            row.status        || 'active',
      approved:          row.approved      || false,
      pendingIgn:        row.pending_ign   || null,
      pendingUid:        row.pending_uid   || null,
      profileRequired:   row.profile_required || false,
      accessMode:        row.access_mode   || 'FULL',
      totalKills:        row.total_kills   || 0,
      totalWinnings:     row.total_winnings || 0,
      referralCount:     row.referral_count || 0,
      premiumTier:       row.premium_tier  || 0,
      premiumExpiresAt:  row.premium_expires_at ? new Date(row.premium_expires_at).getTime() : null,
      winStreak:         row.win_streak    || 0,
      createdAt:         row.created_at    ? new Date(row.created_at).getTime() : null,
      updatedAt:         row.updated_at    ? new Date(row.updated_at).getTime() : null,
      lastSeen:          row.last_seen     ? new Date(row.last_seen).getTime()  : null,
      lastLogin:         row.last_seen     ? new Date(row.last_seen).getTime()  : null,
      /* Legacy wallet fields — mapped from Supabase columns */
      realMoney: {
        deposited:  row.sky_diamonds    || 0,
        winnings:   row.green_diamonds  || 0
      },
      wallet: {
        depositBalance:  row.sky_diamonds   || 0,
        winningBalance:  row.green_diamonds || 0
      },
      /* ✅ FIX (Audit follow-up): row.wins aur row.matches_played columns
         exist hi nahi karte 'users' table mein — real columns total_wins
         aur total_matches hain. Pehle yeh hamesha 0 milta tha, isliye
         fa68_checkSeasonReset ka "if (u.stats.matches > 0)" check kabhi
         true hi nahi hota tha — season archival kisi ke liye bhi kabhi
         chalta hi nahi tha. */
      stats: {
        matches:    row.total_matches   || 0,
        wins:       row.total_wins      || 0,
        kills:      row.total_kills     || 0,
        earnings:   row.total_winnings  || 0,
        winStreak:  row.win_streak      || 0
      }
    };
  }

  /* ── MATCH conversions ── */
  function matchToSupa(d) {
    if (!d) return {};
    var s = {};
    if (d.name          !== undefined) s.title           = d.name;
    if (d.title         !== undefined) s.title           = d.title;
    if (d.gameMode      !== undefined) s.mode            = d.gameMode;
    if (d.matchType     !== undefined) s.match_sub_type  = d.matchType;
    if (d.mode          !== undefined) s.mode            = d.mode;
    if (d.map           !== undefined) s.map             = d.map;
    if (d.entryType     !== undefined) s.entry_type      = d.entryType;
    if (d.entryFee      !== undefined) s.entry_fee       = d.entryFee;
    if (d.maxSlots      !== undefined) s.max_slots       = d.maxSlots;
    if (d.firstPrize    !== undefined) s.first_prize     = d.firstPrize;
    if (d.secondPrize   !== undefined) s.second_prize    = d.secondPrize;
    if (d.thirdPrize    !== undefined) s.third_prize     = d.thirdPrize;
    if (d.prizePool     !== undefined) s.prize_pool      = d.prizePool;
    if (d.perKillPrize  !== undefined) s.per_kill_prize  = d.perKillPrize;
    if (d.matchTime     !== undefined) s.scheduled_at    = d.matchTime ? new Date(d.matchTime).toISOString() : null;
    if (d.roomId        !== undefined) s.room_id         = d.roomId;
    if (d.roomPassword  !== undefined) s.room_password   = d.roomPassword;
    if (d.roomStatus    !== undefined) s.room_status     = d.roomStatus;
    if (d.roomReleaseMinutes !== undefined) s.room_release_minutes = d.roomReleaseMinutes;
    if (d.roomReleasedAt !== undefined) s.room_released_at = d.roomReleasedAt ? new Date(d.roomReleasedAt).toISOString() : null;
    if (d.status        !== undefined) s.status          = d.status;
    if (d.filledSlots   !== undefined) s.filled_slots    = d.filledSlots;
    if (d.joinedSlots   !== undefined) s.filled_slots    = d.joinedSlots;
    if (d.isSpecial     !== undefined) s.is_special      = d.isSpecial;
    if (d.specialCategory !== undefined) s.special_category = d.specialCategory;
    if (d.prizeType     !== undefined) s.prize_type      = d.prizeType;
    if (d.adsRequired   !== undefined) s.ads_required    = d.adsRequired;
    if (d.minRank       !== undefined) s.min_rank        = d.minRank;
    if (d.creatorUid    !== undefined) s.creator_uid     = d.creatorUid;
    if (d.creatorCode   !== undefined) s.creator_code    = d.creatorCode;
    if (d.resultPublishedAt !== undefined) s.result_published_at = d.resultPublishedAt ? new Date(d.resultPublishedAt).toISOString() : null;
    if (d.cancelledAt   !== undefined) s.cancelled_at    = d.cancelledAt ? new Date(d.cancelledAt).toISOString() : null;
    if (d.cancelledBy   !== undefined) s.cancelled_by    = d.cancelledBy;
    if (d.resultScreenshot !== undefined) s.result_screenshot = d.resultScreenshot;
    if (d.resultScreenshots !== undefined) s.result_screenshots = d.resultScreenshots;
    if (d.reminderSent  !== undefined) s.reminder_sent   = d.reminderSent;
    if (d.updatedAt     !== undefined) s.updated_at      = new Date().toISOString();
    if (d.createdAt     !== undefined) s.created_at      = new Date(d.createdAt).toISOString();
    return s;
  }

  function matchFromSupa(row) {
    if (!row) return null;
    var mt = row.scheduled_at ? new Date(row.scheduled_at).getTime() : 0;
    return {
      id:               row.id,
      firebaseId:       row.firebase_id   || row.id,
      name:             row.name          || row.title || '',
      gameMode:         row.mode          || 'solo',
      matchType:        row.match_sub_type || row.mode || 'solo',
      mode:             row.mode          || 'solo',
      map:              row.map           || 'Bermuda',
      entryType:        row.entry_type    || 'paid',
      entryFee:         row.entry_fee     || 0,
      maxSlots:         row.max_slots     || 12,
      firstPrize:       row.first_prize   || 0,
      prize1st:         row.first_prize   || 0,
      secondPrize:      row.second_prize  || 0,
      prize2nd:         row.second_prize  || 0,
      thirdPrize:       row.third_prize   || 0,
      prize3rd:         row.third_prize   || 0,
      prizePool:        row.prize_pool    || 0,
      perKillPrize:     row.per_kill_prize || 0,
      matchTime:        mt,
      roomId:           row.room_id       || '',
      roomPassword:     row.room_password || '',
      roomStatus:       row.room_status   || 'pending',
      status:           row.status        || 'upcoming',
      filledSlots:      row.filled_slots  || 0,
      joinedSlots:      row.filled_slots  || 0,
      isSpecial:        row.is_special    || false,
      specialCategory:  row.special_category || 'none',
      prizeType:        row.prize_type    || 'greenDiamond',
      adsRequired:      row.ads_required  || 0,
      minRank:          row.min_rank      || null,
      creatorUid:       row.creator_uid   || null,
      creatorCode:      row.creator_code  || '',
      reminderSent:     row.reminder_sent || false,
      resultScreenshot: row.result_screenshot || '',
      resultScreenshots: row.result_screenshots || [],
      createdAt:        row.created_at    ? new Date(row.created_at).getTime() : null,
      updatedAt:        row.updated_at    ? new Date(row.updated_at).getTime() : null,
      resultPublishedAt: row.result_published_at ? new Date(row.result_published_at).getTime() : null
    };
  }

  /* ── JOIN REQUEST conversions ── */
  function jrToSupa(d) {
    if (!d) return {};
    var s = {};
    var uid = d.uid || d.userId || d.oderId;
    if (uid)             s.user_id       = uid;
    if (d.matchId !== undefined || d.tournamentId !== undefined)
                         s.match_id      = d.matchId || d.tournamentId;
    if (d.playerName !== undefined || d.ign !== undefined)
                         s.player_name   = d.playerName || d.ign || d.userName;
    if (d.ffUid !== undefined || d.userFFUID !== undefined)
                         s.ff_uid        = d.ffUid || d.userFFUID || d.gameUid;
    if (d.phone    !== undefined) s.phone       = d.phone;
    if (d.slotNumber !== undefined) s.slot_number = d.slotNumber;
    if (d.status   !== undefined) s.status      = d.status;
    if (d.entryFee !== undefined) s.entry_fee   = d.entryFee;
    if (d.entryType !== undefined) s.entry_type = d.entryType;
    if (d.mode     !== undefined) s.mode        = d.mode;
    if (d.kills    !== undefined) s.kills       = d.kills;
    if (d.rank     !== undefined) s.placement   = d.rank;
    if (d.reward !== undefined || d.prize_earned !== undefined)
                         s.prize_earned  = d.reward || d.prize_earned;
    if (d.resultStatus !== undefined) s.status  = d.resultStatus === 'completed' ? 'completed' : s.status;
    if (d.adminVerified !== undefined) s.checked_in = d.adminVerified;
    if (d.inRoom   !== undefined) s.in_room     = d.inRoom;
    if (d.captainUid !== undefined) s.captain_uid = d.captainUid;
    if (d.isTeamMember !== undefined) s.is_team_member = d.isTeamMember;
    if (d.teamMembers !== undefined) s.team_members = d.teamMembers;
    if (d.joinedAt !== undefined || d.createdAt !== undefined)
                         s.created_at   = new Date(d.joinedAt || d.createdAt || Date.now()).toISOString();
    return s;
  }

  function jrFromSupa(row) {
    if (!row) return null;
    return {
      id:            row.id,
      uid:           row.user_id,
      userId:        row.user_id,
      oderId:        row.user_id,
      matchId:       row.match_id,
      tournamentId:  row.match_id,
      playerName:    row.player_name  || '',
      ign:           row.player_name  || '',
      userName:      row.player_name  || '',
      ffUid:         row.ff_uid       || '',
      userFFUID:     row.ff_uid       || '',
      phone:         row.phone        || '',
      slotNumber:    row.slot_number  || null,
      slot:          row.slot_number  || null,
      status:        row.status       || 'joined',
      entryFee:      row.entry_fee    || 0,
      entryType:     row.entry_type   || 'paid',
      mode:          row.mode         || 'solo',
      kills:         row.kills        || 0,
      rank:          row.placement    || 0,
      killPrize:     row.kill_prize   || 0,
      rankPrize:     row.rank_prize   || 0,
      reward:        row.prize_earned || 0,
      prize_earned:  row.prize_earned || 0,
      resultStatus:  row.status       === 'completed' ? 'completed' : '',
      adminVerified: row.checked_in   || false,
      inRoom:        row.in_room      || false,
      captainUid:    row.captain_uid  || null,
      isTeamMember:  row.is_team_member || false,
      teamMembers:   row.team_members || [],
      joinedAt:      row.created_at   ? new Date(row.created_at).getTime() : null,
      createdAt:     row.created_at   ? new Date(row.created_at).getTime() : null
    };
  }

  /* ── WALLET REQUEST conversions ── */
  function walletFromSupa(row) {
    if (!row) return null;
    return {
      id:           row.id,
      uid:          row.user_id,
      userId:       row.user_id,
      userName:     row.user_name     || '',
      displayName:  row.user_name     || '',
      type:         row.type          || 'add',
      amount:       row.amount        || 0,
      diamonds:     row.amount        || 0,
      utrNumber:    row.utr_number    || '',
      upiId:        row.upi_id        || '',
      screenshotUrl: row.screenshot_url || '',
      screenshotBase64: row.screenshot_url || '',
      status:       row.status        || 'pending',
      creatorCode:  row.creator_code  || '',
      ffUid:        row.ff_uid        || '',
      createdAt:    row.created_at    ? new Date(row.created_at).getTime() : null,
      processedAt:  row.reviewed_at   ? new Date(row.reviewed_at).getTime() : null
    };
  }

  function walletToSupa(d) {
    if (!d) return {};
    var s = {};
    if (d.uid || d.userId)  s.user_id       = d.uid || d.userId;
    if (d.type !== undefined) s.type         = d.type;
    if (d.amount !== undefined) s.amount     = d.amount;
    if (d.utrNumber !== undefined) s.utr_number = d.utrNumber;
    if (d.upiId !== undefined) s.upi_id      = d.upiId;
    if (d.status !== undefined) s.status     = d.status;
    if (d.rejectionReason !== undefined) s.rejection_reason = d.rejectionReason;
    if (d.processedAt !== undefined) s.reviewed_at = new Date(d.processedAt).toISOString();
    if (d.processedBy !== undefined) s.reviewed_by = d.processedBy;
    /* ✅ Audit Fix: a second approve/reject pair (window.approveSkyDiamond/
       rejectSkyDiamond) sends approvedAt/rejectedAt instead of processedAt —
       was being silently dropped (status still saved correctly since that's
       explicitly handled above, but the timestamp never reached Supabase). */
    if (d.approvedAt !== undefined) s.approved_at = new Date(d.approvedAt).toISOString();
    if (d.rejectedAt !== undefined) s.rejected_at = new Date(d.rejectedAt).toISOString();
    return s;
  }

  /* ── PROFILE REQUEST conversions ── */
  function profileReqToSupa(d) {
    if (!d) return {};
    var s = {};
    var uid = d.uid || d.userId;
    if (uid) s.user_id = uid;
    s.requested_ign   = d.requestedIgn || d.ign || d.username || d.gameName || '';
    s.requested_ff_uid = d.requestedUid || d.requestedFfUid || d.ffUid || d.gameUid || '';
    s.requested_phone  = d.phone || d.mobileNumber || '';
    s.screenshot_url   = d.screenshot || d.screenshotUrl || '';
    s.status           = d.status || 'pending';
    if (d.processedAt) s.processed_at = new Date(d.processedAt).toISOString();
    if (d.processedBy) s.processed_by = d.processedBy;
    if (d.rejectionReason) s.rejection_reason = d.rejectionReason;
    if (d.createdAt) s.created_at = new Date(d.createdAt).toISOString();
    return s;
  }

  function profileReqFromSupa(row) {
    if (!row) return null;
    return {
      id:             row.id,
      uid:            row.user_id,
      userId:         row.user_id,
      requestedIgn:   row.requested_ign   || '',
      ign:            row.requested_ign   || '',
      requestedFfUid: row.requested_ff_uid || '',
      ffUid:          row.requested_ff_uid || '',
      requestedUid:   row.requested_ff_uid || '',
      phone:          row.requested_phone  || '',
      screenshotUrl:  row.screenshot_url   || '',
      status:         row.status           || 'pending',
      rejectionReason: row.rejection_reason || '',
      processedAt:    row.processed_at ? new Date(row.processed_at).getTime() : null,
      processedBy:    row.processed_by || null,
      createdAt:      row.created_at ? new Date(row.created_at).getTime() : null
    };
  }

  function profileUpdFromSupa(row) {
    if (!row) return null;
    return {
      id:             row.id,
      uid:            row.user_id,
      userId:         row.user_id,
      requestedIgn:   row.new_ign         || '',
      newIgn:         row.new_ign         || '',
      requestedFfUid: row.new_ff_uid      || '',
      newFfUid:       row.new_ff_uid      || '',
      requestedUid:   row.new_ff_uid      || '',
      currentIgn:     row.current_ign     || '',
      currentFfUid:   row.current_ff_uid  || '',
      newPhone:       row.new_phone       || '',
      status:         row.status          || 'pending',
      rejectionReason: row.rejection_reason || '',
      requestCount:   row.request_count   || 1,
      processedAt:    row.processed_at ? new Date(row.processed_at).getTime() : null,
      createdAt:      row.created_at ? new Date(row.created_at).getTime() : null
    };
  }

  function profileUpdToSupa(d) {
    if (!d) return {};
    var s = {};
    var uid = d.uid || d.userId;
    if (uid) s.user_id = uid;
    if (d.requestedIgn || d.newIgn)    s.new_ign      = d.requestedIgn || d.newIgn;
    if (d.requestedFfUid || d.newFfUid) s.new_ff_uid  = d.requestedFfUid || d.newFfUid;
    if (d.currentIgn)   s.current_ign   = d.currentIgn;
    if (d.currentFfUid) s.current_ff_uid = d.currentFfUid;
    if (d.newPhone)     s.new_phone     = d.newPhone;
    if (d.status)       s.status        = d.status;
    if (d.rejectionReason) s.rejection_reason = d.rejectionReason;
    if (d.processedAt)  s.processed_at  = new Date(d.processedAt).toISOString();
    if (d.processedBy)  s.processed_by  = d.processedBy;
    return s;
  }

  /* ── TEAM REQUEST conversions ── */
  function teamReqFromSupa(row) {
    if (!row) return null;
    return {
      id:         row.id,
      uid:        row.owner_id,
      ownerUid:   row.owner_id,
      ownerName:  row.owner_name   || '',
      ownerFfUid: row.owner_ff_uid || '',
      memberUid:  row.member_id,
      memberName: row.member_name  || '',
      memberFfUid: row.member_ff_uid || '',
      teamType:   row.team_type    || 'duo',
      type:       row.team_type    || 'duo',
      status:     row.status       || 'pending',
      createdAt:  row.created_at ? new Date(row.created_at).getTime() : null
    };
  }

  function teamReqToSupa(d) {
    if (!d) return {};
    var s = {};
    if (d.ownerUid || d.uid) s.owner_id    = d.ownerUid || d.uid;
    if (d.ownerName)         s.owner_name  = d.ownerName;
    if (d.ownerFfUid)        s.owner_ff_uid = d.ownerFfUid;
    if (d.memberUid)         s.member_id   = d.memberUid;
    if (d.memberName)        s.member_name = d.memberName;
    if (d.memberFfUid)       s.member_ff_uid = d.memberFfUid;
    if (d.teamType || d.type) s.team_type  = d.teamType || d.type;
    if (d.status)            s.status      = d.status;
    if (d.processedBy)       s.processed_by = d.processedBy;
    return s;
  }

  /* ── NOTIFICATION conversions ── */
  function notifFromSupa(row) {
    if (!row) return null;
    return {
      id:          row.id,
      targetUserId: row.user_id || (row.target_all ? 'all' : null),
      title:       row.title       || '',
      body:        row.body        || row.message || '',
      message:     row.body        || row.message || '',
      type:        row.type        || 'admin_alert',
      read:        row.is_read     || false,
      matchId:     row.ref_id      || null,
      createdAt:   row.created_at ? new Date(row.created_at).getTime() : null,
      timestamp:   row.created_at ? new Date(row.created_at).getTime() : null
    };
  }

  function notifToSupa(d) {
    if (!d) return {};
    return {
      user_id:    d.targetUserId === 'all' ? null : (d.uid || d.userId || d.targetUserId || null),
      target_all: d.targetUserId === 'all' || d.target_all || false,
      type:       d.type   || 'admin_alert',
      title:      d.title  || '',
      body:       d.body   || d.message || '',
      is_read:    d.read   || false,
      ref_id:     d.matchId || d.ref_id || null
    };
  }

  /* ── ACTIVITY LOG conversions ── */
  function activityFromSupa(row) {
    if (!row) return null;
    return {
      id:         row.id,
      type:       row.action_type || row.type || '',
      action:     row.action      || '',
      message:    row.action      || '',
      uid:        row.target_uid  || '',
      adminUid:   row.admin_uid   || '',
      adminEmail: row.admin_email || '',
      by:         row.admin_email || '',
      details:    row.details     || '',
      timestamp:  row.created_at ? new Date(row.created_at).getTime() : null
    };
  }

  function activityToSupa(d) {
    if (!d) return {};
    return {
      action_type:  d.type         || 'admin_action',
      action:       d.action || d.type || d.message || '',
      target_uid:   d.uid          || null,
      admin_uid:    d.admin        || d.adminUid || null,
      details:      JSON.stringify(d),
      created_at:   new Date().toISOString()
    };
  }

  /* ── DISPUTE conversions ── */
  function disputeFromSupa(row) {
    if (!row) return null;
    return {
      id:           row.id,
      uid:          row.user_id,
      userId:       row.user_id,
      userName:     row.user_name   || '',
      matchId:      row.match_id    || '',
      type:         row.type        || 'other',
      message:      row.message     || '',
      claimedRank:  row.claimed_rank || null,
      screenshot:   row.screenshot_url || '',
      status:       row.status      || 'pending',
      resolvedAt:   row.resolved_at ? new Date(row.resolved_at).getTime() : null,
      resolvedBy:   row.resolved_by || null,
      createdAt:    row.created_at  ? new Date(row.created_at).getTime() : null
    };
  }

  function disputeToSupa(d) {
    if (!d) return {};
    var s = {};
    if (d.status !== undefined)    s.status      = d.status;
    if (d.resolvedAt !== undefined) s.resolved_at = new Date(d.resolvedAt).toISOString();
    if (d.resolvedBy !== undefined) s.resolved_by = d.resolvedBy;
    return s;
  }

  /* ── COIN REQUEST conversions ── */
  function coinReqFromSupa(row) {
    if (!row) return null;
    return {
      id:        row.id,
      userId:    row.user_id,
      uid:       row.user_id,
      ign:       row.ign || '',
      coins:     row.amount   || 0,
      price:     row.price    || 0,
      note:      row.note     || '',
      status:    row.status   || 'pending',
      createdAt: row.created_at ? new Date(row.created_at).getTime() : null
    };
  }

  function coinReqToSupa(d) {
    if (!d) return {};
    var s = {};
    if (d.userId || d.uid) s.user_id = d.userId || d.uid;
    if (d.ign)    s.ign    = d.ign;
    if (d.coins !== undefined) s.amount = d.coins;
    if (d.price !== undefined) s.price  = d.price;
    if (d.note)   s.note   = d.note;
    if (d.status) s.status = d.status;
    if (d.processedAt) s.processed_at = new Date(d.processedAt).toISOString();
    if (d.processedBy) s.processed_by = d.processedBy;
    return s;
  }

  /* ── PREMIUM REQUEST conversions ── */
  function premiumReqFromSupa(row) {
    if (!row) return null;
    return {
      id:               row.id,
      uid:              row.user_id,
      userId:           row.user_id,
      ign:              row.user_name || '',
      userName:         row.user_name || '',
      tier:             row.tier       || 1,
      tierId:           row.tier       || 1,
      tierName:         row.tier_name  || 'Tier ' + (row.tier || 1),
      price:            row.price      || 0,
      gdBonus:          row.gd_bonus   || 0,
      planType:         row.plan_type  || 'monthly',
      bundleId:         row.bundle_id  || null,
      screenshotBase64: row.screenshot_url || '',
      status:           row.status     || 'pending',
      createdAt:        row.created_at ? new Date(row.created_at).getTime() : null
    };
  }

  /* ── VOUCHER conversions ── */
  function voucherFromSupa(row) {
    if (!row) return null;
    return {
      id:        row.id,
      code:      row.code      || '',
      value:     row.value     || 0,
      maxUses:   row.max_uses  || 100,
      usedCount: row.used_count || 0,
      createdAt: row.created_at ? new Date(row.created_at).getTime() : null
    };
  }

  function voucherToSupa(d) {
    if (!d) return {};
    var s = {};
    if (d.code !== undefined)     s.code       = d.code;
    if (d.value !== undefined)    s.value      = d.value;
    if (d.maxUses !== undefined)  s.max_uses   = d.maxUses;
    if (d.usedCount !== undefined) s.used_count = d.usedCount;
    return s;
  }

  /* ── MATCH TEMPLATE conversions ── */
  function templateFromSupa(row) {
    if (!row) return null;
    var data = row.data || {};
    return Object.assign({ id: row.id, name: row.name || data.name || '', savedAt: row.created_at ? new Date(row.created_at).getTime() : null }, data);
  }

  function templateToSupa(d) {
    if (!d) return {};
    return { name: d.name || '', data: d, created_at: new Date().toISOString() };
  }

  /* ── MATCH RESULT conversions ── */
  function resultFromSupa(row) {
    if (!row) return null;
    return {
      id:           row.id,
      userId:       row.user_id,
      matchId:      row.match_id,
      rank:         row.rank         || 0,
      kills:        row.kills        || 0,
      killPrize:    row.kill_prize   || 0,
      rankPrize:    row.rank_prize   || 0,
      winnings:     row.prize_earned || 0,
      totalWinning: row.prize_earned || 0,
      won:          row.rank === 1,
      timestamp:    row.created_at   ? new Date(row.created_at).getTime() : null,
      createdAt:    row.created_at   ? new Date(row.created_at).getTime() : null
    };
  }

  function resultToSupa(d) {
    if (!d) return {};
    var s = {};
    if (d.userId !== undefined)    s.user_id      = d.userId;
    if (d.matchId !== undefined)   s.match_id     = d.matchId;
    if (d.rank !== undefined)      s.rank         = d.rank;
    if (d.kills !== undefined)     s.kills        = d.kills;
    if (d.killPrize !== undefined) s.kill_prize   = d.killPrize;
    if (d.rankPrize !== undefined) s.rank_prize   = d.rankPrize;
    if (d.winnings !== undefined || d.totalWinning !== undefined)
                                   s.prize_earned = d.winnings || d.totalWinning;
    return s;
  }

  /* ── SUPPORT TICKET conversions ── */
  function ticketFromSupa(row) {
    if (!row) return null;
    return {
      id:         row.id,
      userId:     row.user_id,
      userName:   row.user_name || '',
      message:    row.message   || '',
      adminReply: row.admin_reply || '',
      status:     row.status    || 'open',
      createdAt:  row.created_at ? new Date(row.created_at).getTime() : null,
      repliedAt:  row.replied_at ? new Date(row.replied_at).getTime() : null
    };
  }

  function ticketToSupa(d) {
    if (!d) return {};
    var s = {};
    if (d.userId)       s.user_id    = d.userId;
    if (d.userName)     s.user_name  = d.userName;
    if (d.message)      s.message    = d.message;
    if (d.adminReply !== undefined)  s.admin_reply = d.adminReply;
    if (d.status !== undefined)      s.status = d.status;
    if (d.repliedAt !== undefined)   s.replied_at = new Date(d.repliedAt).toISOString();
    return s;
  }

  /* ── Generic camelCase → snake_case fallback for unmapped tables ── */
  function genericToSupa(d) {
    if (!d || typeof d !== 'object') return d;
    var s = {};
    Object.keys(d).forEach(function(k) {
      s[toSnake(k)] = d[k];
    });
    return s;
  }

  function genericFromSupa(row) {
    if (!row) return null;
    return row; // return as-is for unknown tables
  }

  /* Converter registry */
  var CONVERTERS = {
    'matches':               { to: matchToSupa,       from: matchFromSupa      },
    'users':                 { to: userToSupa,         from: userFromSupa       },
    'join_requests':         { to: jrToSupa,           from: jrFromSupa         },
    'sd_requests':           { to: walletToSupa,       from: walletFromSupa     },
    'profile_requests':      { to: profileReqToSupa,   from: profileReqFromSupa },
    'profile_updates':       { to: profileUpdToSupa,   from: profileUpdFromSupa },
    'team_requests':         { to: teamReqToSupa,      from: teamReqFromSupa    },
    'notifications':         { to: notifToSupa,        from: notifFromSupa      },
    'admin_activity_log':    { to: activityToSupa,     from: activityFromSupa   },
    'disputes':              { to: disputeToSupa,      from: disputeFromSupa    },
    'coin_requests':         { to: coinReqToSupa,      from: coinReqFromSupa    },
    'premium_requests':      { to: function(d){ return genericToSupa(d); }, from: premiumReqFromSupa },
    'vouchers':              { to: voucherToSupa,      from: voucherFromSupa    },
    'match_templates':       { to: templateToSupa,     from: templateFromSupa   },
    'match_results':         { to: resultToSupa,       from: resultFromSupa     },
    'support_tickets':       { to: ticketToSupa,       from: ticketFromSupa     }
  };

  function getConverter(table) {
    return CONVERTERS[table] || { to: genericToSupa, from: genericFromSupa };
  }

  /* ═══════════════════════════════════════════════════════════════════
     4. DATA SNAPSHOT SHIM
     Firebase DataSnapshot API ko emulate karta hai Supabase data se
  ═══════════════════════════════════════════════════════════════════ */

  function makeSnapshot(rows, key, table, isScalar) {
    /* rows = array of Supabase rows, or null, or a single value */
    var conv = getConverter(table || '');

    function val() {
      if (isScalar) return rows; // single field value
      if (rows === null || rows === undefined) return null;
      if (!Array.isArray(rows)) {
        /* Single row */
        return conv.from ? conv.from(rows) : rows;
      }
      if (rows.length === 0) return null;
      /* Multiple rows → object keyed by id */
      var idCol = (TABLE_MAP[key] && TABLE_MAP[key].id) || 'id';
      var obj = {};
      rows.forEach(function(r) {
        var rowKey = r[idCol] || r.id || ('row_' + Math.random());
        obj[rowKey] = conv.from ? conv.from(r) : r;
      });
      return obj;
    }

    function exists() {
      if (isScalar) return rows !== null && rows !== undefined;
      if (rows === null || rows === undefined) return false;
      if (Array.isArray(rows)) return rows.length > 0;
      return Object.keys(rows || {}).length > 0;
    }

    function forEach(cb) {
      var arr = Array.isArray(rows) ? rows : (rows ? [rows] : []);
      var idCol = (TABLE_MAP[key] && TABLE_MAP[key].id) || 'id';
      arr.forEach(function(r) {
        var rowKey = r[idCol] || r.id || ('row_' + Math.random());
        cb(makeSnapshot(r, rowKey, table, false));
      });
    }

    function numChildren() {
      if (!rows) return 0;
      if (Array.isArray(rows)) return rows.length;
      if (typeof rows === 'object') return Object.keys(rows).length;
      return 0;
    }

    function child(path) {
      /* Access a sub-field of a single row */
      var v = rows && typeof rows === 'object' ? rows[path] : null;
      return makeSnapshot(v, path, null, true);
    }

    return { key: key, exists: exists, val: val, forEach: forEach, numChildren: numChildren, child: child };
  }

  /* ═══════════════════════════════════════════════════════════════════
     5. PATH PARSER
     Decomposes Firebase paths into components for Supabase routing
  ═══════════════════════════════════════════════════════════════════ */

  function parsePath(fullPath) {
    var path = fullPath.replace(/^\//, '');
    var parts = path.split('/');
    return {
      root:    parts[0] || '',        // e.g. 'users', 'matches'
      id:      parts[1] || null,      // e.g. uid, matchId
      field:   parts[2] || null,      // e.g. 'coins', 'notifications'
      sub:     parts[3] || null,      // e.g. matchId in userMatches/uid/matches/matchId
      raw:     path,
      parts:   parts
    };
  }

  /* ═══════════════════════════════════════════════════════════════════
     6. NESTED PATH HANDLERS
     Special handling for paths like users/{uid}/coins
  ═══════════════════════════════════════════════════════════════════ */

  /* Nested field → Supabase column mapping */
  /* ✅ CORRECTED (2026-07-17): 18 of these entries were audited against a
     complete, authoritative extraction of the users table's actual columns
     (CREATE TABLE + every later ALTER TABLE ADD COLUMN) and found to be
     pointing at columns that never existed anywhere in the schema — this
     matches the exact class of error visible in the live Postgres logs
     ("column users.referral_count does not exist... Perhaps you meant
     users.referral_code"). Each was resolved individually: some were
     genuine duplicates of an existing column under Firebase-era naming
     (loginStreak/profileVerified), some were dead mappings with zero live
     callers (removed), and six were genuinely new fields with confirmed
     live callers that needed an actual new column (added above). */
  var USER_FIELD_MAP = {
    'coins':                  'coins',
    'skyDiamonds':            'sky_diamonds',
    'greenDiamonds':          'green_diamonds',
    'level':                  'level',                 // column added above
    'exp':                    'exp',                   // column added above
    'isBanned':               'is_banned',
    'ffUid':                  'ff_uid',
    'ign':                    'ign',
    'phone':                  'phone',
    'totalKills':             'total_kills',
    'totalWinnings':          'total_winnings',         // column added above
    /* profileVerified/profileUpdatePending removed: profileVerified is a
       genuine duplicate of profile_status==='approved' (see
       screens/profile.js lines checking `profileStatus === 'approved' ||
       profileVerified` — both already represent the same concept
       client-side; the bridge should route it to the real column).
       profileUpdatePending had zero confirmed live callers. */
    'profileVerified':        'profile_status',
    'winStreak':              'win_streak',
    /* premiumTier/premiumExpiresAt removed: premium_level/premium_expires
       (the real columns) are payment-gated and no longer directly
       client-writable at all (see the users GRANT block earlier in this
       file) — routing this mapping at them would just fail the same way
       intentionally. Real premium grants go through approve_premium /
       start_free_trial RPCs only. */
    'partnerUid':             'partner_uid',            // column added above
    'duoTeam':                'duo_team',               // column added above
    'squadTeam':              'squad_team',              // column added above
    /* lastResult removed: zero confirmed live callers. */
    /* isReferralUsed removed: zero confirmed live callers — the real
       equivalent check is users.referred_by IS NOT NULL. */
    'referralCount':          'referral_count',
    /* loginStreak corrected: core/listeners.js's OWN code already does
       `UD.loginStreak = sp.streak_days` — this is a genuine duplicate of
       the real streak_days column under an old Firebase-era name, not a
       separate concept. login_streak (no such column) was never right. */
    'loginStreak':            'streak_days',
    'cleanMatches':           'clean_matches',
    'hasCleanBadge':          'has_clean_badge',
    'totalWins':              'total_wins',
    'profileStatus':          'profile_status',
    'sponsoredWinnings':      'sponsored_winnings',
    'penaltyPoints':          'penalty_points',          // column added above
    'deviceFP':               'device_fp',
    'fraudScore':             'fraud_score',
    /* isSuspicious removed: purely a client-side computed display value
       (winRate>70 && matches>=5 in admin-player-lookup.js) — never
       actually written anywhere, confirmed zero write callers. */
    'selfExcluded':           'self_excluded',
    'selfExcludedTill':       'self_excluded_till'
    /* selfExcluded/selfExcludedTill are KNOWINGLY left pointing at
       non-existent columns — see BUG #41 in AUDIT-LOG.md. The
       Responsible Gaming feature these back is a confirmed UI-only
       illusion with zero working data path anywhere in the app (User
       Panel never reads what it writes; Admin Panel has this same dead
       write). Not fixed here since it needs its own dedicated design
       pass (self-exclusion needs to be enforced at LOGIN/match-join time,
       not just stored) — flagging accurately rather than adding a column
       that would make it look fixed without actually being enforced
       anywhere.
     */
  };

  /* Nested wallet/stats paths → users table columns */
  /* ✅ CORRECTED (2026-07-17): stats/wins and stats/matches previously
     pointed at 'wins' and 'matches_played' — neither exists on the users
     table (there's a 'wins' column on an unrelated table, city_championship,
     which is not this one). The real equivalents are total_wins/
     total_matches, same audit pass as USER_FIELD_MAP above. */
  var NESTED_FIELD_MAP = {
    'realMoney/winnings':           'green_diamonds',
    'realMoney/deposited':          'sky_diamonds',
    'wallet/winningBalance':        'green_diamonds',
    'wallet/depositBalance':        'sky_diamonds',
    'stats/kills':                  'total_kills',
    'stats/earnings':               'total_winnings',
    'stats/wins':                   'total_wins',
    'stats/matches':                'total_matches',
    'stats/winStreak':              'win_streak',
    /* creatorProfile/status and creatorProfile/commission removed: zero
       confirmed live callers (only a stale comment referencing the OLD,
       already-replaced write path — see fa-growth-admin.js's own BUG #19
       fix comment). creatorProfile/code kept, now valid since creator_code
       was added to users above, though it also currently has no confirmed
       live caller through this specific path (approve_creator_application
       RPC is the actual live path that sets it). */
    'creatorProfile/code':          'creator_code',
    'creatorProfile/totalReferrals':'referral_count'
  };

  /* Which nested paths push to sub-tables */
  function getNestedTableHandler(p) {
    if (!p.id) return null;
    var fieldPath = p.parts.slice(2).join('/');

    if (p.root === 'users') {
      if (p.field === 'notifications') return { table: 'notifications', filter: { col: 'user_id', val: p.id }, insertPatch: { user_id: p.id } };
      if (p.field === 'transactions')  return { table: 'wallet_transactions', filter: { col: 'user_id', val: p.id }, insertPatch: { user_id: p.id } };
      if (USER_FIELD_MAP[p.field])     return { table: 'users', field: USER_FIELD_MAP[p.field], filter: { col: 'id', val: p.id } };
      if (NESTED_FIELD_MAP[fieldPath]) return { table: 'users', field: NESTED_FIELD_MAP[fieldPath], filter: { col: 'id', val: p.id } };
    }
    if (p.root === 'matches') {
      if (p.field === 'results')       return { table: 'match_results', filter: { col: 'match_id', val: p.id }, insertPatch: { match_id: p.id } };
      if (p.field === 'joined')        return { table: 'join_requests', filter: { col: 'match_id', val: p.id } };
    }
    /* ✅ FIX (Audit follow-up — season-history shape mismatch):
       seasonHistory/{seasonKey}/{uid}.set({seasonName,seasonNum,finalTier,
       points,badge,reward,emoji}) → seasonal_league_history row.
       genericToSupa() camelCase→snake_case kar deta hai automatically
       (seasonName→season_name, finalTier→final_tier, etc.) — koi dedicated
       converter likhne ki zaroorat nahi, field names already match. */
    if (p.root === 'seasonHistory' && p.id && p.field) {
      return { table: 'seasonal_league_history', insertPatch: { user_id: p.field } };
    }
    if (p.root === 'joinRequests')     return { table: 'join_requests', filter: { col: 'id', val: p.id } };
    if (p.root === 'walletRequests')   return { table: 'sd_requests', filter: { col: 'id', val: p.id } };
    if (p.root === 'profileRequests')  return { table: 'profile_requests', filter: { col: 'id', val: p.id } };
    if (p.root === 'profileUpdates')   return { table: 'profile_updates', filter: { col: 'id', val: p.id } };
    if (p.root === 'teamRequests')     return { table: 'team_requests', filter: { col: 'id', val: p.id } };
    if (p.root === 'disputes' && p.id) return { table: 'disputes', filter: { col: 'id', val: p.id } };
    if (p.root === 'supportRequests' && p.id) return { table: 'support_tickets', filter: { col: 'id', val: p.id } };
    if (p.root === 'coinRequests' && p.id)    return { table: 'coin_requests', filter: { col: 'id', val: p.id } };
    if (p.root === 'premiumRequests' && p.id) return { table: 'premium_requests', filter: { col: 'id', val: p.id } };
    if (p.root === 'matchTemplates' && p.id)  return { table: 'match_templates', filter: { col: 'id', val: p.id } };
    if (p.root === 'vouchers' && p.id)        return { table: 'vouchers', filter: { col: 'id', val: p.id } };
    if (p.root === 'results' && p.id)         return { table: 'match_results', filter: { col: 'id', val: p.id } };
    if (p.root === 'ffUIDIndex' && p.id)      return { table: 'ff_uid_index', filter: { col: 'ff_uid', val: p.id } };
    if (p.root === 'creatorCodes' && p.id)    return { table: 'creator_codes', filter: { col: 'code', val: p.id } };

    /* ── v17 Feature nested paths ── */
    if (p.root === 'clanWars') {
      if (!p.field) return { table: 'clan_wars', filter: { col: 'week', val: p.id }, insertPatch: { week: p.id } };
      if (p.field === 'challenges') return { table: 'clan_war_challenges', filter: { col: 'week', val: p.id }, insertPatch: { week: p.id } };
      if (p.field === 'matches')    return { table: 'clan_wars',           filter: { col: 'week', val: p.id }, insertPatch: { week: p.id } };
      if (p.field === 'clans')      return { table: 'clans',               filter: { col: 'id',   val: p.sub || p.id } };
    }
    if (p.root === 'cityChampionship') {
      if (!p.field) return { table: 'city_championship', filter: { col: 'month', val: p.id }, insertPatch: { month: p.id } };
      if (p.field === 'cities') return { table: 'city_championship', filter: { col: 'month', val: p.id }, insertPatch: { month: p.id } };
    }
    if (p.root === 'mentors') {
      if (p.field === 'active') return { table: 'mentor_profiles', field: 'active', filter: { col: 'uid', val: p.id } };
      if (p.id) return { table: 'mentor_profiles', filter: { col: 'uid', val: p.id } };
    }
    if (p.root === 'clans') {
      if (p.field === 'members')      return { table: 'clan_members',     filter: { col: 'clan_id', val: p.id } };
      if (p.field === 'messages')     return { table: 'clan_messages',    filter: { col: 'clan_id', val: p.id }, insertPatch: { clan_id: p.id } };
      if (p.field === 'squadBank')    return { table: 'clans',            field: 'squad_bank_gd', filter: { col: 'id', val: p.id } };
      if (p.id) return { table: 'clans', filter: { col: 'id', val: p.id } };
    }

    /* ── ✅ FIX (Audit H4): battlePass/{season}/{uid}/{field} — admin
       kisi specific user ko ek specific season ke liye premium grant
       karta hai. Yeh composite key (user_id + season_key) row hai,
       isliye 'extraFilter' use karke dono columns match karte hain. ── */
    if (p.root === 'battlePass' && p.id && p.field) {
      var bpFieldMap = { hasPremium: 'has_premium', currentXp: 'current_xp', currentTier: 'current_tier' };
      var bpField = p.sub ? bpFieldMap[p.sub] : null;
      return {
        table: 'battle_pass_progress',
        field: bpField,
        filter: { col: 'user_id', val: p.field },
        extraFilter: { col: 'season_key', val: p.id },
        insertPatch: { user_id: p.field, season_key: p.id }
      };
    }

    /* ── ✅ FIX (Audit H4): autoMatchQueue/{matchId} (sab queued players)
       aur autoMatchQueue/{matchId}/{uid} (ek specific player remove) ── */
    if (p.root === 'autoMatchQueue' && p.id) {
      if (p.field) {
        return {
          table: 'auto_squad_queue',
          filter: { col: 'match_id', val: p.id },
          extraFilter: { col: 'user_id', val: p.field },
          insertPatch: { match_id: p.id, user_id: p.field }
        };
      }
      return { table: 'auto_squad_queue', filter: { col: 'match_id', val: p.id }, insertPatch: { match_id: p.id } };
    }

    return null;
  }

  /* ✅ FIX (Audit H4): composite-key rows (battlePass, autoMatchQueue) ke
     liye ek dusra .eq() bhi chain karna padta hai — generic helper. */
  function applyFilter(query, nested) {
    query = query.eq(nested.filter.col, nested.filter.val);
    if (nested.extraFilter) query = query.eq(nested.extraFilter.col, nested.extraFilter.val);
    return query;
  }

  /* ═══════════════════════════════════════════════════════════════════
     7. SUPABASE OPERATIONS
  ═══════════════════════════════════════════════════════════════════ */

  function getSupa() {
    return window._supa;
  }

  /* ── READ: table + optional filter ── */
  async function supaRead(p, query) {
    var supa = getSupa();
    if (!supa) return null;

    /* Nested handler (e.g. users/uid/coins) */
    var nested = getNestedTableHandler(p);

    if (nested && nested.field) {
      /* Scalar field read from users table */
      var r = await applyFilter(supa.from(nested.table).select(nested.field), nested).single();
      return r.data ? r.data[nested.field] : null; /* Returns scalar */
    }

    if (nested && !nested.field && p.parts.length >= 3) {
      /* Sub-table read (e.g. users/uid/notifications) */
      var q2 = applyFilter(supa.from(nested.table).select('*'), nested);
      if (query && query.limitN) q2 = q2.limit(query.limitN);
      if (query && query.orderField) q2 = q2.order(toSnake(query.orderField), { ascending: false });
      var r2 = await q2;
      return r2.data || [];
    }

    /* Top-level table */
    var mapping = TABLE_MAP[p.root];
    if (!mapping) {
      /* ✅ FIX (Audit M5): comment pehle galat tha — "Firebase fallback"
         kabhi hota hi nahi tha, SupaRef ke paas real Firebase ka reference
         hi nahi hota. Agar yahan pohchte ho, matlab koi naya RTDB path use
         ho raha hai jo na FIREBASE_ONLY mein hai na TABLE_MAP mein — usse
         in dono jagah add karo (upar) varna data silently kahin nahi jaata. */
      console.warn('[Bridge] Path not mapped to any Supabase table, and not in FIREBASE_ONLY — data NOT saved anywhere. Add it to one of the two lists at the top of supabase-rtdb-bridge.js:', p.raw);
      return null;
    }

    var table = mapping.table;
    var conv = getConverter(table);

    /* Collection or single row? */
    if (p.id) {
      /* Single row: matches/matchId */
      var r3 = await supa.from(table).select('*').eq(mapping.id, p.id).single();
      return r3.data || null;
    }

    /* Collection */
    var q3 = supa.from(table).select('*');

    /* Apply query modifiers */
    if (query) {
      if (query.orderByField) q3 = q3.order(resolveOrderCol(query.orderByField), { ascending: true });
      if (query.equalToVal !== undefined && query.orderByField) {
        var eqCol = resolveOrderCol(query.orderByField);
        q3 = q3.eq(eqCol, normalizeRangeVal(eqCol, query.equalToVal));
      }
      /* ✅ AUDIT FIX (critical): range-query translation for startAt/endAt/
         startAfter/endBefore — see SupaRef.prototype definitions above for
         why these are needed. All apply to the column .orderByChild()
         selected (matches real Firebase RTDB range-query semantics). */
      if (query.orderByField) {
        var rangeCol = resolveOrderCol(query.orderByField);
        if (query.startAtVal !== undefined && query.startAtVal !== null) q3 = q3.gte(rangeCol, normalizeRangeVal(rangeCol, query.startAtVal));
        if (query.startAfterVal !== undefined && query.startAfterVal !== null) q3 = q3.gt(rangeCol, normalizeRangeVal(rangeCol, query.startAfterVal));
        if (query.endAtVal !== undefined && query.endAtVal !== null) q3 = q3.lte(rangeCol, normalizeRangeVal(rangeCol, query.endAtVal));
        if (query.endBeforeVal !== undefined && query.endBeforeVal !== null) q3 = q3.lt(rangeCol, normalizeRangeVal(rangeCol, query.endBeforeVal));
      }
      if (query.limitN) q3 = q3.limit(query.limitN);
      if (query.orderDesc) q3 = q3.order(defaultTimeCol(table), { ascending: false });
      if (query.statusFilter) q3 = q3.eq('status', query.statusFilter);
    }

    /* Default sort for proper ordering */
    if (!query || !query.orderByField) {
      q3 = q3.order(defaultTimeCol(table), { ascending: false }).limit(500);
    }

    var r4 = await q3;
    return r4.data || [];
  }

  /* ── INSERT ── */
  async function supaInsert(p, data) {
    var supa = getSupa();
    if (!supa) return { key: 'fb_' + Date.now() };

    var nested = getNestedTableHandler(p);
    var table, conv, insertData;

    if (nested && nested.insertPatch) {
      /* Push to sub-table (e.g. users/uid/notifications) */
      table = nested.table;
      conv = getConverter(table);
      insertData = Object.assign({}, conv.to ? conv.to(data) : genericToSupa(data), nested.insertPatch);
    } else {
      var mapping = TABLE_MAP[p.root];
      if (!mapping) {
        console.warn('[Bridge] INSERT: Unknown table for path:', p.raw);
        return { key: 'fb_' + Date.now() };
      }
      table = mapping.table;
      conv = getConverter(table);
      insertData = conv.to ? conv.to(data) : genericToSupa(data);

      /* Set created_at / updated_at if not present — respects the
         TABLES_WITHOUT_CREATED_AT guard so tables like creator_stats and
         app_settings (which only have updated_at) don't get an unknown
         'created_at' column stamped onto the insert payload, which
         Postgres would reject with "column X.created_at does not exist"
         (this was previously only applied on the query/order-by path via
         defaultTimeCol(), never on the insert path — that gap is what
         caused the creator_stats insert failures). */
      var timeCol = defaultTimeCol(table);
      if (!insertData[timeCol]) insertData[timeCol] = new Date().toISOString();

      /* Add firebase_id if available (for cross-reference) */
      if (p.id) insertData[mapping.id] = insertData[mapping.id] || p.id;
    }

    /* Remove undefined/null keys */
    Object.keys(insertData).forEach(function(k) {
      if (insertData[k] === undefined) delete insertData[k];
    });

    var result = await supa.from(table).insert(insertData).select('id').single();

    /* Surface insert failures instead of silently faking a fallback ID.
       Previously, an RLS violation or column-grant rejection here would
       leave result.data null, and the code would return a fake
       'new_<timestamp>' key as if the insert had succeeded — callers
       (e.g. Quick Create Match) would show a success toast for a row
       that was never actually written. Now the error is logged loudly
       and re-thrown so the caller's own .catch()/toast logic (which
       already exists in most call sites) can show the real failure. */
    if (result.error) {
      console.error('[Bridge] INSERT failed for table "' + table + '":', result.error.message || result.error, insertData);
      throw new Error('Insert into ' + table + ' failed: ' + (result.error.message || 'unknown error'));
    }

    var newId = result.data ? result.data.id : ('new_' + Date.now());
    return { key: newId, id: newId };
  }

  /* ── UPDATE ── */
  async function supaUpdate(p, data) {
    var supa = getSupa();
    if (!supa) return;

    var nested = getNestedTableHandler(p);
    var table, conv, updateData, filter, extraFilter;

    if (nested) {
      table = nested.table;
      filter = nested.filter;
      extraFilter = nested.extraFilter;

      if (nested.field && !Array.isArray(data) && typeof data !== 'object') {
        /* Scalar field update */
        var patch = {};
        patch[nested.field] = data;
        if (table === 'users') patch.updated_at = new Date().toISOString();
        await applyFilter(supa.from(table).update(patch), nested);
        return;
      }

      conv = getConverter(table);
      updateData = conv.to ? conv.to(data) : genericToSupa(data);
    } else {
      var mapping = TABLE_MAP[p.root];
      if (!mapping) {
        console.warn('[Bridge] UPDATE: Unknown table for path:', p.raw);
        return;
      }
      table = mapping.table;
      filter = { col: mapping.id, val: p.id };
      conv = getConverter(table);
      updateData = conv.to ? conv.to(data) : genericToSupa(data);
    }

    if (!filter || !filter.val) {
      console.warn('[Bridge] UPDATE: No ID to filter on, path:', p.raw);
      return;
    }

    /* Add updated_at for users table */
    if (table === 'users' && !updateData.updated_at) updateData.updated_at = new Date().toISOString();

    /* Remove undefined keys */
    Object.keys(updateData).forEach(function(k) {
      if (updateData[k] === undefined) delete updateData[k];
    });

    var upQ = supa.from(table).update(updateData).eq(filter.col, filter.val);
    if (extraFilter) upQ = upQ.eq(extraFilter.col, extraFilter.val);
    await upQ;
  }

  /* ── SET (upsert) ── */
  async function supaSet(p, data) {
    var supa = getSupa();
    if (!supa) return;

    /* Scalar field set (e.g. users/uid/ffUid.set(value)) */
    var nested = getNestedTableHandler(p);
    if (nested && nested.field) {
      var patch = {};
      patch[nested.field] = data;
      if (nested.table === 'users') patch.updated_at = new Date().toISOString();
      /* ✅ FIX (Audit H4): composite-key tables (battlePass, etc.) — row
         shaayad pehli baar exist hi na kare (e.g. user ne abhi tak us
         season mein kuch kiya hi nahi), isliye blind UPDATE silently
         0 rows affect karega. Upsert use karo taaki row na ho to ban jaaye. */
      if (nested.insertPatch) {
        var upsertPatch = Object.assign({}, nested.insertPatch, patch);
        var conflictCols = Object.keys(nested.insertPatch).join(',');
        await supa.from(nested.table).upsert(upsertPatch, { onConflict: conflictCols });
        return;
      }
      await applyFilter(supa.from(nested.table).update(patch), nested);
      return;
    }

    if (nested && data === null) {
      /* .set(null) = clear the field */
      if (nested.field) {
        var clearPatch = {};
        clearPatch[nested.field] = null;
        await applyFilter(supa.from(nested.table).update(clearPatch), nested);
      }
      return;
    }

    /* Nested sub-table INSERT (e.g. users/uid/notifications/nid.set({...})) */
    if (nested && nested.insertPatch && typeof data === 'object' && data !== null) {
      var conv = getConverter(nested.table);
      var insertData = Object.assign(
        {},
        conv.to ? conv.to(data) : genericToSupa(data),
        nested.insertPatch
      );
      /* Use sub-path id as the row id if the table has an id column */
      if (p.sub) insertData.id = p.sub;
      if (!insertData.created_at) insertData.created_at = new Date().toISOString();
      Object.keys(insertData).forEach(function(k) {
        if (insertData[k] === undefined) delete insertData[k];
      });
      /* Upsert so re-setting same id is idempotent */
      await supa.from(nested.table).upsert(insertData, { onConflict: 'id' });
      return;
    }

    /* Upsert row at root table */
    var mapping = TABLE_MAP[p.root];
    if (!mapping) return;
    var table = mapping.table;
    var convRoot = getConverter(table);
    var upsertData = convRoot.to ? convRoot.to(data) : genericToSupa(data);
    if (p.id) upsertData[mapping.id] = p.id;
    if (!upsertData.created_at) upsertData.created_at = new Date().toISOString();
    upsertData.updated_at = new Date().toISOString();

    await supa.from(table).upsert(upsertData, { onConflict: mapping.id });
  }

  /* ── DELETE ── */
  async function supaDelete(p) {
    var supa = getSupa();
    if (!supa) return;

    var nested = getNestedTableHandler(p);
    if (nested) {
      /* If a specific sub-record id is given, delete only that record */
      if (p.sub) {
        await supa.from(nested.table).delete().eq('id', p.sub);
      } else {
        /* No sub-id: delete record(s) matching the filter (+ extraFilter
           for composite-key tables like autoMatchQueue/{matchId}/{uid}) */
        await applyFilter(supa.from(nested.table).delete(), nested);
      }
      return;
    }

    var mapping = TABLE_MAP[p.root];
    if (!mapping || !p.id) return;
    await supa.from(mapping.table).delete().eq(mapping.id, p.id);
  }

  /* ── TRANSACTION (atomic increment/decrement) ── */
  async function supaTransaction(p, fn) {
    var supa = getSupa();
    if (!supa) return { committed: false, snapshot: makeSnapshot(null, null, null, true) };

    var nested = getNestedTableHandler(p);

    if (nested && nested.field && nested.table === 'users') {
      /* Atomic balance update via RPC */
      var readRes = await supa.from('users').select(nested.field).eq('id', nested.filter.val).single();
      var current = readRes.data ? (readRes.data[nested.field] || 0) : 0;
      var newVal = fn(current);
      if (newVal === undefined) return { committed: false, snapshot: makeSnapshot(current, p.field, null, true) };

      newVal = Math.max(0, Number(newVal) || 0); /* Never go negative */
      var patch = {};
      patch[nested.field] = newVal;
      patch.updated_at = new Date().toISOString();
      await supa.from('users').update(patch).eq('id', nested.filter.val);
      return { committed: true, snapshot: makeSnapshot(newVal, p.field, null, true) };
    }

    /* Generic transaction — read then write */
    var r = await supaRead(p, null);
    var currentVal = Array.isArray(r) ? r : (r || null);
    var newValue = fn(currentVal);
    if (newValue !== undefined) {
      await supaUpdate(p, newValue);
    }
    return { committed: true, snapshot: makeSnapshot(newValue, p.id, p.root, false) };
  }

  /* ═══════════════════════════════════════════════════════════════════
     8. REALTIME LISTENERS — Supabase Realtime channels ke saath
  ═══════════════════════════════════════════════════════════════════ */

  var _channels = {};
  var _pollingTimers = {};

  function setupRealtimeListener(p, callback, query) {
    var supa = getSupa();
    if (!supa) return function() {};

    var mapping = TABLE_MAP[p.root];
    if (!mapping) return function() {};

    var table = mapping.table;
    var channelKey = p.raw;

    /* Remove existing channel */
    if (_channels[channelKey]) {
      try { supa.removeChannel(_channels[channelKey]); } catch(e) {}
      delete _channels[channelKey];
    }

    /* Initial load */
    var doRead = function() {
      supaRead(p, query).then(function(data) {
        var snap;
        var isScalar = (data !== null && !Array.isArray(data) && typeof data !== 'object');
        if (data === null || data === undefined) {
          snap = makeSnapshot([], p.root, table, false);
        } else if (Array.isArray(data)) {
          snap = makeSnapshot(data, p.root, table, false);
        } else if (isScalar) {
          snap = makeSnapshot(data, p.id || p.root, table, true);
        } else {
          snap = makeSnapshot([data], p.id || p.root, table, false);
        }
        callback(snap);
      }).catch(function(e) {
        console.error('[Bridge] Realtime read error:', e);
      });
    };

    doRead();

    /* Subscribe to Supabase Realtime changes */
    try {
      var channel = supa.channel('bridge_' + table + '_' + Date.now())
        .on('postgres_changes', { event: '*', schema: 'public', table: table }, function() {
          doRead();
        })
        .subscribe();
      _channels[channelKey] = channel;
    } catch(e) {
      /* Fallback: poll every 5 seconds */
      _pollingTimers[channelKey] = setInterval(doRead, 5000);
    }

    /* Return cleanup function */
    return function() {
      if (_channels[channelKey]) {
        try { supa.removeChannel(_channels[channelKey]); } catch(e) {}
        delete _channels[channelKey];
      }
      if (_pollingTimers[channelKey]) {
        clearInterval(_pollingTimers[channelKey]);
        delete _pollingTimers[channelKey];
      }
    };
  }

  /* ═══════════════════════════════════════════════════════════════════
     9. SUPAREF CLASS — Firebase ref API ko implement karta hai
  ═══════════════════════════════════════════════════════════════════ */

  function SupaRef(path, query) {
    this._path = path;
    this._p = parsePath(path);
    this._query = query || null;
    this._listenerCleanup = null;
  }

  /* READ ONCE */
  SupaRef.prototype.once = function(event, callbackFn) {
    var self = this;
    var promise = supaRead(self._p, self._query).then(function(data) {
      var snap;
      if (data === null || data === undefined) {
        snap = makeSnapshot([], self._p.root, null, false);
      } else if (Array.isArray(data)) {
        snap = makeSnapshot(data, self._p.root, TABLE_MAP[self._p.root] ? TABLE_MAP[self._p.root].table : null, false);
      } else if (typeof data !== 'object') {
        snap = makeSnapshot(data, self._p.id || self._p.root, null, true);
      } else {
        snap = makeSnapshot([data], self._p.id || self._p.root, TABLE_MAP[self._p.root] ? TABLE_MAP[self._p.root].table : null, false);
      }
      if (typeof callbackFn === 'function') callbackFn(snap);
      return snap;
    });
    return promise;
  };


  /* REALTIME LISTENER — value, child_added, child_changed, child_removed */
  SupaRef.prototype.on = function(event, callback) {
    var self = this;
    var supa = getSupa();
    var mapping = TABLE_MAP[self._p.root];
    if (!mapping || !supa) { return callback; }
    var table = mapping.table;
    var idCol  = mapping.id || 'id';
    var conv   = getConverter(table);

    /* ── 'value' — full table listener (unchanged) ── */
    if (event === 'value') {
      self._listenerCleanup = setupRealtimeListener(self._p, callback, self._query);
      return callback;
    }

    /* ── child_added / child_changed / child_removed ── */
    var supaEvent = event === 'child_added'   ? 'INSERT'
                  : event === 'child_changed' ? 'UPDATE'
                  :                             'DELETE';
    var channelKey = self._p.raw + '_' + event + '_' + Date.now();

    /* Helper: build a proper child snapshot where
       snap.key  = row id  (e.g. match UUID)
       snap.val() = camelCase row data  (matchFromSupa applied)            */
    function makeChildSnap(row) {
      var rowKey = (row && row[idCol]) || (row && row.id) || ('row_' + Date.now());
      /* Pass single row object — NOT wrapped in array — so val() returns
         the converted object directly, not { id: object }                  */
      return makeSnapshot(row, rowKey, table, false);
    }

    /* Initial load for child_added: fire once per existing row */
    if (event === 'child_added') {
      supaRead(self._p, self._query).then(function(rows) {
        var arr = Array.isArray(rows) ? rows : (rows ? [rows] : []);
        arr.forEach(function(row) { callback(makeChildSnap(row)); });
      }).catch(function(){});
    }

    /* Supabase Realtime subscription for future changes */
    try {
      var ch = supa.channel('bridge_' + table + '_' + supaEvent + '_' + Date.now())
        .on('postgres_changes', { event: supaEvent, schema: 'public', table: table },
          function(payload) {
            /* payload.new for INSERT/UPDATE, payload.old for DELETE */
            var raw = payload.new || payload.old || null;
            if (!raw) return;
            /* Apply fromSupa converter so data is camelCase */
            var row = conv.from ? conv.from(raw) : raw;
            callback(makeChildSnap(row));
          })
        .subscribe();
      _channels[channelKey] = ch;
      /* Store cleanup on SupaRef so .off() works */
      self._listenerCleanup = function() {
        try { supa.removeChannel(ch); } catch(e) {}
        delete _channels[channelKey];
      };
    } catch(e) {
      console.warn('[Bridge] Realtime subscription failed:', e);
      /* Polling fallback: poll every 4s and diff against last known state */
      var _lastIds = {};
      _pollingTimers[channelKey] = setInterval(function() {
        supaRead(self._p, self._query).then(function(rows) {
          var arr = Array.isArray(rows) ? rows : (rows ? [rows] : []);
          arr.forEach(function(row) {
            var rk = (row && row[idCol]) || (row && row.id);
            if (!rk) return;
            var currentHash = JSON.stringify(row);
            if (event === 'child_added' && !_lastIds[rk]) {
              _lastIds[rk] = currentHash;
              callback(makeChildSnap(row));
            } else if (event === 'child_changed' && _lastIds[rk] && _lastIds[rk] !== currentHash) {
              _lastIds[rk] = currentHash;
              callback(makeChildSnap(row));
            } else if (!_lastIds[rk]) {
              _lastIds[rk] = currentHash;
            }
          });
        }).catch(function(){});
      }, 4000);
    }

    return callback;
  };

  SupaRef.prototype.off = function() {
    var supa = getSupa();
    if (typeof this._listenerCleanup === "function") {
      this._listenerCleanup();
      this._listenerCleanup = null;
    }
    var rawPath = this._p ? this._p.raw : "";
    ["value","child_added","child_changed","child_removed"].forEach(function(ev) {
      var key = rawPath + "_" + ev;
      if (_channels[key]) {
        try { if (supa) supa.removeChannel(_channels[key]); } catch(e) {}
        delete _channels[key];
      }
    });
  };


  /* INSERT (push) */
  SupaRef.prototype.push = function(data) {
    var self = this;
    if (data === undefined || data === null) {
      /* push() with no args: used as push().key to pre-generate a key */
      var tempKey = 'new_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
      return {
        key: tempKey,
        set: function(d, cb) {
          var p = supaInsert(self._p, Object.assign({}, d, { id: tempKey }));
          if (cb) p.then(function() { cb(null); }, cb);
          return p;
        },
        update: function(d, cb) {
          var p = supaUpdate(parsePath(self._p.raw + '/' + tempKey), d);
          if (cb) p.then(function() { cb(null); }, cb);
          return p;
        }
      };
    }
    return supaInsert(self._p, data).then(function(ref) {
      return ref;
    });
  };

  /* SET (replace/upsert) */
  SupaRef.prototype.set = function(data, callback) {
    var result = supaSet(this._p, data);
    if (callback) result && result.then ? result.then(function() { callback(null); }, callback) : callback(null);
    return result;
  };

  /* UPDATE (partial) */
  SupaRef.prototype.update = function(data, callback) {
    var self = this;
    var isRootOrEmpty = (self._p.root === '' || self._p.root === '/' || !self._p.id);

    /* Detect multi-path batch: an object where keys contain '/' (Firebase pattern) */
    if (isRootOrEmpty && data && typeof data === 'object') {
      var keys = Object.keys(data);
      var isMultiPath = keys.some(function(k) { return k.indexOf('/') > -1; });
      if (isMultiPath) {
        var promises = keys.map(function(path) {
          var p = parsePath(path);
          if (isFirebasePath(p.raw)) return Promise.resolve();
          return supaUpdate(p, data[path]);
        });
        var result = Promise.all(promises);
        if (callback) result.then(callback, callback);
        return result;
      }
    }

    var result = supaUpdate(self._p, data);
    if (callback) result.then(callback, callback);
    return result;
  };

  /* DELETE */
  SupaRef.prototype.remove = function() {
    return supaDelete(this._p);
  };

  /* TRANSACTION */
  SupaRef.prototype.transaction = function(fn) {
    return supaTransaction(this._p, fn);
  };

  /* QUERY BUILDER */
  SupaRef.prototype.orderByChild = function(field) {
    return new SupaRef(this._path, Object.assign({}, this._query, { orderByField: field }));
  };
  SupaRef.prototype.equalTo = function(val) {
    return new SupaRef(this._path, Object.assign({}, this._query, { equalToVal: val }));
  };
  SupaRef.prototype.limitToLast = function(n) {
    return new SupaRef(this._path, Object.assign({}, this._query, { limitN: n, orderDesc: true }));
  };
  SupaRef.prototype.limitToFirst = function(n) {
    return new SupaRef(this._path, Object.assign({}, this._query, { limitN: n }));
  };
  SupaRef.prototype.orderByKey = function() {
    return new SupaRef(this._path, this._query);
  };
  /* ✅ AUDIT FIX (critical): these 4 methods were MISSING entirely — real
     Firebase Query supports them and 7+ admin files call them on
     db.ref(...) for paths that route through this Supabase bridge
     (fraud-control-center, admin-activity-log, automation bundles,
     server-side search, sponsored-tournaments pagination). Without these,
     every one of those calls threw "X is not a function" and crashed the
     feature. They mirror Firebase RTDB range-query semantics, applied on
     whichever column .orderByChild() selected. */
  SupaRef.prototype.startAt = function(val) {
    return new SupaRef(this._path, Object.assign({}, this._query, { startAtVal: val }));
  };
  SupaRef.prototype.endAt = function(val) {
    return new SupaRef(this._path, Object.assign({}, this._query, { endAtVal: val }));
  };
  SupaRef.prototype.startAfter = function(val) {
    return new SupaRef(this._path, Object.assign({}, this._query, { startAfterVal: val }));
  };
  SupaRef.prototype.endBefore = function(val, key) {
    /* Firebase supports a 2-arg cursor form (value, key) for pagination.
       When val is null (sponsored-tournaments "load more" passes the key
       only), we intentionally skip the value filter rather than guess —
       the caller already dedupes accumulated items by key, so this just
       means slightly more overlap re-fetched on later pages, never wrong
       data and never a crash. */
    return new SupaRef(this._path, Object.assign({}, this._query, { endBeforeVal: val, endBeforeKey: key }));
  };

  /* ═══════════════════════════════════════════════════════════════════
     10. RTDB BRIDGE OBJECT — Real Firebase RTDB ko replace karta hai
  ═══════════════════════════════════════════════════════════════════ */

  function RtdbBridge(realRtdb) {
    this._real = realRtdb;
  }

  RtdbBridge.prototype.ref = function(path) {
    path = path || '/';
    /* Firebase-only paths → real RTDB */
    if (isFirebasePath(path)) {
      return this._real.ref(path);
    }
    /* Everything else → Supabase */
    return new SupaRef(path);
  };

  /* Root-level ref().update() for batch updates */
  RtdbBridge.prototype.update = function(updates) {
    var promises = [];
    Object.keys(updates).forEach(function(path) {
      var p = parsePath(path);
      if (isFirebasePath(p.raw)) return;
      promises.push(supaUpdate(p, updates[path]));
    });
    return Promise.all(promises);
  };

  /* ═══════════════════════════════════════════════════════════════════
     11. INSTALL THE BRIDGE
     Firebase RTDB ko replace karte hain jab ready ho
  ═══════════════════════════════════════════════════════════════════ */

  function installBridge() {
    if (!window.rtdb || !window.rtdb.ref) {
      /* Firebase RTDB not initialized yet — wait */
      setTimeout(installBridge, 300);
      return;
    }
    if (window.rtdb._isSupaBridge) {
      /* Already installed — don't install twice */
      return;
    }
    if (!window._supa) {
      setTimeout(installBridge, 300);
      return;
    }

    /* Get real Firebase RTDB — NOT Firestore (window.db might be Firestore) */
    var realRtdb = window.rtdb;
    if (!realRtdb || !realRtdb.ref) {
      /* window.rtdb not set yet, try again */
      setTimeout(installBridge, 300);
      return;
    }
    window._realFbRtdb = realRtdb; /* Save real RTDB for chat/deviceJoins */

    var bridge = new RtdbBridge(realRtdb);
    window.rtdb = bridge;
    window.rtdb._isSupaBridge = true; /* Marker to prevent double install */
    /* NOTE: window.db is Firestore — DO NOT override it */

    console.log('%c[Supabase Bridge] ✅ Installed — Firebase RTDB replaced by Supabase (except chat/deviceJoins/appSettings)', 'color:#00ff9c;font-weight:700');

    /* Also patch _adminNotifyUser to write ONLY to Supabase (remove Firebase write for notifications) */
    _patchNotifications();

    /* Patch _adminNotifyAll to write ONLY to Supabase */
    _patchGlobalNotifications();

    /* Patch activityLogs to go to Supabase admin_activity_log */
    _patchActivityLog();
  }

  /* ── Patch notification functions to remove Firebase writes ── */
  function _patchNotifications() {
    window._adminNotifyUser = function(uid, payload) {
      if (!uid) return Promise.resolve();
      var supa = window._supa;
      if (!supa) return Promise.resolve();
      /* BUG #26-followup FIX (2026-07): notifications.type/title/body/ref_id are no
         longer directly INSERT-able by any client (Category A security fix — see
         AUDIT-LOG) since a regular user could otherwise fake a system notification.
         Must go through the admin_send_notification RPC, which checks is_admin
         server-side before inserting. */
      return supa.rpc('admin_send_notification', {
        p_user_id: uid,
        p_type:    payload.type    || 'admin_alert',
        p_title:   payload.title   || '',
        p_body:    payload.message || payload.body || '',
        p_ref_id:  payload.matchId || payload.ref_id || null
      }).then(function() {
        /* Also write to Firebase for OneSignal push triggers */
        try {
          var fbPayload = Object.assign({ timestamp: Date.now(), read: false }, payload);
          window._realFbRtdb.ref('users/' + uid + '/notifications').push(fbPayload)
            .catch(function(e) { console.warn('[Bridge] Firebase notif fail:', e.message); });
        } catch(e) {}
      }).catch(function(e) {
        console.warn('[Bridge] _adminNotifyUser Supabase fail:', e.message);
      });
    };
  }

  function _patchGlobalNotifications() {
    window._adminNotifyAll = function(title, body, type) {
      var supa = window._supa;
      if (supa) {
        /* BUG #26-followup FIX (2026-07): same reasoning as _adminNotifyUser above —
           target_all is no longer client-INSERT-able directly, must go through the
           admin-checked RPC. */
        supa.rpc('admin_send_broadcast_notification', {
          p_type: type || 'admin_alert', p_title: title, p_body: body
        }).catch(function(e) { console.warn('[Bridge] Global notif Supabase fail:', e.message); });
      }
    };
  }

  function _patchActivityLog() {
    var _origLogActivity = window.logAdminActivity;
    window.logAdminActivity = function(type, data) {
      var supa = window._supa;
      if (supa) {
        supa.from('admin_activity_log').insert({
          action_type: type || 'admin_action',
          action:      (data && data.action) || type || '',
          target_uid:  (data && (data.uid || data.targetUid)) || null,
          admin_uid:   (data && (data.admin || data.adminUid)) || null,
          details:     JSON.stringify(data || {}),
          created_at:  new Date().toISOString()
        }).catch(function() {});
      }
      if (typeof _origLogActivity === 'function') _origLogActivity.apply(this, arguments);
    };
  }

  /* ═══════════════════════════════════════════════════════════════════
     12. STARTUP — Wait for both Firebase and Supabase to be ready
  ═══════════════════════════════════════════════════════════════════ */

  /* Start trying to install as early as possible — no artificial delay.
     installBridge() already self-guards (checks window.rtdb.ref and
     window._supa, retries every 300ms if either isn't ready yet), so an
     extra flat delay here only widens the window during which a fast
     (cached-session) auth callback could attach match/join-request
     listeners to raw Firebase before the bridge swaps in — and any
     .on() realtime listener bound during that window stays bound to
     real Firebase for the rest of the session, even after window.rtdb
     is reassigned. This was the root cause of match data appearing to
     come from Firebase in the Admin Panel (v32.8.3 audit). */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installBridge);
  } else {
    installBridge();
  }

  /* Also expose bridge installer globally for manual triggering */
  window._installSupaBridge = installBridge;

})();

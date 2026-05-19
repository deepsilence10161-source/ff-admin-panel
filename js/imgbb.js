/* ================================================================
   IMGBB UPLOAD — core/imgbb.js
   MiniESports v2.0 | May 2026
   
   Replaces Firebase Storage / base64 storage
   ImgBB API → free, no credit card, direct URLs
================================================================ */
(function() {
  'use strict';

  var IMGBB_KEY = 'c977a42da70cbc98fe176af64fbc484f';
  var IMGBB_URL = 'https://api.imgbb.com/1/upload';

  /* ── uploadToImgBB(base64orFile, name, callback) ──
     callback(err, url) — url is the direct image URL */
  window.uploadToImgBB = function(input, name, callback) {
    /* Accept base64 string OR File object */
    if (input instanceof File || input instanceof Blob) {
      var reader = new FileReader();
      reader.onload = function(e) {
        var b64 = e.target.result.split(',')[1]; /* strip data:image/...;base64, */
        _doUpload(b64, name, callback);
      };
      reader.onerror = function() { callback('File read error', null); };
      reader.readAsDataURL(input);
    } else if (typeof input === 'string') {
      /* Already base64 — strip prefix if present */
      var b64 = input.indexOf(',') > -1 ? input.split(',')[1] : input;
      _doUpload(b64, name, callback);
    } else {
      callback('Invalid input', null);
    }
  };

  function _doUpload(b64, name, callback) {
    var formData = new FormData();
    formData.append('key', IMGBB_KEY);
    formData.append('image', b64);
    if (name) formData.append('name', name);
    formData.append('expiration', '0'); /* No expiry */

    fetch(IMGBB_URL, { method: 'POST', body: formData })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data && data.success && data.data && data.data.url) {
          callback(null, data.data.url, data.data.display_url, data.data.thumb && data.data.thumb.url);
        } else {
          callback(data && data.error ? data.error.message : 'Upload failed', null);
        }
      })
      .catch(function(err) { callback(err.message || 'Network error', null); });
  }

  /* ── Convenience: upload profile image ── */
  window.uploadProfileImage = function(file, callback) {
    var uid = window.U ? window.U.uid : 'user';
    var name = 'profile_' + uid + '_' + Date.now();
    compImg(file, 400, 0.8, 150, function(b64) {
      uploadToImgBB(b64, name, function(err, url) {
        if (err) { toast('Image upload failed: ' + err, 'err'); return; }
        /* Save URL to Firebase + Supabase */
        if (window.db) db.ref('users/' + uid + '/profileImage').set(url);
        if (window.DB) DB.users.update({ avatar_url: url });
        if (callback) callback(url);
      });
    });
  };

  /* ── Convenience: upload banner image ── */
  window.uploadBannerImage = function(file, callback) {
    var uid = window.U ? window.U.uid : 'user';
    var name = 'banner_' + uid + '_' + Date.now();
    compImg(file, 800, 0.75, 250, function(b64) {
      uploadToImgBB(b64, name, function(err, url) {
        if (err) { toast('Banner upload failed: ' + err, 'err'); return; }
        if (window.db) db.ref('users/' + uid + '/bannerImage').set(url);
        if (window.DB) DB.users.update({ avatar_url: url });
        if (callback) callback(url);
      });
    });
  };

  /* ── Convenience: upload wallet screenshot ── */
  window.uploadWalletScreenshot = function(b64, callback) {
    var uid = window.U ? window.U.uid : 'user';
    var name = 'wallet_ss_' + uid + '_' + Date.now();
    uploadToImgBB(b64, name, function(err, url) {
      if (err) { callback(null); return; } /* Non-fatal — fallback to base64 */
      callback(url);
    });
  };

  console.log('[ImgBB] Image upload ready');
})();

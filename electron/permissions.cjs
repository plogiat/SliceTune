function createMediaPermissionPolicy(getContents, documentURL) {
  function sameDocument(value) {
    try { const url = new URL(value); url.hash = ''; url.search = ''; return url.href === documentURL; }
    catch { return false; }
  }
  function trusted(contents, details) {
    return !!contents && contents === getContents() && !contents.isDestroyed() && details.isMainFrame !== false && sameDocument(contents.getURL()) && sameDocument(details.requestingUrl || contents.getURL());
  }
  return {
    check(contents, permission, _origin, details = {}) {
      // Chromium also checks "unknown" media for device enumeration. Actual
      // capture requests below still require an audio-only mediaTypes list.
      return permission === 'media' && trusted(contents, details) && details.mediaType !== 'video';
    },
    request(contents, permission, callback, details = {}) {
      callback(permission === 'media' && trusted(contents, details) && Array.isArray(details.mediaTypes) && details.mediaTypes.length > 0 && details.mediaTypes.every(type => type === 'audio'));
    }
  };
}
module.exports = { createMediaPermissionPolicy };

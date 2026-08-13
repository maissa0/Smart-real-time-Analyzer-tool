// WebGL bridge: Unity → Angular for 3D-twin snapshots.
//
// CanBridge.CaptureSnapshot() (C#) grabs the current frame, PNG-encodes it,
// base64-encodes that, and calls SendSnapshotToPage(base64). Here we forward
// the string to the browser as a 'unity-snapshot' CustomEvent, which the Angular
// TwinTabComponent.captureSnapshot() listens for.
mergeInto(LibraryManager.library, {
  SendSnapshotToPage: function (base64Ptr) {
    var b64 = UTF8ToString(base64Ptr);
    try {
      window.dispatchEvent(new CustomEvent('unity-snapshot', { detail: b64 }));
    } catch (e) {
      console.warn('unity-snapshot dispatch failed', e);
    }
  },
});

// WebGL bridge: Unity → Angular pour l'etat de la cle electronique.
//
// KeyController (C#, GameObject 'KeyRoot') appelle SendKeyStateToPage a chaque
// changement de zone. L'evenement 'unity-keystate' (detail: 'inside' |
// 'outside' | 'unknown') est emis vers la page, comme 'unity-snapshot'.
mergeInto(LibraryManager.library, {
  SendKeyStateToPage: function (statePtr) {
    var s = UTF8ToString(statePtr);
    try {
      window.dispatchEvent(new CustomEvent('unity-keystate', { detail: s }));
    } catch (e) {
      console.warn('unity-keystate dispatch failed', e);
    }
  },
});
